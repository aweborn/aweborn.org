import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { initDb, closeDb, getDb, getStats as getDbStats } from "./persistence.js";
import { RoomManager } from "./rooms.js";
import { initAuth, getIdentity, getRawSession, isTrustedOrigin, authMethods, setPlayerPassword } from "./auth.js";
import { listCharacters, recordDiscovery, switchCharacter, waysIn, worldIndex, cleanLocation, saveLocation, loadLocation, setCharacterName, characterNameAt, characterNames } from "./identity.js";
import type { Identity } from "./identity.js";
import { parseRoomPath, isWorldId, ORIGIN_WORLD_ID } from "../../../shared/crdt-schema.js";
import { cleanCoCreators } from "../../../shared/world-policy.js";
import { cleanPlayerName } from "../../../shared/names.js";
import { timingSafeEqual } from "node:crypto";
import { MANA_FUNCTIONS, MANA_PURPOSES, INFLOW_SOURCES } from "./mana.js";
import { startCreation, creationStatus, handleAssets, handleLibrary, manaStatus, writeLore, sweepCreations, type CreateRequest } from "./creations.js";
import { planTurn, plannerModels, planResume, planManifest, planRedo, planEdit, planVersions, planRestore } from "./planner.js";
import { removeOwnAsset, uploadAssetThumb, handleTrashAdmin } from "./trash.js";
import { SIGN_IN_MESSAGE } from "./admission.js";
import { parseWorldRequest, worldsLeftToday, WORLDS_PER_DAY } from "./world-create.js";
import { listMutes, setMute, fileReport, handleReportsAdmin, isPlayerId } from "./moderation.js";
import { CLIENT_SKILLS, type Skill } from "../../../shared/progress.js";
import type { ProgressDelta } from "./progress.js";
import { isNature } from "../../../shared/sky.js";
import { RunwayWatch } from "./runway.js";
import { sendEmail } from "./email.js";
import { CardOrders, CHECKOUT_BODY_LIMIT } from "./cards.js";
import { CardSets } from "./card-sets.js";
import { checkCreation } from "./safety.js";

/** Paid gen-AI calls: signed-in players only (Alex, 2026-10-20). Guests explore and build freely. */
const GENAI_POST_PATHS = new Set(["/api/player/create", "/api/player/lore", "/api/player/plan", "/api/player/plan/redo", "/api/player/plan/manifest", "/api/player/plan/edit"]);

const PORT = parseInt(process.env.PORT ?? "1234", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

// ── Initialize persistence, auth & room manager ─────────────────────────────
initDb();
const auth = await initAuth(getDb());
const authHandler = auth ? toNodeHandler(auth) : null;
const rooms = new RoomManager();

// Private runway warning (M4): email when the non-creative money would last < 90 days.
new RunwayWatch(getDb(), rooms.mana, sendEmail, process.env.RUNWAY_ALERT_TO ?? "hello@aweborn.org").start();

// Card orders (M6): Get this card → Stripe (payment Lambda) → paid webhook → a person approves → print → mail.
const cardOrders = new CardOrders(getDb(), {
  mana: rooms.mana,
  world: (id) => rooms.lookupWorld(id),
  nameOf: (playerId) => characterNames([playerId])[playerId] ?? null,
  check: async (playerId, texts, ref) => {
    const v = await checkCreation(playerId, "card", texts, ref);
    return v.ok ? { ok: true } : { ok: false, message: v.message };
  },
  email: (to, subject, text) => sendEmail({ to, subject, text, html: `<pre style="font:15px/1.5 system-ui,sans-serif;white-space:pre-wrap">${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre>` }),
});
const cardSets = new CardSets(getDb(), (id) => rooms.lookupWorld(id) !== null);

// ── HTTP API (health, stats, world lookup) ───────────────────────────
// CORS for the public HTTP API (GET only). Extra origins (comma-separated)
// can be added with CORS_ORIGINS.
const CORS_ORIGINS = new Set([
  "https://aweborn.org",
  "https://www.aweborn.org",
  ...(process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
]);
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  if (origin && (CORS_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin))) {
    return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
  return { Vary: "Origin" };
}

/**
 * `GET /worlds/:id`: resolve a world for teleport links (`/w/<id>`).
 * Permanent public API (printed NFC cards depend on it): only ever add fields.
 *  200 { id, name, color, creator, solidified, sector, position, isOrigin }
 *  400 { error: "invalid_id" }   not a UUIDv4
 *  404 { error: "not_found" }    unknown, or faded (worlds are never hard-deleted)
 */
function handleWorldLookup(req: IncomingMessage, res: ServerResponse, id: string): void {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=30",
    ...corsHeaders(req),
  };
  const worldId = id.toLowerCase();
  if (!isWorldId(worldId)) {
    res.writeHead(400, headers);
    res.end(JSON.stringify({ error: "invalid_id" }));
    return;
  }
  const w = rooms.lookupWorld(worldId);
  if (!w) {
    res.writeHead(404, headers);
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  res.writeHead(200, headers);
  res.end(
    JSON.stringify({
      id: w.id,
      name: w.name,
      color: w.color,
      creator: w.creator,
      solidified: w.solidified,
      sector: w.sector,
      position: w.resolvedPosition,
      resolvedAt: w.resolvedAt, // 0 = position not settled yet (Origin is fixed at 0, 0, 0)
      isOrigin: w.id === ORIGIN_WORLD_ID,
      ...(w.parentWorldId ? { parentWorldId: w.parentWorldId } : {}),
    })
  );
}

/** Ids per `/players/names` request, and the id shape we look up. */
const NAMES_MAX_IDS = 50;
const PLAYER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `GET /players/names?ids=a,b,c`: public names for characters (≤ 50 per call).
 * Unnamed or unknown ids are simply left out, so the client falls back to
 * "Wanderer 4K2Q". Rough Draft M1 (2026-10-27).
 *  200 { names: { [id]: name } }
 */
function handleNames(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://x");
  const ids = [...new Set((url.searchParams.get("ids") ?? "").split(",").filter((id) => PLAYER_ID.test(id)))].slice(0, NAMES_MAX_IDS);
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=60", ...corsHeaders(req) });
  res.end(JSON.stringify({ names: characterNames(ids) }));
}

/** One rename per character per this long. */
const RENAME_EVERY_MS = 10_000;

function readJson(req: IncomingMessage, limit = 4096): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > limit) {
        reject(new Error("too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err as Error);
      }
    });
    req.on("error", reject);
  });
}

