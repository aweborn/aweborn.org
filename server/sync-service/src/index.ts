import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { initDb, closeDb, getDb, getStats as getDbStats } from "./persistence.js";
import { RoomManager } from "./rooms.js";
import { initAuth, getIdentity, getRawSession, isTrustedOrigin, authMethods, setPlayerPassword, deleteStanding } from "./auth.js";
import { accountOfCharacter, listCharacters, recordDiscovery, switchCharacter, waysIn, worldIndex, cleanLocation, saveLocation, loadLocation, setCharacterName, characterNameAt, characterNames } from "./identity.js";
import type { Identity } from "./identity.js";
import { parseRoomPath, isWorldId, ORIGIN_WORLD_ID } from "../../../shared/crdt-schema.js";
import { cleanCoCreators, isWorldOwnerId, planBuilderChange, type BuilderChange } from "../../../shared/world-policy.js";
import { BuildRequests, type SqlDb } from "./build-requests.js";
import { WorldGames } from "./game.js";
import { MatchStore } from "./match-store.js";
import { AgeDoor } from "./age-door.js";
import { AdultWorlds } from "./adult-worlds.js";
import { MatchHost } from "./matches.js";
import { GameLibrary, saveLibraryGame, bringLibraryGame, type LibraryRouteDeps } from "./game-library.js";
import { tryResearchId } from "./research.js";
import { MATCH_TICK_MS } from "../../../shared/match.js";
import { AWE_MATCH_DAILY_MAX, GAME_HOST_SENDER, type MatchMessage } from "../../../shared/match-protocol.js";
import { wandererTag } from "../../../shared/names.js";
import type { BuildRequestView, MyBuildRequest } from "../../../shared/build-requests.js";
import { cleanPlayerName } from "../../../shared/names.js";
import { timingSafeEqual, randomInt } from "node:crypto";
import { MANA_FUNCTIONS, MANA_PURPOSES, INFLOW_SOURCES } from "./mana.js";
import { startCreation, creationStatus, handleAssets, handleLibrary, manaStatus, writeLore, sweepCreations, type CreateRequest } from "./creations.js";
import { MindHost, startAnimate, createMind, mindHistory, saveMind, adoptMind, removeSavedMind, mindShelf, handleMindLibrary } from "./minds.js";
import { planTurn, plannerModels, planResume, planManifest, planRedo, planEdit, planVersions, planRestore, hookWorldMusic, forgetPlannerPlayers } from "./planner.js";
import { sweepUnrated } from "./output-gate.js";
import { removeOwnAsset, uploadAssetThumb, handleTrashAdmin } from "./trash.js";
import { SIGN_IN_MESSAGE } from "./admission.js";
import { parseWorldRequest, worldsLeftToday, cleanWorldName, WORLDS_PER_DAY } from "./world-create.js";
import { listMutes, setMute, fileReport, handleReportsAdmin, isPlayerId } from "./moderation.js";
import { CLIENT_SKILLS, type Skill } from "../../../shared/progress.js";
import type { ProgressDelta } from "./progress.js";
import { isNature } from "../../../shared/sky.js";
import { RunwayWatch } from "./runway.js";
import { sendEmail, playerDeletedEmail } from "./email.js";
import { CardOrders, CHECKOUT_BODY_LIMIT } from "./cards.js";
import { CardSets } from "./card-sets.js";
import { checkCreation, checkImage } from "./safety.js";
import { handleMakingOf, buildMakingOf } from "./making-of.js";
import { DELETE_CONFIRM_WORD, EraseLimiter, eraseRows, flushGenaiForget, queueGenaiForget, writeEraseAudit, type EraseCounts, type GenaiForget } from "./erase-player.js";
import { FORMER_PLAYER_ID } from "../../../shared/names.js";

/** Paid gen-AI calls: signed-in players only (Alex, 2026-10-20). Guests explore and build freely. */
const GENAI_POST_PATHS = new Set(["/api/player/create", "/api/player/lore", "/api/player/plan", "/api/player/plan/redo", "/api/player/plan/manifest", "/api/player/plan/edit",
  "/api/player/animate", "/api/player/mind"]);

