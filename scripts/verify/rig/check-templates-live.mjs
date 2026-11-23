// Sandbox rig: one live match of every template with NPC players (Phase 10), and one game
// with two When ▸ If ▸ Do cards. One saved owner alone: Play now with NPCs from the lobby
// sheet, a 60-second round that the clock ends, then the stored record is fetched and
// replayed (verifyRecord must be true).
//
// For each match the script reports what the snapshots carried (items by kind, scores, who
// holds the hill), how far every NPC walked, who scored, and what the HUD said, and takes a
// screenshot mid-round and of the results. An NPC that never moves, a template whose items
// never arrive, or nobody scoring where the template should produce scores is a failure.
//
//   RIG_N=8 scripts/verify/rig/up.sh && RIG_N=8 node scripts/verify/rig/check-templates-live.mjs
//   ONLY=collect,rules …   to run some (race collect capture-the-flag king-of-the-hill survive build-together rules)
// Screenshots: /tmp/rig<N>/tpl-<VP>-<template>-{play,results}.png
import { launch, open, sleep, savedPlayer, plantWorld, enterWorld, RIG_DIR, WEB } from "./browser.mjs";
import { checklist, player, recordOf, verifies, GAMES } from "./match-kit.mjs";

const VP = process.env.VP ?? "phone";
const ONLY = (process.env.ONLY ?? "collect,capture-the-flag,king-of-the-hill,survive,build-together,rules").split(",");
const { ok, until, done } = checklist();
const b = await launch();
const p = await open(b, WEB, VP);
await savedPlayer(p);
const W = await plantWorld(p, "Template Arena");
const H = player(p, "player", W);

/** What each template should show within a minute, and what the human does to help it along. */
const PLAN = {
  "collect": { items: "pickup", scores: true, hud: /RED|BLUE/i, act: async (snap) => { const it = snap.items.find((i) => i.kind === "pickup"); if (it) await H.stand(it.x, it.y, it.z); } },
  "capture-the-flag": { items: "flag", scores: true, hud: /RED|BLUE/i, act: async () => {} },
  "king-of-the-hill": { items: null, scores: true, hud: /RED|BLUE/i, act: async () => {}, late: async () => H.stand(0, 0, -8) },
  "survive": { items: null, scores: false, hud: /\d/, act: async () => {} },
  "build-together": { items: "piece", scores: true, hud: /\d/, act: async () => {} },
  "rules": { items: "pickup", scores: true, hud: /RED|BLUE/i, act: async () => H.stand(0, 0, -13) },
};
/** Collect with a goal zone and two cards: entering Goal gives the entering team a point; 30 seconds from the end an announcement. */
const RULES_GAME = {
  ...GAMES.collect,
  settings: { ...GAMES.collect.settings, scoreToWin: 60 },
  zones: [...GAMES.collect.zones, { id: "goal-1", kind: "goal", at: [0, 0, -13], size: [4, 3, 4] }],
  rules: [
    { id: "r-goal", when: { event: "enter-zone", zone: "goal-1" }, if: [], do: [{ type: "add-score", target: "actor", value: 1 }] },
    { id: "r-late", when: { event: "seconds-left", seconds: 30 }, if: [], do: [{ type: "announce", value: 2 }] },
  ],
};

