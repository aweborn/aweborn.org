// 18+ worlds against the real server and app (Phase 07 → "Changed 2026-11-24"):
// made only behind the 18+ door, 18+ for good, veiled for everyone else, and shut on
// every way in. Players: Ada (saved, switch on), Ben (saved, switch off), a guest.
// Screenshots in /tmp/rig<N>/.
//   node scripts/verify/rig/check-adult-worlds.mjs
import { launch, open, savedPlayer, session, api, store, waitFor, sleep, plantWorld, enterWorld, SYNC, VIEWPORTS, RIG_DIR } from "./browser.mjs";

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };
const REAL = "Velvet Rig Hall";
const worldOf = (page, id) => store(page, "stores/universeStore", "useUniverseStore", (s, id) => { const w = s.worlds.get(id); return w ? { name: w.name, color: w.color, tier: w.tier ?? null, music: w.music ?? null, parent: w.parentWorldId ?? null } : null; }, id);
const active = (page) => store(page, "stores/universeStore", "useUniverseStore", (s) => s.activeWorldId);
const universeText = (page) => store(page, "stores/universeStore", "useUniverseStore", (s) => JSON.stringify(s.universeDoc?.getMap("worlds").toJSON() ?? {}));
const tryEnter = (page, id) => page.evaluate(async (id) => (await import("/src/stores/universeStore.ts")).useUniverseStore.getState().enterWorld(id), id);
/** Open a raw socket straight at a world, as a client that ignores the app's own check would. */
const rawJoin = (page, id) => page.evaluate((url) => new Promise((resolve) => {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const got = [];
  ws.onmessage = (e) => got.push(new Uint8Array(e.data)[0]);
  ws.onclose = (e) => resolve({ closed: e.code, got });
  setTimeout(() => { resolve({ closed: null, got }); ws.close(); }, 2500);
}), SYNC.replace(/^http/, "ws") + "/world/" + id);
const get = (path) => fetch(SYNC + path).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