/**
 * `/api/player/*`: the signed-in account (session cookie, trusted origins only).
 *   GET  /api/player/me         { playerId, characters, methods, worldIndex }
 *   POST /api/player/character  { id } → this device now plays that character
 *   POST /api/player/character/name  { name } → { playerId, name }  (400 bad_name · 429 slow_down)
 *   POST /api/player/password   { password } → add or change this player's password
 *   POST /api/player/world-index/sighted  { sightings: { worldId, at? }[] (≤ 20) } → { results }
 *        Came close enough to see them. The client reports these (it may have
 *        been offline: `at` = when, up to 30 days back). Only real, live worlds
 *        count, rate-limited per account; legitimacy checks are still to come.
 *   POST /api/player/world-index/arrived  { worldId } → result
 *        Landed next to it by link or card tap = sighted (entering then visits).
 *        Each result: { worldId, isNew, firstVisit }.
 *   POST /api/player/world  { name, color, position } → { world: { id, name, color, position }, leftToday }
 *        Plant a world (signed-in only; WORLDS_PER_DAY per rolling 24 h).
 *        403 sign_in_required · 429 daily_limit · 400 bad_name | bad_color | bad_position
 *   GET  /api/player/progress  → { progress: ProgressView }  (awe = experience, Rough Draft M3)
 *   POST /api/player/progress/report  { skills?: Skill[], flight?: { distance, farthest } }
 *        → { delta: { xp, level?, chapter? }, progress }  (429 slow_down: one report per 3 s)
 *        Piloting/building skills and flight distance, client-reported (cheap
 *        checks now; Phase 09 derives them on the server later).
 */

/** One progress report per character per this long. */
const PROGRESS_REPORT_MS = 3000;
const progressReports = new Map<string, number>();

/** True if this character may report now (and remembers it). Old entries are pruned as the map grows. */
function takeProgressReport(playerId: string, now = Date.now()): boolean {
  const last = progressReports.get(playerId);
  if (last !== undefined && now - last < PROGRESS_REPORT_MS) return false;
  if (progressReports.size > 50_000) {
    for (const [id, at] of progressReports) if (now - at > 60_000) progressReports.delete(id);
  }
  progressReports.set(playerId, now);
  return true;
}

/** Sightings per account per minute (a busy flight past a cluster stays well under). */
const SIGHTINGS_PER_MIN = 60;
const MAX_SIGHTED_BATCH = 20;
/** Oldest offline sighting we accept. */
const MAX_SIGHTING_AGE_MS = 30 * 24 * 3600_000;
const sightingWindows = new Map<string, { start: number; count: number }>();

/** Take `n` from the account's sighting budget; false = over the limit. */
function takeSightings(accountId: string, n: number, now = Date.now()): boolean {
  let w = sightingWindows.get(accountId);
  if (!w || now - w.start >= 60_000) {
    w = { start: now, count: 0 };
    sightingWindows.set(accountId, w);
  }
  if (w.count + n > SIGHTINGS_PER_MIN) return false;
  w.count += n;
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, w] of sightingWindows) if (now - w.start >= 60_000) sightingWindows.delete(k);
}, 5 * 60_000).unref();

// Settle/release creation holds nobody is polling for any more (closed tab), one sweep at a time
let sweeping = false;
setInterval(() => {
  if (sweeping) return;
  sweeping = true;
  sweepCreations(rooms)
    .then((r) => { if (r.settled || r.released) console.log(`[creations] swept: ${r.settled} settled, ${r.released} released`); })
    .catch((err) => console.error("[creations] sweep failed:", (err as Error).message))
    .finally(() => { sweeping = false; });
}, 60_000).unref();

/** A live world id (normalised), or null. */
function knownWorld(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const worldId = id.toLowerCase();
  return isWorldId(worldId) && rooms.lookupWorld(worldId) ? worldId : null;
}

