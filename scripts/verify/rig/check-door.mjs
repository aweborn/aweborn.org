// The 18+ door (AdultDoor.tsx + sync-service age-door.ts) against the real server, at four
// screen sizes: a guest can't open it; a saved player sees a toggle with the research note
// beside it; on, off and on again with one tap each; no date of birth is asked anywhere.
// Screenshots in /tmp/rig<N>/.
//   node scripts/verify/rig/check-door.mjs
import { launch, open, savedPlayer, session, api, waitFor, sleep, VIEWPORTS, RIG_DIR } from "./browser.mjs";

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const rect = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { w: r.width, h: r.height } : null; }, sel);
const click = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
const checked = (page, want) => waitFor(() => page.evaluate((w) => document.querySelector("#player-door-switch")?.getAttribute("aria-checked") === w, String(want)), 10000);
async function openPanel(page) {
  await waitFor(() => page.$(".pa-chip"));
  await click(page, ".pa-chip");
  await waitFor(() => page.evaluate(() => document.querySelector(".pa-dialog")?.open === true));
  await sleep(600);
}

const browser = await launch();
try {
  // A guest: no door in the panel, and the server refuses
  {
    const ctx = await browser.createBrowserContext();
    const page = await open(browser, undefined, "phone", ctx);
    await session(page);
    await openPanel(page);
    check(!(await page.$(".pa-door")), "a guest sees no 18+ switch");
    const r = await api(page, "/api/player/door", { show: true });
    check(r.status === 403 && r.data.error === "sign_in_required", "the server refuses a guest");
    check((await api(page, "/api/player/me")).data.door.show === false, "a guest's door reads shut");
    await ctx.close();
  }

  for (const size of Object.keys(VIEWPORTS)) {
    const ctx = await browser.createBrowserContext();
    const page = await open(browser, undefined, size, ctx);
    await savedPlayer(page);
    const [vw] = VIEWPORTS[size];
    await openPanel(page);
    await waitFor(() => page.evaluate(() => document.querySelector("#player-door-switch")?.disabled === false));
    check((await text(page, ".pa-door .pa-hint"))?.startsWith("Off"), `[${size}] starts off`);
    await page.evaluate(() => document.querySelector(".pa-door").scrollIntoView({ block: "center" }));
    const sw = await rect(page, "#player-door-switch");
    check(sw && sw.w >= 44 && sw.h >= 44, `[${size}] the switch is a 44 px target (${sw?.w}×${sw?.h})`);
    const note = await text(page, ".pa-door-note");
    check(/Turning this on also makes how you play in matches part of Aweborn’s research/.test(note), `[${size}] research is said at the switch, before the tap`);
    const noteSize = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".pa-door-note")).fontSize));
    check(noteSize >= 14, `[${size}] the note is ≥ 14 px (${noteSize})`);
    check((await page.$$(".pa-door input, .pa-door select, .pa-door form")).length === 0, `[${size}] no date of birth or any other entry: only the switch`);
    const over = await page.evaluate((vw) => [...document.querySelectorAll(".pa-door *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5); }).length, vw);
    check(over === 0 && (await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)), `[${size}] nothing runs off the side`);
    await page.screenshot({ path: `${RIG_DIR}/door-${size}-1-off.png` });

    await click(page, "#player-door-switch");
    check(await checked(page, true), `[${size}] one tap turns it on`);
    check((await api(page, "/api/player/me")).data.door.show === true, `[${size}] the server agrees`);
    check(/^How you play in matches is part of Aweborn’s research/.test(await text(page, ".pa-door-note")), `[${size}] the note says it is now in effect`);
    await sleep(300);
    await page.screenshot({ path: `${RIG_DIR}/door-${size}-2-on.png` });

    await click(page, "#player-door-switch");
    check((await checked(page, false)) && (await api(page, "/api/player/me")).data.door.show === false, `[${size}] one tap turns it off`);
    await click(page, "#player-door-switch");
    check(await checked(page, true), `[${size}] and on again`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await session(page);
    await openPanel(page);
    check(await checked(page, true), `[${size}] still on after a reload`);
    check(page.errors.filter((e) => /door|AdultDoor/i.test(e)).length === 0, `[${size}] no page errors from the door`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