const PORT = parseInt(process.env.PORT ?? "1234", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

// ── Initialize persistence, auth & room manager ─────────────────────────────
initDb();
const auth = await initAuth(getDb());
const authHandler = auth ? toNodeHandler(auth) : null;
const rooms = new RoomManager();
rooms.sweepWorldSounds();
hookWorldMusic(rooms);
// Minds (Phase 07 Life & minds): placed creations that hear world chat and answer
const minds = new MindHost(rooms);
rooms.onWorldChat = (worldId, playerId, text, at) => minds.heard(worldId, playerId, text, at);

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
  checkImage: async (playerId, dataUrl, ref) => {
    const v = await checkImage(playerId, "card-photo", dataUrl, ref);
    return v.ok ? { ok: true } : { ok: false, message: v.message };
  },
  email: (to, subject, text) => sendEmail({ to, subject, text, html: `<pre style="font:15px/1.5 system-ui,sans-serif;white-space:pre-wrap">${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre>` }),
});
const cardSets = new CardSets(getDb(), (id) => rooms.lookupWorld(id) !== null);
// Asking to build (2026-11-07): asks wait in every owner's inbox until one answers.
// (better-sqlite3's Database has the prepare/exec shape SqlDb names; tests use node:sqlite.)
const buildRequests = new BuildRequests(getDb() as unknown as SqlDb);
// The game layer (Phase 10, slice 1): one game per world, every version kept (game.ts).
const worldGames = new WorldGames(getDb() as unknown as SqlDb);
rooms.worldGame = (worldId) => worldGames.get(worldId);
// Matches (Phase 10, slices 2 to 6): every match is recorded (match-store.ts) and run by the match host (matches.ts).
const nameOfPlayer = (playerId: string): string => characterNames([playerId])[playerId] ?? wandererTag(playerId);
// The 18+ door (age-door.ts): a saved player's *Show 18+* toggle. Being behind it is what makes a research candidate (Q10b).
const ageDoor = new AgeDoor(getDb() as unknown as SqlDb);
// 18+ worlds: only behind the door (rooms.ts → mayEnter); their real names stay out of the shared universe (adult-worlds.ts)
const adultWorlds = new AdultWorlds(getDb() as unknown as SqlDb);
rooms.doorOpen = (accountId) => ageDoor.open(accountId);
const matchStore = new MatchStore(getDb() as unknown as SqlDb, (worldId) => rooms.lookupWorld(worldId)?.name ?? "");
const matchHost = new MatchHost({
  game: (worldId) => worldGames.get(worldId),
  isOwner: (worldId, playerId) => rooms.isWorldOwner(worldId, playerId, accountOfCharacter(playerId)),
  position: (worldId, playerId) => rooms.playerPosition(worldId, playerId),
  online: (worldId, playerId) => rooms.playerOnline(worldId, playerId),
  send: (playerId, worldId, msg: MatchMessage) => rooms.sendMatchTo(playerId, worldId, msg),
  setGroup: (playerId, group) => rooms.setPresenceGroup(playerId, group),
  name: nameOfPlayer,
  researchId: (playerId) => tryResearchId(playerId),
  researchCandidate: (playerId) => ageDoor.open(accountOfCharacter(playerId)),
  // A player deleted mid-match earns nothing (it would write their progress back): erasedPlayers, below
  awe: (playerId, amount, matchId) => (erasedPlayers.has(playerId) ? 0 : rooms.progress.match(playerId, amount, matchId, AWE_MATCH_DAILY_MAX).xp),
  chat: (worldId, line) => { rooms.pushWorldChat(worldId, { sender: GAME_HOST_SENDER, text: line }); },
  objects: (worldId) => rooms.readWorldState(worldId)?.objects ?? [],
  gravity: (worldId) => rooms.worldGravity(worldId),
  checkPositions: process.env.MATCH_POSITION_CHECK !== "off",
  store: matchStore,
  now: Date.now,
  seed: () => randomInt(0x100000000),
});
rooms.onMatchIntent = (_ws, worldId, playerId, intent) => matchHost.intent(worldId, playerId, intent);
rooms.onLeftWorld = (worldId, playerId) => matchHost.left(worldId, playerId);
rooms.terrainLocks = (worldId) => matchHost.terrainLocks(worldId);
setInterval(() => matchHost.tick(), MATCH_TICK_MS);
// The game Library (Phase 10, slice 7): games travel between worlds, versioned and credited (game-library.ts).
const gameLibrary = new GameLibrary(getDb() as unknown as SqlDb);
const libraryDeps = (accountId: string): LibraryRouteDeps => ({
  lib: gameLibrary,
  isOwner: (worldId, playerId) => rooms.isWorldOwner(worldId, playerId, accountId),
  game: (worldId) => worldGames.get(worldId),
  objects: (worldId) => rooms.readWorldState(worldId)?.objects ?? [],
  cleanName: cleanWorldName,
  saveGame: (worldId, game, by, credits) => {
    const r = worldGames.save(worldId, game, by, Date.now(), credits);
    if (!r.ok) return { ok: false, message: r.message };
    rooms.setWorldGame(worldId, r.game);
    matchHost.gameChanged(worldId);
    return { ok: true, game: r.game, warnings: r.warnings };
  },
  placeObjects: (worldId, objects) => { rooms.placeWorldObjects(worldId, objects); },
  clearProps: (worldId) => rooms.clearGameProps(worldId),
  name: nameOfPlayer,
});
setInterval(() => {
  try {
    const n = buildRequests.sweep();
    if (n) console.log(`[build-requests] swept ${n}`);
  } catch (err) {
    console.error("[build-requests] sweep failed:", (err as Error).message);
  }
}, 3600_000).unref();

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
 *  200 { id, name, color, creator, solidified, sector, position, isOrigin, tier? }
 *      (`tier: "adult"` = an 18+ world: its `name` here is always "18+ world", never the real one)
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
      ...(w.tier ? { tier: w.tier } : {}),
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

/** What a player outside the 18+ door is told about an 18+ world, on every route. */
const ADULT_WORLD_SHUT = { error: "adult_world", message: "This is an 18+ world. Sign in and turn on 18+ content to go there." };

/** A request's body, read once: the 18+ guard looks at it before the route does (`handlePlayerApi`). */
const bodies = new WeakMap<IncomingMessage, { length: number; value?: unknown; bad?: true }>();
/** The 18+ guard reads bodies up to this size (the largest JSON route, animate, is 450 kB); card checkout checks its world itself. */
const GUARD_BODY_LIMIT = 512_000;