async function handlePlayerApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (!auth) return json(503, { error: "auth_disabled" });
  // Credentialed: our own pages only (also covers CSRF on the POST).
  if (!isTrustedOrigin(req.headers.origin)) return json(403, { error: "forbidden_origin" });
  const session = await getRawSession(auth, fromNodeHeaders(req.headers));
  if (!session?.playerId) return json(401, { error: "no_session" });
  const accountId = session.userId;
  rooms.admission.setGuest(session.playerId, session.isAnonymous);
  // Solar cycle (M4): the client keeps its UTC offset in the `aw_tz` cookie; admission clamps the effect to ±10 %.
  const tz = /(?:^|;\s*)aw_tz=(-?\d{1,4})(?:;|$)/.exec(req.headers.cookie ?? "");
  if (tz) rooms.admission.setTimezone(session.playerId, Number(tz[1]));
  const path = req.url?.split("?")[0];

  if (path === "/api/player/me" && req.method === "GET") {
    return json(200, {
      playerId: session.playerId,
      characters: listCharacters(accountId),
      methods: waysIn(accountId),
      worldIndex: worldIndex(accountId).map((e) => {
        const w = rooms.lookupWorld(e.worldId);
        return {
          ...e,
          world: w
            ? {
                name: w.name,
                color: w.color,
                creator: w.creator,
                position: w.resolvedPosition,
                sector: w.sector,
                solidified: w.solidified,
                ...(w.parentWorldId ? { parentWorldId: w.parentWorldId } : {}),
              }
            : null,
        };
      }),
    });
  }
  if (path === "/api/player/character" && req.method === "POST") {
    const body = (await readJson(req).catch(() => null)) as { id?: unknown } | null;
    const id = typeof body?.id === "string" ? body.id : "";
    if (!switchCharacter(accountId, session.sessionId, id)) return json(404, { error: "not_your_character" });
    return json(200, { playerId: id });
  }
  // Mute + report (Rough Draft M1, 2026-10-27)
  if (path === "/api/player/mutes" && req.method === "GET") return json(200, { mutes: listMutes(accountId) });
  if (path === "/api/player/mute" && req.method === "POST") {
    const body = (await readJson(req).catch(() => null)) as { targetId?: unknown; muted?: unknown } | null;
    if (!isPlayerId(body?.targetId) || typeof body?.muted !== "boolean") return json(400, { error: "bad_request" });
    if (!setMute(accountId, body.targetId, body.muted)) return json(409, { error: "too_many", message: "Your mute list is full." });
    return json(200, { targetId: body.targetId, muted: body.muted });
  }
  if (path === "/api/player/report" && req.method === "POST") {
    const body = (await readJson(req).catch(() => null)) as Record<string, unknown> | null;
    const r = fileReport(accountId, session.playerId, body ?? {});
    return r.ok ? json(200, { id: r.id }) : json(r.status, { error: r.error, message: r.message });
  }
  // Name the character you're playing (Rough Draft M1, 2026-10-27)
  if (path === "/api/player/character/name" && req.method === "POST") {
    const body = (await readJson(req).catch(() => null)) as { name?: unknown } | null;
    const r = cleanPlayerName(body?.name);
    if (!r.ok) return json(400, { error: "bad_name", message: r.message });
    const last = characterNameAt(session.playerId);
    if (last && Date.now() - last < RENAME_EVERY_MS) {
      return json(429, { error: "slow_down", message: "Give it a few seconds before renaming again." });
    }
    if (!setCharacterName(accountId, session.playerId, r.name)) return json(404, { error: "not_your_character" });
    return json(200, { playerId: session.playerId, name: r.name });
  }
  if (path === "/api/player/password" && req.method === "POST") {
    const body = (await readJson(req).catch(() => null)) as { password?: unknown } | null;
    const r = await setPlayerPassword(auth, fromNodeHeaders(req.headers), body?.password);
    return r.ok ? json(200, { changed: r.changed }) : json(r.status, { code: r.code, message: r.message });
  }
  if (path === "/api/player/world-index/sighted" && req.method === "POST") {
    const body = (await readJson(req).catch(() => null)) as { sightings?: unknown } | null;
    const raw = body?.sightings;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SIGHTED_BATCH) {
      return json(400, { error: "bad_request" });
    }
    const now = Date.now();
    const seen = new Map<string, number>();
    for (const s of raw as { worldId?: unknown; at?: unknown }[]) {
      const worldId = knownWorld(s?.worldId);
      if (!worldId) continue;
      const at = typeof s.at === "number" && Number.isFinite(s.at) ? Math.min(s.at, now) : now;
      if (at < now - MAX_SIGHTING_AGE_MS) continue;
      seen.set(worldId, Math.min(at, seen.get(worldId) ?? at));
    }
    if (!takeSightings(accountId, seen.size)) return json(429, { error: "slow_down" });
    const playerId = session.playerId;
    const results = [...seen].map(([worldId, at]) => {
      const w = rooms.lookupWorld(worldId);
      const edition = w?.solidified === false ? "dreamt" : "solid";
      const r = recordDiscovery(accountId, worldId, playerId, "sighted", "flight", at, edition);
      if (r.isNew) rooms.progress.sighted(playerId, worldId);
      return { worldId, ...r };
    });
    return json(200, { results });
  }
  if (path === "/api/player/world-index/arrived" && req.method === "POST") {
    const body = (await readJson(req).catch(() => null)) as { worldId?: unknown } | null;
    const worldId = knownWorld(body?.worldId);
    if (!worldId) return json(404, { error: "not_found" });
    const w = rooms.lookupWorld(worldId);
    const edition = w?.solidified === false ? "dreamt" : "solid";
    const r = recordDiscovery(accountId, worldId, session.playerId, "sighted", "link", Date.now(), edition);
    if (r.isNew) rooms.progress.sighted(session.playerId, worldId);
    return json(200, { worldId, ...r });
  }
  // Awe = experience (Rough Draft M3)
  if (path === "/api/player/progress" && req.method === "GET") {
    return json(200, { progress: rooms.progress.view(session.playerId) });
  }
  if (path === "/api/player/progress/report" && req.method === "POST") {
    const body = (await readJson(req).catch(() => null)) as { skills?: unknown; flight?: { distance?: unknown; farthest?: unknown } } | null;
    if (!body) return json(400, { error: "bad_request" });
    if (!takeProgressReport(session.playerId)) return json(429, { error: "slow_down" });
    const skills = Array.isArray(body.skills)
      ? [...new Set(body.skills.filter((s): s is Skill => typeof s === "string" && (CLIENT_SKILLS as readonly string[]).includes(s)))]
      : [];
    let delta: ProgressDelta = { xp: 0 };
    const add = (d: ProgressDelta) => {
      delta = { xp: delta.xp + d.xp, level: Math.max(delta.level ?? 0, d.level ?? 0) || undefined, chapter: Math.max(delta.chapter ?? 0, d.chapter ?? 0) || undefined };
    };
    for (const s of skills) add(rooms.progress.useSkill(session.playerId, s));
    const f = body.flight;
    if (f && typeof f.distance === "number" && typeof f.farthest === "number") add(rooms.progress.flight(session.playerId, f.distance, f.farthest));
    return json(200, { delta, progress: rooms.progress.view(session.playerId) });
  }
  // Where this character stands (saved as they move; restored on any device)
  if (path === "/api/player/location" && req.method === "GET") {
    return json(200, { location: loadLocation(session.playerId) });
  }
  if (path === "/api/player/location" && req.method === "POST") {
    const loc = cleanLocation(await readJson(req).catch(() => null)); // sent as text/plain on tab close: no preflight
    if (!loc) return json(400, { error: "bad_request" });
    return json(saveLocation(session.playerId, loc) ? 200 : 429, { ok: true });
  }
  // Mana tracker: this player's allowance, usage and averages
  if (path === "/api/player/mana" && req.method === "GET") return manaStatus(rooms, session.playerId, json, session.isAnonymous);
  // Create World: plant one where you stand (Alex, 2026-10-21)
  if (path === "/api/player/world" && req.method === "POST") {
    if (session.isAnonymous) {
      return json(403, { error: "sign_in_required", message: "Worlds are forever. Sign in to plant one." });
    }
    const reqd = parseWorldRequest(await readJson(req).catch(() => null));
    if ("error" in reqd) return json(400, reqd);
    if (reqd.parentWorldId) {
      const parent = rooms.lookupWorld(reqd.parentWorldId);
      if (!parent) return json(404, { error: "parent_not_found", message: "Parent world not found." });
      if (parent.allowPortals === false) {
        const myChars = listCharacters(accountId);
        if (!myChars.some((c) => c.id === parent.creator)) {
          return json(403, {
            error: "portals_locked",
            message: "Only this world’s creator can plant portals here.",
          });
        }
      }
    }
    const left = worldsLeftToday(rooms.allWorlds(), session.playerId);
    if (left <= 0) {
      return json(429, { error: "daily_limit", message: `You can plant ${WORLDS_PER_DAY} worlds a day. Come back tomorrow.` });
    }
    const w = rooms.createWorld(reqd.name, session.playerId, reqd.position, reqd.color, reqd.parentWorldId);
    recordDiscovery(accountId, w.id, session.playerId, "sighted", "flight", Date.now(), w.solidified ? "solid" : "dreamt");
    rooms.progress.useSkill(session.playerId, "world");
    return json(200, {
      world: {
        id: w.id,
        name: w.name,
        color: w.color,
        position: w.resolvedPosition,
        solidified: w.solidified,
        ...(w.parentWorldId ? { parentWorldId: w.parentWorldId } : {}),
      },
      leftToday: left - 1,
    });
  }
  if (path === "/api/player/world/policy" && req.method === "POST") {
    if (session.isAnonymous) {
      return json(403, { error: "sign_in_required", message: "Sign in to change who may build in your world." });
    }
    const body = (await readJson(req).catch(() => null)) as { worldId?: unknown; allowPortals?: unknown; coCreators?: unknown } | null;
    const worldId = knownWorld(body?.worldId);
    const hasPortals = typeof body?.allowPortals === "boolean";
    const hasCo = body?.coCreators !== undefined;
    if (!worldId || (!hasPortals && !hasCo)) {
      return json(400, { error: "bad_request" });
    }
    const w = rooms.lookupWorld(worldId);
    if (!w) return json(404, { error: "not_found" });
    const myChars = listCharacters(accountId);
    if (!myChars.some((c) => c.id === w.creator)) {
      return json(403, { error: "not_creator", message: "Only this world’s creator can change who may build here." });
    }
    let coCreators: string[] | undefined;
    if (hasCo) {
      const cleaned = cleanCoCreators(body!.coCreators, w.creator);
      if (!cleaned) return json(400, { error: "bad_request" });
      coCreators = cleaned.filter((id) => !myChars.some((c) => c.id === id));
      rooms.setWorldCoCreators(worldId, coCreators);
    }
    if (hasPortals) rooms.setWorldPortalPolicy(worldId, body!.allowPortals as boolean);
    return json(200, { worldId, ...(hasPortals ? { allowPortals: body!.allowPortals } : {}), ...(coCreators ? { coCreators } : {}) });
  }
  // Card orders (M6): any player, saved or not, can buy a card of any world
  if (path === "/api/player/cards/checkout" && req.method === "POST") {
    const r = await cardOrders.create(session.playerId, await readJson(req, CHECKOUT_BODY_LIMIT).catch(() => null));
    return r.ok ? json(200, { orderId: r.order.id, order: r.order }) : json(r.status, { error: r.error, message: r.message });
  }
  // Creations (Phase 07): reserve → generate → settle. Signed-in players only.
  if (session.isAnonymous && req.method === "POST" && path && GENAI_POST_PATHS.has(path)) {
    return json(403, { error: "sign_in_required", message: SIGN_IN_MESSAGE });
  }
  if (path === "/api/player/create" && req.method === "POST") {
    const body = (await readJson(req).catch(() => null)) as CreateRequest | null;
    return startCreation(rooms, session.playerId, body, json);
  }
  if (path === "/api/player/lore" && req.method === "POST") {
    const body = (await readJson(req).catch(() => null)) as { prompt?: unknown; subject?: unknown } | null;
    return writeLore(rooms, session.playerId, body, json);
  }
  if (path === "/api/player/plan" && req.method === "POST") {
    return planTurn(rooms, session.playerId, await readJson(req).catch(() => null), json);
  }
  if (path === "/api/player/plan/models" && req.method === "GET") return plannerModels(json);
  if (path === "/api/player/plan/redo" && req.method === "POST") {
    return planRedo(rooms, session.playerId, await readJson(req).catch(() => null), json);
  }
  if (path === "/api/player/plan/manifest" && req.method === "POST") {
    return planManifest(rooms, session.playerId, await readJson(req).catch(() => null), json);
  }
  if (path === "/api/player/plan" && req.method === "GET") {
    return planResume(session.playerId, new URL(req.url ?? "/", "http://x").searchParams.get("worldId") ?? "", json);
  }
  // Direct edits + version history (M5c): no planner call
  if (path === "/api/player/plan/edit" && req.method === "POST") {
    return planEdit(rooms, session.playerId, await readJson(req).catch(() => null), json);
  }
  if (path === "/api/player/plan/versions" && req.method === "GET") {
    return planVersions(session.playerId, new URL(req.url ?? "/", "http://x").searchParams.get("sessionId") ?? "", json);
  }
  if (path === "/api/player/plan/restore" && req.method === "POST") {
    return planRestore(session.playerId, await readJson(req).catch(() => null), json);
  }
  if (path?.startsWith("/api/player/create/") && req.method === "GET") {
    return creationStatus(rooms, session.playerId, path.slice("/api/player/create/".length), json);
  }
  // Library: a maker removes their own asset → the admin trash (never deleted)
  const rm = /^\/api\/player\/library\/([a-f0-9]{64})\/remove$/.exec(path ?? "");
  if (rm && req.method === "POST") return removeOwnAsset(session.playerId, rm[1], json);
  // Library: share a client-rendered thumbnail PNG so future visitors don't have to download the GLB
  const th = /^\/api\/player\/library\/([a-f0-9]{64})\/thumb$/.exec(path ?? "");
  if (th && req.method === "POST") {
    const body = (await readJson(req, 262_144).catch(() => null)) as { dataUrl?: unknown } | null;
    return uploadAssetThumb(th[1], body?.dataUrl, json);
  }
  return json(404, { error: "not_found" });
}

