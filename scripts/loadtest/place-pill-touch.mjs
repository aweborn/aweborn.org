// Top-right Place · Mana pill + 0.6 s hold-to-leave check (2026-10-22).
// usage: W=390 H=844 OUT=<dir> node scripts/loadtest/place-pill-touch.mjs [url]   (needs Vite dev server; Chrome installed)
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
const hold = async (x, y, ms) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 9 }] })
  await sleep(ms)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(250)
}
const rect = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width ? { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) } : null
}, sel)
const overlap = (a, b) => !!(a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b)
const shot = (n) => page.screenshot({ path: `${OUT}/place-${tag}-${n}.png` })
const r = { tag }

await page.goto(url, { waitUntil: 'domcontentloaded' })
await sleep(6000)
await page.evaluate(() => {
  window.__imp = (path) => {
    const hit = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === path).pop()
    return import(hit ?? path)
  }
})

// ── Space: top-right Place · Mana pill, no overlaps even with longest target name ──
await page.evaluate(async () => {
  const { warpSystem } = await window.__imp('/src/systems/WarpSystem.ts')
  const moss = warpSystem.getState().candidates.find((c) => c.world.name.includes('Moss'))
  if (moss) warpSystem.lockOnto(moss.world.id)
})
await sleep(300)
r.hudModeDisplay = await page.evaluate(() => {
  const el = document.querySelector('.hud-mode')
  return el ? getComputedStyle(el).display : 'absent'
})
r.exitBtn = await rect('#touch-btn-exit')
r.pill = await rect('#mana-pill')
r.brand = await rect('.hud-brand')
r.radar = await rect('#radar')
r.target = await rect('#hud-target-chip')
r.placeSpace = await page.evaluate(() => document.querySelector('#mana-pill-place-name')?.textContent?.trim() ?? null)
r.overlapsSpace = {
  pillVsBrand: overlap(r.pill, r.brand),
  pillVsTarget: overlap(r.pill, r.target),
  targetVsRadar: overlap(r.target, r.radar),
  brandVsRadar: overlap(r.brand, r.radar),
}
await shot('0-space')

// Tap as guest → opens account dialog
await hold((r.pill.l + r.pill.r) / 2, (r.pill.t + r.pill.b) / 2, 60)
await sleep(300)
r.guestTapDialog = await page.evaluate(() => !!document.querySelector('#player-account-dialog')?.open)
await page.evaluate(() => document.querySelector('#player-account-dialog')?.close())
await sleep(200)

// Signed-in state → tap opens #mana-panel, close button closes it
await page.evaluate(async () => {
  const { useManaTracker } = await window.__imp('/src/stores/manaTrackerStore.ts')
  const mockStatus = {
    guest: false, cap: 250, spent: 10, held: 0, remaining: 240,
    flow: 1666, flowSpent: 10, activePlayers: 1,
    pool: { pool: 100000, creative: 50000, highWater: 100000 },
    week: { plan: { count: 2, average: 18 }, model: { count: 3, average: 15 } },
    recent: [],
  }
  const origFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    if (String(input).includes('/api/player/mana')) {
      return Promise.resolve(new Response(JSON.stringify(mockStatus), { status: 200, headers: { 'content-type': 'application/json' } }))
    }
    return origFetch(input, init)
  }
  useManaTracker.setState({ status: mockStatus })
})
await sleep(200)
const pillSigned = await rect('#mana-pill')
await hold((pillSigned.l + pillSigned.r) / 2, (pillSigned.t + pillSigned.b) / 2, 60)
await sleep(300)
r.manaPanel = await rect('#mana-panel')
await shot('1-mana-panel')
await page.evaluate(() => document.querySelector('#mana-panel-close')?.click())
await sleep(200)

// ── Enter a world: pill shows world name + "hold to leave", no ✕ EXIT button ──
await page.evaluate(async () => {
  const { useUniverseStore } = await window.__imp('/src/stores/universeStore.ts')
  const s = useUniverseStore.getState()
  const w = [...s.worlds.values()].find((x) => x.name === 'Lost') ?? [...s.worlds.values()][0]
  if (w) s.enterWorld(w.id)
})
await sleep(4500)
// Dismiss card reveal if shown so we can see the top bar clearly
await page.evaluate(() => document.querySelector('.card-reveal-backdrop')?.click())
await sleep(400)
r.pillWorld = await rect('#mana-pill')
r.placeWorld = await page.evaluate(() => ({
  name: document.querySelector('#mana-pill-place-name')?.textContent?.trim() ?? null,
  sub: document.querySelector('.mana-pill-leave-sub')?.textContent?.trim() ?? null,
  exitBtn: !!document.querySelector('#touch-btn-exit'),
}))
await shot('2-in-world')

// Aborted hold (320 ms < 600 ms): stays in world, does NOT open #mana-panel
await hold((r.pillWorld.l + r.pillWorld.r) / 2, (r.pillWorld.t + r.pillWorld.b) / 2, 320)
r.afterShortHold = await page.evaluate(async () => {
  const { useUniverseStore } = await window.__imp('/src/stores/universeStore.ts')
  return {
    inWorld: useUniverseStore.getState().activeWorldId !== null,
    panelOpen: !!document.querySelector('#mana-panel'),
  }
})

// Full hold (720 ms >= 600 ms): leaves world back to space
await hold((r.pillWorld.l + r.pillWorld.r) / 2, (r.pillWorld.t + r.pillWorld.b) / 2, 720)
await sleep(500)
r.afterFullHold = await page.evaluate(async () => {
  const { useUniverseStore } = await window.__imp('/src/stores/universeStore.ts')
  return {
    inWorld: useUniverseStore.getState().activeWorldId !== null,
    place: document.querySelector('#mana-pill-place-name')?.textContent?.trim() ?? null,
    panelOpen: !!document.querySelector('#mana-panel'),
  }
})
await shot('3-left-world')

r.errors = errors
console.log(JSON.stringify(r, null, 1))
await browser.close()
