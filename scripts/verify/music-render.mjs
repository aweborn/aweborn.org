// Bounce the generative music to WAV files and print levels (2026-11-03).
// usage: OUT=<dir> node scripts/verify/music-render.mjs [url]   (needs the Vite dev server; Chrome installed)
// Renders the universe at each pool band, day vs night, the Frontier edge, company,
// and two worlds' seeded music; writes WAVs + prints RMS / peak / spectral balance.
import puppeteer from 'puppeteer-core'
import { writeFileSync, mkdirSync } from 'node:fs'

const url = process.argv[2] ?? 'http://localhost:5173/'
const OUT = process.env.OUT ?? '/tmp/aweborn-music'
const SECONDS = +(process.env.SECONDS ?? 75)
mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(url, { waitUntil: 'domcontentloaded' })
await new Promise((r) => setTimeout(r, 3000))

const cases = (process.env.CASES ? JSON.parse(process.env.CASES) : [
  { name: 'universe-high-day', band: 'high', sun: 0.8 },
  { name: 'universe-medium', band: 'medium', sun: 0 },
  { name: 'universe-low', band: 'low', sun: 0 },
  { name: 'universe-critical', band: 'critical', sun: 0 },
  { name: 'universe-high-night', band: 'high', sun: -1 },
  { name: 'universe-edge', band: 'medium', unresolved: 1 },
  { name: 'universe-home', band: 'medium', home: 1 },
  { name: 'universe-company', band: 'medium', company: 3 },
  { name: 'world-a', band: 'medium', world: '5d6c1a50-2f0e-4a51-9c3b-3f8c1d7e9a01' },
  { name: 'world-b', band: 'medium', world: 'b91f3e22-7c44-4d1a-8e2f-0a6b5c4d3e21' },
])

for (const c of cases) {
  const res = await page.evaluate(async (c, seconds) => {
    const { renderMusic, toWav, seedFromId, UNIVERSE_SEED } = await import('/src/audio/music/render.ts')
    const { name: _name, ...opts } = c
    const t0 = performance.now()
    const buf = await renderMusic({ ...opts, seconds })
    const ms = performance.now() - t0
    // Levels: RMS per 1 s window, peak, and a crude spectral balance (energy above 2 kHz)
    const L = buf.getChannelData(0), R = buf.getChannelData(1)
    const win = buf.sampleRate
    const rms = []
    let peak = 0, hi = 0, all = 0, prev = 0
    for (let w = 0; w + win <= L.length; w += win) {
      let s = 0
      for (let i = w; i < w + win; i++) {
        const v = (L[i] + R[i]) / 2
        s += v * v
        peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
        const d = v - prev // first difference ≈ highpass
        hi += d * d
        all += v * v
        prev = v
      }
      rms.push(Math.sqrt(s / win))
    }
    const blob = toWav(buf)
    const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob) })
    const seed = opts.world ? seedFromId(opts.world) : UNIVERSE_SEED
    return { b64, ms: Math.round(ms), rms, peak, brightness: Math.sqrt(hi / Math.max(1e-12, all)), seed }
  }, c, SECONDS)
  writeFileSync(`${OUT}/${c.name}.wav`, Buffer.from(res.b64, 'base64'))
  const r = res.rms
  const mean = r.reduce((s, v) => s + v, 0) / r.length
  const min = Math.min(...r.slice(4)), max = Math.max(...r)
  const silentSecs = r.filter((v) => v < 0.002).length
  console.log(JSON.stringify({
    case: c.name, renderMs: res.ms, seed: res.seed,
    rmsMean: +mean.toFixed(4), rmsMin: +min.toFixed(4), rmsMax: +max.toFixed(4), peak: +res.peak.toFixed(3),
    brightness: +res.brightness.toFixed(4), silentSecs,
    // how much the level moves second to second (a drone barely moves)
    motion: +(r.slice(1).reduce((s, v, i) => s + Math.abs(v - r[i]), 0) / (r.length - 1) / Math.max(1e-9, mean)).toFixed(3),
  }))
}
console.log('errors', errors)
await browser.close()