/**
 * Mana (Phase 05). Public, read-only:
 *   GET /mana                          ManaState (pool, creative, highWater, frontierRadius, draws by function/purpose…)
 *   GET /mana/ledger?limit=50&before=  public ledger rows, newest first (no donors, players or refs)
 *   GET /mana/flow                     today's outflow by function · purpose · Form 990 nature (shooting stars, M4)
 * Admin / server-to-server (Authorization: Bearer $MANA_ADMIN_TOKEN; 503 if unset):
 *   POST /api/mana/inflow  { source, netDollars, creativeBaseDollars?, restricted?, ref?, note?, publicName?, at? }
 *   POST /api/mana/draw    { purpose, fn, dollars, nature?, periodDays?, ref?, note?, at? }   (not creations: those reserve → settle)
 *   POST /api/mana/refund  { giftRef, refundRef, dollars, dispute? }   a gift going back: a labeled draw, bounded by the gift
 *   All are idempotent on their ref (200 { duplicate: true } on a retry).
 * Donation webhook (Authorization: Bearer $MANA_INFLOW_TOKEN): the Stripe Lambda's
 * narrow key. Only POST /api/mana/inflow with `source: "gift"`, a `ref`, no
 * creative override and no note (an opt-in `publicName` is allowed), and
 * POST /api/mana/refund (which can't exceed the gift it names): a leaked copy
 * can't draw money freely or fake a grant.
 */