let entered = false;
for (const name of ONLY) {
  const plan = PLAN[name];
  if (!plan) { ok(false, `unknown template ${name}`); continue; }
  console.log(`\n── ${name} ──`);
  const game = name === "rules" ? RULES_GAME : GAMES[name];
  const saved = await H.api("/api/player/world/game", { worldId: W, game: { ...game, settings: { ...game.settings, roundSeconds: 60, rounds: 1 } } });
  if (!ok(saved.status === 200, `${name}: the game saved`, JSON.stringify(saved.data?.warnings ?? saved.data))) continue;
  if (name === "rules") ok(saved.data.game.rules.length === 2, "both cards were kept", JSON.stringify(saved.data.game.rules.map((r) => r.when)));
  if (!entered) { await enterWorld(p, W); entered = true; }
  await until(`${name}: the lobby runs this version`, () => H.match((s, v) => s.lobby?.ready === true && s.lobby.gameVersion === v, saved.data.game.version), 30000);
  await H.queue();
  await until(`${name}: alone in the ring, the sheet offers Play now with NPCs`, async () => { if (!(await H.has("#lobby-sheet"))) await H.click("#lobby-chip", 2000); return H.has("#lobby-play-now"); }, 25000);
  await H.click("#lobby-play-now");
  const st = await until(`${name}: the match starts`, () => H.match((s) => s.playing && { id: s.playing.matchId, me: s.playing.you, roster: s.playing.roster.map((r) => ({ slot: r.slot, kind: r.kind, team: r.team, name: r.name })) }), 20000);
  if (!st) continue;
  const npcs = st.roster.filter((r) => r.kind === "npc");
  console.log("     roster:", st.roster.map((r) => `${r.name}:${r.kind}:t${r.team}`).join(" "));
  ok(npcs.length >= 1 && new Set(npcs.map((r) => r.name)).size === npcs.length, `${name}: NPCs fill the other slots, each with its own name`);
  await until(`${name}: the round is on`, () => H.match((s) => s.snap?.phase === "playing"), 20000);
  ok(plan.hud.test(await H.text("#match-strip") ?? ""), `${name}: the strip reads right`, await H.text("#match-strip"));

  // Watch the round: sample the snapshot about once a second
  const seen = { kinds: new Set(), maxItems: 0, hill: new Set(), walked: new Map(npcs.map((r) => [r.slot, 0])), last: new Map(), toasts: new Set(), carry: new Set(), warned: false };
  let shotDone = false, acted = false, lated = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 100000) {
    const s = await H.match((s) => s.snap && { phase: s.snap.phase, left: s.snap.left, scores: s.snap.scores, hill: s.snap.hill, items: s.snap.items, players: s.snap.players, ended: Boolean(s.ended) });
    if (!s || s.ended || s.phase === "finished") break;
    for (const i of s.items) seen.kinds.add(i.kind);
    seen.maxItems = Math.max(seen.maxItems, s.items.length);
    if (s.hill) seen.hill.add(s.hill);
    for (const pl of s.players) {
      if (pl.carrying) seen.carry.add(pl.slot);
      const was = seen.last.get(pl.slot);
      if (was && seen.walked.has(pl.slot)) seen.walked.set(pl.slot, seen.walked.get(pl.slot) + Math.hypot(pl.x - was.x, pl.z - was.z));
      seen.last.set(pl.slot, pl);
    }
    for (const t of await p.$$eval(".match-toast", (l) => l.map((e) => e.textContent))) seen.toasts.add(t);
    if (await H.has("#match-warning")) seen.warned = true;
    const secs = (Date.now() - t0) / 1000;
    if (!acted && secs > 6) { acted = true; await plan.act(s); }
    if (plan.late && !lated && secs > 30) { lated = true; await plan.late(s); }
    if (name === "survive" && secs > 14 && secs < 17) await H.stand(0, 0, -10); // into the keep-out for a moment
    if (name === "survive" && secs > 20 && secs < 23) await H.stand(0, 0, -2);
    if (!shotDone && secs > 16) { shotDone = true; await H.shot(`tpl-${VP}-${name}-play`); }
    await sleep(900);
  }
  const end = await until(`${name}: the clock (or the score) ends it`, () => H.match((s) => s.ended && { winner: s.ended.result.winner, scores: s.ended.result.scores, why: s.ended.result.why, players: s.ended.result.players, awe: s.ended.awe }), 40000);
  await sleep(600);
  await H.shot(`tpl-${VP}-${name}-results`);
  const rec = await recordOf(H, st.id);
  const count = {};
  for (const e of rec?.events ?? []) count[e.type] = (count[e.type] ?? 0) + 1;
  console.log("     result:", JSON.stringify(end), "| events:", JSON.stringify(count));
  console.log("     seen: items", [...seen.kinds].join() || "none", `(max ${seen.maxItems})`, "| hill held by", [...seen.hill].join() || "-", "| NPC metres walked", [...seen.walked].map(([s, d]) => `${s}:${d.toFixed(0)}`).join(" "), "| toasts", JSON.stringify([...seen.toasts]));
  ok(await H.has("#match-results"), `${name}: the results screen`, await H.text("#match-results-title"));
  ok((await verifies(H, st.id)) === true, `${name}: the stored record replays to the same result (verifyRecord)`);
  if (plan.items) ok(seen.kinds.has(plan.items), `${name}: ${plan.items}s arrive in the snapshots`);
  ok([...seen.walked.values()].every((d) => d > 3), `${name}: every NPC moves`, [...seen.walked].map(([s, d]) => `${s}:${d.toFixed(1)} m`).join(" "));
  const npcScore = (end?.players ?? []).filter((x) => npcs.some((n) => n.slot === x.slot)).map((x) => x.score);
  if (plan.scores) {
    ok((end?.scores ?? []).some((v) => v > 0), `${name}: at least one score`, JSON.stringify(end?.scores));
    ok(npcScore.some((v) => v > 0), `${name}: an NPC scored`, JSON.stringify(npcScore));
  }
  if (name === "king-of-the-hill") ok(seen.hill.size > 0 && (count.hill ?? 0) > 0, "king-of-the-hill: the hill changes hands in the snapshots");
  if (name === "capture-the-flag") ok(seen.carry.size > 0, "capture-the-flag: someone carried a flag", `captures ${count.capture ?? 0}`);
  if (name === "survive") {
    ok(end?.why === "time" && end.scores[0] >= 1, "survive: time runs out and the survivors score", JSON.stringify(end));
    ok(seen.warned, "survive: stepping into the keep-out shows the warning");
  }
  if (name === "build-together") ok((count.piece ?? 0) > 0, "build-together: pieces are delivered", `pieces ${count.piece ?? 0}`);
  if (name === "rules") {
    const fired = (rec?.events ?? []).filter((e) => e.type === "rule");
    const mine = fired.filter((e) => e.why === "r-goal" && e.slot === st.me.slot);
    ok(mine.length >= 1, "rules: the enter-Goal card fired for the human", JSON.stringify(fired.slice(0, 4)));
    const at = mine[0]?.tick;
    ok((rec?.events ?? []).some((e) => e.type === "score" && e.tick === at && e.team === st.me.team && e.value === 1), "rules: and added a point to their team on that tick");
    ok(fired.some((e) => e.why === "r-late") && (count.announce ?? 0) >= 1, "rules: the 30-seconds-left card fired");
    ok(seen.toasts.has("One minute left!"), "rules: the announcement toast showed", JSON.stringify([...seen.toasts]));
  }
  await H.click("#match-back");
  await until(`${name}: back in the lobby`, () => H.match((s) => s.playing === null && s.ended === null && s.lobby !== null), 30000);
}
ok(H.errors().length === 0, "no page errors", JSON.stringify(H.errors().slice(0, 4)));
const code = done(`(${VP}; screenshots in ${RIG_DIR}/tpl-${VP}-*.png)`);
await b.close();
process.exit(code);
