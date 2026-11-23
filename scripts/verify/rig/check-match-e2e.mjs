// Sandbox rig: a whole match with THREE people in three browser contexts against the real
// server (Phase 10): an owner who sets the game up and watches from the lobby, and two
// players (one saved, one guest) who are matched, play, finish and play again.
//
//   1  set-up, arrival in the lobby, the ring, the ready check, placed at the spawns
//   2  each player sees the other's body; the lobby sees neither as a live-world player
//   3  the owner tunes in from the 👁 chip: bodies in the arena, the roster, the hologram
//   4  out of bounds: the warning, and coming back
//   5  the goal, results for both players, the watcher's strip (no results screen), the record verifies
//   6  Play again together → back in the pool → a second ready check, declined by stepping out
//   7  a third ready check: NPCs proposed, voted in, the match fills to max and is played
//   8  replays: from Finished (owner), from Mine (player), and from another world (the 2D mini-map)
//
//   RIG_N=8 scripts/verify/rig/up.sh && RIG_N=8 node scripts/verify/rig/check-match-e2e.mjs
// VP=phone (default) | small | landscape | desktop. Screenshots: /tmp/rig<N>/e2e-<VP>-*.png
import { launch, open, sleep, savedPlayer, session, plantWorld, enterWorld, waitFor, RIG_DIR, WEB } from "./browser.mjs";
import { checklist, player, verifies, recordOf, RACE, RING, GOAL } from "./match-kit.mjs";

const VP = process.env.VP ?? "phone";
const { ok, until, done } = checklist();
const b = await launch();
const [po, pa, pb] = await Promise.all([open(b, WEB, VP), open(b, WEB, VP, await b.createBrowserContext()), open(b, WEB, VP, await b.createBrowserContext())]);
const [idO, idA, idB] = await Promise.all([savedPlayer(po), savedPlayer(pa), session(pb)]);
console.log("owner", idO, "| A (saved)", idA, "| B (guest)", idB);

// ── 1. Set-up ──────────────────────────────────────────────────────
const W = await plantWorld(po, "E2E Arena");
const W2 = await plantWorld(po, "E2E Other", { x: 420, y: 0, z: 300 });
const O = player(po, "owner", W), A = player(pa, "A", W), B = player(pb, "B", W);
const shot = (h, name) => h.shot(`e2e-${VP}-${name}`);
ok((await O.api("/api/player/world/game", { worldId: W, game: RACE })).status === 200, "the owner saves a 2-team race (arena, two spawns, a goal, a lobby with its ring)");
// The other world's game sits somewhere else, so arriving there is told apart from standing still
const far = (v) => [v[0] + 8, v[1], v[2]];
const RACE2 = { ...RACE, arena: { ...RACE.arena, at: far(RACE.arena.at) }, zones: RACE.zones.map((z) => ({ ...z, at: far(z.at) })), lobby: { ...RACE.lobby, at: far(RACE.lobby.at), ring: { ...RACE.lobby.ring, at: far(RING) }, arrival: far(RACE.lobby.arrival) } };
const saved2 = await O.api("/api/player/world/game", { worldId: W2, game: RACE2 });
const ARRIVE2 = saved2.data?.game?.lobby?.arrival ?? far(RACE.lobby.arrival);
ok(saved2.status === 200, "a second world of the owner has a game too", `arrival ${ARRIVE2}`);
await Promise.all([enterWorld(po, W), enterWorld(pa, W), enterWorld(pb, W)]);
for (const h of [O, A, B]) ok(await h.lobby(), `${h.name}: the lobby answers and is ready`);
for (const h of [A, B]) {
  const at = await h.pos();
  ok(Math.abs(at.x) <= 6 && at.z >= 6 && at.z <= 18, `${h.name} arrives in the lobby`, JSON.stringify({ x: +at.x.toFixed(1), z: +at.z.toFixed(1) }));
}
await until("the owner sees both players walking in the lobby (live-world bodies)", async () => { const o = await O.others(); return o.includes(idA) && o.includes(idB); }, 15000);
console.log("     presence:", JSON.stringify({ owner: await O.others(), A: await A.others(), B: await B.others() }));
ok(await O.has("#lobby-chip") && await O.has("#watch-chip"), "the lobby chip and the 👁 chip are there");
if (process.env.STOP === "1") { for (const h of [O, A, B]) console.log(h.name, h.page.errors.slice(0, 5)); await b.close(); process.exit(1); }
await shot(O, "01-lobby-owner");

