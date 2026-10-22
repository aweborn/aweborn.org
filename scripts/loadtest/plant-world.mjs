// Create World end-to-end at 390x844 touch: pill in space → guest seal →
// (promote the test player to signed-in in the LOCAL db) → sheet → plant →
// success (link, Enter) → daily limit. Also checks the dev panel is gone.
// usage: OUT=<dir> node scripts/loadtest/plant-world.mjs [url]   (Vite dev + local docker stack)
import puppeteer from 'puppeteer-core'
import { execFileSync } from 'node:child_process'

const url = process.argv[2] ?? 'http://localhost:5173/'
const OUT = process.env.OUT ?? '/tmp'
const DB = process.env.DB ?? 'server/data/universe.db'
const W = +(process.env.W ?? 390), H = +(process.env.H ?? 844)
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
  args: [`--window-size=${W + 40},${H + 120}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tap = async (sel) => { const el = await page.$(sel); if (!el) throw new Error(`missing ${sel}`); await el.tap() }
const rect = (sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` }).catch(() => 'missing')
const r = {}

await page.goto(url, { waitUntil: 'domcontentloaded' })
await sleep(12000)
r.devPanelGone = !(await page.evaluate(() => document.body.innerText.includes('Multiplayer Dev')))
r.backtickNoPanel = await (async () => { await page.keyboard.press('Backquote'); await sleep(300); return !(await page.evaluate(() => document.body.innerText.includes('Multiplayer Dev'))) })()
r.syncChip = await rect('#sync-status')
r.pill = await rect('#plant-open')
await page.screenshot({ path: `${OUT}/plant-0-space.png` })

// Guest: the seal
await tap('#plant-open'); await sleep(800)
r.seal = await page.$eval('#mana-seal-title', (el) => el.textContent).catch(() => 'missing')
await page.screenshot({ path: `${OUT}/plant-1-seal.png` })
await tap('#mana-seal-explore'); await sleep(400)

// Promote this test player to signed-in (local DB only), then reload.
// Stop sync-service first: writing the bind-mounted SQLite file from the host while the
// container has it open can corrupt it (no file locking across the Docker VM).
const me = await page.evaluate(async () => (await (await fetch('http://localhost:1234/api/player/me', { credentials: 'include' })).json()))
r.playerId = me.playerId
if (!me.playerId) throw new Error(`no session (${JSON.stringify(me)}); is auth working locally?`)
const compose = ['compose', '-f', 'server/docker-compose.yml']
execFileSync('docker', [...compose, 'stop', 'sync-service'], { stdio: 'ignore' })
execFileSync('sqlite3', [DB, `update "user" set isAnonymous = 0 where playerId = '${me.playerId}';`])
execFileSync('docker', [...compose, 'start', 'sync-service'], { stdio: 'ignore' })
await sleep(6000)
await page.reload({ waitUntil: 'domcontentloaded' })
await sleep(12000)

await tap('#plant-open'); await sleep(800)
r.sheet = await rect('.plant-sheet')
r.nameField = await rect('#plant-name')
await page.screenshot({ path: `${OUT}/plant-2-sheet.png` })
await page.type('#plant-name', 'Moss Garden Test')
await tap('#plant-submit'); await sleep(2500)
r.successTitle = await page.$eval('#plant-title', (el) => el.textContent).catch(() => 'missing')
r.link = await page.$eval('#plant-link-url', (el) => el.textContent).catch(() => 'missing')
r.leftNote = await page.$eval('.plant-sheet .mana-seal-note', (el) => el.textContent).catch(() => 'missing')
await page.screenshot({ path: `${OUT}/plant-3-planted.png` })
const id = r.link.split('/w/')[1]
r.inUniverseStore = await page.evaluate(async (id) => (await import('/src/stores/universeStore.ts')).useUniverseStore.getState().worlds.has(id), id)
await tap('#plant-enter'); await sleep(5000)
r.enteredWorld = (await page.evaluate(async () => (await import('/src/stores/universeStore.ts')).useUniverseStore.getState().activeWorldId)) === id
r.pillHiddenInWorld = (await rect('#plant-open')) === 'missing'
await page.screenshot({ path: `${OUT}/plant-4-entered.png` })

// Daily limit: plant until refused (3 per rolling 24 h)
r.limit = await page.evaluate(async () => {
  const out = []
  for (let i = 0; i < 4; i++) {
    const res = await fetch('http://localhost:1234/api/player/world', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Limit ${i}`, color: '#336699', position: { x: 300 + i * 40, y: 0, z: 300 } }),
    })
    out.push(res.status)
  }
  return out
})
r.errors = errors
console.log(JSON.stringify(r, null, 1))
await browser.close()
