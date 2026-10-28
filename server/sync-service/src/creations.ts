/**
 * Creations (Phase 07): the player-facing side of generation.
 *
 *   POST /api/player/create        { prompt, kind?, seconds?, loop? } → { jobId, estimate } | 402 { message }
 *                                  kind: model (default) | image | sound | music | voice (Rough Draft M5)
 *   GET  /api/player/create/:jobId                  → { status, progress, assetUrl?, error? }
 *   POST /api/player/lore          { prompt, subject? } → { text, mana } (synchronous, short)
 *   GET  /assets/:sha256.(glb|png|webp|mp3|wav)     → proxied from genai-service (public, immutable)
 *
 * Mana: reserve the estimate at admission (Phase 05 requestDraw), then settle
 * the actual cost when the job completes, or release it if it fails. The
 * provider work happens in genai-service (internal, GENAI_URL).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { RoomManager } from "./rooms.js";
import { getDb } from "./persistence.js";
import type { PlayerProgress } from "../../../shared/crdt-schema.js";
import { checkCreation, chargeCheck, SAFETY_MODEL } from "./safety.js";
import { tryResearchId } from "./research.js";
import { isMakeKind, makeEstimate, clampSeconds, MAKE_SKILL, VOICE_MAX_CHARS, type MakeKind } from "../../../shared/make-costs.js";

const GENAI_URL = process.env.GENAI_URL ?? "http://genai-service:3001";

/** Meshy preview + texture refine ≈ $0.60 (30 credits × $0.02) × K = 100 → 60 mana. */
export const MODEL_ESTIMATE_MANA = 60;

/** The character's chapter/level for admission (Rough Draft M3: was a provisional "everyone is chapter 5"). */
const progressOf = (rooms: RoomManager, playerId: string): PlayerProgress => rooms.progress.playerProgress(playerId);

interface Creation {
  ref: string;
  playerId: string;
  settled: boolean;
  /** What was made (older rows: model). */
  kind?: MakeKind;
}