// ── The ring and the ready check ────────────────────────────────────
await A.queue();
await until("A, alone in the ring, is in the pool", () => A.match((s) => s.lobby?.queued === true && s.lobby.pool === 1));
ok(/In the pool/.test(await A.text("#lobby-chip") ?? ""), "A's chip says so", await A.text("#lobby-chip"));
await shot(A, "02-in-ring");
await B.queue();
const found = await until("both get the ready check", async () => {
  const [a, c] = await Promise.all([A.match((s) => s.found && { id: s.found.matchId, team: s.found.you.team, n: s.found.roster.length }), B.match((s) => s.found && { id: s.found.matchId, team: s.found.you.team })]);
  return a && c && a.id === c.id ? { a, c } : null;
}, 20000);
ok(found?.a.team !== found?.c.team && found?.a.n === 2, "one on each team", JSON.stringify(found));
ok(await A.has("#match-ready") && await B.has("#match-ready"), "the ready check is on both screens", await A.text("#match-ready-title"));
ok((await O.match((s) => s.found)) === null && !(await O.has("#match-ready")), "the owner, outside the ring, gets none");
await shot(A, "03-ready-check");
// Nobody declines: the roster locks when the ready check runs out
const started = await until("both are placed in the match", async () => {
  const [a, c] = await Promise.all([A.match((s) => s.playing && { id: s.playing.matchId, team: s.playing.you.team, slot: s.playing.you.slot }), B.match((s) => s.playing && { id: s.playing.matchId, team: s.playing.you.team, slot: s.playing.you.slot })]);
  return a && c ? { a, c } : null;
}, 25000);
const M1 = started?.a.id;
await sleep(800);
for (const [h, me] of [[A, started?.a], [B, started?.c]]) {
  const at = await h.pos();
  const x = me?.team === 1 ? -6 : 6;
  ok(Math.abs(at.x - x) < 2.5 && Math.abs(at.z) < 2.5, `${h.name} stands on team ${me?.team}'s spawn`, JSON.stringify({ x: +at.x.toFixed(1), z: +at.z.toFixed(1) }));
  ok(at.mods?.speedMul === 1.25 && at.mods?.fly === false, `${h.name}: the match's traits apply`);
  ok(await h.has("#match-strip") && !(await h.has("#lobby-chip")), `${h.name}: the score strip takes the chip's place`);
}

// ── 2. Who sees whom ───────────────────────────────────────────────
await until("A sees B's body in the match", async () => (await A.others()).includes(idB), 15000);
await until("B sees A's body in the match", async () => (await B.others()).includes(idA), 15000);
ok(!(await A.others()).includes(idO) && !(await B.others()).includes(idO), "neither sees the owner (who is in the live world)");
await until("the owner no longer sees them as live-world players", async () => { const o = await O.others(); return !o.includes(idA) && !o.includes(idB); }, 12000);

