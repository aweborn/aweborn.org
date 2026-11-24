// The 🎯 Game tab's sections (Phase 10, slices 6–7): sub-tabs, the NPC roster, the
// When ▸ If ▸ Do cards, a save that comes back intact after a reload, and the Library
// (its routes answered here by request interception, so this runs without them).
//   RIG_N=5 node scripts/verify/rig/check-game-setup.mjs        (phone build, then every viewport)
import { launch, open, sleep, savedPlayer, session, plantWorld, enterWorld, standAt, store, RIG_DIR, WEB } from "./browser.mjs";
const OUT = RIG_DIR;
let failed = 0;
const check = (what, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${extra ? " — " + extra : ""}`); if (!ok) failed++; };
const b = await launch();
const p = await open(b, WEB, "phone");
const me = await savedPlayer(p);
const w = await plantWorld(p, "Setup Test");

const click = async (p, sel) => { const el = await p.$(sel); if (!el) throw new Error("missing " + sel); await el.evaluate((e) => e.scrollIntoView({ block: "center", inline: "center" })); await el.click(); await sleep(120); };
const sub = (p, name) => click(p, `#game-sub-${name}`);
const draft = (p) => store(p, "lib/game", "useGameDraftStore", (s) => s.draft);
const openGame = async (p) => { await enterWorld(p, w); await store(p, "stores/sheetStore", "useSheetStore", (s) => s.setSheet("game", true)); await sleep(800); };
/** Wait (Chrome is slow here) until `fn` in the page is truthy. */
const until = (p, fn, ...args) => p.waitForFunction(fn, { timeout: 8000, polling: 100 }, ...args).then(() => true, () => false);
const text = (p, sel) => p.$eval(sel, (e) => e.textContent).catch(() => "");
const shot = (p, name) => p.screenshot({ path: `${OUT}/setup-${name}.png` });
/** Nothing in the panel may be wider than the panel, or narrower than a thumb. */
const fits = async (p, where) => {
  const r = await p.evaluate(() => {
    const panel = document.getElementById("game-panel").getBoundingClientRect();
    const wide = [], small = [];
    for (const el of document.querySelectorAll("#game-panel button, #game-panel select, #game-panel input")) {
      const q = el.getBoundingClientRect();
      if (!q.width) continue;
      const scroller = el.closest(".game-subtabs, .make-tabs");
      if (!scroller && (q.left < panel.left - 0.5 || q.right > panel.right + 0.5)) wide.push(el.id || el.className);
      const h = el.type === "checkbox" ? el.closest("label").getBoundingClientRect().height : q.height;
      if (document.documentElement.classList.contains("touch-ui") && (h < 43.5 || (el.type !== "checkbox" && q.width < 43.5))) small.push(el.id || el.className);
    }
    const body = document.querySelector(".game-body");
    return { wide, small, sideways: body ? body.scrollWidth - body.clientWidth : 0, bodyH: body ? Math.round(body.clientHeight) : 0 };
  });
  check(`${where}: nothing clipped, targets ≥ 44`, !r.wide.length && !r.small.length && r.sideways <= 1, JSON.stringify(r));
};

// ── Phone: build a game with NPCs and two cards ─────────────────────────
await openGame(p);
check("opens on the Game section", await p.$("#game-template-race") !== null);
check("checklist chip counts what is missing", /to do/.test(await p.$eval("#game-checklist", (e) => e.textContent)));
await shot(p, "phone-1-game"); await fits(p, "phone game");

await sub(p, "places");
await standAt(p, 0, 0, -8); await click(p, "#game-arena-mark");
for (let i = 0; i < 5; i++) { await click(p, "#game-arena-w-less"); await click(p, "#game-arena-d-less"); }
await standAt(p, -6, 0, -8); await click(p, "#game-zone-add-spawn-1");
await standAt(p, 6, 0, -8); await click(p, "#game-zone-add-spawn-2");
await click(p, "#game-zone-kind-goal"); await standAt(p, 0, 0, -14); await click(p, "#game-zone-add-goal");
await standAt(p, 0, 0, 12); await click(p, "#game-lobby-mark");
await shot(p, "phone-2-places"); await fits(p, "phone places");
check("checklist chip says ready", /Ready/.test(await p.$eval("#game-checklist", (e) => e.textContent)));

await sub(p, "rules"); await click(p, "#game-rounds-more");
await shot(p, "phone-3-rules"); await fits(p, "phone rules");

await sub(p, "npcs");
await click(p, "#game-npc-add"); await click(p, "#game-npc-add");
await p.select("#game-npc-behavior-npc-2", "guard"); await sleep(120);
await p.select("#game-npc-name-npc-2", "Nova"); await sleep(120);
await click(p, "#game-npc-min-npc-2-more"); await click(p, "#game-npc-max-npc-1-less");
await click(p, "#game-npc-host");
await shot(p, "phone-4-npcs"); await fits(p, "phone npcs");
let d = await draft(p);
check("roster: two NPCs, names from the list and not repeated", d.npcRoster.length === 2 && d.npcRoster[0].name === "Bolt" && d.npcRoster[1].name === "Nova" && d.npcRoster[1].behavior === "guard" && d.npcRoster[1].levels.min === 2 && d.npcRoster[0].levels.max === 4, JSON.stringify(d.npcRoster));
check("policy: host switched off", d.npc.host === false && d.npc.fill === true);
check("a used name is not offered to another NPC", !(await p.$$eval("#game-npc-name-npc-1 option", (o) => o.map((e) => e.value))).includes("Nova"));

await sub(p, "cards");
await click(p, "#game-card-add");
await click(p, "#game-card-rule-1-if-add");
await click(p, "#game-card-rule-1-if-0-right-more");
await shot(p, "phone-5-card-open"); await fits(p, "phone card open");
await p.$eval(".game-body", (e) => e.scrollTo(0, e.scrollHeight)); await sleep(150);
await shot(p, "phone-5b-card-open-bottom");
const s1 = await p.$eval("#game-card-rule-1 .game-card-sentence", (e) => e.textContent);
check("card 1 reads as a sentence", s1 === "When a player enters Goal ▸ if their score ≥ 2 ▸ add 1 point to their team", s1);
await click(p, "#game-card-edit-rule-1");
await click(p, "#game-card-add");
await p.select("#game-card-rule-2-event", "seconds-left"); await sleep(120);
await click(p, "#game-card-rule-2-seconds-more"); // 30 → 35
await p.select("#game-card-rule-2-do-0-type", "announce"); await sleep(120);
await p.select("#game-card-rule-2-do-0-say", "2"); await sleep(120);
await click(p, "#game-card-rule-2-do-add");
await p.select("#game-card-rule-2-do-1-type", "add-var"); await sleep(120);
await click(p, "#game-card-rule-2-do-1-name-var-b");
await shot(p, "phone-6-card-2-open"); await fits(p, "phone card 2 open");
await click(p, "#game-card-edit-rule-2");
await click(p, "#game-card-up-rule-2");
await shot(p, "phone-7-cards"); await fits(p, "phone cards");
d = await draft(p);
const s2 = await p.$eval("#game-card-rule-2 .game-card-sentence", (e) => e.textContent);
check("card 2 reads as a sentence", s2 === "When 35 seconds are left ▸ announce “One minute left!”, then add 1 to counter B", s2);
check("cards reorder", d.rules.map((r) => r.id).join() === "rule-2,rule-1");
check("no free text in Cards or NPCs", (await p.$$("#game-panel .game-body input:not([type=checkbox]), #game-panel textarea")).length === 0);

await click(p, "#game-save"); await sleep(1500);
const status = await p.$eval(".game-status", (e) => e.textContent);
check("saved", /saved$/.test(status), status);
const before = await draft(p);
const metaGame = await store(p, "stores/worldStore", "useWorldStore", (s) => s.meta?.game);
check("the server stored the NPCs and cards", JSON.stringify(metaGame?.npcRoster) === JSON.stringify(before.npcRoster) && JSON.stringify(metaGame?.rules) === JSON.stringify(before.rules) && metaGame?.npc.host === false);

// ── Reload at every size: the game comes back intact; the Library with fake data ──
const fake = [
  { id: "lib-1", name: "Goal Rush", version: 3, template: "race", by: me, byName: "Me", credits: [], updatedAt: Date.now(), mine: true },
  { id: "lib-2", name: "Capture the Lighthouse with a very long name!", version: 12, template: "capture-the-flag", by: "p-other", byName: "Wren", credits: [], updatedAt: Date.now(), mine: false },
  { id: "lib-3", name: "Hill Kings", version: 1, template: "king-of-the-hill", by: "p-other-2", byName: "Ossian of the Long Name", credits: [], updatedAt: Date.now(), mine: false },
];
const posts = [];
const intercept = async (page) => {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (!url.includes("/api/player/game-library")) return req.continue();
    const headers = { "Access-Control-Allow-Origin": WEB.replace(/\/$/, ""), "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "content-type" };
    const json = (status, body) => req.respond({ status, headers, contentType: "application/json", body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return req.respond({ status: 204, headers });
    if (req.method() === "GET") return json(200, { games: fake });
    const body = JSON.parse(req.postData() ?? "{}");
    posts.push({ url: url.replace(/^.*\/api/, "/api"), body });
    if (url.endsWith("/bring")) {
      const lib = fake.find((x) => x.id === body.libraryId);
      return json(200, { game: { ...before, version: before.version + 1, arena: { ...before.arena, at: body.at }, credits: [{ libraryId: "lib-0", version: 2, by: "Juniper", name: "First Dash" }, { libraryId: lib.id, version: lib.version, by: lib.by, name: lib.name }] } });
    }
    if (/bad/i.test(body.name)) return json(400, { error: "bad_name", message: "Pick a different name for this game." });
    return json(200, { game: { ...fake[0], name: body.name, version: 4 } });
  });
};

for (const vp of ["phone", "small", "landscape", "desktop"]) {
  const q = vp === "phone" ? p : await open(b, WEB, vp);
  if (vp === "phone") await p.reload({ waitUntil: "domcontentloaded" });
  await intercept(q);
  await session(q);
  await openGame(q);
  const after = await draft(q);
  check(`${vp}: the saved game came back intact after a reload`, JSON.stringify(after) === JSON.stringify(before));
  for (const name of ["game", "places", "rules", "npcs", "cards"]) {
    await sub(q, name);
    if (name === "cards") await click(q, "#game-card-edit-rule-1");
    await sleep(150);
    await shot(q, `${vp}-tab-${name}`); await fits(q, `${vp} ${name}`);
  }
  await sub(q, "library"); await until(q, () => document.getElementById("game-lib-list"));
  check(`${vp}: Mine lists my games`, (await q.$$eval("#game-lib-list .game-lib-name", (l) => l.map((e) => e.textContent))).join() === "Goal Rush");
  check(`${vp}: the name field is 16 px`, (await q.$eval("#game-lib-name", (e) => getComputedStyle(e).fontSize)) === "16px");
  check(`${vp}: can't save to the Library without a name`, await q.$eval("#game-lib-save", (e) => e.disabled));
  await q.type("#game-lib-name", "bad"); await click(q, "#game-lib-save"); await until(q, () => document.getElementById("game-lib-error"));
  check(`${vp}: the server's message shows`, (await text(q, "#game-lib-error")) === "Pick a different name for this game.");
  await shot(q, `${vp}-lib-1-mine`); await fits(q, `${vp} library mine`);
  await q.$eval("#game-lib-name", (e) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(e, "Goal Rush"); e.dispatchEvent(new Event("input", { bubbles: true })); });
  await sleep(200); await click(q, "#game-lib-save"); await until(q, () => document.getElementById("game-lib-done"));
  check(`${vp}: saved to the Library`, /Goal Rush.*v4/.test(await text(q, "#game-lib-done")));
  await click(q, "#game-lib-all"); await sleep(200);
  check(`${vp}: Everyone's lists the others`, (await q.$$("#game-lib-list .game-card")).length === 2);
  await click(q, "#game-lib-bring-lib-2");
  check(`${vp}: Bring asks first`, (await q.$eval("#game-lib-bring-lib-2", (e) => e.textContent)) === "Replaces this world’s game" && !posts.some((x) => x.url.endsWith("/bring")));
  await shot(q, `${vp}-lib-2-everyone`); await fits(q, `${vp} library everyone`);
  await standAt(q, 4, 0, -6);
  // The same rule as marking the arena: where you stand, half-metre steps, one metre down to the floor
  const at = await q.evaluate(async () => { const s = (await import("/src/systems/InteriorController.ts")).interiorController.state; const r = (v) => Math.round(v * 2) / 2; return [r(s.x), r(s.y - 1), r(s.z)]; });
  // The screenshot above may have outlasted the "sure?" (3.5 s): let it lapse, then tap twice
  await until(q, () => document.getElementById("game-lib-bring-lib-2").textContent === "Bring here");
  await click(q, "#game-lib-bring-lib-2"); await click(q, "#game-lib-bring-lib-2"); await until(q, () => document.getElementById("game-credits"));
  const bring = posts.find((x) => x.url.endsWith("/bring"));
  check(`${vp}: Bring posts where you stand`, JSON.stringify(bring?.body) === JSON.stringify({ worldId: w, libraryId: "lib-2", at }), JSON.stringify(bring?.body));
  const brought = await draft(q);
  check(`${vp}: the draft is the game that came back`, brought.credits.length === 2 && brought.arena.at.join() === at.join() && !(await store(q, "lib/game", "useGameDraftStore", (s) => s.dirty)), JSON.stringify(brought.arena));
  await q.$eval(".game-body", (e) => e.scrollTo(0, 0));
  const credit = await text(q, "#game-credits");
  check(`${vp}: the credit chain shows`, credit === "Based on Capture the Lighthouse with a very long name! v12 by Wrenwhich was based on First Dash v2 by Juniper", credit);
  await shot(q, `${vp}-lib-3-credit`); await fits(q, `${vp} library credit`);
  posts.length = 0;
  if (vp === "phone") {
    // The outlines still read (owner only): close the sheet and look at the stage
    await store(q, "stores/sheetStore", "useSheetStore", (s) => s.close());
    await standAt(q, 0, 1, 16); await sleep(1500);
    await shot(q, "phone-outlines");
  }
  const errs = q.errors.filter((e) => !/ERR_|Failed to load resource|fonts|stripe|google/i.test(e));
  check(`${vp}: no page errors`, errs.length === 0, JSON.stringify(errs.slice(0, 5)));
  if (q !== p) await q.close();
}
await b.close();
console.log(failed ? `${failed} FAILED` : "all ok");
process.exit(failed ? 1 : 0);
