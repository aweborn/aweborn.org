// Rig walkthrough for the view layer against the REAL match server (Phase 10): one page
// owns a world and watches from its lobby; a second page (a guest) starts a match with
// NPCs. Checks tuning in, the roster from the live record, the result, and the replay
// rebuilt by the referee.   RIG_N=4 scripts/verify/rig/up.sh && RIG_N=4 node scripts/verify/rig/check-view-live.mjs
import { launch, open, sleep, savedPlayer, session, plantWorld, enterWorld, api, store, standAt, RIG_DIR, WEB } from "./browser.mjs";

const VP = process.env.VP ?? "phone";
const shot = (p, name) => p.screenshot({ path: `${RIG_DIR}/live-${VP}-${name}.png` });
const fails = [];
const check = (ok, what) => { console.log(ok ? "  ok  " : "  FAIL", what); if (!ok) fails.push(what); };
const until = async (what, fn, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(300); } throw new Error(`timed out waiting for ${what}`); };

const GAME = {
  template: "capture-the-flag", settings: { teams: 2, players: { min: 2, max: 4 }, roundSeconds: 240 },
  arena: { at: [0, 0, -6], size: [20, 8, 20] },
  zones: [
    { id: "s1", kind: "spawn", team: 1, at: [-7, 0, -6], size: [4, 3, 4] },
    { id: "s2", kind: "spawn", team: 2, at: [7, 0, -6], size: [4, 3, 4] },
    { id: "g1", kind: "goal", team: 1, at: [-7, 0, -12], size: [3, 3, 3] },
    { id: "g2", kind: "goal", team: 2, at: [7, 0, -12], size: [3, 3, 3] },
  ],
  lobby: { at: [0, 0, 12], size: [10, 5, 10], ring: { at: [3, 0, 13], radius: 1.5 }, arrival: [0, 0, 15.5] },
  npcRoster: [{ id: "bolt", name: "Bolt", behavior: "auto", levels: { min: 1, max: 5 } }, { id: "pip", name: "Pip", behavior: "auto", levels: { min: 1, max: 5 } }],
};

const b = await launch();
const p = await open(b, WEB, VP);
await savedPlayer(p);
const W = await plantWorld(p, "Live Arena");
const saved = await api(p, "/api/player/world/game", { worldId: W, game: GAME });
if (saved.status !== 200) throw new Error("game save failed: " + JSON.stringify(saved.data));
await enterWorld(p, W, 7000);
const send = (page, intent) => page.evaluate(async (w, intent) => (await import("/src/lib/match.ts")).sendMatch(w, intent), W, intent);
const match = (page, fn) => store(page, "lib/match", "useMatchStore", fn);
const view = (fn) => store(p, "lib/matchView", "useViewStore", fn);
const click = async (sel) => { const el = await p.$(sel); if (!el) throw new Error("missing " + sel); await el.click(); await sleep(400); };

// The second player: a guest in their own browser context, who plays with NPCs
const ctx = await b.createBrowserContext();
const g = await open(b, WEB, [390, 600, true], ctx);
await session(g);
await enterWorld(g, W, 7000);
await until("the guest's lobby", async () => { await send(g, { t: "hello" }); await sleep(700); return match(g, (s) => s.lobby?.ready); }, 40000)
  .catch(async (e) => { throw new Error(`${e.message}: ${JSON.stringify({ world: await store(g, "stores/universeStore", "useUniverseStore", (s) => s.activeWorldId), match: await match(g, (s) => ({ lobby: s.lobby, error: s.error })), errors: g.errors.slice(0, 5) })}`); });
await standAt(g, 3, 0, 13); // in the ring
await sleep(1500);
await send(g, { t: "play-now", level: 3 });
const gm = await until("the guest's match", () => match(g, (s) => s.playing && { id: s.playing.matchId, spawn: s.playing.roster.length, err: s.error }), 20000).catch(async (e) => { throw new Error(`${e.message}; error: ${await match(g, (s) => s.error)}`); });
console.log("match", gm.id, "slots", gm.spawn);