// ── 3. The owner tunes in ──────────────────────────────────────────
await until("the owner's 👁 chip counts one running match", async () => (await O.text("#watch-chip") ?? "").includes("1"), 15000);
ok(!(await O.has("#match-strip")) && (await O.match((s) => s.playing)) === null, "the owner is not in the match");
await O.click("#watch-chip");
await shot(O, "04-watch-sheet");
ok(await O.click(".watch-sheet .watch-row"), "the Live tab lists it: tap to tune in");
await until("snapshots reach the owner", () => O.match((s) => Boolean(s.watching && s.snap && s.prevSnap)), 15000);
const roster = await until("the roster arrives from the live record", () => O.match((s) => s.watchRoster?.map((r) => `${r.name}:${r.kind}:t${r.team}`)), 15000);
ok(roster?.length === 2 && roster.every((r) => r.includes(":human:")), "two humans in it", roster?.join(" "));
await until("a body with a name tag for each player, in the arena", async () => (await O.count(".watch-tag")) === 2, 10000);
ok((await O.match((s) => s.snap.watching)) === 1, "the match counts one watcher");
ok(!(await O.has("#match-results")) && !(await O.has("#match-warning")), "no play-layer overlays on the watcher's screen");
await shot(O, "05-watching-hologram");

// ── 4. Out of bounds and back ──────────────────────────────────────
await until("the round is on", () => A.match((s) => s.snap?.phase === "playing"), 20000);
ok((await A.pos()).hold === false, "free to move once the countdown is over");
await sleep(1500);
await A.stand(14, 0, -6); // 4 m past the arena's east edge
await until("A, outside the arena, gets the warning", () => A.has("#match-warning"), 8000);
ok(/Out of bounds/.test(await A.text("#match-warning") ?? ""), "it says out of bounds, with a count", await A.text("#match-warning"));
await until("the referee counts A as outside", () => A.match((s, slot) => (s.snap?.players.find((p) => p.slot === slot)?.outside ?? 0) > 0, started?.a.slot), 8000);
ok(!(await B.has("#match-warning")), "B, inside, has no warning");
await shot(A, "06-out-of-bounds");
await A.stand(started?.a.team === 1 ? -6 : 6, 0, -3);
await until("back inside: the warning goes", async () => !(await A.has("#match-warning")), 8000);
ok((await A.match((s, slot) => s.snap?.players.find((p) => p.slot === slot)?.outside ?? 0, started?.a.slot)) === 0, "and the count is cleared");
await shot(B, "07-playing");

// ── 5. The goal and the results ────────────────────────────────────
await B.stand(GOAL[0], GOAL[1], GOAL[2]);
const ended = await until("B reaches the goal: both get the result", async () => {
  const [a, c] = await Promise.all([A.match((s) => s.ended && { w: s.ended.result.winner, you: s.ended.you, awe: s.ended.awe, again: s.ended.again }), B.match((s) => s.ended && { w: s.ended.result.winner, you: s.ended.you, awe: s.ended.awe })]);
  return a && c ? { a, c } : null;
}, 20000);
ok(ended?.a.w === started?.c.team && ended?.c.w === started?.c.team, "B's team won", JSON.stringify(ended));
ok(ended?.a.awe === 30 && ended?.c.awe === 30, "both earn the awe for finishing (two humans played)");
await until("the results screen is up for both", async () => (await A.has("#match-results")) && (await B.has("#match-results")), 8000);
ok(/wins/.test(await A.text("#match-results-title") ?? "") && /your team/i.test(await B.text(".match-results-sub") ?? ""), "it names the winner", `${await A.text("#match-results-title")} | ${await B.text(".match-results-sub")}`);
await shot(A, "08-results-loser");
await shot(B, "09-results-winner");
await until("the watcher is told the match ended", () => O.match((s) => s.ended && s.ended.you === null), 10000);
ok(!(await O.has("#match-results")), "the watcher gets no results screen (that is the players')");
ok(await O.has("#watch-replay"), "the watcher's strip offers the replay");
await shot(O, "10-watcher-ended");
ok(M1 && (await verifies(O, M1)) === true, "the stored record replays to the same result (verifyRecord)");

