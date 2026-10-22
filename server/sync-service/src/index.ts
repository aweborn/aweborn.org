import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { initDb, closeDb, getDb, getStats as getDbStats } from "./persistence.js";
import { RoomManager } from "./rooms.js";
import { initAuth, getIdentity, getRawSession, isTrustedOrigin, authMethods, setPlayerPassword } from "./auth.js";
import { listCharacters, recordDiscovery, switchCharacter, waysIn, worldIndex, cleanLocation, saveLocation, loadLocation } from "./identity.js";
import type { Identity } from "./identity.js";
import { parseRoomPath, isWorldId, ORIGIN_WORLD_ID } from "../../../shared/crdt-schema.js";
import { timingSafeEqual } from "node:crypto";
import { MANA_FUNCTIONS, MANA_PURPOSES, INFLOW_SOURCES } from "./mana.js";
import { startCreation, creationStatus, handleAssets, handleLibrary, manaStatus } from "./creations.js";
import { planTurn, plannerModels, planResume, planManifest, planRedo } from "./planner.js";
import { removeOwnAsset, handleTrashAdmin } from "./trash.js";
import { SIGN_IN_MESSAGE } from "./admission.js";
import { parseWorldRequest, worldsLeftToday, WORLDS_PER_DAY } from "./world-create.js";

/** Paid gen-AI calls: signed-in players only (Alex, 2026-10-20). Guests explore and build freely. */
const GENAI_POST_PATHS = new Set(["/api/player/create", "/api/player/plan", "/api/player/plan/redo", "/api/player/plan/manifest"]);

const PORT = parseInt(process.env.PORT ?? "1234", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

// ── Initialize persistence, auth & room manager ─────────────────────────────
initDb();
const auth = await initAuth(getDb());
const authHandler = auth ? toNodeHandler(auth) : null;
const rooms = new RoomManager();

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
      isOrigin: w.id === ORIGIN_WORLD_ID,
    })
  );
}

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
 */

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
            ? { name: w.name, color: w.color, creator: w.creator, position: w.resolvedPosition, sector: w.sector, solidified: w.solidified }
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
    const results = [...seen].map(([worldId, at]) => ({
      worldId,
      ...recordDiscovery(accountId, worldId, session.playerId, "sighted", "flight", at),
    }));
    return json(200, { results });
  }
  if (path === "/api/player/world-index/arrived" && req.method === "POST") {
    const body = (await readJson(req).catch(() => null)) as { worldId?: unknown } | null;
    const worldId = knownWorld(body?.worldId);
    if (!worldId) return json(404, { error: "not_found" });
    return json(200, { worldId, ...recordDiscovery(accountId, worldId, session.playerId, "sighted", "link") });
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
    const left = worldsLeftToday(rooms.allWorlds(), session.playerId);
    if (left <= 0) {
      return json(429, { error: "daily_limit", message: `You can plant ${WORLDS_PER_DAY} worlds a day. Come back tomorrow.` });
    }
    const w = rooms.createWorld(reqd.name, session.playerId, reqd.position, reqd.color);
    recordDiscovery(accountId, w.id, session.playerId, "sighted", "flight");
    return json(200, {
      world: { id: w.id, name: w.name, color: w.color, position: w.resolvedPosition, solidified: w.solidified },
      leftToday: left - 1,
    });
  }
  // Creations (Phase 07): reserve → generate → settle. Signed-in players only.
  if (session.isAnonymous && req.method === "POST" && path && GENAI_POST_PATHS.has(path)) {
    return json(403, { error: "sign_in_required", message: SIGN_IN_MESSAGE });
  }
  if (path === "/api/player/create" && req.method === "POST") {
    const body = (await readJson(req).catch(() => null)) as { prompt?: unknown } | null;
    return startCreation(rooms, session.playerId, body?.prompt, json);
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
  if (path?.startsWith("/api/player/create/") && req.method === "GET") {
    return creationStatus(rooms, session.playerId, path.slice("/api/player/create/".length), json);
  }
  // Library: a maker removes their own asset → the admin trash (never deleted)
  const rm = /^\/api\/player\/library\/([a-f0-9]{64})\/remove$/.exec(path ?? "");
  if (rm && req.method === "POST") return removeOwnAsset(session.playerId, rm[1], json);
  return json(404, { error: "not_found" });
}

/**
 * Mana (Phase 05). Public, read-only:
 *   GET /mana                          ManaState (pool, creative, highWater, frontierRadius, draws by function/purpose…)
 *   GET /mana/ledger?limit=50&before=  public ledger rows, newest first (no donors, players or refs)
 * Admin / server-to-server (Authorization: Bearer $MANA_ADMIN_TOKEN; 503 if unset):
 *   POST /api/mana/inflow  { source, netDollars, creativeBaseDollars?, restricted?, ref?, note?, at? }
 *   POST /api/mana/draw    { purpose, fn, dollars, ref?, note?, at? }   (not creations: those reserve → settle)
 *   Both are idempotent on `ref` (200 { duplicate: true } on a retry).
 * Donation webhook (Authorization: Bearer $MANA_INFLOW_TOKEN): the Stripe Lambda's
 * narrow key. Only POST /api/mana/inflow with `source: "gift"`, a `ref`, no
 * creative override and no note: a leaked copy can't draw money or fake a grant.
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
      path === "/api/mana/inflow" &&
      b.source === "gift" &&
      typeof b.ref === "string" && b.ref.length > 0 &&
      b.creativeBaseDollars === undefined && b.restricted === undefined && b.note === undefined;
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
      const r = rooms.mana.recordDraw({ purpose, fn, dollars, ref: str(b.ref), note: str(b.note), at: num(b.at) });
      return json(200, r ? { ...r, state: rooms.mana.state() } : { duplicate: true });
    }
  } catch (err) {
    return json(400, { error: "bad_request", message: (err as Error).message });
  }
  return json(404, { error: "not_found" });
}

function handleManaPublic(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname !== "/mana" && url.pathname !== "/mana/ledger") return false;
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
  } else {
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
    const before = parseInt(url.searchParams.get("before") ?? "", 10);
    res.end(JSON.stringify({ entries: rooms.mana.publicEntries(limit, Number.isFinite(before) ? before : undefined) }));
  }
  return true;
}

// HTTP server (health checks + stats + world lookup + auth)
const server = createServer((req, res) => {
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

