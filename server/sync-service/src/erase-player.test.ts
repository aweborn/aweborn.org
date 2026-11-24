/**
 * Deleting a player (erase-player.ts). Uses node:sqlite so it runs without native modules.
 * Every table the sync-service has is here with rows for two people; one is deleted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as Y from "yjs";
import {
  eraseRows, scrubWorldDoc, scrubUniverseDoc, scrubGame, writeEraseAudit, eraseAudit, queueGenaiForget, flushGenaiForget,
  EraseLimiter, DELETE_CONFIRM_WORD,
} from "./erase-player.js";
import { BuildRequests, type SqlDb } from "./build-requests.js";
import { WorldGames } from "./game.js";
import { MatchStore } from "./match-store.js";
import { AgeDoor } from "./age-door.js";
import { GameLibrary } from "./game-library.js";
import { newGame } from "../../../shared/game.js";
import { FORMER_PLAYER_ID, FORMER_PLAYER_NAME, wandererTag } from "../../../shared/names.js";
import { canEditObject, isWorldOwnerId, planBuilderChange } from "../../../shared/world-policy.js";
import type { MatchSetup } from "../../../shared/match.js";

// The person who deletes: one account, two characters
const ACCT_A = "acctZephyrine0000000000000000001";
const A1 = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaa1";
const A2 = "aaaaaaaa-2222-4222-8222-aaaaaaaaaaa2";
const EMAIL_A = "zephyrine@example.org";
// Everything that must be gone afterwards, wherever it was
const GONE = [ACCT_A, A1, A2, EMAIL_A, "Zephyrine", "Quillon", "cred-zeph", "pubkey-zeph", "google-sub-zeph", "tok-zeph", "203.0.113.7", "r1111111111111111111a"];
// Someone else, who built and played with them
const ACCT_B = "acctBartholomew00000000000000002";
const B1 = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbb1";
const EMAIL_B = "bartholomew@example.org";
const KEPT = [ACCT_B, B1, EMAIL_B, "Bartholomew", "cred-bart", "r2222222222222222222b"];

const W = "11111111-2222-4333-8444-555555555555"; // a world the deleted player created
const W2 = "22222222-2222-4333-8444-555555555555"; // a world the other player created
const T0 = 1_800_000_000_000;

/** Tables made lazily by modules that open the database themselves: the same statements, copied. */
const LAZY_SCHEMA = `
  CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT, email TEXT, emailVerified INTEGER, image TEXT, createdAt TEXT, updatedAt TEXT, isAnonymous INTEGER, playerId TEXT);
  CREATE TABLE session (id TEXT PRIMARY KEY, expiresAt TEXT, token TEXT, createdAt TEXT, updatedAt TEXT, ipAddress TEXT, userAgent TEXT, userId TEXT);
  CREATE TABLE account (id TEXT PRIMARY KEY, accountId TEXT, providerId TEXT, userId TEXT, accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt TEXT, refreshTokenExpiresAt TEXT, scope TEXT, password TEXT, createdAt TEXT, updatedAt TEXT);
  CREATE TABLE passkey (id TEXT PRIMARY KEY, name TEXT, publicKey TEXT, userId TEXT, credentialID TEXT, counter INTEGER, deviceType TEXT, backedUp INTEGER, transports TEXT, createdAt TEXT, aaguid TEXT);
  CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT, value TEXT, expiresAt TEXT, createdAt TEXT, updatedAt TEXT);
  CREATE TABLE character (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, createdAt INTEGER NOT NULL, name TEXT, nameAt INTEGER);
  CREATE TABLE session_character (sessionId TEXT PRIMARY KEY, characterId TEXT NOT NULL);
  CREATE TABLE character_location (characterId TEXT PRIMARY KEY, data TEXT NOT NULL, updatedAt INTEGER NOT NULL);
  CREATE TABLE world_index (accountId TEXT NOT NULL, worldId TEXT NOT NULL, characterId TEXT, discoveredAt INTEGER NOT NULL, state TEXT, method TEXT, edition TEXT, visitCount INTEGER, visitedAt INTEGER, lastVisitedAt INTEGER, PRIMARY KEY (accountId, worldId));
  CREATE TABLE progress (character_id TEXT PRIMARY KEY, xp INTEGER NOT NULL DEFAULT 0, stats TEXT NOT NULL, chapter INTEGER NOT NULL DEFAULT 1, floor INTEGER NOT NULL DEFAULT 1, warp_at INTEGER, level_at_warp INTEGER, flight_at INTEGER, updated_at INTEGER NOT NULL);
  CREATE TABLE xp_event (id INTEGER PRIMARY KEY AUTOINCREMENT, character_id TEXT NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL, ref TEXT, at INTEGER NOT NULL);
  CREATE UNIQUE INDEX xp_event_ref ON xp_event(character_id, kind, ref) WHERE ref IS NOT NULL;
  CREATE TABLE mana_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, amount_mm INTEGER NOT NULL, creative_mm INTEGER NOT NULL DEFAULT 0, source TEXT, restricted INTEGER NOT NULL DEFAULT 0, fn TEXT, purpose TEXT, player_id TEXT, ref TEXT, note TEXT, nature TEXT, period_days REAL, public_name TEXT);
  CREATE TABLE card_orders (id TEXT PRIMARY KEY, world_id TEXT NOT NULL, world_name TEXT NOT NULL, quantity INTEGER NOT NULL, arrival TEXT NOT NULL, status TEXT NOT NULL, player_id TEXT, show_name INTEGER NOT NULL DEFAULT 0, public_name TEXT, email TEXT, payment_ref TEXT UNIQUE, net_cents INTEGER, cost_cents INTEGER NOT NULL DEFAULT 0, tracking TEXT, note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, paid_at INTEGER, shipped_at INTEGER, art TEXT, edition TEXT, event_id TEXT);
  CREATE TABLE card_order_photos (order_id TEXT PRIMARY KEY, jpeg BLOB NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE creations (job_id TEXT PRIMARY KEY, ref TEXT NOT NULL, player_id TEXT NOT NULL, settled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, kind TEXT);
  CREATE TABLE minds (object_id TEXT NOT NULL, world_id TEXT NOT NULL, creator TEXT NOT NULL, prompt TEXT NOT NULL, persona TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, head TEXT, origin TEXT, PRIMARY KEY (world_id, object_id));
  CREATE TABLE mind_memory (id INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, object_id TEXT NOT NULL, player_id TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE mind_versions (world_id TEXT NOT NULL, object_id TEXT NOT NULL, version INTEGER NOT NULL, player_id TEXT NOT NULL, prompt TEXT NOT NULL, persona TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (world_id, object_id, version));
  CREATE TABLE animations (job_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, object_id TEXT NOT NULL, gait TEXT NOT NULL, player_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', created_at INTEGER NOT NULL);
  CREATE TABLE mind_nodes (id TEXT PRIMARY KEY, parent TEXT, kind TEXT NOT NULL, player_id TEXT NOT NULL, prompt TEXT NOT NULL, request TEXT, system_sha TEXT, model TEXT, persona TEXT NOT NULL, world_id TEXT, object_id TEXT, at INTEGER NOT NULL);
  CREATE TABLE mind_texts (sha TEXT PRIMARY KEY, text TEXT NOT NULL);
  CREATE TABLE mind_library (id TEXT PRIMARY KEY, name TEXT NOT NULL, epithet TEXT NOT NULL DEFAULT '', greeting TEXT NOT NULL DEFAULT '', voice TEXT NOT NULL DEFAULT '', saved_by TEXT NOT NULL, saved_at INTEGER NOT NULL, world_id TEXT, object_id TEXT, body TEXT NOT NULL, public_mind TEXT NOT NULL, removed_at INTEGER);
  CREATE TABLE mind_library_memory (lib_id TEXT NOT NULL, player_id TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE player_mute (account_id TEXT NOT NULL, target_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (account_id, target_id));
  CREATE TABLE report (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, reporter_id TEXT NOT NULL, account_id TEXT NOT NULL, target_id TEXT NOT NULL, place TEXT NOT NULL, reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', resolved_at INTEGER, resolution TEXT);
  CREATE TABLE chat_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, player_id TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE plan_sessions (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, world_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, blueprint TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, research_id TEXT);
  CREATE TABLE plan_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT, model TEXT, cost_mana REAL, version INTEGER, payload TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE world_plans (world_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, version INTEGER NOT NULL, blueprint TEXT NOT NULL, updated_at INTEGER NOT NULL, owners TEXT NOT NULL DEFAULT '{"a":{},"f":{}}');
  CREATE TABLE research_identity (research_id TEXT PRIMARY KEY, player_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
  CREATE TABLE safety_flag (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, player_id TEXT, surface TEXT NOT NULL, category TEXT NOT NULL, layer TEXT NOT NULL, text TEXT NOT NULL);
  CREATE TABLE sim_last_known (player_id TEXT PRIMARY KEY, state TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE flight_samples (player_id TEXT NOT NULL, t INTEGER NOT NULL, x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL, mode INTEGER NOT NULL);
  CREATE TABLE adult_world_names (world_id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE card_sets (id TEXT PRIMARY KEY, name TEXT NOT NULL, world_ids TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE approved_text (sha TEXT PRIMARY KEY, at INTEGER NOT NULL);
  CREATE TABLE alert_log (key TEXT PRIMARY KEY, at INTEGER NOT NULL);
`;