// ── 6. Play again together, then a decline ──────────────────────────
ok(await A.click("#match-again") && await B.click("#match-again"), "both tap Play again together");
await until("both are back in the lobby, in the pool, standing in the ring", async () => {
  const [a, c] = await Promise.all([A.match((s) => s.playing === null && s.ended === null && s.lobby?.queued === true), B.match((s) => s.playing === null && s.ended === null && s.lobby?.queued === true)]);
  return a && c;
}, 30000);
for (const h of [A, B]) { const at = await h.pos(); ok(Math.hypot(at.x - RING[0], at.z - RING[2]) <= 2.2 && at.mods === null, `${h.name} stands in the ring, traits cleared`, JSON.stringify({ x: +at.x.toFixed(1), z: +at.z.toFixed(1) })); }
await until("the owner sees them in the lobby again", async () => { const o = await O.others(); return o.includes(idA) && o.includes(idB); }, 15000);
const f2 = await until("a second ready check", async () => { const [a, c] = await Promise.all([A.match((s) => s.found?.matchId), B.match((s) => s.found?.matchId)]); return a && a === c && a !== M1 ? a : null; }, 20000);
await sleep(1200);
await A.stepOut();
await until("A steps out of the ring: the ready check is called off for both", async () => (await A.match((s) => s.found === null)) && (await B.match((s) => s.found === null)), 10000);
ok((await A.match((s) => s.playing)) === null && (await B.match((s) => s.playing)) === null, "nobody was placed");
await until("B is still in the pool, A is not", async () => (await B.match((s) => s.lobby?.queued === true && s.lobby.pool === 1)) && (await A.match((s) => s.lobby?.queued === false)), 10000);
await sleep(READY_WAIT());
ok((await recordOf(O, f2)) === null, "the declined match left no record");

// ── 7. NPCs: proposed, voted in ────────────────────────────────────
await A.queue();
const f3 = await until("A steps back in: a third ready check", async () => { const [a, c] = await Promise.all([A.match((s) => s.found?.matchId), B.match((s) => s.found?.matchId)]); return a && a === c ? a : null; }, 20000);
ok(await A.click("#match-npc-propose"), "A asks everyone: fill the empty slots with NPCs");
await until("B sees the proposal and the vote", () => B.has("#match-npc-yes"), 8000);
ok(/1 of 2 agree/.test(await B.text(".match-npc-votes") ?? ""), "one of two agrees so far", await B.text(".match-npc-votes"));
await shot(B, "11-npc-vote");
await B.click("#match-npc-yes");
await until("everyone agreed", async () => /2 of 2 agree/.test(await A.text(".match-npc-votes") ?? ""), 8000);
const s3 = await until("the match starts, filled to max with NPCs", () => A.match((s, id) => s.playing?.matchId === id && { roster: s.playing.roster.map((r) => `${r.name}:${r.kind}:t${r.team}`), team: s.playing.you.team }, f3), 25000);
console.log("     roster:", s3?.roster.join(" "));
const npcNames = (s3?.roster ?? []).filter((r) => r.includes(":npc:")).map((r) => r.split(":")[0]);
ok(s3?.roster.length === 4 && npcNames.length === 2, "four slots: two humans, two NPCs");
ok(new Set(npcNames).size === npcNames.length, "the NPCs have different names", npcNames.join(", "));
ok([1, 2].every((t) => s3?.roster.filter((r) => r.endsWith(`:t${t}`)).length === 2), "two a side");
await until("the NPCs' bodies are drawn for A (name tags marked AI)", async () => (await A.count(".watch-tag")) === 2, 15000);
await until("the round is on", () => A.match((s) => s.snap?.phase === "playing"), 20000);
await sleep(2500);
await shot(A, "12-playing-with-npcs");
await A.stand(GOAL[0], GOAL[1], GOAL[2]);
await until("A reaches the goal (or an NPC got there first): results for both", async () => (await A.has("#match-results")) && (await B.has("#match-results")), 25000);
ok(await verifies(O, f3), "that record verifies too");
ok(await A.click("#match-back") && await B.click("#match-back"), "both go back to the lobby");
await until("both are in the lobby, not queued", async () => (await A.match((s) => s.playing === null && s.ended === null && s.lobby?.queued === false)) && (await B.match((s) => s.playing === null && s.ended === null)), 30000);
{ const at = await A.pos(); ok(at.z > 12 && at.mods === null, "A is at the arrival point", JSON.stringify({ x: +at.x.toFixed(1), z: +at.z.toFixed(1) })); }

