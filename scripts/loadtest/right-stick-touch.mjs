// Right joystick (LOOK, world interior only) + surrounding action arc check (2026-10-22).
// usage: W=390 H=844 OUT=<dir> node scripts/loadtest/right-stick-touch.mjs [url]
import puppeteer from 'puppeteer-core'

const url = process.argv[2] ?? 'http://localhost:5173/'
const OUT = process.env.OUT ?? '/tmp'
const W = +(process.env.W ?? 390), H = +(process.env.H ?? 844)
const DESKTOP = process.env.DESKTOP === '1'
const tag = DESKTOP ? `desktop-${W}x${H}` : `${W}x${H}`
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
  args: [`--window-size=${W + 40},${H + 120}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 2, isMobile: !DESKTOP, hasTouch: !DESKTOP },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const cdp = await page.createCDPSession()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) })
const rect = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width ? { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) } : null
}, sel)
const overlap = (a, b) => !!(a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b)
const shot = (n) => page.screenshot({ path: `${OUT}/right-stick-${tag}-${n}.png` })
const r = { tag }

await page.goto(url, { waitUntil: 'domcontentloaded' })
await sleep(5500)
await page.evaluate(() => {
  window.__imp = (path) => {
    const hit = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === path).pop()
    return import(hit ?? path)
  }
})

if (DESKTOP) {
  r.touchUi = await page.evaluate(() => document.documentElement.classList.contains('touch-ui'))
  r.stickLeft = await rect('#touch-stick-left')
  r.stickRight = await rect('#touch-stick-right')
  await shot('0-desktop')
  r.errors = errors
  console.log(JSON.stringify(r, null, 1))
  await browser.close()
  process.exit(0)
}

// ── Space: left STEER stick + THRUST cluster, NO right stick ──
r.leftStickSpace = await rect('#touch-stick-left')
r.rightStickSpace = await rect('#touch-stick-right')
r.thrust = await rect('#touch-btn-thrust')
r.mode = await rect('#touch-btn-mode')
r.dock = await rect('.touch-dock')
await shot('0-space')

// ── Enter a world: right LOOK stick appears with JUMP + KICK surrounding it ──
await page.evaluate(async () => {
  const { useUniverseStore } = await window.__imp('/src/stores/universeStore.ts')
  const s = useUniverseStore.getState()
  const w = [...s.worlds.values()].find((x) => x.name === 'Lost') ?? [...s.worlds.values()][0]
  if (w) s.enterWorld(w.id)
})
await sleep(4500)
await page.evaluate(() => document.querySelector('.card-reveal-backdrop')?.click())
await sleep(300)

r.worldLabels = await page.evaluate(() => ({
  left: document.querySelector('#touch-stick-left .touch-joystick-label')?.textContent?.trim(),
  right: document.querySelector('#touch-stick-right .touch-joystick-label')?.textContent?.trim(),
}))
r.jump = await rect('#touch-btn-brake')
r.kick = await rect('#touch-btn-enter')
r.rightStickWorld = await rect('#touch-stick-right')
r.leftStickWorld = await rect('#touch-stick-left')
r.worldOverlaps = {
  rightVsJump: overlap(r.rightStickWorld, r.jump),
  rightVsKick: overlap(r.rightStickWorld, r.kick),
  rightVsDock: overlap(r.rightStickWorld, r.dock),
  leftVsKick: overlap(r.leftStickWorld, r.kick),
  jumpVsKick: overlap(r.jump, r.kick),
}
await shot('1-world')

// Drag right stick in world → turns & looks without moving the stick base
const rs = r.rightStickWorld
const rcx = (rs.l + rs.r) / 2, rcy = (rs.t + rs.b) / 2
const beforeWorld = await page.evaluate(async () => {
  const { interiorController } = await window.__imp('/src/systems/InteriorController.ts')
  const s = interiorController.state
  return { fx: +s.fx.toFixed(3), fz: +s.fz.toFixed(3), pitch: +s.pitch.toFixed(3) }
})
await touch('touchStart', [[rcx + 4, rcy - 4, 6]])
for (let i = 1; i <= 12; i++) {
  await touch('touchMove', [[rcx + i * 7, rcy - i * 5, 6]])
  await sleep(25)
}
await sleep(200)
r.rightStickDragged = await rect('#touch-stick-right')
r.rightKnobDragged = await rect('#touch-stick-right .touch-joystick-knob')
await shot('2-world-looking')
await touch('touchEnd', [])
await sleep(100)
const afterWorld = await page.evaluate(async () => {
  const { interiorController } = await window.__imp('/src/systems/InteriorController.ts')
  const s = interiorController.state
  return { fx: +s.fx.toFixed(3), fz: +s.fz.toFixed(3), pitch: +s.pitch.toFixed(3) }
})
r.worldLook = { before: beforeWorld, after: afterWorld }

r.errors = errors
console.log(JSON.stringify(r, null, 1))
await browser.close()
