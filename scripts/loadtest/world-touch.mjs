// World touch-controls check: 390x844 touch emulation, enter a world, drive the
// stick / drag-look / JUMP with real CDP touch events, read the interior state.
// usage: node scripts/loadtest/world-touch.mjs [url]   (needs the Vite dev server; Chrome installed)
// With no /w/ link (local DB has no Origin), it enters the first world from the dev panel.
import puppeteer from 'puppeteer-core'

const url = process.argv[2] ?? 'http://localhost:5173/'
const OUT = process.env.OUT ?? '/tmp'
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
  args: ['--window-size=430,960', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const cdp = await page.createCDPSession()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await page.goto(url, { waitUntil: 'domcontentloaded' })
await sleep(12000)
const inWorld = () => page.evaluate(async () => (await import('/src/stores/universeStore.ts')).useUniverseStore.getState().activeWorldId)
if (!(await inWorld())) {
  // Dev panel "Enter →" (the real entry path), then close the panel
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Enter →'))?.click())
  await sleep(7000)
  await page.evaluate(() => document.querySelector('button[title^="Close"]')?.click())
  await sleep(800)
}

const state = () => page.evaluate(async () => {
  // Vite tags files edited during the dev session (?t=…); import the URL the app itself uses
  const live = async (name) => {
    const src = await (await fetch('/src/components/Scene.tsx')).text()
    const m = src.match(new RegExp(`["'](/src/[^"']*${name}\\.tsx?[^"']*)["']`))
    return import(m ? m[1] : `/src/systems/${name}.ts`)
  }
  const { interiorController: c } = await live('InteriorController')
  const { useUniverseStore } = await import('/src/stores/universeStore.ts')
  const s = c.state
  const { useWorldStore } = await import('/src/stores/worldStore.ts')
  const { inputManager: im } = await import('/src/systems/InputManager.ts')
  const ax = Object.fromEntries(['moveX', 'moveY', 'yaw', 'pitch'].map((k) => [k, +im.getAxis(k).toFixed(2)]))
  return { world: useUniverseStore.getState().activeWorldId, loaded: useWorldStore.getState().loaded, ax, x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2), fx: +s.fx.toFixed(3), fz: +s.fz.toFixed(3), pitch: +s.pitch.toFixed(3) }
})
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) })

const r = {}
r.start = await state()
await page.screenshot({ path: `${OUT}/world-touch-0-idle.png` })

// 1. Stick forward (up), moderate push: walk
await touch('touchStart', [[90, 640, 1]])
for (let i = 1; i <= 6; i++) { await touch('touchMove', [[90, 640 - i * 7, 1]]); await sleep(16) }
await sleep(1200)
r.walk = await state()
r.walkSprintGlow = await page.$eval('.touch-joystick-base', (el) => el.classList.contains('touch-joystick-base--sprint'))
// 2. Push to the rim: sprint
for (let i = 1; i <= 6; i++) { await touch('touchMove', [[90, 598 - i * 10, 1]]); await sleep(16) }
await sleep(300)
r.sprintGlow = await page.$eval('.touch-joystick-base', (el) => el.classList.contains('touch-joystick-base--sprint'))
const a = await state(); await sleep(1000); const b = await state()
r.sprintSpeed = +Math.hypot(b.x - a.x, b.z - a.z).toFixed(2)
await page.screenshot({ path: `${OUT}/world-touch-1-stick.png` })
// 3. While still walking, second finger drags right on the right half: turn
const f0 = await state()
await touch('touchStart', [[90, 538, 1], [260, 420, 2]])
for (let i = 1; i <= 12; i++) { await touch('touchMove', [[90, 538, 1], [260 + i * 8, 420, 2]]); await sleep(16) }
await sleep(100)
const f1 = await state()
r.turnWhileWalking = { before: [f0.fx, f0.fz], after: [f1.fx, f1.fz], deg: +((Math.atan2(f1.fx, -f1.fz) - Math.atan2(f0.fx, -f0.fz)) * 180 / Math.PI).toFixed(1) }
// drag up = look up
for (let i = 1; i <= 8; i++) { await touch('touchMove', [[90, 538, 1], [356, 420 - i * 8, 2]]); await sleep(16) }
await sleep(100)
r.lookUp = { before: f1.pitch, after: (await state()).pitch }
await touch('touchEnd', [])
await sleep(400)
r.afterRelease = await state()
await sleep(500)
r.stoppedDrift = +Math.hypot((await state()).x - r.afterRelease.x, (await state()).z - r.afterRelease.z).toFixed(2)

// 4. JUMP button
const jump = await page.$eval('#touch-btn-brake', (el) => { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, label: el.textContent, visible: getComputedStyle(el).display !== 'none' } })
r.jumpButton = jump
const y0 = (await state()).y
await touch('touchStart', [[jump.x, jump.y, 3]]); await sleep(150); await touch('touchEnd', [])
await sleep(250)
r.jump = { y0, yAfter: (await state()).y }
// layout of the right-thumb cluster + hidden buttons
r.layout = await page.evaluate(() => Object.fromEntries(['touch-btn-brake', 'touch-btn-enter', 'touch-btn-warp', 'touch-btn-lock', 'touch-btn-exit'].map((id) => {
  const el = document.getElementById(id); if (!el) return [id, null]
  const b = el.getBoundingClientRect(); return [id, getComputedStyle(el).display === 'none' ? 'hidden' : `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)} "${el.textContent}"`]
})))
await page.screenshot({ path: `${OUT}/world-touch-2-after.png` })
r.errors = errors
console.log(JSON.stringify(r, null, 2))
await browser.close()