// ── 8. Replays ─────────────────────────────────────────────────────
const openSheet = async (h, tab) => { if (!(await h.view((s) => s.sheet))) await h.click("#watch-chip"); await h.click(`#watch-tab-${tab}`); };
await openSheet(O, "finished");
await until("Finished lists both matches (once each)", async () => (await O.count(".watch-sheet .watch-row")) === 2, 10000);
await shot(O, "13-finished");
await O.click(".watch-sheet .watch-row");
const rp = await until("the owner opens the newest replay from Finished", () => O.view((s) => s.replay && { id: s.replay.id, exact: s.replay.exact !== null, last: s.replay.last }), 15000);
ok(rp?.id === f3 && rp.exact, "it is rebuilt by the referee", JSON.stringify(rp));
await until("the replay's bodies stand in the arena (four name tags)", async () => (await O.count(".watch-tag")) === 4, 10000);
await until("the replay's clock runs", () => O.view((s) => s.tick > 5), 10000);
ok(await O.has("#watch-seek") && await O.has("#watch-play") && await O.has("#watch-speed"), "play, seek and speed are there");
await shot(O, "14-replay");
await O.click("#watch-replay-close");
ok((await O.view((s) => s.replay)) === null, "closing it ends the replay");

await openSheet(A, "mine");
await until("Mine lists A's two matches", async () => (await A.count(".watch-sheet .watch-row")) === 2, 10000);
await shot(A, "15-mine");
await A.click(".watch-sheet .watch-row");
await until("A opens a replay from Mine, in the world it was played in: bodies in the arena", async () => (await A.view((s) => s.replay !== null)) && (await A.count(".watch-tag")) > 0, 15000);
ok(!(await A.has(".watch-map")), "no mini-map here: the arena is right there");
await A.click("#watch-replay-close");
const guestMine = (await B.api("/api/player/replays")).data?.matches?.length;
ok(guestMine === 2, "the guest's matches are listed for them too", String(guestMine));

// From one world straight into another (what a portal does): a fresh arrival in that lobby, and the mini-map
await enterWorld(pa, W2);
await sleep(1500);
{ const at = await A.pos(); ok(Math.hypot(at.x - ARRIVE2[0], at.z - ARRIVE2[2]) <= 2 && Math.abs(at.x) > 3, "world to world: A arrives in the other world's lobby", JSON.stringify({ x: +at.x.toFixed(1), z: +at.z.toFixed(1) })); }
await waitFor(() => A.has("#watch-chip"), 15000);
await openSheet(A, "mine");
await until("Mine is the same list in another world", async () => (await A.count(".watch-sheet .watch-row")) === 2, 10000);
await A.click(".watch-sheet .watch-row");
await until("from another world the replay shows the 2D mini-map", () => A.has(".watch-map"), 15000);
ok((await A.count(".watch-tag")) === 0 && !(await A.has("#watch-fly")), "no bodies drawn in the wrong world, no Fly in");
await sleep(1500);
const inked = await pa.$eval(".watch-map", (c) => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++; return n; }).catch(() => 0);
ok(inked > 100, "the mini-map is drawn", `${inked} solid pixels`);
await shot(A, "16-minimap");

for (const h of [O, A, B]) ok(h.errors().length === 0, `${h.name}: no page errors`, JSON.stringify(h.errors().slice(0, 4)));
const code = done(`(${VP}; screenshots in ${RIG_DIR}/e2e-${VP}-*.png)`);
await b.close();
process.exit(code);

/** A little longer than the ready check, so a match that was going to start anyway would have. */
function READY_WAIT() { return 2500; }