const MANA_ADMIN_TOKEN = process.env.MANA_ADMIN_TOKEN ?? "";
const MANA_INFLOW_TOKEN = process.env.MANA_INFLOW_TOKEN ?? "";

function bearerMatches(req: IncomingMessage, token: string): boolean {
  if (!token) return false;
  const got = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

function manaRole(req: IncomingMessage): "admin" | "inflow" | null {
  if (bearerMatches(req, MANA_ADMIN_TOKEN)) return "admin";
  if (bearerMatches(req, MANA_INFLOW_TOKEN)) return "inflow";
  return null;
}

async function handleManaAdmin(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (!MANA_ADMIN_TOKEN && !MANA_INFLOW_TOKEN) return json(503, { error: "mana_admin_disabled" });
  const role = manaRole(req);
  if (!role) return json(401, { error: "unauthorized" });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const b = (await readJson(req).catch(() => null)) as Record<string, unknown> | null;
  if (!b) return json(400, { error: "bad_json" });
  if (role === "inflow") {
    const narrow =
      (path === "/api/mana/inflow" &&
        b.source === "gift" &&
        typeof b.ref === "string" && b.ref.length > 0 &&
        b.creativeBaseDollars === undefined && b.restricted === undefined && b.note === undefined) ||
      path === "/api/mana/refund";
    if (!narrow) return json(403, { error: "forbidden" });
  }
  const str = (v: unknown) => (typeof v === "string" && v.length <= 500 ? v : undefined);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  try {
    if (path === "/api/mana/inflow") {
      const source = b.source as (typeof INFLOW_SOURCES)[number];
      const netDollars = num(b.netDollars);
      if (!INFLOW_SOURCES.includes(source) || netDollars === undefined) return json(400, { error: "bad_request" });
      const e = rooms.mana.recordInflow({
        source,
        netDollars,
        creativeBaseDollars: num(b.creativeBaseDollars),
        restricted: b.restricted === true,
        ref: str(b.ref),
        note: str(b.note),
        publicName: typeof b.publicName === "string" && b.publicName.trim() ? b.publicName.slice(0, 60) : undefined,
        at: num(b.at),
      });
      return json(200, e ? { entry: e, state: rooms.mana.state() } : { duplicate: true });
    }
    if (path === "/api/mana/draw") {
      const purpose = b.purpose as (typeof MANA_PURPOSES)[number];
      const fn = b.fn as (typeof MANA_FUNCTIONS)[number];
      const dollars = num(b.dollars);
      if (purpose === "creations" || !MANA_PURPOSES.includes(purpose) || !MANA_FUNCTIONS.includes(fn) || dollars === undefined) {
        return json(400, { error: "bad_request" });
      }
      if (b.nature !== undefined && !isNature(b.nature)) return json(400, { error: "bad_request", message: "unknown nature" });
      const r = rooms.mana.recordDraw({
        purpose,
        fn,
        dollars,
        nature: isNature(b.nature) ? b.nature : undefined,
        periodDays: num(b.periodDays),
        ref: str(b.ref),
        note: str(b.note),
        at: num(b.at),
      });
      return json(200, r ? { ...r, state: rooms.mana.state() } : { duplicate: true });
    }
    if (path === "/api/mana/refund") {
      const giftRef = str(b.giftRef);
      const refundRef = str(b.refundRef);
      const dollars = num(b.dollars);
      if (!giftRef || !refundRef || dollars === undefined || !(dollars > 0)) return json(400, { error: "bad_request" });
      const r = rooms.mana.recordRefund({ giftRef, refundRef, dollars, dispute: b.dispute === true, at: num(b.at) });
      if (!r.ok) return r.reason === "duplicate" ? json(200, { duplicate: true }) : json(409, { error: r.reason });
      cardOrders.markRefunded(giftRef); // no-op unless it paid for cards
      return json(200, { draw: r.draw, shortfall: r.shortfall, state: rooms.mana.state() });
    }
  } catch (err) {
    return json(400, { error: "bad_request", message: (err as Error).message });
  }
  return json(404, { error: "not_found" });
}

/** /mana/flow is computed from the ledger; reuse it briefly (it's public). */
let flowCache: { at: number; body: string } | null = null;

function handleManaPublic(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname !== "/mana" && url.pathname !== "/mana/ledger" && url.pathname !== "/mana/flow") return false;
  const headers = { "Content-Type": "application/json", "Cache-Control": "public, max-age=10", ...corsHeaders(req) };
  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...corsHeaders(req), "Access-Control-Allow-Methods": "GET" });
    res.end();
    return true;
  }
  if (req.method !== "GET") {
    res.writeHead(405, headers);
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return true;
  }
  res.writeHead(200, headers);
  if (url.pathname === "/mana") {
    res.end(JSON.stringify(rooms.mana.state()));
  } else if (url.pathname === "/mana/flow") {
    const now = Date.now();
    if (!flowCache || now - flowCache.at > 30_000) flowCache = { at: now, body: JSON.stringify(rooms.mana.flow(now)) };
    res.end(flowCache.body);
  } else {
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
    const before = parseInt(url.searchParams.get("before") ?? "", 10);
    res.end(JSON.stringify({ entries: rooms.mana.publicEntries(limit, Number.isFinite(before) ? before : undefined) }));
  }
  return true;
}

