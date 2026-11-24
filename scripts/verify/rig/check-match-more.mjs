// Sandbox rig: the parts of a match day that check-match-e2e.mjs leaves out, with three
// saved people (an owner and two players) against the real server (Phase 10):
//
//   1  a "play against" link made from the chat name sheet, accepted from the lobby sheet
//   2  the owner holds the queue (nobody is matched), releases it, and starts the ready check early
//   3  the link is honoured and logged in the match record
//   4  a player closes their tab mid-match → after the grace an NPC takes the slot
//   5  the player comes back, sees Rejoin, takes the slot back
//      (the owner, who is playing, ends that match as host)
//   6  the owner's Start now with one player in the ring (NPCs up to the minimum); Leave
//   7  a "play with" link + Start now: both on one team
//
//   RIG_N=8 scripts/verify/rig/up.sh && RIG_N=8 node scripts/verify/rig/check-match-more.mjs
// Screenshots: /tmp/rig<N>/more-<VP>-*.png
import { launch, open, sleep, savedPlayer, plantWorld, enterWorld, waitFor, RIG_DIR, WEB } from "./browser.mjs";
import { checklist, player, recordOf, verifies, GAMES } from "./match-kit.mjs";

// King of the hill: a race would be over in seconds once an NPC takes a slot (it walks straight to the goal)
const GAME = GAMES["king-of-the-hill"];

const VP = process.env.VP ?? "phone";
const { ok, until, done } = checklist();
const b = await launch();
const ctxB = await b.createBrowserContext();
const [po, pa, pb0] = await Promise.all([open(b, WEB, VP), open(b, WEB, VP, await b.createBrowserContext()), open(b, WEB, VP, ctxB)]);
let pb = pb0;
const [idO, idA, idB] = await Promise.all([savedPlayer(po), savedPlayer(pa), savedPlayer(pb)]);
console.log("owner", idO, "| A", idA, "| B", idB);
const W = await plantWorld(po, "More Arena");
const O = player(po, "owner", W), A = player(pa, "A", W);
let B = player(pb, "B", W);
const shot = (h, name) => h.shot(`more-${VP}-${name}`);
ok((await O.api("/api/player/world/game", { worldId: W, game: GAME })).status === 200, "the game saved");
await Promise.all([enterWorld(po, W), enterWorld(pa, W), enterWorld(pb, W)]);
for (const h of [O, A, B]) ok(await h.lobby(), `${h.name}: the lobby is ready`);

// ── 1. A link from the chat name sheet ─────────────────────────────
await B.click("#chat-open");
await pb.type("#chat-input", "hello from B");
await pb.keyboard.press("Enter");
await A.click("#chat-open"); // names are tappable while the chat is open
await until("B's chat line reaches A, with a name to tap", () => A.has(".chat-name--btn"), 15000);
await A.click(".chat-name--btn");
await until("the name sheet offers Play with / Play against", async () => (await A.has("#pact-play-with")) && (await A.has("#pact-play-against")), 8000);
await shot(A, "01-name-sheet");
await A.click("#pact-play-against");
await until("B gets the ask (a badge on the chip)", async () => (await B.match((s) => s.lobby?.asks.length === 1)) && /1 ask/.test(await B.text("#lobby-chip") ?? ""), 10000);
await B.click("#lobby-chip");
await until("B's lobby sheet lists it", () => B.has("#lobby-sheet .lobby-item .lobby-btn--primary"), 8000);
await shot(B, "02-ask");
await B.click("#lobby-sheet .lobby-item .lobby-btn--primary");
await until("accepted: both have the link", async () => (await A.match((s, id) => s.lobby?.links.some((l) => l.with === id && l.kind === "against"), idB)) && (await B.match((s, id) => s.lobby?.links.some((l) => l.with === id && l.kind === "against"), idA)), 10000);
ok(/Playing against/.test(await B.text("#lobby-sheet") ?? ""), "the sheet shows it under Your links");
await B.click("#lobby-close");

