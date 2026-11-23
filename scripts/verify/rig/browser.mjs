// Sandbox rig: a headless Chrome (software WebGL) for scripts that look at the app.
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";

const CHROME = process.env.CHROME ?? ["/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => existsSync(p));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const VIEWPORTS = { phone: [390, 844, true], small: [360, 740, true], landscape: [844, 390, true], desktop: [1440, 900, false] };

export async function launch() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--mute-audio", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
}

/** A page at one of VIEWPORTS (or [w, h, touch]); page.errors collects page errors and console errors. */
export async function open(browser, url = WEB, viewport = "phone", context = null) {
  const [width, height, touch] = Array.isArray(viewport) ? viewport : VIEWPORTS[viewport];
  const page = await (context ?? browser).newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") page.errors.push(m.text()); });
  await stubCdn(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return page;
}

/**
 * The space scene's clouds load one texture from a CDN (drei's cloud.png). The sandbox has
 * no network, the load fails after a while, and the failure takes the whole canvas down
 * (the error boundary rebuilds it, which puts a player inside a world back at its entrance
 * in the middle of a script). Answer that one address with a 1×1 picture instead. Its own
 * CDP session, so scripts that intercept requests themselves are not disturbed.
 */
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
async function stubCdn(page) {
  const cdp = await page.createCDPSession();
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*githack.com*" }] });
  cdp.on("Fetch.requestPaused", (e) => {
    cdp.send("Fetch.fulfillRequest", {
      requestId: e.requestId, responseCode: 200, body: PNG_1X1,
      responseHeaders: [{ name: "Content-Type", value: "image/png" }, { name: "Access-Control-Allow-Origin", value: "*" }],
    }).catch(() => {});
  });
}

const N = Number(process.env.RIG_N ?? 0);
/** This rig copy's addresses (RIG_N picks the copy; see up.sh). */
export const WEB = `http://localhost:${5173 + 10 * N}/`;
export const SYNC = `http://localhost:${1234 + 10 * N}`;
export const RIG_DIR = `/tmp/rig${N}`;
const DB = `${RIG_DIR}/universe.db`;

/** Call the sync-service from the page (with its session cookie). */
export const api = (page, path, body) =>
  page.evaluate(async (url, body) => {
    const res = await fetch(url, { method: body === undefined ? "GET" : "POST", credentials: "include", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: res.status, data: await res.json().catch(() => null) };
  }, SYNC + path, body);

/** Run `fn(store state getter)` against one of the app's zustand stores, e.g. store(page, "universeStore", "useUniverseStore", (s) => s.activeWorldId). */
export const store = (page, file, hook, fn, ...args) =>
  page.evaluate(async (file, hook, fn, args) => {
    const mod = await import(`/src/${file}.ts`);
    return new Function("s", "args", `return (${fn})(s, ...args)`)(mod[hook].getState(), args);
  }, file, hook, fn.toString(), args);

/** Poll `fn` (may be async) until it returns something truthy; null after `ms`. */
export async function waitFor(fn, ms = 30000, every = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    await sleep(every);
  }
  return null;
}

/** Wait until the page's app has its session (a guest is made on first load); returns the playerId. */
export async function session(page, ms = 40000) {
  const id = await waitFor(() => page.evaluate(async () => {
    const m = await import("/src/lib/player.ts");
    const p = m.getPlayerSnapshot();
    return p && !p.isGuest ? p.playerId : null;
  }), ms);
  if (!id) throw new Error("no session after " + ms + " ms");
  return id;
}

let emailN = 0;
/**
 * Make this page's guest a saved player and return its playerId. Every rig script gets
 * its saved players this way: the real sign-in (an e-mail code; the rig's server runs
 * with DEV_FIXED_OTP=123456), so no script opens the server's database. If that fails,
 * falls back to flipping `isAnonymous` in the rig's database.
 */
export async function savedPlayer(page) {
  await session(page);
  const email = `rig-${Date.now()}-${++emailN}@rig.test`;
  const r = await page.evaluate(async (email) => {
    const m = await import("/src/lib/player.ts");
    const sent = await m.sendEmailCode(email);
    return sent.ok ? m.verifyEmailCode(email, "123456") : sent;
  }, email);
  if (!r.ok) {
    console.log("e-mail sign-in failed, flipping the database row instead:", r.message);
    const me = (await api(page, "/api/player/me")).data;
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(DB);
    db.prepare(`UPDATE "user" SET isAnonymous = 0 WHERE playerId = ?`).run(me.playerId);
    db.close();
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  const saved = await waitFor(() => page.evaluate(async () => {
    const p = (await import("/src/lib/player.ts")).getPlayerSnapshot();
    return p && !p.isGuest && !p.isAnonymous ? p.playerId : null;
  }), 40000);
  if (!saved) throw new Error("the player is not saved after signing in");
  await sleep(1500);
  return saved;
}

/** Plant a world as this page's player; returns its id. */
export async function plantWorld(page, name = "Rig World", at = { x: 300, y: 0, z: 300 }) {
  const r = await api(page, "/api/player/world", { name, color: "#336699", position: at });
  if (r.status !== 200) throw new Error(`plant failed: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.world.id;
}

/** Step into a world and wait until it has loaded (then `settle` ms for the scene). */
export async function enterWorld(page, worldId, settle = 2500) {
  await page.evaluate(async (id) => (await import("/src/stores/universeStore.ts")).useUniverseStore.getState().enterWorld(id), worldId);
  const ok = await waitFor(() => page.evaluate(async (id) => {
    const u = (await import("/src/stores/universeStore.ts")).useUniverseStore.getState();
    const w = (await import("/src/stores/worldStore.ts")).useWorldStore.getState();
    return u.activeWorldId === id && w.loaded === true;
  }, worldId), 40000);
  if (!ok) throw new Error(`world ${worldId} did not load`);
  await sleep(Math.min(settle, 2500));
}

/** Where the player stands inside a world / put them somewhere. */
export const standAt = (page, x, y, z) =>
  page.evaluate(async (x, y, z) => {
    const { interiorController: c } = await import("/src/systems/InteriorController.ts");
    c.state = { ...c.state, x, y, z, vx: 0, vy: 0, vz: 0 };
    c.prev = c.state;
  }, x, y, z);
