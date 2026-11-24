// The 18+ door (AdultDoor.tsx + sync-service age-door.ts) against the real server, at four
// screen sizes: a guest can't open it; a saved player sees the switch; the disclosure and
// the date of birth; an under-18 date is refused and held; an adult date opens it; off and
// on again without asking; the birthdate is in no response. Screenshots in /tmp/rig<N>/.
//   node scripts/verify/rig/check-door.mjs
import { launch, open, savedPlayer, session, api, waitFor, sleep, VIEWPORTS, RIG_DIR } from "./browser.mjs";

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const rect = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom } : null; }, sel);
const click = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
async function type(page, sel, value) {
  await page.focus(sel);
  await page.keyboard.type(value);
}
async function openPanel(page) {
  await waitFor(() => page.$("#player-chip, .pa-chip"));
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
    const r = await api(page, "/api/player/door", { show: true, birthdate: "1990-01-01" });
    check(r.status === 403 && r.data.error === "sign_in_required", "the server refuses a guest");
    await ctx.close();
  }

  for (const size of Object.keys(VIEWPORTS)) {
    const ctx = await browser.createBrowserContext();
    const page = await open(browser, undefined, size, ctx);
    await savedPlayer(page);
    const [vw] = VIEWPORTS[size];
    await openPanel(page);
    await waitFor(() => page.evaluate(() => !document.querySelector("#player-door-switch")?.disabled));
    check((await text(page, ".pa-door .pa-hint"))?.startsWith("Off."), `[${size}] starts off`);
    await page.evaluate(() => document.querySelector(".pa-door").scrollIntoView({ block: "center" }));
    const sw = await rect(page, "#player-door-switch");
    check(sw && sw.w >= 44 && sw.h >= 44, `[${size}] the switch is a 44 px target (${sw?.w}×${sw?.h})`);
    await page.screenshot({ path: `${RIG_DIR}/door-${size}-1-off.png` });

    await click(page, "#player-door-switch");
    await waitFor(() => page.$(".pa-door-form"));
    await sleep(400);
    const notes = await text(page, ".pa-door-notes");
    check(/part of Aweborn’s research/.test(notes) && /no separate research form/.test(notes), `[${size}] research is disclosed before the choice`);
    check(/aren’t open yet/.test(notes), `[${size}] says 18+ worlds aren't open yet`);
    check(await page.evaluate(() => document.querySelector("#player-door-confirm").disabled), `[${size}] can't confirm without a date`);
    const sizes = await page.evaluate(() => [...document.querySelectorAll(".pa-door-form .pa-input")].map((el) => parseFloat(getComputedStyle(el).fontSize)));
    check(sizes.length === 3 && sizes.every((s) => s >= 16), `[${size}] date inputs are ≥ 16 px (${sizes})`);
    const noteSize = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".pa-door-notes")).fontSize));
    check(noteSize >= 14, `[${size}] the disclosure is ≥ 14 px (${noteSize})`);
    await page.evaluate(() => document.querySelector(".pa-door-form").scrollIntoView({ block: "center" }));
    const over = await page.evaluate((vw) => [...document.querySelectorAll(".pa-door *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5); }).length, vw);
    check(over === 0 && (await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)), `[${size}] nothing runs off the side`);
    const fields = await page.evaluate(() => [...document.querySelectorAll(".pa-door-field .pa-input")].map((el) => { const r = el.getBoundingClientRect(); return [r.width, r.height]; }));
    check(fields.every(([w, h]) => w >= 44 && h >= 44), `[${size}] date fields are 44 px targets (${fields.map((f) => f.map(Math.round).join("×"))})`);
    await page.screenshot({ path: `${RIG_DIR}/door-${size}-2-ask.png` });

    // An impossible date never leaves the page
    await page.select(".pa-door-field--month select", "2");
    await type(page, ".pa-door-fields label:nth-child(2) input", "30");
    await type(page, ".pa-door-fields label:nth-child(3) input", "1990");
    check(await page.evaluate(() => document.querySelector("#player-door-confirm").disabled), `[${size}] Feb 30 can't be sent`);

    if (size === "phone") {
      // Under 18: refused, held, nothing stored
      await page.evaluate(() => { for (const el of document.querySelectorAll(".pa-door-fields input")) { el.focus(); el.select(); } });
      await page.keyboard.press("Backspace");
      await page.evaluate(() => document.querySelector(".pa-door-fields label:nth-child(2) input").select());
      await page.keyboard.press("Backspace");
      await type(page, ".pa-door-fields label:nth-child(2) input", "15");
      await type(page, ".pa-door-fields label:nth-child(3) input", String(new Date().getFullYear() - 12));
      await click(page, "#player-door-confirm");
      await waitFor(() => page.$(".pa-door .pa-status--error"));
      check(/18 or older/.test(await text(page, ".pa-door .pa-status--error")), "[phone] an under-18 date is refused in plain words");
      check(await page.evaluate(() => document.querySelector("#player-door-switch").disabled), "[phone] the switch rests after a refusal");
      await page.screenshot({ path: `${RIG_DIR}/door-phone-3-refused.png` });
      const again = await api(page, "/api/player/door", { show: true, birthdate: "1990-01-01" });
      check(again.status === 403 && again.data.error === "under_age" && again.data.retryAt > Date.now(), "[phone] a different date straight away is still refused");
      check((await api(page, "/api/player/me")).data.door.show === false, "[phone] the door stays shut");
      await ctx.close();
      continue;
    }

    await page.evaluate(() => document.querySelector(".pa-door-fields label:nth-child(2) input").select());
    await page.keyboard.press("Backspace");
    await type(page, ".pa-door-fields label:nth-child(2) input", "14");
    const sent = [];
    page.on("response", async (res) => { if (res.url().includes("/api/player/")) sent.push(await res.text().catch(() => "")); });
    await click(page, "#player-door-confirm");
    await waitFor(() => page.evaluate(() => document.querySelector("#player-door-switch")?.getAttribute("aria-checked") === "true"));
    check((await text(page, ".pa-door .pa-hint"))?.startsWith("On."), `[${size}] an adult date turns it on`);
    check(!(await page.$(".pa-door-form")), `[${size}] the form closes`);
    const me = (await api(page, "/api/player/me")).data;
    check(me.door.confirmed === true && me.door.show === true, `[${size}] the server agrees`);
    check(!sent.join("").includes("1990") && !JSON.stringify(me).includes("1990-02-14"), `[${size}] no response carries the birthdate`);
    await page.evaluate(() => document.querySelector(".pa-door").scrollIntoView({ block: "center" }));
    await sleep(300);
    await page.screenshot({ path: `${RIG_DIR}/door-${size}-3-on.png` });

    await click(page, "#player-door-switch");
    await waitFor(() => page.evaluate(() => document.querySelector("#player-door-switch")?.getAttribute("aria-checked") === "false"));
    check((await api(page, "/api/player/me")).data.door.show === false, `[${size}] off with one tap`);
    await click(page, "#player-door-switch");
    await waitFor(() => page.evaluate(() => document.querySelector("#player-door-switch")?.getAttribute("aria-checked") === "true"));
    check(!(await page.$(".pa-door-form")) && (await api(page, "/api/player/me")).data.door.show === true, `[${size}] back on without asking for the date again`);
    // It survives a reload
    await page.reload({ waitUntil: "domcontentloaded" });
    await session(page);
    await openPanel(page);
    check(await waitFor(() => page.evaluate(() => document.querySelector("#player-door-switch")?.getAttribute("aria-checked") === "true"), 10000), `[${size}] still on after a reload`);
    check(page.errors.filter((e) => /door|AdultDoor/i.test(e)).length === 0, `[${size}] no page errors from the door`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