/**
 * Card orders over HTTP (M6; see cards.ts for the flow):
 *   GET  /cards/orders/:id                 public status page data
 *   GET  /cards/orders/:id/photo           public: the order's photo art (M6b), while it can still print
 *   GET  /api/cards/checkout-info/:id      payment Lambda (Bearer inflow or admin)
 *   POST /api/cards/paid                   Stripe webhook Lambda (Bearer inflow or admin)
 *   GET  /api/admin/cards?status=          admin
 *   POST /api/admin/cards/:id              admin: { status, costDollars?, tracking?, note? }
 *   POST /api/admin/cards/event            admin: { worldIds | setId, quantity, note, netDollars?, email? } (M6e)
 *   GET  /card-sets                        public: curated sets (M6d, card-sets.ts)
 *   GET/POST /api/admin/card-sets, DELETE /api/admin/card-sets/:id   admin
 */
async function handleCards(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  const isPublic = path.startsWith("/cards/orders/");
  const isServer = path.startsWith("/api/cards/");
  const isAdmin = path === "/api/admin/cards" || path.startsWith("/api/admin/cards/");
  const isSets = path === "/card-sets";
  const isSetsAdmin = path === "/api/admin/card-sets" || path.startsWith("/api/admin/card-sets/");
  if (!isPublic && !isServer && !isAdmin && !isSets && !isSetsAdmin) return false;
  const cors = corsHeaders(req);
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors });
    res.end(JSON.stringify(body));
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...cors, "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600" });
    res.end();
    return true;
  }
  if (isSets) {
    if (req.method !== "GET") return (json(405, { error: "method_not_allowed" }), true);
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", ...cors });
    res.end(JSON.stringify({ sets: cardSets.list() }));
    return true;
  }
  if (isPublic) {
    if (req.method !== "GET") return (json(405, { error: "method_not_allowed" }), true);
    const rest = path.slice("/cards/orders/".length);
    if (rest.endsWith("/photo")) {
      const p = cardOrders.photo(rest.slice(0, -"/photo".length));
      if (!p) return (json(404, { error: "not_found" }), true);
      res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": p.jpeg.length, "Cache-Control": "private, max-age=3600", ...cors });
      res.end(p.jpeg);
      return true;
    }
    const o = cardOrders.publicView(rest);
    return (o ? json(200, { order: o }) : json(404, { error: "not_found" }), true);
  }
  const role = manaRole(req);
  if (isSetsAdmin) {
    if (role !== "admin") return (json(MANA_ADMIN_TOKEN ? 401 : 503, { error: MANA_ADMIN_TOKEN ? "unauthorized" : "admin_disabled" }), true);
    if (path === "/api/admin/card-sets" && req.method === "GET") return (json(200, { sets: cardSets.list() }), true);
    if (path === "/api/admin/card-sets" && req.method === "POST") {
      const r = cardSets.upsert(await readJson(req).catch(() => null));
      return (r.ok ? json(200, { set: r.set }) : json(r.status, { error: r.error, message: r.message }), true);
    }
    if (req.method === "DELETE") {
      const r = cardSets.remove(path.slice("/api/admin/card-sets/".length));
      return (r.ok ? json(200, { ok: true }) : json(r.status, { error: r.error, message: r.message }), true);
    }
    return (json(405, { error: "method_not_allowed" }), true);
  }
  if (isAdmin) {
    if (role !== "admin") return (json(MANA_ADMIN_TOKEN ? 401 : 503, { error: MANA_ADMIN_TOKEN ? "unauthorized" : "admin_disabled" }), true);
    if (path === "/api/admin/cards" && req.method === "GET") {
      return (json(200, { orders: cardOrders.list(new URL(req.url ?? "/", "http://x").searchParams.get("status") ?? undefined) }), true);
    }
    if (path === "/api/admin/cards/event" && req.method === "POST") {
      const body = ((await readJson(req).catch(() => null)) ?? {}) as Record<string, unknown>;
      if (typeof body.setId === "string" && body.setId) {
        const set = cardSets.list().find((s) => s.id === body.setId);
        if (!set) return (json(404, { error: "no_set", message: "No set with that id." }), true);
        body.worldIds = set.worldIds;
      }
      const r = cardOrders.createEvent(body);
      return (r.ok ? json(200, { eventId: r.eventId, orders: r.orders }) : json(r.status, { error: r.error, message: r.message }), true);
    }
    if (req.method === "POST") {
      const r = cardOrders.advance(path.slice("/api/admin/cards/".length), await readJson(req).catch(() => null));
      return (r.ok ? json(200, { order: r.order }) : json(r.status, { error: r.error, message: r.message }), true);
    }
    return (json(405, { error: "method_not_allowed" }), true);
  }
  // Server-to-server (payment Lambdas): the narrow inflow key is enough for these two
  if (!role) return (json(MANA_ADMIN_TOKEN || MANA_INFLOW_TOKEN ? 401 : 503, { error: "unauthorized" }), true);
  if (path.startsWith("/api/cards/checkout-info/") && req.method === "GET") {
    const info = cardOrders.checkoutInfo(path.slice("/api/cards/checkout-info/".length));
    return (info ? json(200, info) : json(404, { error: "not_found" }), true);
  }
  if (path === "/api/cards/paid" && req.method === "POST") {
    const b = (await readJson(req).catch(() => null)) as Record<string, unknown> | null;
    if (!b) return (json(400, { error: "bad_json" }), true);
    const r = await cardOrders.markPaid({ orderId: b.orderId, ref: b.ref, netDollars: b.netDollars, email: b.email, at: b.at });
    return (r.ok ? json(200, { duplicate: r.duplicate, order: r.order }) : json(r.status, { error: r.error }), true);
  }
  return (json(404, { error: "not_found" }), true);
}

