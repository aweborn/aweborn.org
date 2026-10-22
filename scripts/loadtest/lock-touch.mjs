// Tap-to-lock + contextual ENTER / WARP check (2026-10-22).
// usage: W=390 H=844 OUT=<dir> node scripts/loadtest/lock-touch.mjs [url]   (needs the Vite dev server; Chrome installed)
// Space: no LOCK button; tapping a planet locks it; tapping the target chip switches; tapping a radar
// blip locks it; WARP shows only while locked (gone with nothing in range); ENTER shows only when
// close to a world, and tapping it goes in.
import puppeteer from 'puppeteer-core'

const url = process.argv[2] ?? 'http://localhost:5173/'
const OUT = process.env.OUT ?? '/tmp'
const W = +(process.env.W ?? 390), H = +(process.env.H ?? 844)
const tag = `${W}x${H}`
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
  args: [`--window-size=${W + 40},${H + 120}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const cdp = await page.createCDPSession()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tap = async (x, y) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 7 }] })
  await sleep(60)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(250)
}
const rect = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width ? { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) } : null
}, sel)
const state = () => page.evaluate(() => {
  const vis = (s) => { const el = document.querySelector(s); return el ? (el.classList.contains('touch-btn--off') ? 'off' : getComputedStyle(el).visibility) : 'absent' }
  return {
    target: document.querySelector('#hud-target-chip .hud-target-name')?.textContent?.replace('◇', '').trim() ?? null,
    warp: vis('#touch-btn-warp'),
    enter: vis('#touch-btn-enter'),
    lock: vis('#touch-btn-lock'),
  }
})
const shot = (n) => page.screenshot({ path: `${OUT}/lock-${tag}-${n}.png` })
const r = { tag }

await page.goto(url, { waitUntil: 'domcontentloaded' })
await sleep(6000)
// Import the app's own module instance: after Vite hot updates the app loads
// e.g. /src/systems/WarpSystem.ts?t=123, and a bare import would be a second copy.
await page.evaluate(() => {
  window.__imp = (path) => {
    const hit = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === path).pop()
    return import(hit ?? path)
  }
})
r.start = await state()
await shot('0-start')

// World names + where they are on screen (fresh load: the test's module instances are the app's)
const worlds = await page.evaluate(async () => {
  const { warpSystem } = await window.__imp('/src/systems/WarpSystem.ts')
  const { worldScreenPos } = await window.__imp('/src/systems/tapTargeting.ts')
  return warpSystem.getState().candidates.map((c) => ({ id: c.world.id, name: c.world.name, at: worldScreenPos(c.world.id) }))
})
r.candidates = worlds.map((w) => `${w.name}@${w.at ? `${Math.round(w.at.x)},${Math.round(w.at.y)}` : 'offscreen'}`)

// Tap a planet that isn't the current target (must be on screen, away from the controls)
const pick = worlds.find((w) => w.at && w.name !== r.start.target && w.at.y > 140 && w.at.y < H - 330 && w.at.x > 20 && w.at.x < W - 20)
if (pick) {
  await tap(pick.at.x, pick.at.y)
  r.tapPlanet = { tapped: pick.name, now: (await state()).target }
  await shot('1-tap-planet')
}
// Tap empty sky: the lock stays
await tap(28, H * 0.5)
r.tapSky = (await state()).target

// Tap the chip → next target
const before = (await state()).target
const chip = await rect('#hud-target-chip')
if (chip) {
  await tap((chip.l + chip.r) / 2, (chip.t + chip.b) / 2)
  r.chipSwitch = { before, after: (await state()).target }
  await shot('2-chip')
}

// Radar: tap a blip that isn't the current target
const radar = await rect('#radar')
const hits = await page.evaluate(async () => (await window.__imp('/src/systems/tapTargeting.ts')).radarHits.map((h) => ({ ...h })))
const cur = (await state()).target
const blip = hits.find((h) => worlds.find((w) => w.id === h.id)?.name !== cur)
if (radar && blip) {
  const s = (radar.r - radar.l) / 160
  await tap(radar.l + blip.x * s, radar.t + blip.y * s)
  r.radarTap = { wanted: worlds.find((w) => w.id === blip.id)?.name, now: (await state()).target }
  await shot('3-radar')
}

// Nothing in range → no lock, no WARP
await page.evaluate(async () => {
  const { flightController } = await window.__imp('/src/systems/FlightController.ts')
  flightController.position.set(4000, 900, 4000)
  flightController.velocity.set(0, 0, 0)
})
await sleep(800)
r.farAway = await state()
await shot('4-far')

// Park right next to a world → ENTER appears; tap it → inside
const near = await page.evaluate(async () => {
  const { useUniverseStore } = await window.__imp('/src/stores/universeStore.ts')
  const { flightController } = await window.__imp('/src/systems/FlightController.ts')
  const w = [...useUniverseStore.getState().worlds.values()][0]
  if (!w) return null
  flightController.position.set(w.resolvedPosition.x + 1.5, w.resolvedPosition.y, w.resolvedPosition.z)
  flightController.velocity.set(0, 0, 0)
  return w.name
})
await sleep(800)
r.near = { world: near, ...(await state()) }
await shot('5-near')
const enter = await rect('#touch-btn-enter')
if (enter && r.near.enter !== 'off') {
  await tap((enter.l + enter.r) / 2, (enter.t + enter.b) / 2)
  await sleep(2500)
  r.entered = await page.evaluate(async () => (await window.__imp('/src/stores/universeStore.ts')).useUniverseStore.getState().activeWorldId !== null)
  r.inWorldKick = (await state()).enter
  await shot('6-entered')
}

r.errors = errors
console.log(JSON.stringify(r, null, 1))
await browser.close()
