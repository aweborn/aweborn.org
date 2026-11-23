// Rig walkthrough for the view layer (Phase 10: spectating, hologram, ghost camera, replays).
// No match server is needed: lobby / snap / end messages are fed straight into the client
// store, and the three HTTP routes are answered here by request interception.
//   RIG_N=4 scripts/verify/rig/up.sh && RIG_N=4 VP=phone node scripts/verify/rig/check-view.mjs
// VP = phone | small | landscape | desktop. Screenshots: /tmp/rig<N>/view-<VP>-*.png
import { launch, open, sleep, savedPlayer, plantWorld, enterWorld, api, store, RIG_DIR, WEB, SYNC } from "./browser.mjs";

const VP = process.env.VP ?? "phone";
const shot = (p, name) => p.screenshot({ path: `${RIG_DIR}/view-${VP}-${name}.png` });
const fails = [];
const check = (ok, what) => { console.log(ok ? "  ok  " : "  FAIL", what); if (!ok) fails.push(what); };

const GAME = {
  version: 0, template: "capture-the-flag",
  settings: { teams: 2, players: { min: 2, max: 8 }, rounds: 1, roundSeconds: 120, scoreToWin: 3, traits: { speedMul: 1, gravityMul: 1, fly: true }, edge: "soft", edgeSeconds: 10 },
  arena: { at: [0, 0, -6], size: [20, 8, 20] },
  zones: [
    { id: "s1", kind: "spawn", team: 1, at: [-7, 0, -6], size: [4, 3, 4] },
    { id: "s2", kind: "spawn", team: 2, at: [7, 0, -6], size: [4, 3, 4] },
    { id: "g1", kind: "goal", at: [0, 0, -13], size: [4, 3, 4] },
    { id: "k1", kind: "keep-out", at: [0, 0, 1], size: [3, 3, 3], ret: "soft" },
  ],
  lobby: { at: [0, 0, 12], size: [10, 5, 10], ring: { at: [3, 0, 13], radius: 1.5 }, arrival: [0, 0, 15.5] },
  npcRoster: [], npc: { fill: true, hold: true, host: true }, rules: [], credits: [],
};
const SLOTS = [
  { slot: 0, team: 1, kind: "human", id: "p-ana", name: "Ana" },
  { slot: 1, team: 2, kind: "human", id: "p-bo", name: "Bo" },
  { slot: 2, team: 1, kind: "npc", id: "npc:a:1", name: "Comet", npc: { rosterId: "a", behavior: "auto", level: 3, version: 1 } },
  { slot: 3, team: 2, kind: "npc", id: "npc:a:2", name: "Pip", npc: { rosterId: "a", behavior: "auto", level: 2, version: 1 } },
];
/** Where slot `s` walks at tick `t`: loops inside the arena. */
const walk = (s, t) => {
  const a = t / 25 + s * 1.7;
  const r = 4 + s * 1.3;
  return { slot: s, x: Math.round(Math.cos(a) * r * 100) / 100, y: 0, z: Math.round((-6 + Math.sin(a * (s % 2 ? 1 : -1)) * r) * 100) / 100 };
};