// HTTP server (health checks + stats + world lookup + auth)
const server = createServer((req, res) => {
  const urlPath = req.url?.split("?")[0] ?? "";
  if (urlPath.startsWith("/cards/orders/") || urlPath.startsWith("/api/cards/") || urlPath.startsWith("/api/admin/cards")
    || urlPath === "/card-sets" || urlPath.startsWith("/api/admin/card-sets")) {
    handleCards(req, res, urlPath).catch((err: unknown) => {
      console.error("[cards]", err);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal" }));
    });
    return;
  }
  if (req.url?.startsWith("/api/mana/")) {
    const path = req.url.split("?")[0];
    handleManaAdmin(req, res, path).catch((err: unknown) => {
      console.error("[mana-api]", err);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal" }));
    });
    return;
  }
  if (handleManaPublic(req, res)) return;
  if (handleAssets(req, res)) return;
  if (handleLibrary(req, res)) return;
  if (req.url?.startsWith("/api/admin/") && handleTrashAdmin(req, res, req.url.split("?")[0], MANA_ADMIN_TOKEN, corsHeaders(req))) return;
  if (req.url?.startsWith("/api/admin/") && handleReportsAdmin(req, res, req.url.split("?")[0], MANA_ADMIN_TOKEN, corsHeaders(req), readJson)) return;
  // Flight telemetry (Phase 09, 9D): GET /api/admin/flight-path?player=<characterId>&from=<ms>&to=<ms> (admin; default last 24 h)
  if (req.url?.split("?")[0] === "/api/admin/flight-path" && req.method === "GET") {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (!MANA_ADMIN_TOKEN) return send(503, { error: "admin_disabled" });
    if (!bearerMatches(req, MANA_ADMIN_TOKEN)) return send(401, { error: "unauthorized" });
    const q = new URL(req.url, "http://x").searchParams;
    const player = q.get("player") ?? "";
    if (!player || player.length > 100) return send(400, { error: "player_required" });
    const to = Number(q.get("to") ?? Date.now());
    const from = Number(q.get("from") ?? to - 24 * 3600_000);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return send(400, { error: "bad_range" });
    return send(200, { player, from, to, points: rooms.telemetry.path(player, from, to) });
  }
  if (req.url?.startsWith("/api/player/")) {
    const origin = req.headers.origin;
    if (isTrustedOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      });
      res.end();
      return;
    }
    handlePlayerApi(req, res).catch((err: unknown) => {
      console.error("[player-api]", err);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal" }));
    });
    return;
  }
  // Better Auth: /api/auth/* (credentialed CORS for trusted origins only;
  // Better Auth also checks Origin against trustedOrigins on mutations).
  if (req.url?.startsWith("/api/auth/")) {
    const origin = req.headers.origin;
    if (isTrustedOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      });
      res.end();
      return;
    }
    if (req.url === "/api/auth/methods" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(authMethods(auth)));
      return;
    }
    if (!authHandler) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "auth_disabled" }));
      return;
    }
    void authHandler(req, res);
    return;
  }

  const worldMatch = req.url?.match(/^\/worlds\/([^/?#]+)\/?(?:\?.*)?$/);
  if (req.url?.startsWith("/players/names") && req.method === "GET") {
    handleNames(req, res);
    return;
  }
  if (worldMatch && (req.method === "GET" || req.method === "HEAD")) {
    handleWorldLookup(req, res, worldMatch[1]);
    return;
  }
  if (worldMatch && req.method === "OPTIONS") {
    res.writeHead(204, { ...corsHeaders(req), "Access-Control-Allow-Methods": "GET, HEAD" });
    res.end();
    return;
  }

  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "sync-service" }));
    return;
  }

  if (req.url === "/stats" && req.method === "GET") {
    const roomStats = rooms.getStats();
    const dbStats = getDbStats();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        rooms: roomStats,
        sim: rooms.sim.stats(),
        telemetry: rooms.telemetry.stats(),
        database: dbStats,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      })
    );
    return;
  }

  res.writeHead(404);
  res.end();
});