/** jobId → creation, persisted so a restart can still settle or release its hold. */
let ready = false;
function table() {
  const d = getDb();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS creations (
      job_id TEXT PRIMARY KEY, ref TEXT NOT NULL, player_id TEXT NOT NULL,
      settled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`);
    try { d.exec("ALTER TABLE creations ADD COLUMN kind TEXT"); } catch { /* already there */ }
    // The sweeper's lookups (sweepCreations)
    d.exec("CREATE INDEX IF NOT EXISTS creations_open ON creations (settled, created_at)");
    d.exec("CREATE INDEX IF NOT EXISTS creations_ref ON creations (ref)");
    ready = true;
  }
  return d;
}
const creations = {
  get(jobId: string): Creation | undefined {
    const r = table().prepare("SELECT ref, player_id, settled, kind FROM creations WHERE job_id = ?").get(jobId) as
      | { ref: string; player_id: string; settled: number; kind: string | null } | undefined;
    return r ? { ref: r.ref, playerId: r.player_id, settled: !!r.settled, kind: isMakeKind(r.kind) ? r.kind : "model" } : undefined;
  },
  set(jobId: string, c: Creation): void {
    table().prepare("INSERT OR REPLACE INTO creations (job_id, ref, player_id, settled, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(jobId, c.ref, c.playerId, c.settled ? 1 : 0, c.kind ?? "model", Date.now());
  },
  markSettled(jobId: string): void {
    table().prepare("UPDATE creations SET settled = 1 WHERE job_id = ?").run(jobId);
  },
};

type Json = (status: number, body: unknown) => void;

/** GET /api/player/mana: this player's allowance, usage and averages, plus the universe flow. Read-only. */
export function manaStatus(rooms: RoomManager, playerId: string, json: Json, guest = false): void {
  const now = Date.now();
  const usage = rooms.mana.playerUsage(playerId, now - 7 * 24 * 60 * 60 * 1000);
  const { available, ...status } = rooms.admission.status(playerId, progressOf(rooms, playerId));
  return json(200, {
    ...status,
    guest,
    remaining: available,
    held: usage.held,
    week: { plan: usage.plan, model: usage.model, media: usage.media },
    recent: usage.recent,
    pool: { creative: rooms.mana.state().creative, available: rooms.mana.available() },
  });
}

/** Body of POST /api/player/create. Media fields are ignored for models. */
export interface CreateRequest { prompt?: unknown; kind?: unknown; seconds?: unknown; loop?: unknown }

export async function startCreation(rooms: RoomManager, playerId: string, body: CreateRequest | null, json: Json): Promise<void> {
  let kind: Exclude<MakeKind, "lore"> = "model";
  if (body?.kind !== undefined) {
    if (!isMakeKind(body.kind) || body.kind === "lore") return json(400, { error: "bad_kind" });
    kind = body.kind;
  }
  const max = kind === "voice" ? VOICE_MAX_CHARS : 600;
  const text = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, max) : "";
  if (!text) return json(400, { error: "empty_prompt" });
  const params: Record<string, number | boolean> = {};
  if (kind === "sound" || kind === "music") params.seconds = clampSeconds(kind, body?.seconds);
  if (kind === "sound") params.loop = body?.loop === true;
  const estimate = makeEstimate(kind, { seconds: params.seconds as number | undefined, chars: text.length });

  const ref = `create:${randomUUID()}`;
  const decision = rooms.admission.requestDraw({ playerId, ref, estimate, progress: progressOf(rooms, playerId) });
  if (!decision.ok) return json(402, { error: decision.reason, message: decision.message, remainingToday: decision.remainingToday });

  // Safety before any provider ever sees it (M1)
  const safe = await checkCreation(playerId, kind === "model" ? "make" : `make:${kind}`, [text], ref);
  chargeCheck(rooms.mana, playerId, ref, safe.costUsd);
  if (!safe.ok) {
    rooms.mana.release(ref);
    return json(422, { error: "unsafe", category: safe.category, message: safe.message, suggestion: safe.suggestion || undefined });
  }

  try {
    const jobId = await startJob(ref, playerId, text, kind, params);
    return json(200, { jobId, kind, estimate, remainingToday: decision.remainingToday });
  } catch (err) {
    rooms.mana.release(ref);
    console.error("[create] genai unavailable:", (err as Error).message);
    return json(503, { error: "genai_unavailable", message: "Creation is resting right now. Try again soon." });
  }
}

/**
 * Start a job for a hold that's already reserved (`ref`). The status route
 * settles or releases it. Throws if genai is unreachable (caller releases).
 */
export async function startJob(
  ref: string, playerId: string, prompt: string, kind: Exclude<MakeKind, "lore"> = "model", params?: Record<string, number | boolean>,
): Promise<string> {
  const res = await fetch(`${GENAI_URL}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref, kind, prompt: prompt.slice(0, kind === "voice" ? VOICE_MAX_CHARS : 600), creator: playerId, params, researchId: tryResearchId(playerId) }),
  });
  const body = (await res.json()) as { jobId?: string };
  if (!res.ok || !body.jobId) throw new Error(`genai ${res.status}`);
  creations.set(body.jobId, { ref, playerId, settled: false, kind });
  return body.jobId;
}

interface JobView { status: string; progress: number; asset: string | null; costUsd: number | null; error: string | null }

/** Settle a finished job's hold (or release a failed one's). Idempotent per job. */
function reconcile(rooms: RoomManager, jobId: string, c: Creation, j: JobView): void {
  if (c.settled) return;
  const kind = c.kind ?? "model";
  if (j.status === "complete") {
    const mana = Math.max(0, (j.costUsd ?? 0) * 100);
    rooms.mana.settle(c.ref, mana, kind);
    creations.markSettled(jobId);
    rooms.progress.creation(c.playerId, mana, jobId, MAKE_SKILL[kind]);
  } else if (j.status === "failed") {
    rooms.mana.release(c.ref); // failed generations draw nothing
    creations.markSettled(jobId);
  }
}

