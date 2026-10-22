// ••• More sheet check (2026-10-22).
// usage: W=390 H=844 OUT=<dir> node scripts/loadtest/more-touch.mjs [url]   (needs the Vite dev server; Chrome installed)
// Top right is clear on touch (no gear / fullscreen / account chip / FPS); the dock has 4 buttons
// and fits; More opens clear of the thumb buttons, cycles a mod, pins FPS, opens the account
// dialog and the gift modal; same in a world.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rect = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width ? { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) } : null
}, sel)
const display = (sels) => page.evaluate((ss) => ss.map((s) => {
  const el = document.querySelector(s); return el ? getComputedStyle(el).display : 'absent'
}), sels)
const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent?.trim() ?? null, sel)
const click = (sel) => page.evaluate((s) => { const b = document.querySelector(s); b?.click(); return !!b }, sel)
const shot = (n) => page.screenshot({ path: `${OUT}/more-${tag}-${n}.png` })
const overlap = (a, b) => !!(a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b)
const r = { tag }

await page.goto(url, { waitUntil: 'domcontentloaded' })
await sleep(6000)

// ── Space ──
r.topHidden = await display(['.hud-tools', '#player-account-chip', '.hud-fps', '#touch-btn-fullscreen'])
r.dock = await rect('.touch-dock')
r.dockFits = !!r.dock && r.dock.l >= 0 && r.dock.r <= W
await shot('0-space')

await click('#touch-dock-more')
await sleep(500)
r.sheet = await rect('#more-sheet')
r.sheetHitsThumbs = ['#touch-btn-mode', '#touch-btn-lock', '#touch-btn-thrust', '.touch-joystick-base', '.touch-dock']
r.sheetOverlaps = {}
for (const s of r.sheetHitsThumbs) r.sheetOverlaps[s] = overlap(r.sheet, await rect(s))
await shot('1-more-space')

const trail0 = await text('#more-mod-trail .more-mod-value')
await click('#more-mod-trail')
await sleep(150)
r.trail = [trail0, await text('#more-mod-trail .more-mod-value')]
await click('#more-fps')
await sleep(1200)
r.fpsPinned = (await display(['.hud-fps']))[0]
await click('#more-fps') // back off
await page.evaluate(() => document.querySelector('#more-give')?.scrollIntoView())
await sleep(300)
await shot('2-more-space-bottom')

await click('#more-give')
await sleep(800)
r.giveModal = !!(await rect('.modal-backdrop, .donation-modal'))
r.sheetAfterGive = await rect('#more-sheet')
await shot('3-give')
await click('#donation-modal-close')
await sleep(500)

await click('#touch-dock-more')
await sleep(400)
await click('#more-account')
await sleep(800)
r.accountDialog = await page.evaluate(() => !!document.querySelector('#player-account-dialog')?.open)
await shot('4-account')
await page.evaluate(() => document.querySelector('#player-account-dialog')?.close())
await sleep(400)

// ── World ──
await page.evaluate(async () => {
  const { useUniverseStore } = await import('/src/stores/universeStore.ts')
  const s = useUniverseStore.getState()
  const first = [...s.worlds.keys()][0]
  if (first) s.enterWorld(first)
})
await sleep(7000)
await click('#touch-dock-more')
await sleep(500)
r.sheetWorld = await rect('#more-sheet')
r.worldOverlaps = {}
for (const s of ['#touch-btn-enter', '#touch-btn-brake', '.touch-joystick-base', '.touch-dock']) r.worldOverlaps[s] = overlap(r.sheetWorld, await rect(s))
r.legendWorld = await text('.more-legend li')
await shot('5-more-world')
await click('#touch-dock-make')
await sleep(400)
r.moreClosedByMake = !(await rect('#more-sheet'))

r.errors = errors
console.log(JSON.stringify(r, null, 1))
await browser.close()