/** A finished 60-second match in `worldId`, shaped like the server's record. */
function fakeRecord(id, worldId, game) {
  const frames = [];
  for (let t = 0; t <= 600; t++) frames.push({ t, s: SLOTS.flatMap((s) => { const p = walk(s.slot, t); return [p.slot, p.x * 100, p.y * 100, p.z * 100].map(Math.round); }) });
  const events = [
    { tick: 50, type: "round-start" },
    { tick: 140, type: "pickup", slot: 0, item: "flag-2" },
    { tick: 200, type: "out-of-bounds", slot: 3 },
    { tick: 260, type: "capture", slot: 0, team: 1, item: "flag-2" },
    { tick: 260, type: "score", team: 1, value: 1 },
    { tick: 330, type: "pickup", slot: 1, item: "flag-1" },
    { tick: 380, type: "drop", slot: 1, item: "flag-1" },
    { tick: 420, type: "pickup", slot: 3, item: "flag-1" },
    { tick: 470, type: "capture", slot: 3, team: 2, item: "flag-1" },
    { tick: 470, type: "score", team: 2, value: 1 },
    { tick: 520, type: "pickup", slot: 2, item: "flag-2" },
    { tick: 580, type: "capture", slot: 2, team: 1, item: "flag-2" },
    { tick: 580, type: "score", team: 1, value: 1 },
    { tick: 600, type: "round-end", team: 1, why: "time" },
    { tick: 600, type: "match-end", why: "time" },
  ];
  const result = { winner: 1, rounds: [1, 0], scores: [2, 1], players: SLOTS.map((s) => ({ slot: s.slot, score: 0, returns: 0, left: false })), ticks: 600, why: "time" };
  return { v: 1, setup: { matchId: id, worldId, game, seed: 7, simVersion: 0 /* not this referee: the client follows the events */, slots: SLOTS, formed: { policy: "random-balanced", seed: 7, links: [], together: [] } }, frames, events, result, startedAt: Date.now() - 8 * 60_000, endedAt: Date.now() - 7 * 60_000 };
}