export async function creationStatus(rooms: RoomManager, playerId: string, jobId: string, json: Json): Promise<void> {
  const c = creations.get(jobId);
  if (!c || c.playerId !== playerId) return json(404, { error: "not_found" });
  const res = await fetch(`${GENAI_URL}/jobs/${encodeURIComponent(jobId)}`).catch(() => null);
  if (!res?.ok) return json(503, { error: "genai_unavailable" });
  const j = (await res.json()) as JobView;
  reconcile(rooms, jobId, c, j);
  return json(200, {
    status: j.status,
    kind: c.kind ?? "model",
    progress: j.progress,
    asset: j.status === "complete" ? j.asset : undefined,
    error: j.status === "failed" ? "The making didn't take. Nothing was drawn." : undefined,
  });
}

/** Jobs younger than this are left to the maker's own polling. */
const SWEEP_AFTER_MS = 3 * 60_000;
/** A job genai no longer knows (lost in a restart) is released after this long. */
const LOST_AFTER_MS = 60 * 60_000;
/** Per sweep, so a backlog can't hammer genai. */
const SWEEP_BATCH = 25;

/** No generation runs this long: a hold this old is stuck, and goes back. */
const STALE_HOLD_MS = 6 * 60 * 60_000;

/**
 * Holds used to settle only when the maker's browser polled the status
 * route, so a closed tab left its estimate held forever. This settles or
 * releases unsettled jobs nobody is watching, a bounded batch per call
 * (index.ts runs it every minute). It also returns any hold older than
 * STALE_HOLD_MS (covers holds with no job row at all).
 */
export async function sweepCreations(rooms: RoomManager, now = Date.now()): Promise<{ settled: number; released: number }> {
  let settled = 0, released = 0;
  for (const ref of rooms.mana.staleHolds(now - STALE_HOLD_MS)) {
    if (rooms.mana.release(ref)) released++;
    table().prepare("UPDATE creations SET settled = 1 WHERE ref = ?").run(ref);
  }
  const rows = table()
    .prepare("SELECT job_id, created_at FROM creations WHERE settled = 0 AND created_at < ? ORDER BY created_at LIMIT ?")
    .all(now - SWEEP_AFTER_MS, SWEEP_BATCH) as { job_id: string; created_at: number }[];
  for (const r of rows) {
    const c = creations.get(r.job_id);
    if (!c || c.settled) continue;
    const res = await fetch(`${GENAI_URL}/jobs/${encodeURIComponent(r.job_id)}`).catch(() => null);
    if (!res) return { settled, released }; // genai down: try again next sweep
    if (res.status === 404) {
      if (now - r.created_at > LOST_AFTER_MS) {
        rooms.mana.release(c.ref);
        creations.markSettled(r.job_id);
        released++;
      }
      continue;
    }
    if (!res.ok) continue;
    const j = (await res.json()) as JobView;
    reconcile(rooms, r.job_id, c, j);
    if (j.status === "complete") settled++;
    else if (j.status === "failed") released++;
  }
  return { settled, released };
}

const LORE_MODEL = process.env.LORE_MODEL ?? SAFETY_MODEL;
const LORE_SYSTEM = `You write short in-world lore for Aweborn, a shared universe of player-made worlds.
Write 2–5 sentences (under 90 words) of evocative, original lore for what the player describes:
a legend, an inscription, a sign, a tale told about it. Wholesome and all-ages. No real people,
brands or existing franchises. Plain text only: no title, no quotes around it, no markdown.`;

