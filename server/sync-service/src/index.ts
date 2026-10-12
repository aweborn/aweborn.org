import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { initDb, closeDb, getDb, getStats as getDbStats } from "./persistence.js";
import { RoomManager } from "./rooms.js";
import { initAuth, getIdentity, getRawSession, isTrustedOrigin, authMethods, setPlayerPassword } from "./auth.js";
import { listCharacters, switchCharacter, waysIn, worldIndex } from "./identity.js";
import type { Identity } from "./identity.js";
import { parseRoomPath, isWorldId, ORIGIN_WORLD_ID } from "../../../shared/crdt-schema.js";

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
 *  200 { id, name, color, solidified, sector, position, isOrigin }
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
 */
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
  const path = req.url?.split("?")[0];

  if (path === "/api/player/me" && req.method === "GET") {
    return json(200, {
      playerId: session.playerId,
      characters: listCharacters(accountId),
      methods: waysIn(accountId),
      worldIndex: worldIndex(accountId),
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
  return json(404, { error: "not_found" });
}

// HTTP server (health checks + stats + world lookup + auth)
const server = createServer((req, res) => {
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

