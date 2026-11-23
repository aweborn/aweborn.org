// Sandbox rig: the play layer (Phase 10) driven by a fake server.
//
// A saved owner stands in a world with a saved game; this script then plays the server:
// it feeds `lobby`, `found`, `start`, `snap`, `move`, `end` and `back` messages straight
// into the client (lib/match.ts onMatchMessage) and records what the client sends
// (setMatchSender is wrapped), asserting on both and taking screenshots on the way.
//
//   RIG_N=3 scripts/verify/rig/up.sh
//   RIG_N=3 node scripts/verify/rig/check-play.mjs            # phone (390 × 844)
//   RIG_N=3 VP=desktop node scripts/verify/rig/check-play.mjs # or small / landscape
// Screenshots: /tmp/rig<N>/play-<viewport>-<step>.png. Exits 1 if an assertion failed.
import { launch, open, sleep, savedPlayer, plantWorld, enterWorld, standAt, api, store, RIG_DIR, WEB } from "./browser.mjs";

const VP = process.env.VP ?? "phone";
const shot = (p, name) => p.screenshot({ path: `${RIG_DIR}/play-${VP}-${name}.png` });
let failed = 0;
const ok = (cond, what, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${what}${extra ? `  ${extra}` : ""}`); if (!cond) failed++; };

const GAME = {
  template: "capture-the-flag",
  settings: { teams: 2, players: { min: 2, max: 6 }, rounds: 3, roundSeconds: 180, scoreToWin: 3, traits: { speedMul: 1.5, gravityMul: 0.5, fly: false }, edge: "soft", edgeSeconds: 8 },
  arena: { at: [0, 0, -6], size: [20, 10, 20] },
  zones: [
    { id: "spawn-1", kind: "spawn", team: 1, at: [-6, 0, -6], size: [4, 3, 4] },
    { id: "spawn-2", kind: "spawn", team: 2, at: [6, 0, -6], size: [4, 3, 4] },
    { id: "goal-1", kind: "goal", at: [0, 0, -12], size: [4, 3, 4] },
    { id: "keep-1", kind: "keep-out", at: [0, 0, 0], size: [3, 3, 3], ret: "soft" },
  ],
  lobby: { at: [0, 0, 12], size: [12, 6, 12], ring: { at: [0, 0, 11], radius: 2 }, arrival: [0, 0, 15] },
  npcRoster: [{ id: "bolt", name: "Bolt", behavior: "auto", levels: { min: 1, max: 5 } }],
};

const b = await launch();
const p = await open(b, WEB, VP);
const me = await savedPlayer(p);
const w = await plantWorld(p, "Play Test");
const saved = await api(p, "/api/player/world/game", { worldId: w, game: GAME });
ok(saved.status === 200, "the game saved", `v${saved.data?.game?.version}`);
await enterWorld(p, w);

// ── Become the server ──
await p.evaluate(async () => {
  const m = await import("/src/lib/match.ts");
  window.__sent = [];
  const mine = (worldId, intent) => window.__sent.push({ worldId, ...intent });
  // The real socket takes the sender back whenever it reconnects (slow Chrome drops it now and then): take it again
  let installing = true;
  m.onMatchSender(() => { if (installing) return; installing = true; queueMicrotask(() => { m.setMatchSender(mine); installing = false; }); });
  m.setMatchSender(mine);
  installing = false;
});
const feed = (msg) => p.evaluate(async (w, msg) => (await import("/src/lib/match.ts")).onMatchMessage(w, new TextEncoder().encode(JSON.stringify(msg))), w, msg);
const sent = (t) => p.evaluate((t) => window.__sent.filter((m) => !t || m.t === t), t);
const clearSent = () => p.evaluate(() => { window.__sent = []; });
const pos = () => p.evaluate(async () => { const { interiorController: c } = await import("/src/systems/InteriorController.ts"); return { x: c.state.x, y: c.state.y, z: c.state.z, mods: c.mods }; });
const match = (fn, ...args) => store(p, "lib/match", "useMatchStore", fn, ...args);
const text = (sel) => p.$eval(sel, (e) => e.textContent).catch(() => null);
const click = async (sel) => { const el = await p.$(sel); if (!el) { ok(false, `click ${sel}: missing`); return; } await el.evaluate((e) => e.click()); await sleep(250); };
const lobby = (over = {}) => ({ t: "lobby", gameVersion: 1, ready: true, pool: 0, queued: false, held: false, matches: [], links: [], asks: [], rejoin: null, ...over });

await sleep(400);
ok((await sent("hello")).length >= 1, "hello is sent again when the socket (re)opens");

// ── 1. The lobby: ring, chip ──
await feed(lobby());
await standAt(p, 0, 0, 16.5);
await sleep(1500);
ok((await text("#lobby-chip"))?.includes("Play"), "chip says Play", await text("#lobby-chip"));
ok((await text(".match-ring-label")) === "Stand here to play", "ring label invites", await text(".match-ring-label"));
ok((await sent("queue")).length === 0, "no queue message outside the ring");
await shot(p, "01-lobby");

await standAt(p, 0, 0, 11.5);
await sleep(900);
const q1 = await sent("queue");
ok(q1.length === 1 && q1[0].on === true && q1[0].worldId === w, "stepping into the ring sends queue on", JSON.stringify(q1));
await feed(lobby({ pool: 1, queued: true, asks: [{ from: "p-ada", name: "Ada", kind: "with" }], links: [{ with: "p-bo", name: "Bo", kind: "against" }] }));
await sleep(3800); // alone for a few seconds: play now is offered
ok((await text("#lobby-chip"))?.includes("In the pool"), "chip says In the pool", await text("#lobby-chip"));
ok((await text(".match-ring-label"))?.startsWith("In the pool"), "ring label shows the pool", await text(".match-ring-label"));
await shot(p, "02-in-ring");

// ── 2. The chip's sheet ──
await click("#lobby-chip");
await sleep(500);
ok(Boolean(await p.$("#lobby-sheet[open]")), "the sheet opens");
ok(Boolean(await p.$("#lobby-play-now")), "play now with NPCs is offered when alone in the pool");
ok(Boolean(await p.$("#lobby-host-start")), "the owner sees the host controls");
await shot(p, "03-sheet");
await p.$eval(".lobby-panel", (e) => e.scrollTo(0, e.scrollHeight)); await sleep(200);
await shot(p, "03b-sheet-bottom");
await click("#lobby-npc-level-more");
await click("#lobby-play-now");
ok(JSON.stringify(await sent("play-now")) === JSON.stringify([{ worldId: w, t: "play-now", level: 4 }]), "play now sends the level", JSON.stringify(await sent("play-now")));
await p.evaluate(() => [...document.querySelectorAll("#lobby-sheet .lobby-item button")].find((e) => e.textContent === "Accept")?.click());
await p.evaluate(() => [...document.querySelectorAll("#lobby-sheet .lobby-item button")].find((e) => e.textContent === "Remove")?.click());
await click("#lobby-host-hold");
ok((await sent("link-answer"))[0]?.from === "p-ada" && (await sent("link-answer"))[0]?.yes === true, "accepting an ask sends link-answer");
ok((await sent("unlink"))[0]?.with === "p-bo", "removing a link sends unlink");
ok((await sent("host"))[0]?.cmd === "hold", "hold sends host hold");
await feed(lobby({ pool: 1, queued: true, rejoin: "m-old" }));
await sleep(300);
ok(Boolean(await p.$("#lobby-rejoin")), "rejoin shows when the lobby says so");
await feed(lobby({ pool: 2, queued: true }));

// Links: the player sheet offers Play with / Play against in a world with a game
await click("#lobby-close");
await store(p, "stores/muteStore", "useMuteStore", (s, w) => s.openActions("p-ada", w), w);
await sleep(500);
ok(Boolean(await p.$("#pact-play-with")) && Boolean(await p.$("#pact-play-against")), "the player sheet offers Play with / Play against");
await shot(p, "03c-player-sheet");
await click("#pact-play-against");
ok(JSON.stringify((await sent("link")).map(({ to, kind }) => ({ to, kind }))) === JSON.stringify([{ to: "p-ada", kind: "against" }]), "Play against sends link", JSON.stringify(await sent("link")));
ok(!(await p.$("#player-actions[open]")), "…and closes the sheet");

// ── 3. The ready check ──
const roster = [
  { slot: 0, team: 1, kind: "human", id: me, name: "Rig Player" },
  { slot: 1, team: 2, kind: "human", id: "p-ada", name: "Ada" },
  { slot: 2, team: 1, kind: "npc", id: "npc:bolt:1", name: "Bolt", npc: { rosterId: "bolt", behavior: "auto", level: 3, version: 1 } },
];
await clearSent();
await feed({ t: "found", matchId: "m1", you: { slot: 0, team: 1 }, roster, readyMs: 10000, npc: null });
await sleep(700);
ok(!(await p.$("#lobby-sheet")), "a found match closes the sheet");
ok((await text("#match-ready-title")) === "Match found", "the ready check shows");
ok((await text(".match-ready-team"))?.includes("Red"), "it names your team", await text(".match-ready-team"));
ok(Boolean(await p.$("#match-npc-propose")), "empty slots: offer to fill with NPCs");
await shot(p, "04-ready");
await click("#match-npc-propose");
ok((await sent("npc-propose"))[0]?.level === 3, "proposing sends npc-propose");
await feed({ t: "found", matchId: "m1", you: { slot: 0, team: 1 }, roster, readyMs: 10000, npc: { level: 2, by: "p-ada", votes: 1, needed: 2 } });
await sleep(400);
await shot(p, "04b-ready-vote");
ok(Number(await text(".match-ready-secs")) >= 9, "a re-sent found restarts the countdown from its readyMs", await text(".match-ready-secs"));
ok((await text(".match-ready-note"))?.includes("recorded"), "the ready check says matches are recorded");
await click("#match-npc-yes");
ok((await sent("npc-vote"))[0]?.yes === true, "voting sends npc-vote");
await standAt(p, 0, 0, 16.5); await sleep(700);
ok((await sent("queue")).at(-1)?.on === false, "stepping out of the ring during the ready check sends queue off (decline)");
await feed({ t: "cancel", matchId: "m1" });
await sleep(300);
ok(!(await p.$("#match-ready")), "cancel closes the ready check");
await standAt(p, 0, 0, 11.5); await sleep(700);
await feed({ t: "found", matchId: "m2", you: { slot: 0, team: 1 }, roster, readyMs: 10000, npc: null });

// ── 4. Start: placed at the spawn, the match's traits apply ──
await clearSent();
await feed({ t: "start", matchId: "m2", you: { slot: 0, team: 1 }, roster, gameVersion: 1, spawn: [-6, 0, -6], face: [0, 0, -6] });
await sleep(600);
let at = await pos();
ok(Math.abs(at.x + 6) < 0.01 && Math.abs(at.z + 6) < 0.01, "start puts the player on the spawn", JSON.stringify(at));
ok(at.mods?.speedMul === 1.5 && at.mods?.gravityMul === 0.5 && at.mods?.fly === false && !at.mods?.wall, "the match's traits are the step's modifiers (soft edge: no wall)", JSON.stringify(at.mods));
ok(Boolean(await p.$("#match-strip")) && !(await p.$("#lobby-chip")), "the score strip takes the chip's place");
const snap = (over = {}) => ({ t: "snap", matchId: "m2", tick: 100, phase: "playing", round: 1, left: 1610, scores: [1, 0], rounds: [0, 0], hill: 0, watching: 2, events: [],
  players: [{ slot: 0, x: -6, y: 0, z: -6 }, { slot: 1, x: 6, y: 0, z: -6 }, { slot: 2, x: -5, y: 0, z: -8 }],
  items: [{ id: "flag-2", kind: "flag", team: 2, x: 6, y: 0, z: -6, heldBy: null }], ...over });
await feed(snap({ phase: "countdown", left: 42, scores: [0, 0] }));
await sleep(700);
ok((await text(".match-banner"))?.startsWith("Round 1"), "countdown banner", await text(".match-banner"));
const held = () => p.evaluate(async () => (await import("/src/systems/InteriorController.ts")).interiorController.hold);
ok((await held()) === true, "the player stands still during the countdown");
await shot(p, "05-countdown");

await feed(snap({ tick: 150, left: 1610, events: [{ tick: 149, type: "announce", value: 0 }, { tick: 150, type: "pickup", slot: 0, item: "flag-2" }], players: [{ slot: 0, x: -6, y: 0, z: -6, carrying: "flag-2" }, { slot: 1, x: 6, y: 0, z: -6 }, { slot: 2, x: -5, y: 0, z: -8 }], items: [{ id: "flag-2", kind: "flag", team: 2, x: -6, y: 0, z: -6, heldBy: 0 }] }));
await feed(snap({ tick: 151, left: 1609, rounds: [1, 0], events: [{ tick: 151, type: "swap", slot: 1, value: 1 }], players: [{ slot: 0, x: -6, y: 0, z: -6, carrying: "flag-2" }, { slot: 1, x: 6, y: 0, z: -6 }, { slot: 2, x: -5, y: 0, z: -8 }], items: [{ id: "flag-2", kind: "flag", team: 2, x: -6, y: 0, z: -6, heldBy: 0 }] }));
await sleep(300);
const toasts = await p.$$eval(".match-toast", (l) => l.map((e) => e.textContent));
ok(toasts.includes("Go!") && toasts.includes("You have the flag") && toasts.some((t) => t.includes("NPC took over for Ada")), "toasts for events", JSON.stringify(toasts));
await shot(p, "06-hud");
ok((await held()) === false, "…and moves once the round is on");
ok((await text(".match-strip-round")) === "Round 1 of 3", "round n of m", await text(".match-strip-round"));
ok((await p.$$eval(".match-score-value", (l) => l.map((e) => e.textContent).join("-"))) === "1-0", "team scores");
ok(Boolean(await p.$(".match-score.is-mine")), "your team is highlighted");
ok((await text(".match-carry"))?.includes("Blue flag"), "what you carry", await text(".match-carry"));
// The clock: ticks → m:ss, counting down between snapshots (and holding after a second without one)
const clockAt = await p.evaluate(async (w, msg) => {
  const m = await import("/src/lib/match.ts");
  m.onMatchMessage(w, new TextEncoder().encode(JSON.stringify(msg)));
  // Sample the clock for a few seconds: it shows the snapshot's time, then counts down (and holds after a second without a snapshot)
  const seen = [];
  for (let i = 0; i < 45; i++) { const t = document.querySelector(".match-strip-time")?.textContent; if (seen.at(-1) !== t) seen.push(t); await new Promise((r) => setTimeout(r, 100)); }
  return seen;
}, w, snap({ tick: 152, left: 1700, rounds: [1, 0] }));
ok(clockAt.slice(-2).join(" → ") === "2:50 → 2:49", "the clock reads ticks as m:ss and counts down between snapshots", clockAt.join(" → "));
// How much of the screen the HUD covers
const cover = () => p.evaluate(() => { let a = 0; for (const e of document.querySelectorAll("#match-strip, .match-carry, .match-toast, .match-banner, .match-warning")) { const r = e.getBoundingClientRect(); a += r.width * r.height; } return a / (innerWidth * innerHeight); });
ok((await cover()) < 0.25, "HUD chrome under 25% of the screen", `${((await cover()) * 100).toFixed(1)}%`);

// Standing in the ring's spot while playing must not queue
await standAt(p, 0, 0, 11.5); await sleep(1500);
ok((await sent("queue")).length === 0, "never a queue message while playing");
// …and that spot is outside the arena: the warning counts down from the game's own boxes
await feed(snap({ tick: 160, left: 1600 }));
await sleep(1200);
ok((await text(".match-warning-title")) === "Out of bounds", "out-of-bounds warning (computed from the arena)", await text(".match-warning"));
await feed(snap({ tick: 190, left: 1570, players: [{ slot: 0, x: 0, y: 0, z: 11.5, outside: 30 }, { slot: 1, x: 6, y: 0, z: -6 }] }));
await sleep(500);
ok(["5", "4"].includes(await text(".match-warning-secs")), "…and from the referee's count when the snapshot has one (8 s − 3 s)", await text(".match-warning-secs"));
await shot(p, "07-out-of-bounds");
ok((await cover()) < 0.25, "…still under 25% with the warning up", `${((await cover()) * 100).toFixed(1)}%`);
await feed({ t: "move", matchId: "m2", to: [-6, 0, -6], face: [0, 0, -6], why: "return" });
await feed(snap({ tick: 200, left: 1560, events: [{ tick: 200, type: "return", slot: 0, to: [-6, 0, -6] }] }));
await sleep(900);
at = await pos();
ok(Math.abs(at.x + 6) < 0.01 && Math.abs(at.z + 6) < 0.01, "move puts the player where the referee says", JSON.stringify(at));
ok(!(await p.$(".match-warning")), "the warning clears once back inside");
await standAt(p, 0, 0, 0); await sleep(900);
ok((await text(".match-warning-title")) === "Keep out", "keep-out zones warn too", await text(".match-warning-title"));
await standAt(p, -6, 0, -4);
await feed(snap({ tick: 300, phase: "break", left: 40, scores: [3, 1], rounds: [1, 0] }));
await sleep(600);
ok((await text(".match-banner"))?.startsWith("Round over"), "break banner", await text(".match-banner"));
await shot(p, "08-break");

// Leave: confirm on the second tap
await feed(snap({ tick: 310, left: 1500, round: 2, rounds: [1, 0] }));
await click("#match-leave");
ok((await sent("leave")).length === 0 && (await text("#match-leave")) === "Leave?", "the first tap on Leave only asks");
await click("#match-leave");
ok((await sent("leave")).length === 1, "the second tap sends leave (within a few seconds)");

// ── 5. Results ──
await clearSent();
const result = { winner: 1, rounds: [2, 1], scores: [3, 2], ticks: 5400, why: "score", players: [{ slot: 0, score: 4, returns: 1, left: false }, { slot: 1, score: 3, returns: 0, left: true }, { slot: 2, score: 1, returns: 2, left: false }] };
await feed({ t: "end", matchId: "m2", result, roster, awe: 12, again: true });
await sleep(700);
ok((await text("#match-results-title")) === "Red wins", "results name the winner", await text("#match-results-title"));
ok((await text("#match-awe")) === "+12 awe", "awe earned");
ok((await p.$$eval("#match-results .match-slot", (l) => l.length)) === 3, "every player is listed");
await shot(p, "09-results");
await standAt(p, 0, 0, 11.5); await sleep(900);
ok((await sent("queue")).length === 0, "never a queue message while the results are up");
await click("#match-again");
ok(JSON.stringify(await sent("again")) === JSON.stringify([{ worldId: w, t: "again", yes: true }]), "play again sends again yes");
ok((await text(".match-results-wait")) === "Waiting for your team…", "then it waits for the team");
await shot(p, "09b-results-waiting");
await click("#match-back");
ok((await sent("again")).at(-1)?.yes === false, "back to the lobby sends again no");
await feed({ t: "back", to: [0, 0, 15] });
await sleep(900);
at = await pos();
ok(!(await p.$("#match-results")) && Boolean(await p.$("#lobby-chip")), "back closes the results; the chip returns");
ok(Math.abs(at.x) <= 1.01 && Math.abs(at.z - 15) <= 1.01 && at.mods === null, "back puts the player in the lobby and clears the modifiers", JSON.stringify(at));
ok((await match((s) => s.playing === null && s.ended === null)), "the store is back to the lobby");
// A draw reads as a draw
await feed({ t: "start", matchId: "m3", you: { slot: 0, team: 1 }, roster, gameVersion: 1, spawn: [-6, 0, -6], face: [0, 0, -6] });
await feed({ t: "end", matchId: "m3", result: { ...result, winner: 0, rounds: [1, 1] }, roster, awe: 0, again: false });
await sleep(500);
ok((await text("#match-results-title")) === "A draw" && !(await p.$("#match-awe")) && !(await p.$("#match-again")), "a draw: no winner, no awe line, no play-again when the server says so");
await feed({ t: "back", to: [0, 0, 15] });

// ── 6. A new game version says hello again; a walled edge can't be left ──
await clearSent();
const wall = await api(p, "/api/player/world/game", { worldId: w, game: { ...GAME, settings: { ...GAME.settings, edge: "wall" } } });
await sleep(2500);
ok(wall.data?.game?.version === 2 && (await sent("hello")).length >= 1, "a new game version sends hello again", `v${wall.data?.game?.version}, hellos ${(await sent("hello")).length}`);
await feed(lobby({ gameVersion: 2 }));
await feed({ t: "start", matchId: "m4", you: { slot: 0, team: 2 }, roster, gameVersion: 2, spawn: [6, 0, -6], face: [0, 0, -6] });
await feed(snap({ matchId: "m4", tick: 60 }));
await sleep(400);
await standAt(p, 30, 0, -6); await sleep(1200);
at = await pos();
ok(at.x <= 10 && at.mods?.wall?.maxX === 10, "edge: wall keeps the player inside the arena", `x=${at.x.toFixed(2)}`);
ok(!(await p.$(".match-warning")), "no countdown warning with a walled edge");
await standAt(p, 8.5, 0, -6); await sleep(1200);
await shot(p, "10-wall-near-edge");
await feed({ t: "back", to: [0, 0, 15] });

// ── 7. Not ready; leaving the world resets ──
await feed(lobby({ gameVersion: 2, ready: false }));
await sleep(400);
ok((await text("#lobby-chip"))?.includes("Game not ready"), "owners see Game not ready", await text("#lobby-chip"));
await store(p, "stores/universeStore", "useUniverseStore", (s) => s.exitWorld(true));
await sleep(2500);
ok((await match((s) => s.lobby === null && s.worldId === null)), "leaving the world resets the match store");
ok(!(await p.$("#lobby-chip")), "no chip outside the world");

const errors = p.errors.filter((e) => !/ERR_|Failed to load resource|fonts|stripe|google|WebSocket/i.test(e));
ok(errors.length === 0, "no page errors", JSON.stringify(errors.slice(0, 6)));
console.log(failed ? `\n${failed} FAILED` : "\nall passed", `(${VP}; screenshots in ${RIG_DIR}/play-${VP}-*.png)`);
await b.close();
process.exit(failed ? 1 : 0);