/**
 * Every table the service creates, and the decision for it. A new table fails the test
 * below until someone decides what deleting a player does to it and writes it here.
 */
const DECIDED: Record<string, "delete" | "detach" | "anonymise" | "keep" | "no player data" | "delete + anonymise"> = {
  user: "delete", session: "delete", account: "delete", passkey: "delete", verification: "delete",
  character: "delete", session_character: "delete", character_location: "delete", world_index: "delete",
  progress: "delete", xp_event: "delete + anonymise", age_door: "delete",
  build_requests: "delete", build_request_inbox: "delete", player_mute: "delete", report: "delete + anonymise",
  chat_messages: "detach", safety_flag: "delete", plan_sessions: "detach", plan_events: "detach", research_identity: "delete",
  world_plans: "anonymise", creations: "delete", animations: "anonymise",
  minds: "anonymise", mind_versions: "anonymise", mind_nodes: "anonymise", mind_library: "anonymise",
  mind_memory: "delete", mind_library_memory: "delete", mind_texts: "no player data",
  world_games: "anonymise", world_game_versions: "anonymise", game_library: "anonymise", game_library_versions: "anonymise",
  matches: "anonymise", match_players: "anonymise", match_frames: "no player data",
  mana_ledger: "keep", card_orders: "keep", card_order_photos: "delete",
  flight_samples: "delete", sim_last_known: "delete",
  documents: "anonymise", // the Yjs documents: scrubUniverseDoc / scrubWorldDoc
  adult_world_names: "no player data", card_sets: "no player data", approved_text: "no player data", alert_log: "no player data",
  erase_audit: "no player data", erase_pending: "delete", // the genai queue: gone when the genai-service answers
};

function setup(matchId: string, slots: MatchSetup["slots"], formed: MatchSetup["formed"]): MatchSetup {
  const game = { ...newGame("race"), version: 3, credits: [{ libraryId: "lib1", version: 1, by: A1, byName: "Zephyrine", name: "Sky race" }, { libraryId: "lib2", version: 2, by: B1, byName: "Bartholomew", name: "Sky race II" }] };
  return { matchId, worldId: W, game, seed: 99, simVersion: 1, slots, formed };
}

