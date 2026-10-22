// Touch dock + fixed stick + THRUST check (2026-10-22).
// usage: W=390 H=844 OUT=<dir> node scripts/loadtest/dock-touch.mjs [url]   (needs the Vite dev server; Chrome installed)
// Space: stick base must not move while the knob is dragged past the rim; THRUST holds thrust,
// sliding down on it brakes. Dock: Plant / Index / Chat open their sheets. World: Make opens the
// Library, its tabs switch to Create / Plan; the old top pills are hidden.
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
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) })
const rect = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width ? { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) } : null
}, sel)
// The button's own state + the HUD speed (importing InputManager here can give a
// different module instance than the app's after Vite hot updates).
const actions = () => page.evaluate(() => {
  const t = document.querySelector('#touch-btn-thrust')
  return {
    thrust: !!t?.classList.contains('touch-btn--pressed') && !t.classList.contains('touch-btn--braking'),
    brake: !!t?.classList.contains('touch-btn--braking'),
    speed: document.querySelector('.hud-speed-value')?.textContent?.trim(),
  }
})
const click = (sel) => page.evaluate((s) => { const b = document.querySelector(s); b?.click(); return !!b }, sel)
const shot = (n) => page.screenshot({ path: `${OUT}/dock-${tag}-${n}.png` })
const r = { tag }

await page.goto(url, { waitUntil: 'domcontentloaded' })
await sleep(6000)

// ── Space ──
await shot('0-space')
r.hiddenPills = await page.evaluate(() => ['#world-index-chip', '#plant-open', '#chat-open'].map((s) => {
  const el = document.querySelector(s); return el ? getComputedStyle(el).display : 'absent'
}))
r.dock = await rect('.touch-dock')
r.stickBase0 = await rect('.touch-joystick-base')
r.thrustBtn = await rect('#touch-btn-thrust')
r.radar = await rect('.radar-container')

// Stick: land near the centre, drag far past the rim up-right; the base must stay put
const b = r.stickBase0
const cx = (b.l + b.r) / 2, cy = (b.t + b.b) / 2
await touch('touchStart', [[cx + 10, cy + 6, 1]])
for (let i = 1; i <= 10; i++) { await touch('touchMove', [[cx + 10 + i * 14, cy + 6 - i * 14, 1]]); await sleep(16) }
await sleep(300)
r.stickBaseDragged = await rect('.touch-joystick-base')
r.knob = await rect('.touch-joystick-knob')
r.stickAxes = await actions()
await shot('1-steer')
await touch('touchEnd', [])
await sleep(200)

// THRUST: hold, then slide down to brake (with the stick held at the same time)
const t = r.thrustBtn
const tx = (t.l + t.r) / 2, ty = (t.t + t.b) / 2
await touch('touchStart', [[tx, ty, 2]])
await sleep(250)
r.thrusting = await actions()
await shot('2-thrust')
for (let i = 1; i <= 6; i++) { await touch('touchMove', [[tx, ty + i * 9, 2]]); await sleep(16) }
await sleep(250)
r.braking = await actions()
await shot('3-brake')
await touch('touchEnd', [])
await sleep(200)
r.released = await actions()

// Dock: Plant
r.plantClick = await click('#touch-dock-plant')
await sleep(600)
r.plantSheet = await rect('.mana-seal, .plant-sheet')
await shot('4-plant')
await click('#touch-dock-plant')
await sleep(300)

// Dock: Index
await click('#touch-dock-index')
await sleep(700)
r.indexOpen = await page.evaluate(async () => (await import('/src/stores/worldIndexStore.ts')).useWorldIndexStore.getState().open)
r.dockBehindModal = await page.evaluate(() => getComputedStyle(document.querySelector('.touch-dock')).display)
await shot('5-index')
await page.evaluate(async () => (await import('/src/stores/worldIndexStore.ts')).useWorldIndexStore.getState().setOpen(false))
await sleep(400)

// ── World ──
await page.evaluate(async () => {
  const { useUniverseStore } = await import('/src/stores/universeStore.ts')
  const s = useUniverseStore.getState()
  const first = [...s.worlds.keys()][0]
  if (first) s.enterWorld(first)
})
await sleep(7000)
await shot('6-world')
r.worldPills = await page.evaluate(() => ['#library-open', '#create-open', '#planner-open'].map((s) => {
  const el = document.querySelector(s); return el ? getComputedStyle(el).display : 'absent'
}))
r.jump = await rect('#touch-btn-brake')
r.stickWorld = await rect('.touch-joystick-base')
r.chat = await rect('.chat-panel')

r.makeClick = await click('#touch-dock-make')
await sleep(600)
r.library = await rect('#library-panel')
await shot('7-make-library')
await click('#make-tab-plan')
await sleep(600)
r.planOrSeal = await rect('.planner, .mana-seal')
await shot('8-make-plan')
await click('#make-tab-create')
await sleep(600)
r.createOrSeal = await rect('.create-form, .mana-seal')
await shot('9-make-create')
await page.evaluate(async () => (await import('/src/stores/sheetStore.ts')).useSheetStore.getState().close())
await sleep(300)

// Chat from the dock
await click('#touch-dock-chat')
await sleep(500)
r.chatOpen = await rect('.chat-panel.is-open')
await shot('10-chat')

r.errors = errors
console.log(JSON.stringify(r, null, 1))
await browser.close()
