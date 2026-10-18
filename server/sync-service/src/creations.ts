/**
 * Creations (Phase 07): the player-facing side of generation.
 *
 *   POST /api/player/create        { prompt }      → { jobId, estimate } | 402 { message }
 *   GET  /api/player/create/:jobId                  → { status, progress, assetUrl?, error? }
 *   GET  /assets/:sha256.glb                        → proxied from genai-service (public, immutable)
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

const GENAI_URL = process.env.GENAI_URL ?? "http://genai-service:3001";

/** Meshy preview + texture refine ≈ $0.60 (30 credits × $0.02) × K = 100 → 60 mana. */
export const MODEL_ESTIMATE_MANA = 60;

/**
 * Progression (chapters/levels) isn't tracked yet, so every player is treated
 * as a maker (chapter 5) for now. Replace when Experience & Levels lands.
 */
const PROVISIONAL_PROGRESS: PlayerProgress = { chapter: 5, warpUnlocked: false, levelsSinceWarp: 0 };

interface Creation {
  ref: string;
  playerId: string;
  settled: boolean;
}

/** jobId → creation, persisted so a restart can still settle or release its hold. */
let ready = false;
function table() {
  const d = getDb();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS creations (
      job_id TEXT PRIMARY KEY, ref TEXT NOT NULL, player_id TEXT NOT NULL,
      settled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`);
    ready = true;
  }
  return d;
}
const creations = {
  get(jobId: string): Creation | undefined {
    const r = table().prepare("SELECT ref, player_id, settled FROM creations WHERE job_id = ?").get(jobId) as
      | { ref: string; player_id: string; settled: number } | undefined;
    return r ? { ref: r.ref, playerId: r.player_id, settled: !!r.settled } : undefined;
  },
  set(jobId: string, c: Creation): void {
    table().prepare("INSERT OR REPLACE INTO creations (job_id, ref, player_id, settled, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(jobId, c.ref, c.playerId, c.settled ? 1 : 0, Date.now());
  },
  markSettled(jobId: string): void {
    table().prepare("UPDATE creations SET settled = 1 WHERE job_id = ?").run(jobId);
  },
};

type Json = (status: number, body: unknown) => void;

export async function startCreation(rooms: RoomManager, playerId: string, prompt: unknown, json: Json): Promise<void> {
  const text = typeof prompt === "string" ? prompt.trim().slice(0, 600) : "";
  if (!text) return json(400, { error: "empty_prompt" });

  const ref = `create:${randomUUID()}`;
  const decision = rooms.admission.requestDraw({ playerId, ref, estimate: MODEL_ESTIMATE_MANA, progress: PROVISIONAL_PROGRESS });
  if (!decision.ok) return json(402, { error: decision.reason, message: decision.message, remainingToday: decision.remainingToday });

  try {
    const jobId = await startJob(ref, playerId, text);
    return json(200, { jobId, estimate: MODEL_ESTIMATE_MANA, remainingToday: decision.remainingToday });
  } catch (err) {
    rooms.mana.release(ref);
    console.error("[create] genai unavailable:", (err as Error).message);
    return json(503, { error: "genai_unavailable", message: "Creation is resting right now. Try again soon." });
  }
}

/**
 * Start a model job for a hold that's already reserved (`ref`). The status
 * route settles or releases it. Throws if genai is unreachable (caller releases).
 */
export async function startJob(ref: string, playerId: string, prompt: string): Promise<string> {
  const res = await fetch(`${GENAI_URL}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref, kind: "model", prompt: prompt.slice(0, 600) }),
  });
  const body = (await res.json()) as { jobId?: string };
  if (!res.ok || !body.jobId) throw new Error(`genai ${res.status}`);
  creations.set(body.jobId, { ref, playerId, settled: false });
  return body.jobId;
}

export async function creationStatus(rooms: RoomManager, playerId: string, jobId: string, json: Json): Promise<void> {
  const c = creations.get(jobId);
  if (!c || c.playerId !== playerId) return json(404, { error: "not_found" });
  const res = await fetch(`${GENAI_URL}/jobs/${encodeURIComponent(jobId)}`).catch(() => null);
  if (!res?.ok) return json(503, { error: "genai_unavailable" });
  const j = (await res.json()) as { status: string; progress: number; asset: string | null; costUsd: number | null; error: string | null };

  if (!c.settled && j.status === "complete") {
    rooms.mana.settle(c.ref, Math.max(0, (j.costUsd ?? 0) * 100), "model");
    creations.markSettled(jobId);
  } else if (!c.settled && j.status === "failed") {
    rooms.mana.release(c.ref); // failed generations draw nothing
    creations.markSettled(jobId);
  }
  return json(200, {
    status: j.status,
    progress: j.progress,
    asset: j.status === "complete" ? j.asset : undefined,
    error: j.status === "failed" ? "The making didn't take. Nothing was drawn." : undefined,
  });
}

/** Public, immutable asset proxy (content-addressed names only). */
export function handleAssets(req: IncomingMessage, res: ServerResponse): boolean {
  const m = /^\/assets\/([a-f0-9]{64}\.glb)$/.exec(req.url?.split("?")[0] ?? "");
  if (!m) return false;
  res.setHeader("Access-Control-Allow-Origin", "*");
  void fetch(`${GENAI_URL}/assets/${m[1]}`)
    .then((up) => {
      if (!up.ok || !up.body) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "model/gltf-binary", "Cache-Control": "public, max-age=31536000, immutable" });
      Readable.fromWeb(up.body as import("node:stream/web").ReadableStream).pipe(res);
    })
    .catch(() => {
      res.writeHead(502);
      res.end();
    });
  return true;
}
