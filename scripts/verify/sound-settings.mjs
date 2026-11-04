// Sound settings check (2026-11-03): Music + Sounds sliders and the mute, in ••• More (touch)
// and the gear panel (desktop). Screenshots + overflow / tap-size checks.
// usage: W=390 H=844 OUT=<dir> node scripts/verify/sound-settings.mjs [url]
import puppeteer from 'puppeteer-core'

const url = process.argv[2] ?? 'http://localhost:5173/'
const OUT = process.env.OUT ?? '/tmp'
const W = +(process.env.W ?? 390), H = +(process.env.H ?? 844)
const touch = W < 900
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: W, height: H, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await page.goto(url, { waitUntil: 'domcontentloaded' })
await sleep(7000)
const prefix = touch ? 'more' : 'display'
await page.evaluate((touch) => {
  document.querySelector(touch ? '#touch-dock-more' : '#display-settings-toggle')?.click()
}, touch)
await sleep(800)
await page.evaluate((p) => document.querySelector(`#${p}-music-volume`)?.scrollIntoView({ block: 'center' }), prefix)
await sleep(400)
const r = await page.evaluate((p) => {
  const box = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) } }
  return {
    mute: box(`#${p}-sound-mute`), music: box(`#${p}-music-volume`), sounds: box(`#${p}-sound-volume`),
    control: box('.sound-control'),
    labels: [...document.querySelectorAll('.sound-level-name')].map((e) => e.textContent),
    values: [...document.querySelectorAll('.sound-level-value')].map((e) => e.textContent),
    hscroll: document.documentElement.scrollWidth > innerWidth,
  }
}, prefix)
await page.screenshot({ path: `${OUT}/sound-settings-${W}x${H}.png` })
// Slide Music to 0 by keyboard, then check the value text
await page.focus(`#${prefix}-music-volume`)
for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowLeft')
r.afterZero = await page.evaluate(() => [...document.querySelectorAll('.sound-level-value')].map((e) => e.textContent))
r.stored = await page.evaluate(() => localStorage.getItem('aweborn.audio'))
r.errors = errors
console.log(JSON.stringify(r))
await browser.close()