// ── 2. Hold, release, start early ──────────────────────────────────
await O.click("#lobby-chip");
ok(await O.has("#lobby-host-start") && await O.has("#lobby-host-hold"), "the owner's sheet has the host controls");
ok(!(await A.has("#lobby-host-hold")), "a player's does not");
await shot(O, "03-host");
await O.click("#lobby-host-hold");
await until("everyone hears the queue is held", () => A.match((s) => s.lobby?.held === true), 8000);
await A.queue(); await B.queue(); await O.queue();
await until("all three are in the pool", () => A.match((s) => s.lobby?.pool === 3), 15000);
await sleep(6000); // twice the matchmaker's wait
ok((await A.match((s) => s.found)) === null && (await B.match((s) => s.found)) === null, "held: nobody is matched");
ok(/hold/i.test(await O.text("#lobby-status") ?? ""), "the sheet says the hosts are holding the queue", await O.text("#lobby-status"));
await O.click("#lobby-host-release");
const f1 = await until("released: the ready check comes for all three", async () => {
  const ids = await Promise.all([O, A, B].map((h) => h.match((s) => s.found && { id: s.found.matchId, team: s.found.you.team })));
  return ids.every(Boolean) && ids.every((x) => x.id === ids[0].id) ? ids : null;
}, 15000);
ok(f1 && f1[1].team !== f1[2].team, "A and B, linked against each other, are on different teams", JSON.stringify(f1?.map((x) => x.team)));
ok(!(await O.has("#lobby-sheet")), "the lobby sheet closed for the ready check");
await sleep(1500);
const t0 = Date.now();
await O.send({ t: "host", cmd: "start" }); // the sheet is closed during a ready check: the same intent its Start now sends
const st = await until("the owner's Start now locks the roster early", () => A.match((s) => s.playing?.matchId), 6000);
ok(Date.now() - t0 < 6000, "well before the 10 s ready check ran out", `${Date.now() - t0} ms`);
const M1 = st;

// ── 3. The record logs the link ────────────────────────────────────
const rec = await recordOf(O, M1);
ok(rec?.setup.formed.links.some((l) => l.kind === "against" && [l.a, l.b].includes(idA) && [l.a, l.b].includes(idB)), "the record's `formed` logs the against link", JSON.stringify(rec?.setup.formed));
ok(await O.has("#match-strip"), "the owner plays too");
await sleep(1500);
await shot(O, "04-owner-playing");
// Slice 1's setup outlines are hidden for an owner who is playing: nothing to assert in the DOM, see the screenshot

// ── 4. B closes the tab ────────────────────────────────────────────
await until("the round is on", () => A.match((s) => s.snap?.phase === "playing"), 20000);
const slotB = await A.match((s, id) => s.playing.roster.find((r) => r.id === id)?.slot, idB);
await until("A sees B's body", async () => (await A.others()).includes(idB), 10000);
await pb.close();
await until("after the grace an NPC takes B's slot (A is told)", () => A.match((s, slot) => s.snap?.events.some((e) => e.type === "swap" && e.slot === slot) || null, slotB).then(async (v) => v || /NPC took over/.test(await A.text(".match-toasts") ?? "")), 20000);
await until("the slot's body is drawn as an NPC for A", async () => (await A.count(".watch-tag")) === 1, 10000);
await until("and B's live body is gone", async () => !(await A.others()).includes(idB), 10000);
await shot(A, "05-npc-took-over");

// ── 5. B comes back ────────────────────────────────────────────────
pb = await open(b, WEB, VP, ctxB);
B = player(pb, "B", W);
await savedSession(pb);
await enterWorld(pb, W);
await until("back in the world, B's lobby offers the match", () => B.match((s, id) => s.lobby?.rejoin === id, M1), 30000);
await until("the chip says Rejoin", async () => /Rejoin/.test(await B.text("#lobby-chip") ?? ""), 8000);
await shot(B, "06-rejoin-chip");
await B.click("#lobby-chip");
ok(await B.click("#lobby-rejoin"), "the sheet has Rejoin your match");
await until("B has the slot back", () => B.match((s, id) => s.playing?.matchId === id && s.snap !== null, M1), 15000);
ok((await B.match((s) => s.playing.you.slot)) === slotB, "the same slot");
await until("A sees B's own body again, and the NPC body is gone", async () => (await A.others()).includes(idB) && (await A.count(".watch-tag")) === 0, 15000);
await shot(B, "07-rejoined");
await O.send({ t: "host-end", matchId: M1 });
await until("the owner ends the match: results for all three", async () => (await A.has("#match-results")) && (await B.has("#match-results")) && (await O.has("#match-results")), 25000);
ok(await verifies(O, M1), "the record (with the swap out and back) replays to the same result");
const r1 = await recordOf(O, M1);
ok(r1.events.filter((e) => e.type === "swap").length === 2, "two swap events in the record", JSON.stringify(r1.events.filter((e) => e.type === "swap")));
for (const h of [O, A, B]) await h.click("#match-back");
await until("everyone is back in the lobby", async () => (await Promise.all([O, A, B].map((h) => h.match((s) => s.playing === null && s.ended === null && s.lobby !== null)))).every(Boolean), 30000);

