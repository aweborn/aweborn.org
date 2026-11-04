// Live music check in the real game (2026-11-03): the music starts on the first tap and is
// never silent, a nearby world fades in from where it is as the universe fades down, the
// Music / Sounds sliders and mute work, and stepping into a world keeps its music going.
// usage: W=390 H=844 OUT=<dir> node scripts/verify/music-live.mjs [url]   (Vite dev + local sync-service; Chrome)
import puppeteer from 'puppeteer-core'

const url = process.argv[2] ?? 'http://localhost:5173/'
const OUT = process.env.OUT ?? '/tmp'
const W = +(process.env.W ?? 390), H = +(process.env.H ?? 844)
const touch = W < 900
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
  args: [`--window-size=${W + 40},${H + 120}`, '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ev = (fn, ...a) => page.evaluate(fn, ...a)
const out = { size: `${W}x${H}` }

await page.goto(url, { waitUntil: 'domcontentloaded' })
await sleep(7000)
out.before = await ev(() => window.awebornAudio?.state)
// First tap (a real one) starts sound
if (touch) await page.touchscreen.tap(W / 2, H / 3)
else await page.mouse.click(W / 2, H / 3)
await sleep(4000)
out.afterTap = await ev(() => window.awebornAudio.state)

const meter = async (n = 6) => {
  const v = []
  for (let i = 0; i < n; i++) { v.push(await ev(() => window.awebornAudio.meter())); await sleep(500) }
  return +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(4)
}
out.spaceRms = await meter()
out.status = await ev(() => window.awebornMusic.status())

// Each pool band is still audible (critical = one faint voice, never silent)
out.bands = {}
for (const b of ['high', 'low', 'critical']) {
  await ev((b) => window.awebornMusic.band(b), b)
  await sleep(14000) // let a chord change pick up the new layering
  out.bands[b] = await meter(8)
}
await ev(() => window.awebornMusic.reset())

// Fly to the nearest world: its music fades in, the universe fades down
const world = await ev(async () => {
  const { useUniverseStore } = await import('/src/stores/universeStore.ts')
  const { flightController } = await import('/src/systems/FlightController.ts')
  const ws = [...useUniverseStore.getState().worlds.values()].filter((w) => !w.parentWorldId)
  if (!ws.length) return null
  const w = ws[0]
  const p = w.resolvedPosition
  flightController.position.set(p.x + 120, p.y, p.z)
  flightController.velocity.set(0, 0, 0)
  return { id: w.id, name: w.name, music: w.music ?? null, ambient: w.ambientSound ?? null, count: ws.length }
})
out.world = world
if (world) {
  await sleep(3000)
  out.far = await ev(() => window.awebornMusic.status())
  await ev(async (id) => {
    const { useUniverseStore } = await import('/src/stores/universeStore.ts')
    const { flightController } = await import('/src/systems/FlightController.ts')
    const p = useUniverseStore.getState().worlds.get(id).resolvedPosition
    flightController.position.set(p.x + 20, p.y, p.z)
  }, world.id)
  await sleep(4000)
  out.close = await ev(() => window.awebornMusic.status())
  out.closeRms = await meter()
  await page.screenshot({ path: `${OUT}/music-${out.size}-near-world.png` })
}

// Sliders: Music to 0 keeps sounds; mute silences everything
out.musicZero = await ev(async () => {
  const { useAudioSettings } = await import('/src/audio/audioSettings.ts')
  useAudioSettings.getState().setMusic(0)
  return true
})
await sleep(1500)
out.rmsMusicZero = await meter(4)
await ev(async () => {
  const { useAudioSettings } = await import('/src/audio/audioSettings.ts')
  useAudioSettings.getState().setMusic(0.6)
  useAudioSettings.getState().setMuted(true)
})
await sleep(1500)
out.stateMuted = await ev(() => window.awebornAudio.state)
await ev(async () => {
  const { useAudioSettings } = await import('/src/audio/audioSettings.ts')
  useAudioSettings.getState().setMuted(false)
})
await sleep(2500)
out.stateUnmuted = await ev(() => window.awebornAudio.state)
out.rmsUnmuted = await meter(4)

// Into the world: its music keeps going, the universe goes quiet (unless Origin)
if (world) {
  await ev(async (id) => {
    const { useUniverseStore } = await import('/src/stores/universeStore.ts')
    useUniverseStore.getState().enterWorld(id)
  }, world.id)
  await sleep(9000)
  out.inside = await ev(() => window.awebornMusic.status())
  out.insideRms = await meter()
  await page.screenshot({ path: `${OUT}/music-${out.size}-inside.png` })
}
out.errors = errors.filter((e) => !/favicon|ERR_|WebSocket|net::/.test(e)).slice(0, 8)
console.log(JSON.stringify(out, null, 1))
await browser.close()