function seed() {
  const raw = new DatabaseSync(":memory:");
  const db = raw as unknown as SqlDb;
  db.exec(LAZY_SCHEMA);
  const br = new BuildRequests(db);
  const games = new WorldGames(db);
  const matches = new MatchStore(db, () => "Arena World", T0);
  const door = new AgeDoor(db);
  new GameLibrary(db);
  const run = (sql: string, ...p: unknown[]) => db.prepare(sql).run(...p);

  for (const [acct, email, home, name, cred, key, sub, tok, ip] of [
    [ACCT_A, EMAIL_A, A1, "Zephyrine", "cred-zeph", "pubkey-zeph", "google-sub-zeph", "tok-zeph", "203.0.113.7"],
    [ACCT_B, EMAIL_B, B1, "Bartholomew", "cred-bart", "pubkey-bart", "google-sub-bart", "tok-bart", "198.51.100.9"],
  ]) {
    run(`INSERT INTO "user" VALUES (?, ?, ?, 1, NULL, 'd', 'd', 0, ?)`, acct, name, email, home);
    run("INSERT INTO session VALUES (?, 'x', ?, 'd', 'd', ?, 'Firefox', ?)", `s-${acct}`, tok, ip, acct);
    run("INSERT INTO session VALUES (?, 'x', ?, 'd', 'd', ?, 'Safari', ?)", `s2-${acct}`, `${tok}-2`, ip, acct);
    run("INSERT INTO account VALUES (?, ?, 'google', ?, 'at', 'rt', 'idt', NULL, NULL, 'openid', NULL, 'd', 'd')", `ac-${acct}`, sub, acct);
    run("INSERT INTO account VALUES (?, ?, 'credential', ?, NULL, NULL, NULL, NULL, NULL, NULL, 'hash', 'd', 'd')", `ac2-${acct}`, acct, acct);
    run("INSERT INTO passkey VALUES (?, 'iPhone', ?, ?, ?, 0, 'multiDevice', 1, 'internal', 'd', NULL)", `pk-${acct}`, key, acct, cred);
    run("INSERT INTO verification VALUES (?, ?, 'hash:0', 'x', 'd', 'd')", `v-${acct}`, `sign-in-otp-${email}`);
    run("INSERT INTO verification VALUES (?, ?, ?, 'x', 'd', 'd')", `v2-${acct}`, `change-${acct}`, `{"user":"${acct}"}`);
    run("INSERT INTO session_character VALUES (?, ?)", `s-${acct}`, home);
    door.set(acct, true, T0);
  }
  run("INSERT INTO character VALUES (?, ?, 1, 'Zephyrine', 2)", A1, ACCT_A);
  run("INSERT INTO character VALUES (?, ?, 1, 'Quillon', 2)", A2, ACCT_A);
  run("INSERT INTO character VALUES (?, ?, 1, 'Bartholomew', 2)", B1, ACCT_B);
  for (const [id, acct] of [[A1, ACCT_A], [A2, ACCT_A], [B1, ACCT_B]]) {
    run("INSERT INTO character_location VALUES (?, '{}', 1)", id);
    run("INSERT INTO progress VALUES (?, 120, '{}', 3, 1, NULL, NULL, NULL, 1)", id);
    run("INSERT INTO xp_event (character_id, kind, amount, ref, at) VALUES (?, 'visit', 10, ?, 1)", id, W2);
    run("INSERT INTO sim_last_known VALUES (?, '{}', 1)", id);
    run("INSERT INTO flight_samples VALUES (?, 1, 0, 0, 0, 0)", id);
    run("INSERT INTO chat_messages (world_id, player_id, text, at) VALUES (?, ?, 'hello there', 1)", W, id);
    run("INSERT INTO chat_messages (world_id, player_id, text, at) VALUES ('space', ?, 'anyone flying?', 2)", id);
    run("INSERT INTO safety_flag (at, player_id, surface, category, layer, text) VALUES (1, ?, 'planner', 'x', 'in', 'a stopped request')", id);
    run("INSERT INTO research_identity VALUES (?, ?, 1)", id === B1 ? "r2222222222222222222b" : id === A1 ? "r1111111111111111111a" : "r1111111111111111112a", id);
    run("INSERT INTO plan_sessions VALUES (?, ?, ?, 1, '{}', 1, 1, 'r')", `ps-${tag(id)}`, id, W);
    run("INSERT INTO plan_events (session_id, kind, payload, at) VALUES (?, 'user', '{\"message\":\"a tall tower\"}', 1)", `ps-${tag(id)}`);
    run("INSERT INTO creations VALUES (?, ?, ?, 0, 1, 'model')", `job-${tag(id)}`, `ref-${tag(id)}`, id);
    run("INSERT INTO animations VALUES (?, ?, 'obj', 'calm', ?, 'done', 1)", `anim-${tag(id)}`, W, id);
    run("INSERT INTO mana_ledger (at, kind, amount_mm, player_id, ref) VALUES (1, 'reserve', 500, ?, ?)", id, `ref-${tag(id)}`);
    run("INSERT INTO mana_ledger (at, kind, amount_mm, fn, purpose, player_id, ref, note) VALUES (2, 'settle', 400, 'program', 'creations', ?, ?, 'model')", id, `ref-${tag(id)}`);
    run("INSERT INTO mind_memory (world_id, object_id, player_id, text, at) VALUES (?, 'obj', ?, 'likes tall towers', 1)", W, id);
    run("INSERT INTO mind_library_memory VALUES ('node1', ?, 'likes tall towers', 1)", id);
    run("INSERT INTO mind_versions VALUES (?, ?, 1, ?, 'a kind giant', '{}', 1)", W, `obj-${tag(id)}`, id);
    run("INSERT INTO mind_nodes VALUES (?, NULL, 'make', ?, 'a kind giant', NULL, NULL, 'm', '{}', ?, 'obj', 1)", `node-${tag(id)}`, id, W);
    run("INSERT INTO minds VALUES (?, ?, ?, 'a kind giant', '{}', 1, 1, 'node1', ?)", `obj-${tag(id)}`, W, id, JSON.stringify({ libraryId: "node1", name: "Giant", savedBy: id, at: 1 }));
    run("INSERT INTO mind_library VALUES (?, 'Giant', '', '', '', ?, 1, ?, 'obj', '{}', '{}', NULL)", `lib-${tag(id)}`, id, W);
    run("INSERT INTO world_index (accountId, worldId, characterId, discoveredAt) VALUES (?, ?, ?, 1)", acct, id === A2 ? W2 : W, id);
    run(`INSERT INTO game_library (id, name, "by", world_id, version, updated_at) VALUES (?, 'Sky race', ?, ?, 1, 1)`, `gl-${tag(id)}`, id, W);
    run("INSERT INTO game_library_versions VALUES (?, 1, ?, '[]', ?, 1, ?)", `gl-${tag(id)}`, JSON.stringify({ credits: [{ libraryId: `gl-${tag(id)}`, version: 1, by: id, byName: id === B1 ? "Bartholomew" : "Zephyrine", name: "Sky race" }] }), JSON.stringify([{ libraryId: `gl-${tag(id)}`, version: 1, by: id, name: "Sky race" }]), id);
  }
  // The other player's awe for this account's first visit to their world, and the reverse
  run("INSERT INTO xp_event (character_id, kind, amount, ref, at) VALUES (?, 'reaction', 50, ?, 1)", B1, `${W2}:${ACCT_A}`);
  run("INSERT INTO xp_event (character_id, kind, amount, ref, at) VALUES (?, 'reaction', 50, ?, 1)", A1, `${W}:${ACCT_B}`);
  // Mutes and reports, both ways
  run("INSERT INTO player_mute VALUES (?, ?, 1)", ACCT_A, B1);
  run("INSERT INTO player_mute VALUES (?, ?, 1)", ACCT_B, A1);
  run("INSERT INTO report (at, reporter_id, account_id, target_id, place, reason, note, evidence) VALUES (1, ?, ?, ?, ?, 'spam', 'Zephyrine here: he spams', '[\"buy now\"]')", A1, ACCT_A, B1, W);
  run("INSERT INTO report (at, reporter_id, account_id, target_id, place, reason, note, evidence) VALUES (1, ?, ?, ?, ?, 'rude', 'she was rude', '[\"hello there\"]')", B1, ACCT_B, A2, W);
  // Asks to build: theirs elsewhere, others' in their inbox, one they declined
  br.ask(W2, A1, ACCT_A, [B1], T0);
  br.ask(W, B1, ACCT_B, [A1, A2], T0);
  run("INSERT INTO build_requests VALUES ('w3', 'acct-c', 'c1', 1, 'declined', 2, ?)", A2);
  // Games: saved by one, then the other
  games.save(W, newGame("race"), A1, T0, [{ libraryId: "lib1", version: 1, by: A1, byName: "Zephyrine", name: "Sky race" }]);
  games.save(W2, newGame("race"), B1, T0);
  // A world plan: who added what
  run("INSERT INTO world_plans VALUES (?, ?, 1, '{}', 1, ?)", W, `ps-${tag(A1)}`, JSON.stringify({ a: { tower: A1, bridge: B1 }, f: { hill: A2 } }));
  // Cards: unpaid, shipped (with a name in the sky), and paid but not mailed yet; and the other player's
  run("INSERT INTO card_orders (id, world_id, world_name, quantity, arrival, status, player_id, created_at, updated_at) VALUES ('co1', ?, 'Arena', 1, 'solid', 'pending', ?, 1, 1)", W, A1);
  run("INSERT INTO card_orders (id, world_id, world_name, quantity, arrival, status, player_id, show_name, public_name, email, payment_ref, net_cents, created_at, updated_at) VALUES ('co2', ?, 'Arena', 2, 'solid', 'shipped', ?, 1, 'Zephyrine', ?, 'pi_shipped', 900, 1, 1)", W, A1, EMAIL_A);
  run("INSERT INTO card_orders (id, world_id, world_name, quantity, arrival, status, player_id, show_name, public_name, email, payment_ref, net_cents, created_at, updated_at) VALUES ('co3', ?, 'Arena', 1, 'solid', 'paid', ?, 1, 'Quillon', 'buyer-stripe@example.net', 'pi_paid', 500, 1, 1)", W, A2);
  run("INSERT INTO card_orders (id, world_id, world_name, quantity, arrival, status, player_id, show_name, public_name, email, payment_ref, net_cents, created_at, updated_at) VALUES ('co4', ?, 'Other', 1, 'solid', 'shipped', ?, 1, 'Bartholomew', ?, 'pi_ben', 500, 1, 1)", W2, B1, EMAIL_B);
  for (const id of ["co1", "co2", "co3", "co4"]) run("INSERT INTO card_order_photos VALUES (?, x'00', 1, 1, 1)", id);
  for (const [ref, name] of [["pi_shipped", "Zephyrine"], ["pi_paid", "Quillon"], ["pi_ben", "Bartholomew"]]) {
    run("INSERT INTO mana_ledger (at, kind, amount_mm, source, ref, note, public_name) VALUES (3, 'inflow', 9000, 'card', ?, ?, ?)", ref, `card:${W} x1`, name);
  }
  // A gift with a typed name: not linked to any player in our records
  run("INSERT INTO mana_ledger (at, kind, amount_mm, source, ref, public_name) VALUES (4, 'inflow', 50000, 'gift', 'pi_gift', 'A kind donor')");
  // A match the two played together (a third person was linked but got no slot), and one without the deleted player
  matches.begin(setup("m1", [
    { slot: 0, team: 1, kind: "human", id: A1, name: "Zephyrine" },
    { slot: 1, team: 2, kind: "human", id: B1, name: "Bartholomew" },
  ], { policy: "random-balanced", seed: 5, links: [{ a: A1, b: B1, kind: "against" }, { a: A2, b: B1, kind: "with" }], together: [[A1, B1], [A2, B1]] }), T0, { [A1]: "r1111111111111111111a", [B1]: "r2222222222222222222b" }, new Set([A1, B1]));
  matches.appendFrames("m1", [{ t: 0, s: [0, 1, 0, 0, 1, 2, 0, 0] }]);
  matches.finish("m1", [{ tick: 0, type: "round-start" }], { winner: 2, rounds: [0, 1], scores: [0, 1], players: [{ slot: 0, score: 0, returns: 0, left: false }, { slot: 1, score: 1, returns: 0, left: false }], ticks: 1, why: "score" }, T0 + 1);
  matches.begin(setup("m2", [{ slot: 0, team: 1, kind: "human", id: B1, name: "Bartholomew" }], { policy: "play-now", seed: 1, links: [], together: [] }), T0, { [B1]: "r2222222222222222222b" });
  return { raw, db, br, games, matches, door };
}