const b = await launch();
const p = await open(b, WEB, VP);
const state = { world: "", game: null, other: "" };
const summary = (id, worldId, worldName, minsAgo, you) => ({
  id, worldId, worldName, template: "capture-the-flag", gameVersion: 1, startedAt: Date.now() - (minsAgo + 1) * 60_000, endedAt: Date.now() - minsAgo * 60_000, winner: 1, scores: [2, 1],
  roster: SLOTS.map((s) => ({ slot: s.slot, team: s.team, kind: s.kind, name: s.name, ...(you && s.slot === 0 ? { you: true } : {}) })),
});
await p.setRequestInterception(true);
p.on("request", (req) => {
  const u = new URL(req.url());
  const json = (body, status = 200) => req.respond({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": new URL(WEB).origin, "Access-Control-Allow-Credentials": "true" }, body: JSON.stringify(body) });
  if (u.origin !== SYNC) return req.continue();
  if (u.pathname === "/api/match/world") return json({ matches: [summary("m-done", state.world, "Arena World", 3, false), summary("m-old", state.world, "Arena World", 95, false)] });
  if (u.pathname === "/api/player/replays") return json({ matches: [summary("m-done", state.world, "Arena World", 3, true), summary("m-old", state.world, "Arena World", 95, true)] });
  if (u.pathname === "/api/match/record") {
    const id = u.searchParams.get("id");
    if (id === "m-missing") return json({ error: "not_found", message: "That replay is gone." }, 404);
    return json({ record: fakeRecord(id, state.world, state.game) });
  }
  return req.continue();
});

const me = await savedPlayer(p);
state.world = await plantWorld(p, "Arena World");
state.other = await plantWorld(p, "Other World", { x: 600, y: 0, z: 300 });
for (const w of [state.world, state.other]) {
  const r = await api(p, "/api/player/world/game", { worldId: w, game: GAME });
  if (r.status !== 200) throw new Error(`game save failed: ${JSON.stringify(r.data)}`);
  if (w === state.world) state.game = r.data.game;
}
await enterWorld(p, state.world, 7000);
console.log("player", me, "world", state.world, "| game v", state.game.version);

/** Feed one server message into the client, as the socket would. */
const feed = (msg) => p.evaluate(async (w, msg) => (await import("/src/lib/match.ts")).onMatchMessage(w, new TextEncoder().encode(JSON.stringify(msg))), state.world, msg);
const view = (fn, ...args) => store(p, "lib/matchView", "useViewStore", fn, ...args);
const match = (fn, ...args) => store(p, "lib/match", "useMatchStore", fn, ...args);
const click = async (sel) => { const el = await p.$(sel); if (!el) throw new Error("missing " + sel); await el.click(); await sleep(400); };
const clickText = (sel, text) => p.evaluate((sel, text) => { const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(text)); if (!el) throw new Error(`no ${sel} with "${text}"`); el.click(); }, sel, text);
/** Is anything of ours off-screen, and do the things you tap meet the touch size? */
const layout = (sels) => p.evaluate((sels) => {
  const out = [];
  const touch = document.documentElement.classList.contains("touch-ui");
  for (const sel of sels) for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (el.closest(".watch-events")) { if (r.height < (touch ? 43.5 : 30)) out.push(`${sel} short ${Math.round(r.height)}`); continue; } // a sideways-scrolling row
    if (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1) out.push(`${sel} off-screen ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    if (touch && el.matches("button") && !el.closest(".watch-events, .watch-list") && (r.width < 43.5 || r.height < 43.5)) out.push(`${sel} small ${Math.round(r.width)}x${Math.round(r.height)}`);
    if (touch && el.matches(".watch-row, .watch-event") && r.height < 43.5) out.push(`${sel} short ${Math.round(r.height)}`);
  }
  return out;
}, sels);
const OURS = [".watch-chip", ".watch-sheet", ".watch-sheet button", ".watch-strip", ".watch-strip button"];
const checkLayout = async (what) => { const bad = await layout(OURS); check(bad.length === 0, `${what}: layout${bad.length ? " " + JSON.stringify(bad.slice(0, 4)) : ""}`); };

// 1. The lobby: two matches running, one just finished
const lobby = (extra = {}) => ({
  t: "lobby", gameVersion: state.game.version, ready: true, pool: 1, queued: false, held: false, links: [], asks: [], rejoin: null,
  matches: [
    { id: "m-live", phase: "playing", round: 1, scores: [1, 0], players: 4, watching: 2, startedAt: Date.now() - 40_000 },
    { id: "m-live2", phase: "countdown", round: 1, scores: [0, 0], players: 6, watching: 0, startedAt: Date.now() - 2000 },
    { id: "m-done", phase: "finished", round: 1, scores: [2, 1], players: 4, watching: 0, startedAt: Date.now() - 4 * 60_000, endedAt: Date.now() - 3 * 60_000, winner: 1 },
  ],
  ...extra,
});
await feed(lobby());
await sleep(600);
check((await p.$eval("#watch-chip", (e) => e.textContent)).includes("2"), "chip shows 2 running matches");
await shot(p, "1-chip");
await click("#watch-chip");
check((await p.$$(".watch-sheet .watch-row")).length === 2, "Live tab lists 2 matches");
await checkLayout("live tab");
await shot(p, "2-live");
await click("#watch-tab-finished"); await sleep(900);
check((await p.$$(".watch-sheet .watch-row")).length === 2, "Finished tab: lobby row + server list, without doubles");
await checkLayout("finished tab");
await shot(p, "3-finished");
await click("#watch-tab-mine"); await sleep(600);
check((await p.$eval(".watch-sheet .watch-row", (e) => e.textContent)).includes("Won"), "Mine tab says Won for your team");
await checkLayout("mine tab");
await shot(p, "4-mine");

// 2. Tune in: bodies in the arena, the hologram in the lobby, the strip
await click("#watch-tab-live");
await clickText(".watch-row", "Round 1");
await sleep(300);
check((await match((s) => s.watching)) === "m-live", "tapping a live match tunes in");
check((await view((s) => s.sheet)) === false, "the sheet closes when you tune in");
const snapAt = (tick, events = []) => ({
  t: "snap", matchId: "m-live", tick, phase: "playing", round: 1, left: Math.max(0, 1200 - tick), scores: [1 + (tick > 900 ? 1 : 0), 0], rounds: [0, 0], hill: 0, watching: 3, events,
  players: SLOTS.map((s) => ({ ...walk(s.slot, tick), out: s.slot === 3 && tick % 200 > 150, carrying: s.slot === 0 ? "flag-2" : null })),
  items: [
    { id: "flag-1", kind: "flag", team: 1, x: -7, y: 0, z: -6, heldBy: null },
    { id: "flag-2", kind: "flag", team: 2, x: 7, y: 0, z: -6, heldBy: 0 },
    { id: "orb-1", kind: "pickup", x: 0, y: 0, z: -10, heldBy: null },
    { id: "orb-2", kind: "pickup", x: 3, y: 0, z: -3, heldBy: null },
    { id: "block-1", kind: "piece", x: -3, y: 0, z: -2, heldBy: null },
  ],
});
// A stream of snapshots, ten a second, generated in the page (the same shape as snapAt)
await p.evaluate(async (w, SLOTS, walkSrc, snapSrc) => {
  const { onMatchMessage } = await import("/src/lib/match.ts");
  const walk = new Function(`return ${walkSrc}`)();
  const snapAt = new Function("SLOTS", "walk", `return ${snapSrc}`)(SLOTS, walk);
  let tick = 300;
  window.__feed = setInterval(() => onMatchMessage(w, new TextEncoder().encode(JSON.stringify(snapAt(tick++)))), 100);
}, state.world, SLOTS, walk.toString(), snapAt.toString());
await sleep(3500);
check((await match((s) => s.watchRoster?.length)) === 4, "the watched match's roster arrives from its record");
check((await p.$$(".watch-tag")).length === 4, "four name tags over the watched players");
check((await p.$$(".watch-ai")).length === 2, "NPCs carry an AI badge");
check(await p.$eval(".watch-strip", (e) => e.textContent.includes("👁 3")), "the strip shows who is watching");
await checkLayout("watching strip");
await shot(p, "5-watching");

// 3. The ghost camera
const body0 = await p.evaluate(async () => { const { interiorController: c } = await import("/src/systems/InteriorController.ts"); return [c.state.x, c.state.z]; });
await click("#watch-fly");
await sleep(1500);
const ghost = () => p.evaluate(async () => { const { ghostCam: g } = await import("/src/components/match/GhostCamera.ts"); return { active: g.active, x: g.x, y: g.y, z: g.z }; });
const g0 = await ghost();
check(g0.active, "Fly in turns the ghost camera on");
await shot(p, "6-ghost");
await p.keyboard.down("KeyW"); await sleep(2500); await p.keyboard.up("KeyW");
const g1 = await ghost();
const body1 = await p.evaluate(async () => { const { interiorController: c } = await import("/src/systems/InteriorController.ts"); return [c.state.x, c.state.z]; });
check(Math.hypot(g1.x - g0.x, g1.y - g0.y, g1.z - g0.z) > 0.5, `W flies the camera (${Math.hypot(g1.x - g0.x, g1.y - g0.y, g1.z - g0.z).toFixed(1)} m)`);
check(Math.hypot(body1[0] - body0[0], body1[1] - body0[1]) < 0.05, "the body stays where it stood");
await click("#watch-follow"); await sleep(2500);
check((await view((s) => s.follow)) === 0, "Follow picks the first player");
check(await p.$eval("#watch-follow", (e) => e.textContent.includes("Ana")), "the button names who is followed");
await checkLayout("ghost strip");
await shot(p, "7-follow");
await click("#watch-body"); await sleep(1200);
check(!(await ghost()).active, "Back to my body ends the flight");

// 4. The watched match ends: its result, then the replay
await p.evaluate(() => clearInterval(window.__feed));
await feed({ t: "end", matchId: "m-live", result: { winner: 1, rounds: [1, 0], scores: [2, 0], players: [], ticks: 1200, why: "time" }, roster: SLOTS, awe: 0, again: false });
await sleep(600);
check(await p.$eval(".watch-strip", (e) => e.textContent.includes("Red won")), "the result shows when the watched match ends");
await checkLayout("result strip");
await shot(p, "8-ended");
await click("#watch-replay"); await sleep(2500);
check((await view((s) => s.replay?.id)) === "m-live", "Watch the replay opens it");
check((await match((s) => s.watching)) === null, "opening a replay tunes out");
await sleep(2500);
const t1 = await view((s) => s.tick);
check(t1 > 5, `the replay clock runs (tick ${t1})`);
await checkLayout("replay strip");
await shot(p, "9-replay");
await click("#watch-speed");
check((await view((s) => s.speed)) === 2, "speed button: 2×");
await clickText(".watch-event", "captures"); await sleep(700);
const t2 = await view((s) => s.tick);
check(t2 >= 238 && t2 < 330, `tapping a moment jumps there (tick ${t2})`);
const sc = await p.evaluate(async () => { const m = await import("/src/lib/matchView.ts"); const r = m.useViewStore.getState().replay; return { a: m.replayScoreAt(r, 300).scores, b: m.replayScoreAt(r, 600).scores, held: m.replayFrameAt(r, 200).items.find((i) => i.id === "flag-2")?.heldBy, marks: r.marks.length }; });
check(sc.a.join() === "1,0" && sc.b.join() === "2,1", `scores are rebuilt from the events (${sc.a} then ${sc.b})`);
check(sc.held === 0, "a picked-up flag rides with its carrier in the replay");
await click("#watch-play");
check((await view((s) => s.playing)) === false, "pause");
await p.$eval("#watch-seek", (e) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(e, "450"); e.dispatchEvent(new Event("input", { bubbles: true })); });
await sleep(700);
check((await view((s) => s.tick)) === 450, "the scrub bar seeks");
await shot(p, "10-replay-scrubbed");
await click("#watch-fly"); await sleep(1500);
await click("#watch-follow"); await sleep(1500);
await checkLayout("replay ghost strip");
await shot(p, "11-replay-ghost");
await click("#watch-body");
await click("#watch-replay-close");
check((await view((s) => s.replay)) === null, "Close ends the replay");

// 5. A replay that can't be loaded says so
await click("#watch-chip"); await click("#watch-tab-finished"); await sleep(500);
await p.evaluate(async () => { const m = await import("/src/lib/matchView.ts"); await m.openReplay("m-missing", null); });
await sleep(400);
check((await p.$eval(".watch-error", (e) => e.textContent).catch(() => "")).includes("gone"), "a missing replay shows the server's message");
await click(".watch-close");

// 6. While playing: only NPC bodies, no chip
await feed({ t: "start", matchId: "m-mine", you: { slot: 0, team: 1 }, roster: SLOTS, gameVersion: 1, spawn: [-7, 0, -6], face: [0, 0, -6] });
await feed({ ...snapAt(400), matchId: "m-mine" }); await feed({ ...snapAt(401), matchId: "m-mine" });
await sleep(1500);
check((await p.$("#watch-chip")) === null, "no 👁 chip while you play");
check((await p.$$(".watch-tag")).length === 2, "while playing only the NPCs' bodies are drawn");
await shot(p, "12-playing-npcs");
await feed({ t: "back", to: [0, 0, 15.5] });
await sleep(500);

// 7. From another world: Mine opens the replay as a scoreboard and a mini-map
await p.evaluate(async () => (await import("/src/stores/universeStore.ts")).useUniverseStore.getState().exitWorld(true));
await sleep(3000);
await enterWorld(p, state.other, 7000);
check((await p.$("#watch-chip")) !== null, "the chip is there in another world with a game");
await click("#watch-chip"); await click("#watch-tab-mine"); await sleep(900);
await clickText(".watch-row", "Arena World"); await sleep(3000);
check((await p.$(".watch-map")) !== null, "from another world the replay shows the mini-map");
check((await p.$("#watch-fly")) === null, "no Fly in from another world");
check((await p.$$(".watch-tag")).length === 0, "no bodies are drawn in the wrong world");
const inked = await p.$eval(".watch-map", (c) => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 200) n++; return n; });
check(inked > 100, `the mini-map is drawn (${inked} solid pixels)`);
await checkLayout("mini-map strip");
await shot(p, "13-minimap");

const errors = p.errors.filter((e) => !/ERR_|Failed to load resource|fonts|stripe|google|404/i.test(e));
console.log("page errors:", JSON.stringify(errors.slice(0, 8), null, 1));
check(errors.length === 0, "no page errors");
console.log(fails.length ? `\n${fails.length} FAILED:\n - ${fails.join("\n - ")}` : "\nall view checks passed", `(${VP})`);
await b.close();
process.exit(fails.length ? 1 : 0);
