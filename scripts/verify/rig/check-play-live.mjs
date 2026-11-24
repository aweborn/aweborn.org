// Sandbox rig: the play layer (Phase 10) against the REAL server, one player and NPCs.
// A saved owner saves a race, stands in the ring, starts "Play now with NPCs" from the
// chip's sheet, is placed at a spawn, tries to jump straight into the goal (refused: the
// server checks positions), walks there instead, sees the results and
// goes back to the lobby. check-play.mjs covers the rest of the UI with a fake server.
//   RIG_N=3 scripts/verify/rig/up.sh && RIG_N=3 node scripts/verify/rig/check-play-live.mjs
import { launch, open, sleep, savedPlayer, plantWorld, enterWorld, standAt, walkTo, api, store, RIG_DIR, WEB } from "./browser.mjs";

const VP = process.env.VP ?? "phone";
const shot = (p, name) => p.screenshot({ path: `${RIG_DIR}/live-${VP}-${name}.png` });
let failed = 0;
const ok = (cond, what, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${what}${extra ? `  ${extra}` : ""}`); if (!cond) failed++; };

const GAME = {
  template: "race",
  settings: { teams: 2, players: { min: 2, max: 4 }, rounds: 1, roundSeconds: 120, scoreToWin: 1, traits: { speedMul: 1.25, gravityMul: 1, fly: false }, edge: "soft", edgeSeconds: 8 },
  arena: { at: [0, 0, -6], size: [20, 10, 20] },
  zones: [
    { id: "spawn-1", kind: "spawn", team: 1, at: [-6, 0, 0], size: [4, 3, 4] },
    { id: "spawn-2", kind: "spawn", team: 2, at: [6, 0, 0], size: [4, 3, 4] },
    { id: "goal-1", kind: "goal", at: [0, 0, -13], size: [4, 3, 4] },
  ],
  lobby: { at: [0, 0, 12], size: [12, 6, 12], ring: { at: [0, 0, 11], radius: 2 }, arrival: [0, 0, 15] },
  npcRoster: [{ id: "bolt", name: "Bolt", behavior: "auto", levels: { min: 1, max: 5 } }],
};

const b = await launch();
const p = await open(b, WEB, VP);
await savedPlayer(p);
const w = await plantWorld(p, "Live Play");
ok((await api(p, "/api/player/world/game", { worldId: w, game: GAME })).status === 200, "the game saved");
await enterWorld(p, w);
const match = (fn, ...args) => store(p, "lib/match", "useMatchStore", fn, ...args);
const until = async (what, fn, ms = 25000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) { ok(true, what); return v; } await sleep(300); } ok(false, what, "(timed out)"); return null; };
const text = (sel) => p.$eval(sel, (e) => e.textContent).catch(() => null);
const click = async (sel) => { const el = await p.$(sel); if (!el) { ok(false, `click ${sel}: missing`); return; } await el.evaluate((e) => e.click()); await sleep(250); };
const pos = () => p.evaluate(async () => { const { interiorController: c } = await import("/src/systems/InteriorController.ts"); return { x: c.state.x, y: c.state.y, z: c.state.z, mods: c.mods, hold: c.hold }; });

await until("the server answers hello with the lobby (ready)", () => match((s) => s.lobby?.ready === true));
await standAt(p, 0, 0, 11.5);
await until("standing in the ring puts the player in the pool", () => match((s) => s.lobby?.queued === true));
await until("alone for a few seconds: the sheet offers play now", async () => { if (!(await p.$("#lobby-sheet"))) await click("#lobby-chip"); return Boolean(await p.$("#lobby-play-now")); });
await shot(p, "01-sheet");
await click("#lobby-play-now");
const started = await until("play now starts a match with NPCs", () => match((s) => s.playing && { you: s.playing.you, roster: s.playing.roster.map((x) => `${x.name}:${x.kind}:${x.team}`) }), 30000);
console.log("     roster:", JSON.stringify(started));
ok(started?.roster.some((r) => r.includes(":npc:")), "the roster has an NPC");
await sleep(800);
let at = await pos();
const spawnX = started?.you.team === 1 ? -6 : 6;
ok(Math.abs(at.x - spawnX) < 2.5 && Math.abs(at.z) < 2.5, "the player stands on their team's spawn", JSON.stringify({ x: at.x, z: at.z }));
ok(at.mods?.speedMul === 1.25 && at.mods?.fly === false, "the match's traits apply");
await until("snapshots arrive", () => match((s) => s.snap && s.snap.players.length >= 2));
ok((await match((s) => s.snap.phase)) !== "countdown" || at.hold === true || (await pos()).hold === true, "held still during the countdown");
await shot(p, "02-countdown");
await until("the round starts", () => match((s) => s.snap?.phase === "playing"), 15000);
ok((await pos()).hold === false, "free to move once the round is on");
ok(/^\d:\d\d$/.test(await text(".match-strip-time")), "the strip shows the clock", await text(".match-strip-time"));
await shot(p, "03-playing");
// A teleport to the goal (what a cheating client would send) is refused: no score, and the player is put back
const before = await pos();
await standAt(p, 0, 0, -13);
await until("a jump to the goal is refused: the server puts the player back", async () => { const q = await pos(); return Math.hypot(q.x - before.x, q.z - before.z) < 1.5; }, 8000);
ok((await store(p, "lib/matchPlay", "usePlayStore", (s) => s.toasts.map((t) => t.text))).some((t) => /Moved back/.test(t)), "the player is told (a toast)");
await sleep(1200);
ok((await match((s) => s.ended)) === null, "and it did not score");
await shot(p, "03b-refused");
{
  const rec = (await api(p, `/api/match/record?id=${await match((s) => s.playing.matchId)}`)).data?.record;
  const refused = (rec?.frames ?? []).flatMap((f) => (f.c ?? []).filter((c) => c.type === "reject"));
  ok(refused.length >= 1 && refused[0].why === "speed", "the record holds the refusal", JSON.stringify(refused.slice(0, 2)));
  ok(!(rec?.events ?? []).some((e) => e.type === "goal"), "no goal in the record");
}
// Walking there counts
await walkTo(p, 0, 0, -13);
const ended = await until("reaching the goal ends the race with results", () => match((s) => s.ended && { winner: s.ended.result.winner, awe: s.ended.awe, again: s.ended.again, you: s.ended.you }), 20000);
console.log("     result:", JSON.stringify(ended));
ok(ended?.winner === started?.you.team, "this player's team won");
await sleep(600);
ok(Boolean(await p.$("#match-results")), "the results screen is up", await text("#match-results-title"));
await shot(p, "04-results");
await click("#match-back");
await until("back to the lobby", () => match((s) => s.playing === null && s.ended === null && s.lobby !== null), 15000);
await sleep(500);
at = await pos();
ok(at.mods === null && at.z > 5, "back in the lobby, modifiers cleared", JSON.stringify({ x: at.x, z: at.z }));
ok(Boolean(await p.$("#lobby-chip")), "the chip is back", await text("#lobby-chip"));
const errors = p.errors.filter((e) => !/ERR_|Failed to load resource|fonts|stripe|google|WebSocket/i.test(e));
ok(errors.length === 0, "no page errors", JSON.stringify(errors.slice(0, 6)));
console.log(failed ? `\n${failed} FAILED` : "\nall passed", `(${VP}; screenshots in ${RIG_DIR}/live-${VP}-*.png)`);
await b.close();
process.exit(failed ? 1 : 0);