function readJson(req: IncomingMessage, limit = 4096): Promise<unknown> {
  const seen = bodies.get(req);
  if (seen) return seen.bad || seen.length > limit ? Promise.reject(new Error(seen.bad ? "bad json" : "too large")) : Promise.resolve(seen.value);
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > limit) {
        bodies.set(req, { length: body.length, bad: true });
        reject(new Error("too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const value = body ? JSON.parse(body) : {};
        bodies.set(req, { length: body.length, value });
        resolve(value);
      } catch (err) {
        bodies.set(req, { length: body.length, bad: true });
        reject(err as Error);
      }
    });
    req.on("error", reject);
  });
}

/**
 * `/api/player/*`: the signed-in account (session cookie, trusted origins only).
 *   GET  /api/player/me         { playerId, characters, methods, door, buildRequests, worldIndex }
 *   POST /api/player/door       { show } → { show }  the 18+ door: a toggle, saved players only (age-door.ts)
 *   POST /api/player/world/claim  { worldId, token } → admin: this character becomes creator of an Aweborn world
 *   POST /api/player/world/builders  { worldId, add | remove } → { worldId, coCreators }
 *        Creator + builders add; only the creator removes; anyone steps down (shared/world-policy.ts).
 *   GET  /api/match/world?worldId=  → { matches }   a world's finished matches (Phase 10; any session)
 *   GET  /api/match/record?id=      → { record }    one match record, running or finished (any session)
 *   GET  /api/player/replays        → { matches }   the matches this account's characters played
 *   GET  /api/player/game-library   → { games }     the game Library (mine first)
 *   POST /api/player/game-library        { worldId, name }            → { game }   owners save this world's game
 *   POST /api/player/game-library/bring  { worldId, libraryId, at }   → { game }   owners bring a Library game here
 *   POST /api/player/world/game  { worldId, game | null } → { worldId, game, changed, warnings }
 *        The world's game (Phase 10): creator + builders only. Validated and repaired
 *        (shared/game.ts parseGame), saved as the next version, copied to the world's
 *        meta.game. `game: null` removes it (saved versions stay). 400 bad_game.
 *   GET  /api/player/build-requests  → { requests: BuildRequestView[] }  asks waiting for you (also in /me)
 *   GET  /api/player/world/build-request?worldId=  → MyBuildRequest (none | open | declined | builder)
 *   POST /api/player/world/build-request  { worldId } → ask to build (saved players; shared/build-requests.ts limits)
 *   POST /api/player/world/build-request/withdraw  { worldId }
 *   POST /api/player/world/build-request/decide  { worldId, requester, approve } → creator or a builder answers
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

// Output gate (2026-11-10): rate finished files nobody's poll rated, and the Library from before
let rating = false;
setInterval(() => {
  if (rating) return;
  rating = true;
  sweepUnrated()
    .then((r) => { if (r.rated || r.blocked) console.log(`[output-gate] rated ${r.rated}, blocked ${r.blocked}, waiting ${r.waiting}`); })
    .catch((err) => console.error("[output-gate] sweep failed:", (err as Error).message))
    .finally(() => { rating = false; });
}, 60_000).unref();

/** A live world id (normalised), or null. */
function knownWorld(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const worldId = id.toLowerCase();
  return isWorldId(worldId) && rooms.lookupWorld(worldId) ? worldId : null;
}

// ── Builders and asking to build (2026-11-07) ───────────────────────

/** A world's creator and builders: the characters whose inboxes get its asks. */
function ownersOf(worldId: string, coCreators?: readonly string[]): string[] {
  const w = rooms.lookupWorld(worldId);
  if (!w) return [];
  const creator = w.creator && w.creator !== "system" && w.creator !== "guest" && w.creator !== FORMER_PLAYER_ID ? [w.creator] : [];
  return [...creator, ...(coCreators ?? w.coCreators ?? [])];
}

/** Write a world's builders and keep the asks in step (added players' asks are done; inboxes follow). */
function setBuilders(worldId: string, next: string[], before: readonly string[]): boolean {
  if (!rooms.setWorldCoCreators(worldId, next)) return false;
  for (const id of next) {
    if (before.includes(id)) continue;
    const account = accountOfCharacter(id);
    if (account) buildRequests.resolve(worldId, account);
  }
  buildRequests.syncOwners(worldId, ownersOf(worldId, next));
  return true;
}

/** Builder changes per account per minute: each rewrites the universe entry (fans out to its sector). */
const BUILDER_CHANGES_PER_MIN = 30;
const builderWindows = new Map<string, { start: number; count: number }>();
function takeBuilderChange(accountId: string, now = Date.now()): boolean {
  let w = builderWindows.get(accountId);
  if (!w || now - w.start >= 60_000) {
    if (builderWindows.size > 50_000) for (const [k, v] of builderWindows) if (now - v.start >= 60_000) builderWindows.delete(k);
    w = { start: now, count: 0 };
    builderWindows.set(accountId, w);
  }
  if (w.count >= BUILDER_CHANGES_PER_MIN) return false;
  w.count++;
  return true;
}
const SLOW_BUILDERS = { error: "slow_down", message: "That’s a lot of changes. Give it a minute." };