/** POST /api/player/lore: a short piece of lore (signs, plaques, world stories). Checked going in and coming out. */
export async function writeLore(rooms: RoomManager, playerId: string, body: { prompt?: unknown; subject?: unknown } | null, json: Json): Promise<void> {
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 400) : "";
  const subject = typeof body?.subject === "string" ? body.subject.trim().slice(0, 120) : "";
  if (!prompt) return json(400, { error: "empty_prompt" });
  const ref = `lore:${randomUUID()}`;
  const decision = rooms.admission.requestDraw({ playerId, ref, estimate: makeEstimate("lore"), progress: progressOf(rooms, playerId) });
  if (!decision.ok) return json(402, { error: decision.reason, message: decision.message, remainingToday: decision.remainingToday });

  let costUsd = 0;
  try {
    const inSafe = await checkCreation(playerId, "lore", [prompt, subject], ref);
    costUsd += inSafe.costUsd;
    if (!inSafe.ok) {
      rooms.mana.settle(ref, costUsd * 100, "lore safety");
      return json(422, { error: "unsafe", category: inSafe.category, message: inSafe.message, suggestion: inSafe.suggestion || undefined });
    }
    const res = await fetch(`${GENAI_URL}/llm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref, model: LORE_MODEL, maxTokens: 300, researchId: tryResearchId(playerId),
        messages: [{ role: "system", content: LORE_SYSTEM }, { role: "user", content: subject ? `About: ${subject}\n${prompt}` : prompt }],
      }),
    });
    const out = (await res.json().catch(() => ({}))) as { content?: string; costUsd?: number; error?: string };
    if (!res.ok || typeof out.content !== "string") throw new Error(out.error ?? `genai ${res.status}`);
    costUsd += out.costUsd ?? 0;
    const text = out.content.replace(/^["'“”\s#*]+|["'“”\s*]+$/g, "").slice(0, 700);
    const outSafe = await checkCreation(playerId, "lore:out", [text], `${ref}:out`);
    costUsd += outSafe.costUsd;
    const mana = Math.round(costUsd * 100 * 1000) / 1000;
    rooms.mana.settle(ref, mana, "lore");
    if (!outSafe.ok || !text) return json(422, { error: "unsafe", message: "That lore didn't come out right. Try describing it another way." });
    rooms.progress.creation(playerId, mana, ref, "lore");
    return json(200, { text, mana, remainingToday: decision.remainingToday });
  } catch (err) {
    // Whatever was really spent (safety calls) is drawn; the rest of the hold goes back
    if (costUsd > 0) rooms.mana.settle(ref, costUsd * 100, "lore failed");
    else rooms.mana.release(ref);
    console.error("[lore] failed:", (err as Error).message);
    return json(503, { error: "genai_unavailable", message: "The storyteller is resting. Try again soon." });
  }
}

/** Dev only: where assets missing locally can be found (e.g. https://sync.aweborn.org). Unset in prod. */
const ASSET_FALLBACK_URL = (process.env.ASSET_FALLBACK_URL ?? "").replace(/\/$/, "");

const ASSET_TYPES: Record<string, string> = {
  glb: "model/gltf-binary", png: "image/png", webp: "image/webp", mp3: "audio/mpeg", wav: "audio/wav",
};

/** Public, immutable asset proxy (content-addressed names only). */
export function handleAssets(req: IncomingMessage, res: ServerResponse): boolean {
  const m = /^\/assets\/([a-f0-9]{64}\.(glb|png|webp|mp3|wav))$/.exec(req.url?.split("?")[0] ?? "");
  if (!m) return false;
  res.setHeader("Access-Control-Allow-Origin", "*");
  void fetch(`${GENAI_URL}/assets/${m[1]}`, { redirect: "manual" })
    .then((up) => {
      const loc = up.headers.get("location");
      if (up.status >= 300 && up.status < 400 && loc) {
        res.writeHead(302, { Location: loc, "Cache-Control": "public, max-age=300" });
        res.end();
        return;
      }
      if (!up.ok || !up.body) {
        // Dev only (unset in prod): a prod world pulled into the local DB
        // (scripts/dev/pull-prod-worlds.sh) references prod's assets.
        if (up.status === 404 && ASSET_FALLBACK_URL) {
          res.writeHead(302, { Location: `${ASSET_FALLBACK_URL}/assets/${m[1]}` });
          res.end();
          return;
        }
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": ASSET_TYPES[m[2]], "Cache-Control": "public, max-age=31536000, immutable" });
      Readable.fromWeb(up.body as import("node:stream/web").ReadableStream).pipe(res);
    })
    .catch(() => {
      res.writeHead(502);
      res.end();
    });
  return true;
}

/** Public library listing: GET /library?q=&limit= (proxied from genai-service). */
export function handleLibrary(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? "";
  if (!/^\/library(\?|$)/.test(url)) return false;
  res.setHeader("Access-Control-Allow-Origin", "*");
  void fetch(`${GENAI_URL}${url}`)
    .then(async (up) => {
      res.writeHead(up.status, { "Content-Type": "application/json", "Cache-Control": "public, max-age=15" });
      res.end(await up.text());
    })
    .catch(() => {
      res.writeHead(502);
      res.end();
    });
  return true;
}