// The owner, in the lobby: the chip counts the match, the Live tab lists it, tap to tune in
await until("the lobby list", () => match(p, (s) => s.lobby?.matches.some((m) => !m.endedAt)), 15000);
await sleep(500);
check((await p.$eval("#watch-chip", (e) => e.textContent)).includes("1"), "chip shows 1 running match (real lobby)");
await click("#watch-chip");
await shot(p, "1-live");
await click(".watch-sheet .watch-row");
await until("snaps", () => match(p, (s) => s.snap && s.prevSnap && true), 15000);
await until("the roster", () => match(p, (s) => s.watchRoster?.length), 15000);
const roster = await match(p, (s) => s.watchRoster.map((r) => `${r.name}:${r.kind}:t${r.team}`));
console.log("roster", roster.join(" "));
check(roster.some((r) => r.includes(":npc:")), "the live record gives the roster, NPCs marked");
await sleep(6000);
const snap = await match(p, (s) => ({ phase: s.snap.phase, players: s.snap.players.length, items: s.snap.items.map((i) => i.kind).join(), watching: s.snap.watching, left: s.snap.left }));
console.log("snap", JSON.stringify(snap));
check(snap.players === roster.length && snap.watching === 1, "snaps carry every slot and count us as watching");
check((await p.$$(".watch-tag")).length === roster.length, "a name tag per watched player");
check(snap.items.includes("flag"), "flags arrive as items");
await shot(p, "2-watching");
await click("#watch-fly"); await sleep(1500);
await click("#watch-follow"); await sleep(3000);
await shot(p, "3-ghost-follow");
await click("#watch-body");
// Let it run a little, then the owner ends it: watchers get `end`
await sleep(8000);
await send(p, { t: "host-end", matchId: gm.id });
await until("the end", () => match(p, (s) => s.ended?.matchId), 15000);
await sleep(500);
check((await p.$("#watch-replay")) !== null, "the watched match's result shows with Watch the replay");
await shot(p, "4-ended");
await click("#watch-replay");
await until("the replay", () => view((s) => s.replay?.id), 15000);
await sleep(3000);
const r = await p.evaluate(async () => {
  const m = await import("/src/lib/matchView.ts");
  const rp = m.useViewStore.getState().replay;
  const end = m.replayScoreAt(rp, rp.last);
  const mid = m.replayFrameAt(rp, Math.min(rp.last, 120));
  return { exact: rp.exact !== null, last: rp.last, frames: rp.record.frames.length, end, want: rp.record.result, marks: rp.marks.map((k) => k.label), mid: { players: mid.players.length, items: mid.items.length } };
});
console.log("replay", JSON.stringify({ ...r, marks: r.marks.slice(0, 6) }));
check(r.exact, "the replay is rebuilt by the referee (exact state)");
check(r.end.phase === "finished" && r.end.scores.join() === r.want.scores.join(), `the replay ends on the recorded result (${r.end.scores} = ${r.want.scores})`);
check(r.mid.players === roster.length && r.mid.items >= 2, "players and items are there mid-replay");
check((await view((s) => s.tick)) > 5, "the replay clock runs");
await shot(p, "5-replay");
await click("#watch-replay-close");
await click("#watch-chip"); await click("#watch-tab-finished"); await sleep(1500);
check((await p.$$(".watch-sheet .watch-row")).length === 1, "Finished lists it once (lobby row + server list)");
await shot(p, "6-finished");
const errors = [...p.errors].filter((e) => !/ERR_|Failed to load resource|fonts|stripe|google|404/i.test(e));
console.log("page errors:", JSON.stringify(errors.slice(0, 6), null, 1));
check(errors.length === 0, "no page errors");
console.log(fails.length ? `\n${fails.length} FAILED:\n - ${fails.join("\n - ")}` : "\nall live view checks passed", `(${VP})`);
await b.close();
process.exit(fails.length ? 1 : 0);
