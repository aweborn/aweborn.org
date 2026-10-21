// Phone fps profile (Card Event Readiness step 2). Needs: npm i --no-save puppeteer-core
// Local only: run the Vite dev server + local sync-service; add bots with bots.mjs for a crowd.
//   node scripts/loadtest/phone-fps.mjs 4 12 0,1,2,3 label   (throttle, seconds, tiers, label)
// Phone-ish fps profile: system Chrome, 390x844 touch, CPU throttle, per tier.
// usage: node prof.mjs [throttle=4] [seconds=12] [tiers=0,1,2,3] [label]
import puppeteer from 'puppeteer-core'
import { writeFileSync } from 'node:fs'

const throttle = Number(process.argv[2] ?? 4)
const secs = Number(process.argv[3] ?? 12)
const tiers = (process.argv[4] ?? '0,1,2,3').split(',').map((t) => (t === 'auto' ? 'auto' : Number(t)))
const label = process.argv[5] ?? 'run'

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
  args: ['--window-size=430,960', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
})

const results = []
for (const tier of tiers) {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument((tier) => {
    try {
      localStorage.setItem('aweborn.quality', String(tier))
      localStorage.setItem('aweborn.quality.auto', '1')
    } catch {}
    const stats = { draws: 0, programs: 0, frames: [] }
    window.__prof = stats
    for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      if (!C) continue
      for (const fn of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        const orig = C.prototype[fn]
        if (orig) C.prototype[fn] = function (...a) { stats.draws++; return orig.apply(this, a) }
      }
      const link = C.prototype.linkProgram
      C.prototype.linkProgram = function (...a) { stats.programs++; return link.apply(this, a) }
    }
  }, tier)
  const cdp = await page.createCDPSession()
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
  await new Promise((r) => setTimeout(r, 12000)) // load + settle
  const r = await page.evaluate(async (secs) => {
    const s = window.__prof
    const d0 = s.draws, p0 = s.programs
    const deltas = []
    let last = performance.now()
    const end = last + secs * 1000
    await new Promise((res) => {
      const tick = (t) => { deltas.push(t - last); last = t; t < end ? requestAnimationFrame(tick) : res() }
      requestAnimationFrame(tick)
    })
    deltas.shift()
    const sorted = [...deltas].sort((a, b) => a - b)
    const pct = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
    return {
      fps: +(deltas.length / secs).toFixed(1),
      p50ms: +pct(0.5).toFixed(1),
      p95ms: +pct(0.95).toFixed(1),
      maxms: +sorted[sorted.length - 1].toFixed(1),
      over50: deltas.filter((d) => d > 50).length,
      drawsPerFrame: Math.round((s.draws - d0) / deltas.length),
      programsCompiledDuring: s.programs - p0,
      programsTotal: s.programs,
      canvas: (() => { const c = document.querySelector('canvas'); return c ? `${c.width}x${c.height}` : null })(),
    }
  }, secs)
  r.tier = tier
  results.push(r)
  console.log(label, JSON.stringify(r))
  if (tier === tiers[tiers.length - 1]) await page.screenshot({ path: `shot-${label}.png` })
  await page.close()
}
writeFileSync(`result-${label}.json`, JSON.stringify(results, null, 2))
await browser.close()