/** The whole database as text: every table, every column, every row. */
function dump(raw: DatabaseSync): string {
  const out: string[] = [];
  for (const t of raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]) {
    for (const row of raw.prepare(`SELECT * FROM "${t.name}"`).all()) out.push(`${t.name} ${JSON.stringify(row, (_k, v) => (v instanceof Uint8Array ? "<blob>" : v))}`);
  }
  return out.join("\n");
}
const count = (text: string, needle: string) => text.split(needle).length - 1;
const tag = (id: string) => (id === A1 ? "one" : id === A2 ? "two" : "other");
const TARGET = { accountId: ACCT_A, playerIds: [A1, A2], email: EMAIL_A };

test("after the erase nothing holds the player's ids, e-mail, names or passkey; the other player's rows are as they were", () => {
  const { raw, db } = seed();
  const before = dump(raw);
  for (const s of GONE) assert.ok(before.includes(s), `the seed should hold ${s}`);

  const counts = eraseRows(db, TARGET);
  const after = dump(raw);
  for (const s of GONE) {
    const line = after.split("\n").find((l) => l.includes(s));
    assert.equal(line, undefined, `still there: ${s} in ${line?.slice(0, 160)}`);
  }
  // The other player: every mention of them is still there, except what named the deleted player beside them
  for (const s of KEPT) assert.ok(count(after, s) > 0, `${s} is gone`);
  const tableOf = (text: string, table: string) => text.split("\n").filter((l) => l.startsWith(`${table} `));
  for (const table of ["user", "session", "account", "passkey", "character", "character_location", "progress", "world_index", "age_door",
    "safety_flag", "research_identity", "creations", "sim_last_known", "flight_samples",
    "mind_memory", "mind_library_memory", "session_character"]) {
    // Theirs: a row that names them, or hangs off one of their keys (the seed tags those "-one" / "-two")
    const kept = tableOf(before, table).filter((l) => !GONE.some((s) => l.includes(s)) && !/-(one|two)"/.test(l));
    assert.deepEqual(tableOf(after, table), kept, `${table}: only the deleted player's rows went`);
    assert.ok(kept.length > 0, `${table}: the other player has rows`);
  }
  assert.ok(Object.keys(counts).length > 20);
  for (const n of Object.values(counts)) assert.ok(n > 0);
});

test("a second run changes nothing", () => {
  const { raw, db } = seed();
  eraseRows(db, TARGET);
  const once = dump(raw);
  assert.deepEqual(eraseRows(db, TARGET), {});
  assert.equal(dump(raw), once);
});

test("what they wrote stays, detached: every chat message and planner entry is still there, as written, with nothing of them on it", () => {
  const { raw, db } = seed();
  const n = (t: string) => (raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  const before = { chat: n("chat_messages"), sessions: n("plan_sessions"), events: n("plan_events") };
  const texts = (raw.prepare("SELECT seq, world_id, text, at FROM chat_messages ORDER BY seq").all()).map((r) => ({ ...r }));
  const events = (raw.prepare("SELECT seq, session_id, kind, payload, at FROM plan_events ORDER BY seq").all()).map((r) => ({ ...r }));
  const sessions = (raw.prepare("SELECT id, world_id, version, blueprint, created_at FROM plan_sessions ORDER BY id").all()).map((r) => ({ ...r }));
  eraseRows(db, TARGET);
  assert.deepEqual({ chat: n("chat_messages"), sessions: n("plan_sessions"), events: n("plan_events") }, before);
  // The same words, in the same order, at the same times
  assert.deepEqual((raw.prepare("SELECT seq, world_id, text, at FROM chat_messages ORDER BY seq").all()).map((r) => ({ ...r })), texts);
  assert.deepEqual((raw.prepare("SELECT seq, session_id, kind, payload, at FROM plan_events ORDER BY seq").all()).map((r) => ({ ...r })), events);
  assert.deepEqual((raw.prepare("SELECT id, world_id, version, blueprint, created_at FROM plan_sessions ORDER BY id").all()).map((r) => ({ ...r })), sessions);
  // Chat: from "a former player"; the other player's lines are still theirs
  assert.deepEqual((raw.prepare("SELECT player_id, COUNT(*) AS n FROM chat_messages GROUP BY player_id ORDER BY player_id").all()).map((r) => ({ ...r })), [{ player_id: B1, n: 2 }, { player_id: FORMER_PLAYER_ID, n: 4 }]);
  // Planner: a random stand-in per character and world, so the story stone still counts two makers besides the other player
  const who = (raw.prepare("SELECT id, player_id FROM plan_sessions ORDER BY id").all() as { id: string; player_id: string }[]);
  const tokens = who.filter((r) => r.player_id !== B1).map((r) => r.player_id);
  assert.equal(tokens.length, 2);
  assert.notEqual(tokens[0], tokens[1]);
  for (const t of tokens) assert.match(t, /^former:[0-9a-f]{16}$/);
  assert.equal(who.find((r) => r.id === "ps-other")!.player_id, B1);
  // The link from a research id to the player is gone
  assert.deepEqual((raw.prepare("SELECT player_id FROM research_identity").all() as { player_id: string }[]).map((r) => r.player_id), [B1]);
});

test("the same character's sessions in one world keep one stand-in; another world gets another", () => {
  const { raw, db } = seed();
  db.prepare("INSERT INTO plan_sessions VALUES ('ps-one-b', ?, ?, 1, '{}', 5, 5, 'r')").run(A1, W);
  db.prepare("INSERT INTO plan_sessions VALUES ('ps-one-c', ?, ?, 1, '{}', 6, 6, 'r')").run(A1, W2);
  eraseRows(db, TARGET);
  const by = Object.fromEntries((raw.prepare("SELECT id, player_id FROM plan_sessions").all() as { id: string; player_id: string }[]).map((r) => [r.id, r.player_id]));
  assert.equal(by["ps-one"], by["ps-one-b"]);
  assert.notEqual(by["ps-one"], by["ps-one-c"]);
  assert.notEqual(by["ps-one"], by["ps-two"]);
});

test("a run that stopped half-way is finished by running it again", () => {
  const { raw, db } = seed();
  // As if the first run stopped after the sign-in rows: the account is gone, much else is not
  db.prepare(`DELETE FROM "user" WHERE id = ?`).run(ACCT_A);
  db.prepare("DELETE FROM character WHERE accountId = ?").run(ACCT_A);
  eraseRows(db, TARGET);
  const after = dump(raw);
  for (const s of GONE) assert.ok(!after.includes(s), `still there: ${s}`);
});

test("money: the ledger keeps every entry and loses the player; paid orders keep their accounting", () => {
  const { raw, db } = seed();
  const sum = () => raw.prepare("SELECT COUNT(*) AS n, SUM(amount_mm) AS mm FROM mana_ledger").get() as { n: number; mm: number };
  const before = sum();
  eraseRows(db, TARGET);
  assert.deepEqual({ ...sum() }, { ...before }); // not one entry or cent fewer
  const rows = raw.prepare("SELECT kind, player_id, public_name, ref FROM mana_ledger ORDER BY id").all() as { kind: string; player_id: string | null; public_name: string | null; ref: string }[];
  assert.deepEqual(rows.filter((r) => r.player_id !== null).map((r) => r.player_id), [B1, B1]);
  // The name shown with their card sales leaves the public ledger; the other buyer's and the unlinked gift's stay
  assert.deepEqual(rows.filter((r) => r.kind === "inflow").map((r) => [r.ref, r.public_name]), [["pi_shipped", null], ["pi_paid", null], ["pi_ben", "Bartholomew"], ["pi_gift", "A kind donor"]]);
  const orders = raw.prepare("SELECT id, status, player_id, public_name, show_name, email, payment_ref, net_cents FROM card_orders ORDER BY id").all().map((r) => ({ ...r }));
  assert.deepEqual(orders, [
    // co1 (never paid) is gone
    { id: "co2", status: "shipped", player_id: null, public_name: null, show_name: 0, email: null, payment_ref: "pi_shipped", net_cents: 900 },
    // Paid, not mailed yet: the e-mail Stripe gave stays until it ships, so the cards still arrive
    { id: "co3", status: "paid", player_id: null, public_name: null, show_name: 0, email: "buyer-stripe@example.net", payment_ref: "pi_paid", net_cents: 500 },
    { id: "co4", status: "shipped", player_id: B1, public_name: "Bartholomew", show_name: 1, email: EMAIL_B, payment_ref: "pi_ben", net_cents: 500 },
  ]);
  assert.deepEqual(raw.prepare("SELECT order_id FROM card_order_photos ORDER BY order_id").all().map((r) => (r as { order_id: string }).order_id), ["co3", "co4"]);
});

test("replays stay with an anonymous stand-in, and leave the character's list", () => {
  const { db, matches } = seed();
  assert.equal(matches.playerRecent([A1, A2]).length, 1);
  eraseRows(db, TARGET);
  assert.deepEqual(matches.playerRecent([A1, A2]), []);
  // The other player still finds it and can replay it: "Player" where the deleted one was
  const mine = matches.playerRecent([B1]);
  assert.deepEqual(mine.map((m) => m.id).sort(), ["m1"]);
  assert.deepEqual(mine[0].roster, [{ slot: 0, team: 1, kind: "human", name: "Player" }, { slot: 1, team: 2, kind: "human", name: "Bartholomew", you: true }]);
  const r = matches.record("m1")!;
  assert.deepEqual(r.setup.slots[0], { slot: 0, team: 1, kind: "human", id: "stand-in:0", name: "Player" });
  assert.equal(r.frames.length, 1);
  assert.equal(r.result?.winner, 2);
  // The character who was linked but got no slot is out of how the teams were formed
  assert.deepEqual(r.setup.formed.links, [{ a: "stand-in:0", b: B1, kind: "against" }]);
  assert.deepEqual(r.setup.formed.together, [["stand-in:0", B1]]);
  // The game it ran on is kept, its credit to the deleted maker anonymous
  assert.deepEqual(r.setup.game.credits, [{ libraryId: "lib1", version: 1, by: FORMER_PLAYER_ID, name: "Sky race" }, { libraryId: "lib2", version: 2, by: B1, byName: "Bartholomew", name: "Sky race II" }]);
  // Research: no id links the stand-in to anyone
  assert.deepEqual(matches.researchCopy("m1", () => true)!.setup.slots.map((s) => s.id), ["stand-in:0", "r2222222222222222222b"]);
});

test("what others use stays, with the maker taken out: games, Library entries, minds, the world plan, reports, awe", () => {
  const { raw, db, games, br } = seed();
  eraseRows(db, TARGET);
  const one = (sql: string, ...p: string[]) => ({ ...(raw.prepare(sql).get(...p) as Record<string, unknown>) });
  assert.deepEqual(games.get(W)?.credits, [{ libraryId: "lib1", version: 1, by: FORMER_PLAYER_ID, name: "Sky race" }]);
  assert.deepEqual(one("SELECT updated_by FROM world_games WHERE world_id = ?", W), { updated_by: FORMER_PLAYER_ID });
  assert.deepEqual(one("SELECT updated_by FROM world_games WHERE world_id = ?", W2), { updated_by: B1 });
  assert.deepEqual((raw.prepare(`SELECT "by" FROM game_library ORDER BY "by"`).all() as { by: string }[]).map((r) => r.by), [B1, FORMER_PLAYER_ID, FORMER_PLAYER_ID]);
  assert.deepEqual((raw.prepare("SELECT creator FROM minds ORDER BY creator").all() as { creator: string }[]).map((r) => r.creator), [B1, FORMER_PLAYER_ID, FORMER_PLAYER_ID]);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM mind_nodes").get()!.n, 3); // a mind is never erased
  assert.deepEqual((raw.prepare("SELECT saved_by FROM mind_library ORDER BY saved_by").all() as { saved_by: string }[]).map((r) => r.saved_by), [B1, FORMER_PLAYER_ID, FORMER_PLAYER_ID]);
  assert.deepEqual(JSON.parse(String(one("SELECT owners FROM world_plans WHERE world_id = ?", W).owners)), { a: { tower: FORMER_PLAYER_ID, bridge: B1 }, f: { hill: FORMER_PLAYER_ID } });
  // The report they filed about someone else stays, without them or their words; the one against them is gone with its evidence
  assert.deepEqual(raw.prepare("SELECT reporter_id, account_id, target_id, reason, note FROM report").all().map((r) => ({ ...r })), [
    { reporter_id: FORMER_PLAYER_ID, account_id: FORMER_PLAYER_ID, target_id: B1, reason: "spam", note: "" },
  ]);
  // The other maker keeps the awe the deleted player's visit gave them
  const awe = raw.prepare("SELECT amount, ref FROM xp_event WHERE character_id = ? AND kind = 'reaction'").all(B1) as { amount: number; ref: string }[];
  assert.equal(awe.length, 1);
  assert.equal(awe[0].amount, 50);
  assert.match(awe[0].ref, new RegExp(`^${W2}:former-\\d+$`));
  // Asks: theirs are gone, the one waiting for them has nobody to answer it from their side, the decline loses its name
  assert.deepEqual(br.status(W2, ACCT_A, T0 + 1), { status: "none" });
  assert.deepEqual(br.inbox([A1, A2], T0 + 1), []);
  assert.deepEqual(one("SELECT decided_by FROM build_requests WHERE world_id = 'w3'"), { decided_by: null });
  // Mutes: their list, and them on anyone else's
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM player_mute").get()!.n, 0);
});

test("the same e-mail can start again with nothing carried over", () => {
  const { raw, db, door } = seed();
  eraseRows(db, TARGET);
  // As Better Auth would: a new user row with the same address, a new character
  db.prepare(`INSERT INTO "user" VALUES ('acctNew', 'New', ?, 1, NULL, 'd', 'd', 0, 'new-player-id')`).run(EMAIL_A);
  db.prepare("INSERT INTO character VALUES ('new-player-id', 'acctNew', 9, NULL, NULL)").run();
  assert.equal(door.open("acctNew"), false);
  for (const [table, col] of [["world_index", "accountId"], ["progress", "character_id"], ["xp_event", "character_id"], ["chat_messages", "player_id"], ["plan_sessions", "player_id"]]) {
    assert.equal((raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} IN ('acctNew', 'new-player-id')`).get() as { n: number }).n, 0, table);
  }
});

test("tables made later are skipped, not an error: an empty database erases to nothing", () => {
  const db = new DatabaseSync(":memory:") as unknown as SqlDb;
  assert.deepEqual(eraseRows(db, TARGET), {});
  assert.deepEqual(eraseRows(db, { accountId: ACCT_A, playerIds: [] }), {});
});

test("every table the service creates has a decision here", () => {
  const src = new URL(".", import.meta.url).pathname;
  const made = new Set<string>(["user", "session", "account", "passkey", "verification"]); // Better Auth's own
  for (const f of readdirSync(src)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    for (const m of readFileSync(src + f, "utf8").matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) made.add(m[1]);
  }
  assert.deepEqual([...made].filter((t) => !(t in DECIDED)), [], "a table without a decision: say in erase-player.ts what deleting a player does to it");
  assert.deepEqual(Object.keys(DECIDED).filter((t) => !made.has(t)), []);
});

// ── The shared documents ─────────────────────────────────────────────

function world(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap("meta");
    meta.set("name", "Arena World");
    meta.set("creator", A1);
    meta.set("coCreators", [B1, A2]);
    meta.set("game", { version: 1, template: "race", credits: [{ libraryId: "lib1", version: 1, by: A2, byName: "Quillon", name: "Sky race" }] });
    const objects = doc.getMap("objects");
    const put = (id: string, o: Record<string, unknown>) => {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(o)) m.set(k, v);
      objects.set(id, m);
    };
    put("o1", { id: "o1", type: "block", x: 1, y: 0, z: 1, placedBy: A1, placedAt: 1 });
    put("o2", { id: "o2", type: "block", x: 2, y: 0, z: 1, placedBy: A2, placedAt: 1, carry: { by: A2, t: 5 }, kick: { vx: 1, vy: 0, vz: 0, t: 3, by: A1 } });
    put("o3", { id: "o3", type: "block", x: 3, y: 0, z: 1, placedBy: B1, placedAt: 1, kick: { vx: 1, vy: 0, vz: 0, t: 3, by: B1 } });
    doc.getArray("chat").push([
      { sender: B1, text: "hi all", t: 1 },
      { sender: A1, text: "hello from the hill", t: 2 },
      { sender: "npc:o1", text: "Welcome back, friend!", t: 3, to: A1 },
      { sender: A2, text: "me too", t: 4 },
      { sender: "npc:o1", text: "Good day, Bartholomew.", t: 5, to: B1 },
      { sender: B1, text: "bye", t: 6 },
    ]);
  });
  return doc;
}
const IDS = new Set([A1, A2]);
const bytes = (doc: Y.Doc) => Buffer.from(Y.encodeStateAsUpdate(doc));

test("a world they made stays: no creator, builders intact, their things placed by nobody, their chat lines from a former player", () => {
  const doc = world();
  let r!: ReturnType<typeof scrubWorldDoc>;
  doc.transact(() => { r = scrubWorldDoc(doc, IDS); }, "server");
  assert.deepEqual(r, { meta: 3, objects: 2, chat: 3 });
  const meta = doc.getMap("meta").toJSON();
  assert.equal(meta.name, "Arena World");
  assert.equal(meta.creator, FORMER_PLAYER_ID);
  assert.deepEqual(meta.coCreators, [B1]);
  assert.deepEqual(meta.game.credits, [{ libraryId: "lib1", version: 1, by: FORMER_PLAYER_ID, name: "Sky race" }]);
  const objects = doc.getMap("objects").toJSON() as Record<string, Record<string, unknown>>;
  assert.equal(Object.keys(objects).length, 3); // nothing they placed was removed
  assert.equal(objects.o1.placedBy, FORMER_PLAYER_ID);
  assert.equal(objects.o2.placedBy, FORMER_PLAYER_ID);
  assert.equal(objects.o2.carry, undefined);
  assert.deepEqual(objects.o2.kick, { vx: 1, vy: 0, vz: 0, t: 3 });
  assert.deepEqual(objects.o3, { id: "o3", type: "block", x: 3, y: 0, z: 1, placedBy: B1, placedAt: 1, kick: { vx: 1, vy: 0, vz: 0, t: 3, by: B1 } });
  // The visible log: every line still there, in order, as written; theirs are from "a former player"
  assert.deepEqual(doc.getArray("chat").toArray(), [
    { sender: B1, text: "hi all", t: 1 },
    { sender: FORMER_PLAYER_ID, text: "hello from the hill", t: 2 },
    { sender: "npc:o1", text: "Welcome back, friend!", t: 3, to: FORMER_PLAYER_ID },
    { sender: FORMER_PLAYER_ID, text: "me too", t: 4 },
    { sender: "npc:o1", text: "Good day, Bartholomew.", t: 5, to: B1 },
    { sender: B1, text: "bye", t: 6 },
  ]);
  // Not in the stored bytes either (Yjs drops the content of what was replaced or removed)
  const stored = bytes(doc);
  for (const s of [A1, A2, "Zephyrine", "Quillon"]) assert.ok(!stored.includes(s), `${s} is still in the stored document`);
  assert.ok(stored.includes(B1));
  // And a copy another device still has merges to the same thing
  const other = world();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  assert.equal(other.getMap("meta").get("creator") === FORMER_PLAYER_ID || other.getMap("meta").get("creator") === A1, true);
  // Again: nothing to do
  doc.transact(() => { r = scrubWorldDoc(doc, IDS); }, "server");
  assert.deepEqual(r, { meta: 0, objects: 0, chat: 0 });
});

test("nobody gains rights by the delete: the former player's things are the owners' to change, no one else's", () => {
  const stranger = { id: "cccccccc-1111-4111-8111-ccccccccccc1", owner: false, mine: [] };
  const builder = { id: B1, owner: true };
  const obj = { placedBy: FORMER_PLAYER_ID };
  assert.equal(canEditObject(stranger, obj), false);
  assert.equal(canEditObject({ id: FORMER_PLAYER_ID, owner: false }, obj), false); // even someone presenting the marker
  assert.equal(canEditObject(builder, obj), true);
  const roles = { creator: FORMER_PLAYER_ID, coCreators: [B1] };
  assert.equal(isWorldOwnerId(FORMER_PLAYER_ID, roles), false);
  assert.equal(isWorldOwnerId(stranger.id, roles), false);
  assert.equal(isWorldOwnerId(B1, roles), true); // builders keep their rights
  // A builder can still add builders; the marker can never be made one
  assert.deepEqual(planBuilderChange(roles, [B1], { add: stranger.id }), { ok: true, next: [B1, stranger.id], changed: true });
  assert.equal(planBuilderChange(roles, [B1], { add: FORMER_PLAYER_ID }).ok, false);
  assert.equal(wandererTag(FORMER_PLAYER_ID), FORMER_PLAYER_NAME);
});

test("the universe: their worlds have no creator, they leave every builders list, other worlds untouched", () => {
  const doc = new Y.Doc();
  const worlds = doc.getMap("worlds");
  const put = (id: string, o: Record<string, unknown>) => {
    const m = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(o)) m.set(k, v);
    worlds.set(id, m);
  };
  put(W, { id: W, name: "Arena World", creator: A1, coCreators: [B1] });
  put(W2, { id: W2, name: "Other", creator: B1, coCreators: [A2] });
  put("w3", { id: "w3", name: "Third", creator: B1 });
  assert.deepEqual(scrubUniverseDoc(doc, IDS).sort(), [W, W2].sort());
  assert.deepEqual(worlds.toJSON(), {
    [W]: { id: W, name: "Arena World", creator: FORMER_PLAYER_ID, coCreators: [B1] },
    [W2]: { id: W2, name: "Other", creator: B1, coCreators: [] },
    w3: { id: "w3", name: "Third", creator: B1 },
  });
  for (const s of [A1, A2]) assert.ok(!bytes(doc).includes(s));
  assert.deepEqual(scrubUniverseDoc(doc, IDS), []);
});

test("scrubGame leaves a game without their credit alone", () => {
  assert.equal(scrubGame({ credits: [{ by: B1, byName: "Bartholomew" }] }, IDS), null);
  assert.equal(scrubGame(null, IDS), null);
  assert.equal(scrubGame({ version: 1 }, IDS), null);
});

// ── The audit line, the genai queue, the limiter ─────────────────────

test("the audit line says when and how many rows of what, and nothing about who", () => {
  const { raw, db } = seed();
  const counts = eraseRows(db, TARGET);
  const id = writeEraseAudit(db, 2, counts, T0 + 9);
  const [line] = eraseAudit(db);
  assert.equal(line.id, id);
  assert.equal(line.at, T0 + 9);
  assert.equal(line.characters, 2);
  assert.equal(line.counts.character, 2);
  assert.equal(line.counts.user, 1);
  const stored = JSON.stringify(raw.prepare("SELECT * FROM erase_audit").all());
  for (const s of [...GONE, ...KEPT]) assert.ok(!stored.includes(s));
  for (const v of Object.values(line.counts)) assert.equal(typeof v, "number");
});

test("the genai-service is told; if it can't be reached the ids wait, and leave the queue when it answers", async () => {
  const { raw, db } = seed();
  const audit = writeEraseAudit(db, 2, eraseRows(db, TARGET), T0);
  queueGenaiForget(db, [A1, A2], T0, audit);
  assert.equal(await flushGenaiForget(db, async () => null), 1); // down
  assert.equal(await flushGenaiForget(db, async () => { throw new Error("refused"); }), 1);
  assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM erase_pending").get() as { n: number }).n, 1);
  const told: string[][] = [];
  assert.equal(await flushGenaiForget(db, async (ids) => { told.push(ids); return { genai_jobs: 4, genai_trash: 1 }; }), 0);
  assert.deepEqual(told, [[A1, A2]]);
  assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM erase_pending").get() as { n: number }).n, 0);
  assert.equal(eraseAudit(db)[0].counts.genai_jobs, 4);
  for (const s of GONE) assert.ok(!dump(raw).includes(s), `still there: ${s}`);
  assert.equal(await flushGenaiForget(db, async () => { throw new Error("not called"); }), 0);
});

test("asking is limited: five tries an hour for one key", () => {
  const l = new EraseLimiter(5, 3600_000);
  for (let i = 0; i < 5; i++) assert.equal(l.take("a", T0 + i), true);
  assert.equal(l.take("a", T0 + 10), false);
  assert.equal(l.take("b", T0 + 10), true);
  assert.equal(l.take("a", T0 + 3600_001 + 4), true);
  assert.equal(DELETE_CONFIRM_WORD, "DELETE");
});