/** The admin token, sent in a JSON body (the player API's CORS allows no Authorization header). */
function adminTokenMatches(given: unknown): boolean {
  if (!MANA_ADMIN_TOKEN || typeof given !== "string") return false;
  const got = Buffer.from(given);
  const want = Buffer.from(MANA_ADMIN_TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Asks waiting for this person (any of their characters owns the world), minus anyone they muted. */
function buildInbox(accountId: string): BuildRequestView[] {
  const mine = listCharacters(accountId).map((c) => c.id);
  const muted = new Set(listMutes(accountId));
  const rows = buildRequests.inbox(mine).filter((r) => !muted.has(r.requester) && !mine.includes(r.requester));
  const names = characterNames([...new Set(rows.map((r) => r.requester))]);
  const out: BuildRequestView[] = [];
  for (const r of rows) {
    const w = rooms.lookupWorld(r.worldId);
    if (!w || !mine.some((c) => isWorldOwnerId(c, { creator: w.creator, coCreators: w.coCreators }))) continue;
    out.push({
      worldId: r.worldId, worldName: w.name, worldColor: w.color, requester: r.requester, askedAt: r.askedAt,
      ...(names[r.requester] ? { requesterName: names[r.requester] } : {}),
    });
  }
  return out;
}

function myBuildRequest(worldId: string, playerId: string, accountId: string): MyBuildRequest {
  if (rooms.isWorldOwner(worldId, playerId, accountId)) return { status: "builder" };
  return buildRequests.status(worldId, accountId);
}

// ── Deleting a player (erase-player.ts; Alex, 2026-11-24) ───────────

/** Player ids deleted since this process started: late writers (a match that was still running) check it. Memory only. */
const erasedPlayers = new Set<string>();
/** Attempts per account and per address per hour (off with DEV_NO_RATE_LIMIT outside production, like the auth routes). */
const eraseLimiter = new EraseLimiter(5);
const eraseIpLimiter = new EraseLimiter(20);
const ERASE_LIMITED = process.env.NODE_ENV === "production" || !process.env.DEV_NO_RATE_LIMIT;
const GENAI_URL = process.env.GENAI_URL ?? "http://genai-service:3001";

/** The genai-service's part (its own database: job history, the Library's makers and trash). Null = not reached; it is asked again later. */
const genaiForget: GenaiForget = async (playerIds) => {
  const res = await fetch(`${GENAI_URL}/forget`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerIds }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const counts: EraseCounts = {};
  for (const [k, v] of Object.entries(body ?? {})) if (typeof v === "number" && v > 0) counts[k] = v;
  return counts;
};
let genaiForgetRunning = false;
function tellGenaiForget(): void {
  if (genaiForgetRunning) return;
  genaiForgetRunning = true;
  flushGenaiForget(getDb() as unknown as SqlDb, genaiForget)
    .then((waiting) => { if (waiting) console.warn(`[erase] the genai-service has not been told about ${waiting} deleted player(s) yet; trying again later`); })
    .catch((err) => console.error("[erase] telling the genai-service failed:", (err as Error).message))
    .finally(() => { genaiForgetRunning = false; });
}
setInterval(tellGenaiForget, 3600_000).unref();
setTimeout(tellGenaiForget, 30_000).unref(); // anything left from before a restart

/**
 * Delete an account: every character on it and everything linked to them. One place, in
 * an order that can be run again if it stops half-way (until the last step the account
 * still exists, so the player simply asks again):
 *   1. out of every match and pool, every connection closed
 *   2. the shared documents (worlds stay, the player leaves them)
 *   3. every table, in one transaction, with the audit line and the genai-service queue
 *   4. this process's memory; then the genai-service is told
 */
function erasePlayerAccount(accountId: string, storedEmail: string | null): { characters: number; counts: EraseCounts } {
  const ids = new Set(listCharacters(accountId).map((c) => c.id));
  for (const id of ids) erasedPlayers.add(id);
  const now = Date.now();

  const closed = rooms.dropPlayers(ids, (worldId, id) => matchHost.intent(worldId, id, { t: "leave" }));
  const docCounts = rooms.forgetPlayers(ids);

  const db = getDb();
  const sql = db as unknown as SqlDb;
  let counts: EraseCounts = {};
  db.transaction(() => {
    const rowCounts = eraseRows(sql, { accountId, playerIds: [...ids], email: storedEmail });
    counts = { ...docCounts, ...rowCounts, ...(closed ? { sockets: closed } : {}) };
    const auditId = writeEraseAudit(sql, ids.size, counts, now);
    queueGenaiForget(sql, [...ids], now, auditId);
  })();

  const released = rooms.mana.forgetPlayers(ids);
  if (released) counts = { ...counts, "mana.holds_released": released };
  forgetPlannerPlayers(ids);
  for (const id of ids) progressReports.delete(id);
  sightingWindows.delete(accountId);
  builderWindows.delete(accountId);
  tellGenaiForget();
  // No ids, no names: when, how many characters, how many rows of what
  console.log(`[erase] a player was deleted: ${ids.size} character(s), ${JSON.stringify(counts)}`);
  return { characters: ids.size, counts };
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

  // 18+ worlds (Alex, 2026-11-24): only players behind the 18+ door can make, see into or change one.
  // Every route here names its world as `worldId` or `parentWorldId`, in the query or the JSON body,
  // so one check covers them all, and any route added later.
  const door = !session.isAnonymous && ageDoor.open(accountId);
  if (!door) {
    const named: unknown[] = [];
    const query = new URL(req.url ?? "/", "http://x").searchParams;
    named.push(query.get("worldId"), query.get("parentWorldId"));
    if (req.method === "POST" && Number(req.headers["content-length"] ?? 0) <= GUARD_BODY_LIMIT) {
      const body = (await readJson(req, GUARD_BODY_LIMIT).catch(() => null)) as { worldId?: unknown; parentWorldId?: unknown } | null;
      if (body && typeof body === "object") named.push(body.worldId, body.parentWorldId);
    }
    if (named.some((id) => typeof id === "string" && rooms.isAdultWorld(id.toLowerCase()))) return json(403, ADULT_WORLD_SHUT);
  }

  if (path === "/api/player/me" && req.method === "GET") {
    return json(200, {
      playerId: session.playerId,
      characters: listCharacters(accountId),
      methods: waysIn(accountId),
      door: { show: !session.isAnonymous && ageDoor.open(accountId) },
      buildRequests: buildInbox(accountId),
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
                ...(w.coCreators?.length ? { coCreators: w.coCreators } : {}),
              }
            : null,
        };
      }),
    });
  }
  if (path === "/api/player/door" && req.method === "POST") {
    if (session.isAnonymous) return json(403, { error: "sign_in_required", message: "Save your player first, then try again." });
    const body = (await readJson(req).catch(() => null)) as { show?: unknown } | null;
    if (typeof body?.show !== "boolean") return json(400, { error: "bad_request", message: "Say whether to show 18+ content." });
    const show = ageDoor.set(accountId, body.show);
    if (!show) rooms.closeDoorFor(accountId); // out of every 18+ world, at once
    return json(200, { show });
  }
  // Delete my player (Privacy "Your choices and rights"): the whole account, every character on it.
  //   GET  → { saved, fresh, characters, worlds, word }   what the are-you-sure step needs to say
  //   POST { confirm: "DELETE" } → { deleted: true }       saved players only, confirmed in the last 5 minutes
  if (path === "/api/player/delete" && (req.method === "GET" || req.method === "POST")) {
    const standing = await deleteStanding(auth, fromNodeHeaders(req.headers));
    if (!standing) return json(401, { error: "no_session" });
    const mine = listCharacters(accountId).map((c) => c.id);
    if (req.method === "GET") {
      return json(200, {
        saved: !standing.isAnonymous, fresh: standing.fresh, characters: mine.length,
        worlds: rooms.allWorlds().filter((w) => mine.includes(w.creator)).length, word: DELETE_CONFIRM_WORD,
      });
    }
    if (standing.isAnonymous) {
      return json(403, { error: "not_saved", message: "This player isn’t saved, so there is no sign-in to delete. To have an unsaved player’s data removed, email privacy@aweborn.org." });
    }
    if (ERASE_LIMITED) {
      const xff = req.headers["x-forwarded-for"];
      const ip = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim() || req.socket.remoteAddress || "";
      if (!eraseIpLimiter.take(`ip:${ip}`) || !eraseLimiter.take(`a:${accountId}`)) {
        return json(429, { error: "slow_down", message: "Too many tries. Wait an hour, then try again." });
      }
    }
    const body = (await readJson(req).catch(() => null)) as { confirm?: unknown } | null;
    if (body?.confirm !== DELETE_CONFIRM_WORD) {
      return json(400, { error: "confirm_word", message: `Type ${DELETE_CONFIRM_WORD} to confirm.` });
    }
    if (!standing.fresh) return json(403, { error: "confirm_first", code: "SESSION_NOT_FRESH", message: "For safety, confirm it's you first." });
    try {
      const done = erasePlayerAccount(accountId, standing.storedEmail);
      if (standing.realEmail) void sendEmail(playerDeletedEmail(standing.realEmail));
      return json(200, { deleted: true, characters: done.characters });
    } catch (err) {
      console.error("[erase] failed:", (err as Error).message);
      return json(500, { error: "delete_failed", message: "Something went wrong and your player was not deleted. Please try again, or email privacy@aweborn.org." });
    }
  }
  // 18+ worlds' real names, for players behind the door only (the shared universe never carries them: adult-worlds.ts)
  if (path === "/api/player/adult-worlds" && req.method === "GET") {
    return json(200, { names: door ? adultWorlds.names() : {} });
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
  // An 18+ world's story stone, for players behind the door (the public /making-of refuses 18+ worlds; the guard above checked the door)
  if (path === "/api/player/making-of" && req.method === "GET") {
    const worldId = knownWorld(new URL(req.url ?? "/", "http://x").searchParams.get("worldId"));
    if (!worldId) return json(400, { error: "bad_request", message: "That world isn't there." });
    return json(200, buildMakingOf(getDb(), worldId));
  }
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
    // An 18+ world is made by a player behind the 18+ door, and is 18+ for good (a parent's 18+ is inherited in createWorld)
    if (reqd.adult && !door) return json(403, { error: "door_closed", message: "Turn on 18+ content in your player panel to make an 18+ world." });
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
    const w = rooms.createWorld(reqd.name, session.playerId, reqd.position, reqd.color, reqd.parentWorldId, { adult: reqd.adult });
    if (w.tier === "adult") adultWorlds.setName(w.id, reqd.name);
    recordDiscovery(accountId, w.id, session.playerId, "sighted", "flight", Date.now(), w.solidified ? "solid" : "dreamt");
    rooms.progress.useSkill(session.playerId, "world");
    return json(200, {
      world: {
        id: w.id,
        name: w.tier === "adult" ? reqd.name : w.name, // the maker is behind the door: they get their world's real name
        color: w.color,
        position: w.resolvedPosition,
        solidified: w.solidified,
        ...(w.parentWorldId ? { parentWorldId: w.parentWorldId } : {}),
        ...(w.tier ? { tier: w.tier } : {}),
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
      setBuilders(worldId, coCreators, w.coCreators ?? []);
    }
    if (hasPortals) rooms.setWorldPortalPolicy(worldId, body!.allowPortals as boolean);
    return json(200, { worldId, ...(hasPortals ? { allowPortals: body!.allowPortals } : {}), ...(coCreators ? { coCreators } : {}) });
  }
  // Take over one of Aweborn's own worlds (admin, 2026-11-08): the signed-in character becomes its creator
  if (path === "/api/player/world/claim" && req.method === "POST") {
    const body = (await readJson(req).catch(() => null)) as { worldId?: unknown; token?: unknown } | null;
    if (!MANA_ADMIN_TOKEN) return json(503, { error: "admin_disabled" });
    if (!adminTokenMatches(body?.token)) return json(401, { error: "unauthorized", message: "Wrong token." });
    if (session.isAnonymous) return json(403, { error: "sign_in_required", message: "Save your player first, then try again." });
    const worldId = knownWorld(body?.worldId);
    if (!worldId || worldId === ORIGIN_WORLD_ID) return json(400, { error: "bad_request", message: "That isn’t a world you can take over." });
    if (!rooms.claimSystemWorld(worldId, session.playerId)) {
      return json(409, { error: "not_aweborns", message: "Only worlds made by Aweborn can be taken over." });
    }
    buildRequests.syncOwners(worldId, ownersOf(worldId));
    console.log(`[worlds] ${worldId} now belongs to ${session.playerId}`);
    return json(200, { worldId, creator: session.playerId, name: rooms.lookupWorld(worldId)?.name ?? "" });
  }
  // Builders, one change at a time (2026-11-07): the creator and builders add; the creator removes; anyone steps down
  if (path === "/api/player/world/builders" && req.method === "POST") {
    if (session.isAnonymous) return json(403, { error: "sign_in_required", message: "Save your player to change who builds here." });
    const body = (await readJson(req).catch(() => null)) as { worldId?: unknown; add?: unknown; remove?: unknown } | null;
    const worldId = knownWorld(body?.worldId);
    const change: BuilderChange | null = isPlayerId(body?.add) ? { add: body.add } : isPlayerId(body?.remove) ? { remove: body.remove } : null;
    if (!worldId || !change || worldId === ORIGIN_WORLD_ID) return json(400, { error: "bad_request" });
    const w = rooms.lookupWorld(worldId);
    if (!w) return json(404, { error: "not_found" });
    if ("add" in change && !accountOfCharacter(change.add)) return json(400, { error: "bad_player", message: "That player isn’t around any more." });
    const before = w.coCreators ?? [];
    const plan = planBuilderChange({ creator: w.creator, coCreators: before }, listCharacters(accountId).map((c) => c.id), change);
    if (!plan.ok) return json(plan.error === "full" ? 409 : plan.error === "bad_player" ? 400 : 403, plan);
    if (plan.changed && !takeBuilderChange(accountId)) return json(429, SLOW_BUILDERS);
    if (plan.changed && !setBuilders(worldId, plan.next, before)) return json(500, { error: "internal" });
    return json(200, { worldId, coCreators: plan.next });
  }
  // The world's game (Phase 10, slice 1): creator and builders set it up; the server is the only writer
  if (path === "/api/player/world/game" && req.method === "POST") {
    if (session.isAnonymous) return json(403, { error: "sign_in_required", message: "Save your player to set up a game." });
    const body = (await readJson(req, 16_384).catch(() => null)) as { worldId?: unknown; game?: unknown } | null;
    const worldId = knownWorld(body?.worldId);
    if (!worldId || worldId === ORIGIN_WORLD_ID || body?.game === undefined) return json(400, { error: "bad_request" });
    if (!rooms.isWorldOwner(worldId, session.playerId, accountId)) {
      return json(403, { error: "not_owner", message: "Only this world’s creator and builders can set up its game." });
    }
    if (!takeBuilderChange(accountId)) return json(429, SLOW_BUILDERS);
    if (body.game === null) {
      const changed = worldGames.remove(worldId);
      rooms.setWorldGame(worldId, null);
      matchHost.gameChanged(worldId);
      if (changed) console.log(`[game] ${worldId} removed by ${session.playerId}`);
      return json(200, { worldId, game: null, changed, warnings: [] });
    }
    const r = worldGames.save(worldId, body.game, session.playerId);
    if (!r.ok) return json(400, r);
    rooms.setWorldGame(worldId, r.game);
    if (r.changed) matchHost.gameChanged(worldId);
    if (r.changed) console.log(`[game] ${worldId} v${r.game.version} (${r.game.template}) by ${session.playerId}`);
    return json(200, { worldId, game: r.game, changed: r.changed, warnings: r.warnings });
  }
  // Matches (Phase 10): a world's finished matches, a character's replays, one record (any session: a replay is watchable by id)
  if (path === "/api/match/world" && req.method === "GET") {
    const worldId = knownWorld(new URL(req.url ?? "/", "http://x").searchParams.get("worldId"));
    if (!worldId) return json(400, { error: "bad_request", message: "That world isn't there." });
    return json(200, { matches: matchStore.worldRecent(worldId, 30) });
  }
  if (path === "/api/player/replays" && req.method === "GET") {
    const mine = [...new Set([session.playerId, ...listCharacters(accountId).map((c) => c.id)])];
    // Replays from 18+ worlds show only behind the door
    return json(200, { matches: matchStore.playerRecent(mine, 50).filter((m) => door || !rooms.isAdultWorld(m.worldId)) });
  }
  if (path === "/api/match/record" && req.method === "GET") {
    const id = new URL(req.url ?? "/", "http://x").searchParams.get("id") ?? "";
    // A running match answers with the record so far (result null): watchers read the roster from it
    const record = /^[0-9a-f-]{36}$/.test(id) ? matchHost.record(id) : null;
    if (record && !door && rooms.isAdultWorld(record.setup.worldId)) return json(403, ADULT_WORLD_SHUT);
    return record ? json(200, { record }) : json(404, { error: "not_found", message: "That match isn't on record." });
  }
  // The game Library (Phase 10, slice 7): browse, save this world's game, bring one here
  if (path === "/api/player/game-library" && req.method === "GET") {
    const mine = [...new Set([session.playerId, ...listCharacters(accountId).map((c) => c.id)])];
    return json(200, { games: gameLibrary.list(mine, (ids) => ({ ...Object.fromEntries(ids.map((id) => [id, wandererTag(id)])), ...characterNames(ids) })) });
  }
  if ((path === "/api/player/game-library" || path === "/api/player/game-library/bring") && req.method === "POST") {
    if (session.isAnonymous) return json(403, { error: "sign_in_required", message: "Save your player to use the game Library." });
    const body = (await readJson(req).catch(() => null)) as { worldId?: unknown; name?: unknown; libraryId?: unknown; at?: unknown } | null;
    const known = knownWorld(body?.worldId);
    const worldId = known === ORIGIN_WORLD_ID ? null : known;
    // The game Library is one public shelf with no tiers yet, so a game made in an 18+ world isn't put on it
    if (worldId && !path.endsWith("/bring") && rooms.isAdultWorld(worldId)) {
      return json(403, { error: "adult_world", message: "Games made in 18+ worlds can’t go to the Library yet." });
    }
    if (!takeBuilderChange(accountId)) return json(429, SLOW_BUILDERS);
    const mine = [...new Set([session.playerId, ...listCharacters(accountId).map((c) => c.id)])];
    const r = path.endsWith("/bring")
      ? bringLibraryGame(libraryDeps(accountId), { playerId: session.playerId }, worldId, body?.libraryId, body?.at)
      : saveLibraryGame(libraryDeps(accountId), { playerId: session.playerId, mine }, worldId, body?.name);
    if (r.status === 200) console.log(`[game-library] ${path.endsWith("/bring") ? "brought to" : "saved from"} ${worldId} by ${session.playerId}`);
    return json(r.status, r.body);
  }
  // Asking to build (2026-11-07): waits in the creator's and builders' inboxes until one answers
  if (path === "/api/player/build-requests" && req.method === "GET") return json(200, { requests: buildInbox(accountId) });
  if (path === "/api/player/world/build-request" && req.method === "GET") {
    const worldId = knownWorld(new URL(req.url ?? "/", "http://x").searchParams.get("worldId"));
    if (!worldId) return json(400, { error: "bad_request" });
    return json(200, myBuildRequest(worldId, session.playerId, accountId));
  }
  if (path === "/api/player/world/build-request" && req.method === "POST") {
    if (session.isAnonymous) return json(403, { error: "sign_in_required", message: "Save your player to ask to build." });
    const body = (await readJson(req).catch(() => null)) as { worldId?: unknown } | null;
    const worldId = knownWorld(body?.worldId);
    if (!worldId) return json(400, { error: "bad_request" });
    if (rooms.isWorldOwner(worldId, session.playerId, accountId)) return json(200, { status: "builder" });
    const owners = ownersOf(worldId);
    if (worldId === ORIGIN_WORLD_ID || !owners.length) return json(400, { error: "no_owner", message: "Nobody can make builders in this world." });
    const r = buildRequests.ask(worldId, session.playerId, accountId, owners);
    if (!r.ok) return json(r.error === "slow_down" ? 429 : 409, r);
    return json(200, { status: "open", askedAt: r.askedAt });
  }
  if (path === "/api/player/world/build-request/withdraw" && req.method === "POST") {
    const body = (await readJson(req).catch(() => null)) as { worldId?: unknown } | null;
    const worldId = knownWorld(body?.worldId);
    if (!worldId) return json(400, { error: "bad_request" });
    buildRequests.withdraw(worldId, accountId);
    return json(200, myBuildRequest(worldId, session.playerId, accountId));
  }
  if (path === "/api/player/world/build-request/decide" && req.method === "POST") {
    if (session.isAnonymous) return json(403, { error: "sign_in_required", message: "Save your player to answer asks." });
    const body = (await readJson(req).catch(() => null)) as { worldId?: unknown; requester?: unknown; approve?: unknown } | null;
    const worldId = knownWorld(body?.worldId);
    if (!worldId || !isPlayerId(body?.requester) || typeof body?.approve !== "boolean") return json(400, { error: "bad_request" });
    const w = rooms.lookupWorld(worldId);
    if (!w) return json(404, { error: "not_found" });
    const mine = listCharacters(accountId).map((c) => c.id);
    const roles = { creator: w.creator, coCreators: w.coCreators ?? [] };
    if (!mine.some((c) => isWorldOwnerId(c, roles))) {
      return json(403, { error: "not_owner", message: "Only this world’s creator and builders can answer asks." });
    }
    const ask = buildRequests.openAsk(worldId, body.requester);
    if (!ask) return json(404, { error: "not_found", message: "Someone already answered that ask." });
    if (!body.approve) {
      buildRequests.decline(worldId, ask.accountId, session.playerId);
      return json(200, { worldId, declined: true });
    }
    const plan = planBuilderChange(roles, mine, { add: body.requester });
    if (!plan.ok) return json(plan.error === "full" ? 409 : 403, plan);
    if (plan.changed && !takeBuilderChange(accountId)) return json(429, SLOW_BUILDERS);
    if (plan.changed && !setBuilders(worldId, plan.next, roles.coCreators)) return json(500, { error: "internal" });
    buildRequests.resolve(worldId, ask.accountId);
    return json(200, { worldId, coCreators: plan.next });
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
  // Life & minds (Phase 07): animate a placed model; give a creation a mind (cumulative: asking again grows it)
  if (path === "/api/player/animate" && req.method === "POST") {
    // Room for the sheet's drawn thumbnail (body check when the server has none)
    return startAnimate(rooms, session.playerId, accountId, (await readJson(req, 450_000).catch(() => null)) as Record<string, unknown> | null, json);
  }
  if (path === "/api/player/mind" && req.method === "POST") {
    return createMind(rooms, session.playerId, accountId, (await readJson(req).catch(() => null)) as Record<string, unknown> | null, json);
  }
  // Minds you keep (2026-11-06): history, save to the Library, give a saved mind, the shelf
  if (path === "/api/player/mind/history" && req.method === "GET") return mindHistory(rooms, session.playerId, accountId, req, json);
  if (path === "/api/player/mind/save" && req.method === "POST") {
    const from = ((await readJson(req).catch(() => null)) as { worldId?: unknown } | null)?.worldId;
    if (typeof from === "string" && rooms.isAdultWorld(from.toLowerCase())) {
      return json(403, { error: "adult_world", message: "Minds from 18+ worlds can’t go to the Library yet." });
    }
    return saveMind(rooms, session.playerId, accountId, (await readJson(req).catch(() => null)) as Record<string, unknown> | null, json);
  }
  if (path === "/api/player/mind/adopt" && req.method === "POST") {
    return adoptMind(rooms, session.playerId, accountId, (await readJson(req).catch(() => null)) as Record<string, unknown> | null, json);
  }
  if (path === "/api/player/minds" && req.method === "GET") return mindShelf(session.playerId, req, json);
  const mindRm = /^\/api\/player\/mind\/library\/([a-f0-9]{64})\/remove$/.exec(path ?? "");
  if (mindRm && req.method === "POST") return removeSavedMind(session.playerId, accountId, mindRm[1], json);
  if (path === "/api/player/lore" && req.method === "POST") {
    const body = (await readJson(req).catch(() => null)) as { prompt?: unknown; subject?: unknown } | null;
    return writeLore(rooms, session.playerId, body, json);
  }
  if (path === "/api/player/plan" && req.method === "POST") {
    return planTurn(rooms, session.playerId, await readJson(req).catch(() => null), json);
  }
  if (path === "/api/player/plan/models" && req.method === "GET") return plannerModels(json);
  if (path === "/api/player/plan/redo" && req.method === "POST") {
    return planRedo(rooms, session.playerId, await readJson(req).catch(() => null), json, session.userId);
  }
  if (path === "/api/player/plan/manifest" && req.method === "POST") {
    return planManifest(rooms, session.playerId, await readJson(req).catch(() => null), json, session.userId);
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
    return uploadAssetThumb(session.playerId, th[1], body?.dataUrl, json);
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
  // How a world was made: its planner conversations, public (the story stone, making-of.ts)
  if (handleMakingOf(req, res, corsHeaders(req), (id) => rooms.isAdultWorld(id))) return;
  // The Library's Minds shelf and a saved mind's history: public, like made models (minds.ts)
  if (handleMindLibrary(req, res, corsHeaders(req), rooms)) return;
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
  if (req.url?.startsWith("/api/player/") || req.url?.startsWith("/api/match/")) {
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
        steering: rooms.steering.stats(),
        meshIntro: rooms.meshIntro.stats(),
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
  // Public IP (Caddy overwrites X-Forwarded-For with the real client IP): only for mesh auto-pairing
  const xff = req.headers["x-forwarded-for"];
  rooms.setIp(ws, (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim() || req.socket.remoteAddress || "");

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