// ── WebSocket server ─────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws: WebSocket, req: IncomingMessage, identity: Identity | null) => {
  const url = req.url ?? "/";
  const route = parseRoomPath(url);

  if (!route) {
    console.warn(`[ws] unknown path: ${url}`);
    ws.close(4000, "Unknown path");
    return;
  }

  // Everyone is welcome. Normally the client signs in anonymously first, so
  // the socket carries a player. Sockets with no session (cookies blocked,
  // old clients) still play as guests; they just have no persistent identity.
  if (identity) {
    rooms.setPlayer(ws, identity.playerId, identity.accountId);
  } else {
    console.log("[ws] guest connection (no session)");
  }

  if (route.type === "universe") {
    rooms.joinUniverse(ws, route.sectors ?? []);
  } else if (route.type === "world") {
    const doc = rooms.joinWorld(ws, route.id);
    if (!doc) {
      ws.close(4004, "World not found");
      return;
    }
  }

  ws.on("message", (data) => {
    rooms.handleMessage(ws, data as Buffer);
  });

  ws.on("close", () => {
    rooms.handleDisconnect(ws);
  });

  ws.on("error", (err) => {
    console.error("[ws] client error:", err.message);
    rooms.handleDisconnect(ws);
  });
});

server.on("upgrade", (req, socket, head) => {
  // Only trust the session cookie on sockets opened by our own pages
  // (defence against cross-site WebSocket hijacking).
  const resolve = auth && isTrustedOrigin(req.headers.origin)
    ? getIdentity(auth, fromNodeHeaders(req.headers)).catch((err) => {
        console.error("[ws] session lookup failed:", err);
        return null;
      })
    : Promise.resolve(null);

  void resolve.then((identity) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, identity);
    });
  });
});

// ── Start ────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log(`[sync-service] listening on ${HOST}:${PORT}`);
  console.log(`[sync-service] routes: /universe?sectors=..., /world/{worldId}, GET /worlds/{worldId}`);
});

// ── Graceful shutdown ────────────────────────────────────────────────
function shutdown() {
  console.log("[sync-service] shutting down…");
  rooms.shutdown();
  closeDb();
  wss.close();
  server.close(() => process.exit(0));
  // Force exit after 5 seconds
  setTimeout(() => process.exit(1), 5_000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