// ── 6. Start now with one player ───────────────────────────────────
await A.queue();
await until("A alone in the pool", () => O.match((s) => s.lobby?.pool === 1), 15000);
await O.click("#lobby-chip");
await O.click("#lobby-host-start");
const solo = await until("the owner's Start now begins a match for A", () => A.match((s) => s.playing && { id: s.playing.matchId, roster: s.playing.roster.map((r) => `${r.name}:${r.kind}:t${r.team}`) }), 10000);
ok(solo?.roster.length === 2 && solo.roster.filter((r) => r.includes(":npc:")).length === 1, "NPCs only up to the minimum: one human, one NPC", solo?.roster.join(" "));
await O.click("#lobby-close");
await sleep(1000);
await A.click("#match-leave");
ok(/Leave\?/.test(await A.text("#match-leave") ?? ""), "Leave asks once more");
await A.click("#match-leave");
await until("A left: back in the lobby", () => A.match((s) => s.playing === null && s.lobby !== null), 10000);
{ const at = await A.pos(); ok(at.z > 12 && at.mods === null, "at the arrival point, traits cleared", JSON.stringify({ x: +at.x.toFixed(1), z: +at.z.toFixed(1) })); }

// ── 7. A "with" link and Start now: one team ───────────────────────
await A.send({ t: "unlink", with: idB });
await A.send({ t: "link", to: idB, kind: "with" });
await until("B gets the new ask", () => B.match((s) => s.lobby?.asks.some((a) => a.kind === "with")), 10000);
await B.send({ t: "link-answer", from: idA, yes: true });
await until("linked with", () => A.match((s, id) => s.lobby?.links.some((l) => l.with === id && l.kind === "with"), idB), 10000);
await A.queue(); await B.queue();
await until("both in the pool", () => O.match((s) => s.lobby?.pool === 2), 15000);
await sleep(5000);
ok((await A.match((s) => s.found)) === null, "two players who must share a team are not matched on their own (a team would be empty)");
await O.send({ t: "host", cmd: "start" });
const tm = await until("the owner starts it anyway", async () => { const [a, c] = await Promise.all([A.match((s) => s.playing && { id: s.playing.matchId, team: s.playing.you.team, n: s.playing.roster.length }), B.match((s) => s.playing?.you.team)]); return a && c ? { a, c } : null; }, 10000);
ok(tm && tm.a.team === tm.c, "A and B, linked with each other, are on one team", JSON.stringify(tm));
await O.send({ t: "host-end", matchId: tm?.a.id });
await until("the owner ends that match: results", () => A.has("#match-results"), 15000);

for (const h of [O, A, B]) ok(h.errors().length === 0, `${h.name}: no page errors`, JSON.stringify(h.errors().slice(0, 4)));
const code = done(`(${VP}; screenshots in ${RIG_DIR}/more-${VP}-*.png)`);
await b.close();
process.exit(code);

/** The reopened tab already has its cookie: wait for the app to know its saved player. */
async function savedSession(page) {
  const id = await waitFor(() => page.evaluate(async () => { const p = (await import("/src/lib/player.ts")).getPlayerSnapshot(); return p && !p.isGuest && !p.isAnonymous ? p.playerId : null; }), 40000);
  ok(id === idB, "the reopened tab is the same player");
}