const browser = await launch();
try {
  const adaCtx = await browser.createBrowserContext(), benCtx = await browser.createBrowserContext(), guestCtx = await browser.createBrowserContext();
  const ada = await open(browser, undefined, "phone", adaCtx);
  const ben = await open(browser, undefined, "phone", benCtx);
  const guest = await open(browser, undefined, "phone", guestCtx);
  await savedPlayer(ada); await savedPlayer(ben); await session(guest);
  const at = { x: 420, y: 0, z: 420 };

  // ── Making one ──
  let r = await api(ben, "/api/player/world", { name: REAL, color: "#aa3366", position: at, adult: true });
  check(r.status === 403 && r.data.error === "door_closed", "a player with the switch off can't make an 18+ world");
  r = await api(guest, "/api/player/world", { name: REAL, color: "#aa3366", position: at, adult: true });
  check(r.status === 403, "nor can a guest");
  check((await api(ada, "/api/player/door", { show: true })).data.show === true, "Ada turns 18+ content on");
  await ada.evaluate(async () => (await import("/src/lib/door.ts")).loadDoor());
  r = await api(ada, "/api/player/world", { name: REAL, color: "#aa3366", position: at, adult: true });
  check(r.status === 200 && r.data.world.tier === "adult" && r.data.world.name === REAL, "Ada makes an 18+ world and gets its real name back");
  const adult = r.data.world.id;
  const plain = await plantWorld(ada, "Rig Meadow", { x: 460, y: 0, z: 420 });
  await ada.evaluate(async () => (await import("/src/lib/door.ts")).refreshAdultNames());
  await sleep(1500);

  // ── The veil ──
  const seenByBen = await waitFor(() => worldOf(ben, adult));
  check(seenByBen?.tier === "adult" && seenByBen.name === "18+ world", `Ben sees it veiled: "${seenByBen?.name}"`);
  check(seenByBen?.color === "#8d88a6", "with the veil's colour, not its own");
  check(seenByBen?.music === null, "and no music of its own");
  for (const [who, page] of [["Ben", ben], ["the guest", guest]]) {
    const text = await universeText(page);
    check(text.includes(adult) && !text.includes("Velvet"), `${who}'s copy of the universe holds no trace of the real name`);
  }
  const seenByAda = await waitFor(async () => { const w = await worldOf(ada, adult); return w?.name === REAL ? w : null; }, 8000);
  check(seenByAda?.name === REAL && seenByAda.color === "#aa3366", "Ada sees its real name and colour");
  check((await worldOf(ben, plain))?.tier === null, "an ordinary world has no tier");
  let pub = await get(`/worlds/${adult}`);
  check(pub.status === 200 && pub.data.name === "18+ world" && pub.data.tier === "adult", "the public world lookup says 18+ and gives no name");
  check((await api(ben, "/api/player/adult-worlds")).data.names[adult] === undefined, "the names list is empty for Ben");
  check((await api(ada, "/api/player/adult-worlds")).data.names[adult] === REAL, "and has the name for Ada");

  // ── Every way in is shut ──
  await tryEnter(ben, adult);
  await sleep(800);
  check((await active(ben)) === null, "Ben can't step in through the app");
  check(/18\+ world/.test(await ben.evaluate(() => document.body.innerText)), "and is told why");
  await ben.screenshot({ path: `${RIG_DIR}/adult-ben-refused.png` });
  let raw = await rawJoin(ben, adult);
  check(raw.closed === 4004 && !raw.got.includes(0x03), `a raw socket from Ben gets no world (closed ${raw.closed}, messages ${raw.got})`);
  raw = await rawJoin(guest, adult);
  check(raw.closed === 4004 && !raw.got.includes(0x03), "nor from a guest");
  raw = await rawJoin(ada, adult);
  check(raw.got.includes(0x03), "Ada's socket gets the world");
  for (const [path, body] of [
    ["/api/match/world?worldId=" + adult, undefined],
    ["/api/player/plan?worldId=" + adult, undefined],
    ["/api/player/making-of?worldId=" + adult, undefined],
    ["/api/player/world/build-request?worldId=" + adult, undefined],
    ["/api/player/world", { name: "Sneak", color: "#112233", position: { x: 0, y: 0, z: 0 }, parentWorldId: adult }],
    ["/api/player/create", { worldId: adult, kind: "model", prompt: "a chair" }],
    ["/api/player/lore", { worldId: adult, prompt: "a sign" }],
    ["/api/player/world/build-request", { worldId: adult }],
    ["/api/player/world-index/arrived", { worldId: adult }],
    ["/api/player/world/game", { worldId: adult, game: null }],
  ]) {
    const res = await api(ben, path, body);
    check(res.status === 403 && res.data?.error === "adult_world", `Ben: ${body ? "POST" : "GET"} ${path.split("?")[0]} → ${res.status} ${res.data?.error}`);
  }
  check((await api(guest, "/api/match/world?worldId=" + adult)).status === 403, "the guest is refused the same way");
  check((await api(ben, "/api/match/world?worldId=" + plain)).status === 200, "ordinary worlds still answer Ben");
  check((await api(ada, "/api/match/world?worldId=" + adult)).status === 200, "and the 18+ world answers Ada");
  pub = await get("/making-of?worldId=" + adult);
  check(pub.status === 403, "the public story stone refuses an 18+ world");
  check((await api(ada, "/api/player/making-of?worldId=" + adult)).status === 200, "Ada reads it through the door");

  // ── Inside ──
  await enterWorld(ada, adult);
  check((await active(ada)) === adult, "Ada steps in");
  check((await store(ada, "stores/worldStore", "useWorldStore", (s) => s.meta?.name)) === REAL, "inside, the world carries its real name");
  r = await api(ada, "/api/player/world", { name: "Inner Room", color: "#334455", position: { x: 5, y: 0, z: 5 }, parentWorldId: adult });
  check(r.status === 200 && r.data.world.tier === "adult", "a world planted inside it is 18+ without asking");
  const child = r.data.world.id;
  check((await waitFor(() => worldOf(ben, child)))?.name === "18+ world", "and is veiled for Ben too");
  r = await api(ada, "/api/player/cards/checkout", { worldId: adult, quantity: 1, arrival: "inside" });
  check(r.status === 403 && r.data.error === "adult_world", "no cards from an 18+ world, even for Ada");
  r = await api(ada, "/api/player/game-library", { worldId: adult, name: "A Game" });
  check(r.status === 403 && r.data.error === "adult_world", "its game doesn't go to the public Library");
  r = await api(ada, "/api/player/mind/save", { worldId: adult, objectId: "x" });
  check(r.status === 403 && r.data.error === "adult_world", "nor its minds");

  // ── The plant sheet, four sizes ──
  await ada.evaluate(async () => (await import("/src/stores/universeStore.ts")).useUniverseStore.getState().exitWorld(true));
  await sleep(800);
  for (const size of Object.keys(VIEWPORTS)) {
    const [w] = VIEWPORTS[size];
    const page = await open(browser, undefined, size, adaCtx); // Ada again, on a screen of this size
    await session(page);
    await waitFor(() => page.evaluate(async () => (await import("/src/lib/door.ts")).getDoorSnapshot().show), 10000);
    await sleep(3000); // let the page finish arriving (restoring where Ada was closes any open sheet)
    await page.evaluate(async () => (await import("/src/stores/universeStore.ts")).useUniverseStore.getState().exitWorld(true));
    await sleep(500);
    await page.evaluate(async () => (await import("/src/stores/sheetStore.ts")).useSheetStore.getState().setSheet("plant", true));
    await sleep(700);
    const sw = await waitFor(() => page.evaluate(() => { const el = document.querySelector("#plant-adult"); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, on: el.getAttribute("aria-checked"), right: r.right }; }), 8000);
    check(sw && sw.w >= 44 && sw.h >= 44 && sw.on === "false" && sw.right <= w, `[${size}] the plant sheet has an 18+ switch, off by default (${sw?.w}×${sw?.h})`);
    const note = await page.evaluate(() => document.querySelector("#plant-adult-note")?.textContent ?? "");
    check(/can’t be changed later/.test(note), `[${size}] it says the choice is for good`);
    const noteSize = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("#plant-adult-note")).fontSize));
    check(noteSize >= 14, `[${size}] in type of at least 14 px (${noteSize})`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `[${size}] nothing runs off the side`);
    await page.evaluate(() => document.querySelector("#plant-adult").click());
    await sleep(250);
    check(await page.evaluate(() => document.querySelector("#plant-adult").getAttribute("aria-checked") === "true"), `[${size}] one tap turns it on`);
    await page.screenshot({ path: `${RIG_DIR}/adult-plant-${size}.png` });
    await page.close();
  }
  await ben.evaluate(async () => (await import("/src/stores/sheetStore.ts")).useSheetStore.getState().setSheet("plant", true));
  await waitFor(() => ben.$("#plant-name"));
  check(!(await ben.$("#plant-adult")), "Ben's plant sheet has no 18+ switch");
  await ben.evaluate(async () => (await import("/src/stores/sheetStore.ts")).useSheetStore.getState().close());

  // ── Turning the switch off shuts it at once ──
  await enterWorld(ada, adult);
  await ada.evaluate(async () => (await import("/src/lib/door.ts")).setDoor(false));
  check(await waitFor(async () => (await active(ada)) === null, 8000), "Ada turns the switch off inside the world and is outside at once");
  const after = await worldOf(ada, adult);
  check(after?.name === "18+ world" && after.color === "#8d88a6", "and it is veiled for her again");
  raw = await rawJoin(ada, adult);
  check(raw.closed === 4004 && !raw.got.includes(0x03), "her socket can't go back in");
  check((await api(ada, "/api/match/world?worldId=" + adult)).status === 403, "nor her requests");
  check(Object.keys((await api(ada, "/api/player/adult-worlds")).data.names).length === 0, "and the names are gone");
  r = await api(ada, "/api/player/world", { name: "Later", color: "#334455", position: { x: 500, y: 0, z: 500 }, adult: true });
  check(r.status === 403 && r.data.error === "door_closed", "she can't make another until it is on again");
  for (const [who, page] of [["Ada", ada], ["Ben", ben]]) check(page.errors.filter((e) => /door|adult|tier/i.test(e)).length === 0, `no page errors for ${who}`);
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
