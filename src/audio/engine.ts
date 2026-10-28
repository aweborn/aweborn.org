import type { PoolBand } from '@aweborn/shared/mana-level'

/**
 * Procedural sound (Rough Draft M2; ROADMAP "Mana Is Visible, Audible, and
 * Tangible"). Everything is synthesized with WebAudio, so there are no audio
 * files to download.
 *
 *   Ambience     a bed that follows the pool: warm full hum (high), gentle hum
 *                (medium), near-silence with a distant tone now and then
 *                (low), silence (critical)
 *   Wave         a gift: a deep sweep under the golden front, then a warm chord
 *   Creation     an inhale when you ask; an exhale when it arrives (thinner
 *                when the pool is low, a strained whisper when it's critical)
 *   Discovery    a soft bell on a sighting, a rising arpeggio on a reveal
 *   Warp         a rising charge while held, a crack on release
 *   Approach     a warm hum that grows as you near a world (in space)
 *   UI           a faint tick on buttons
 *
 * Browsers only allow sound after a tap or key press: `unlock()` runs on the
 * first one. Until then (and while muted or hidden) every call is a no-op, and
 * the context is suspended so it costs nothing.
 *
 * Preview in the console: `awebornAudio.wave()`, `.creationDone()`, `.reveal()`,
 * `.setBand('low')` …
 */

const NOTE = (midi: number) => 440 * 2 ** ((midi - 69) / 12)
/** A major pentatonic, for distant tones (A3 … A4). */
const DISTANT = [57, 59, 61, 64, 66, 69]

interface Ambience {
  /** Fundamental hum (A1 · E2 · A2). */
  drone: number
  /** Upper partials (C#3 · E3 · A3): the "warm, full" part. */
  warmth: number
  /** Low wind. */
  air: number
  cutoff: number
  /** Occasional distant tone. */
  tones: boolean
}

const AMBIENCE: Record<PoolBand, Ambience> = {
  high: { drone: 0.13, warmth: 0.05, air: 0.03, cutoff: 1400, tones: false },
  medium: { drone: 0.07, warmth: 0.012, air: 0.018, cutoff: 800, tones: false },
  low: { drone: 0, warmth: 0, air: 0.006, cutoff: 380, tones: true },
  critical: { drone: 0, warmth: 0, air: 0, cutoff: 300, tones: false },
}

type Ctor = typeof AudioContext

class AudioEngine {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private sfx!: GainNode
  private echo!: GainNode
  private white!: AudioBuffer
  private brown!: AudioBuffer
  private drone!: GainNode
  private warmth!: GainNode
  private air!: GainNode
  private droneFilter!: BiquadFilterNode
  private hum!: GainNode

  private band: PoolBand | null = null
  private volume = 0.7
  private muted = false
  private hidden = false
  private inSpace = true
  private suspendTimer: number | undefined
  private toneTimer: number | undefined
  private lastTick = 0
  private lastPhase = 'idle'
  private lastHum = 0
  private warpVoice: { osc: OscillatorNode; sub: OscillatorNode; filter: BiquadFilterNode; g: GainNode } | null = null
  private analyser: AnalyserNode | null = null

  /** 'none' until the first tap creates the context. */
  get state(): AudioContextState | 'none' {
    return this.ctx?.state ?? 'none'
  }

  get currentBand(): PoolBand | null {
    return this.band
  }

  /** Debug: output level right now (RMS). Console: `awebornAudio.meter()`. */
  meter(): number {
    if (!this.ctx) return 0
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 2048
      this.master.connect(this.analyser)
    }
    const buf = new Float32Array(this.analyser.fftSize)
    this.analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (const v of buf) sum += v * v
    return Math.sqrt(sum / buf.length)
  }

  // ── Control ──────────────────────────────────────────────────────

  /** Call from a user gesture: creates (once) and resumes the context. */
  unlock(): void {
    if (!this.ctx) this.build()
    if (this.ctx && this.ctx.state !== 'running' && this.audible()) void this.ctx.resume().catch(() => {})
  }

  setSettings(muted: boolean, volume: number): void {
    this.muted = muted
    this.volume = volume
    this.apply()
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden
    this.apply()
  }

  setBand(band: PoolBand): void {
    if (band === this.band) return
    this.band = band
    this.apply()
  }

  setInSpace(inSpace: boolean): void {
    this.inSpace = inSpace
    if (!inSpace) this.setHum(0)
  }

  // ── Build ────────────────────────────────────────────────────────

  private build(): void {
    const C: Ctor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext
    if (!C) return
    let ctx: AudioContext
    try {
      ctx = new C({ latencyHint: 'interactive' })
    } catch {
      return
    }
    this.ctx = ctx

    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.knee.value = 12
    comp.ratio.value = 4
    comp.attack.value = 0.01
    comp.release.value = 0.3
    this.master = this.gain(0)
    this.master.connect(comp).connect(ctx.destination)
    this.sfx = this.gain(1, this.master)

    // Shared echo send: distance and shimmer for bells and tones.
    this.echo = this.gain(1)
    const delay = ctx.createDelay(1)
    delay.delayTime.value = 0.27
    const tone = this.filter('lowpass', 2600)
    const fb = this.gain(0.38)
    this.echo.connect(delay)
    delay.connect(tone)
    tone.connect(fb).connect(delay)
    tone.connect(this.gain(0.5, this.master))

    this.white = this.noise(2, false)
    this.brown = this.noise(4, true)

    // Ambience bed: oscillators run always (cheap); their gains follow the band.
    const amb = this.gain(1, this.master)
    this.droneFilter = this.filter('lowpass', 800, 0.4)
    const breath = this.gain(0.8)
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.07 // one slow breath every ~14 s
    lfo.connect(this.gain(0.2, breath.gain))
    lfo.start()
    this.drone = this.gain(0, amb)
    this.droneFilter.connect(breath).connect(this.drone)
    this.warmth = this.gain(0, this.droneFilter)
    const fundamentals: [OscillatorType, number, number][] = [
      ['sine', 55, 0], ['sine', NOTE(40), 0], ['triangle', 110, -4], ['triangle', 110, 5],
    ]
    for (const [type, f, detune] of fundamentals) {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = f
      o.detune.value = detune
      o.connect(this.droneFilter)
      o.start()
    }
    for (const m of [49, 52, 57]) {
      const o = ctx.createOscillator()
      o.frequency.value = NOTE(m)
      o.connect(this.warmth)
      o.start()
    }
    const wind = ctx.createBufferSource()
    wind.buffer = this.brown
    wind.loop = true
    this.air = this.gain(0, amb)
    wind.connect(this.filter('bandpass', 420, 0.6)).connect(this.air)
    wind.start()

    // Approach hum (in space): A3 + E4, soft.
    this.hum = this.gain(0, this.sfx)
    const humFilter = this.filter('lowpass', 900, 0.3)
    humFilter.connect(this.hum)
    for (const m of [57, 64]) {
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = NOTE(m)
      o.connect(humFilter)
      o.start()
    }

    ctx.addEventListener('statechange', () => this.apply())
    this.apply()
  }

  private apply(): void {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * this.volume, t, 0.08)
    const a = AMBIENCE[this.band ?? 'critical']
    this.drone.gain.setTargetAtTime(a.drone, t, 1.5)
    this.warmth.gain.setTargetAtTime(a.warmth, t, 1.5)
    this.air.gain.setTargetAtTime(a.air, t, 1.5)
    this.droneFilter.frequency.setTargetAtTime(a.cutoff, t, 1.5)
    if (a.tones) this.scheduleTone()
    else if (this.toneTimer !== undefined) {
      clearTimeout(this.toneTimer)
      this.toneTimer = undefined
    }

    clearTimeout(this.suspendTimer)
    if (this.audible()) {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    } else if (ctx.state === 'running') {
      // Let the fade finish, then stop the clock (no CPU, no battery).
      this.suspendTimer = window.setTimeout(() => {
        if (!this.audible()) void ctx.suspend().catch(() => {})
      }, 400)
    }
  }

  private audible(): boolean {
    return !this.muted && !this.hidden && this.volume > 0
  }

  /** The context, only when sound would actually be heard right now. */
  private live(): AudioContext | null {
    return this.ctx && this.ctx.state === 'running' && this.audible() ? this.ctx : null
  }

  // ── Ambience: distant tones (low pool) ───────────────────────────

  private scheduleTone(): void {
    if (this.toneTimer !== undefined) return
    this.toneTimer = window.setTimeout(() => {
      this.toneTimer = undefined
      if (this.band !== 'low') return
      this.distantTone()
      this.scheduleTone()
    }, 9000 + Math.random() * 14000)
  }

  private distantTone(): void {
    const ctx = this.live()
    if (!ctx) return
    const t = ctx.currentTime + 0.05
    const f = NOTE(DISTANT[Math.floor(Math.random() * DISTANT.length)])
    const g = this.gain(0, this.filter('lowpass', 1200, 0.5, this.sfx))
    g.connect(this.echo)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.03, t + 1.2)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 6)
    this.tone('sine', f, t, t + 6.2, g)
  }

  // ── The wave ─────────────────────────────────────────────────────

  /** A gift: a deep resonant sweep for the 10 s front, then a warm chord. */
  wave(): void {
    const ctx = this.live()
    if (!ctx) return
    const t = ctx.currentTime + 0.05

    const subG = this.gain(0, this.sfx)
    subG.gain.setValueAtTime(0.0001, t)
    subG.gain.exponentialRampToValueAtTime(0.4, t + 6)
    subG.gain.setTargetAtTime(0.0001, t + 8.5, 0.6)
    const sub = this.tone('sine', 30, t, t + 12, subG)
    sub.frequency.exponentialRampToValueAtTime(80, t + 9)
    const harmonic = this.tone('triangle', 60, t, t + 12, this.gain(0.3, this.filter('lowpass', 260, 0.7, subG)))
    harmonic.frequency.exponentialRampToValueAtTime(160, t + 9)

    const wG = this.gain(0, this.sfx)
    wG.gain.setValueAtTime(0.0001, t)
    wG.gain.exponentialRampToValueAtTime(0.1, t + 7.5)
    wG.gain.exponentialRampToValueAtTime(0.0001, t + 10)
    const bp = this.filter('bandpass', 160, 1.4, wG)
    bp.frequency.exponentialRampToValueAtTime(2000, t + 9)
    this.noiseSrc(this.white, t, 10.2, bp)

    // The front has passed: a warm hum (A major, gently detuned saws).
    const h0 = t + 8
    const hG = this.gain(0, this.sfx)
    hG.connect(this.gain(0.25, this.echo))
    hG.gain.setValueAtTime(0, h0)
    hG.gain.linearRampToValueAtTime(0.06, h0 + 2.5)
    hG.gain.setTargetAtTime(0, h0 + 5, 2.2)
    const lp = this.filter('lowpass', 700, 0.3, hG)
    lp.frequency.linearRampToValueAtTime(1400, h0 + 3)
    for (const m of [45, 52, 57, 61, 64]) {
      for (const detune of [-5, 5]) this.tone('sawtooth', NOTE(m), h0, h0 + 16, lp).detune.value = detune
    }
  }

  // ── Creation ─────────────────────────────────────────────────────

  /** You asked: the universe breathes in. */
  creationStart(): void {
    const ctx = this.live()
    if (!ctx) return
    const band = this.band ?? 'medium'
    const t = ctx.currentTime + 0.02
    const peak = { high: 0.09, medium: 0.07, low: 0.04, critical: 0.025 }[band]
    const g = this.gain(0, this.sfx)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + 1.1)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5)
    const f = band === 'critical' ? this.filter('bandpass', 2500, 6, g) : this.filter('bandpass', 300, 0.9, g)
    f.frequency.exponentialRampToValueAtTime(band === 'critical' ? 3500 : 1400, t + 1.3)
    this.noiseSrc(this.white, t, 1.6, f)
  }

  /** It arrived: a deep exhale, thinner as the pool runs low, a whisper when it's nearly gone. */
  creationDone(): void {
    const ctx = this.live()
    if (!ctx) return
    const band = this.band ?? 'medium'
    const t = ctx.currentTime + 0.02

    if (band === 'critical') {
      // Strained whisper: narrow, high, trembling.
      const g = this.gain(0, this.sfx)
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.03, t + 0.3)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4)
      const trem = this.gain(0.6, g)
      this.tone('sine', 7, t, t + 1.5, this.gain(0.4, trem.gain))
      this.noiseSrc(this.white, t, 1.5, this.filter('bandpass', 3200, 5, trem))
      return
    }

    const peak = { high: 0.12, medium: 0.09, low: 0.05 }[band]
    const g = this.gain(0, this.sfx)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + 0.15)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3)
    const lp = this.filter('lowpass', 2600, 0.7, g)
    lp.frequency.exponentialRampToValueAtTime(band === 'low' ? 900 : 220, t + 2.8)
    const src = band === 'low' ? this.filter('highpass', 900, 0.7, lp) : lp
    this.noiseSrc(this.white, t, 3.1, src)

    if (band !== 'low') {
      // "The universe breathing through you": a low D under the breath.
      const subG = this.gain(0, this.sfx)
      subG.gain.setValueAtTime(0, t)
      subG.gain.linearRampToValueAtTime(band === 'high' ? 0.14 : 0.07, t + 0.2)
      subG.gain.exponentialRampToValueAtTime(0.0001, t + 3.2)
      this.tone('sine', NOTE(38), t, t + 3.3, subG)
      this.tone('sine', NOTE(45), t, t + 3.3, this.gain(0.4, subG))
    }
    // A glint as it appears.
    const notes = band === 'low' ? [81] : [81, 88]
    notes.forEach((m, i) => this.bell(NOTE(m), t + 0.25 + i * 0.12, band === 'low' ? 0.015 : 0.025, 1.5))
  }

  // ── Discovery ────────────────────────────────────────────────────

  /** A world came into sight. */
  sighting(): void {
    const ctx = this.live()
    if (!ctx) return
    const t = ctx.currentTime + 0.02
    this.bell(NOTE(76), t, 0.045, 1.8)
    this.bell(NOTE(83), t + 0.14, 0.035, 1.8)
  }

  /** A card turned face up (first visit, or Origin). */
  reveal(): void {
    const ctx = this.live()
    if (!ctx) return
    const t = ctx.currentTime + 0.05
    ;[72, 74, 76, 79, 81, 84].forEach((m, i) => this.bell(NOTE(m), t + i * 0.085, 0.05, 2.4, 'triangle'))
  }

  // ── Warp + approach (called every physics step from WarpSystem) ──

  warp(phase: string, charge: number, nearest: number): void {
    const ctx = this.ctx
    const prev = this.lastPhase
    this.lastPhase = phase
    if (!ctx || ctx.state !== 'running') return
    const t = ctx.currentTime

    if (phase === 'charging') {
      let v = this.warpVoice
      if (!v) {
        const g = this.gain(0, this.sfx)
        const filter = this.filter('lowpass', 300, 6, g)
        const osc = this.tone('sawtooth', 90, t, t + 600, filter)
        const sub = this.tone('sine', 45, t, t + 600, g)
        v = this.warpVoice = { osc, sub, filter, g }
      }
      const f = 90 * 2 ** (charge * 2.3)
      v.osc.frequency.setTargetAtTime(f, t, 0.03)
      v.sub.frequency.setTargetAtTime(f / 2, t, 0.03)
      v.filter.frequency.setTargetAtTime(300 + charge * 2500, t, 0.03)
      v.g.gain.setTargetAtTime(0.02 + 0.06 * charge, t, 0.03)
    } else if (this.warpVoice) {
      const v = this.warpVoice
      this.warpVoice = null
      v.g.gain.setTargetAtTime(0, t, 0.04)
      v.osc.stop(t + 0.3)
      v.sub.stop(t + 0.3)
      if (phase === 'leaping' && prev === 'charging') this.crack()
    }

    const near = this.inSpace && phase !== 'leaping' && Number.isFinite(nearest) ? Math.max(0, Math.min(1, (140 - nearest) / 120)) : 0
    this.setHum(near * near * 0.05)
  }

  private setHum(target: number): void {
    if (!this.ctx || Math.abs(target - this.lastHum) < 0.002) return
    this.lastHum = target
    this.hum.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4)
  }

  private crack(): void {
    const ctx = this.live()
    if (!ctx) return
    const t = ctx.currentTime
    const g = this.gain(0, this.sfx)
    g.connect(this.gain(0.4, this.echo))
    g.gain.setValueAtTime(0.25, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
    this.noiseSrc(this.white, t, 0.32, this.filter('highpass', 1200, 0.7, g))
    const dG = this.gain(0, this.sfx)
    dG.gain.setValueAtTime(0.2, t)
    dG.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
    this.tone('sine', 220, t, t + 0.62, dG).frequency.exponentialRampToValueAtTime(40, t + 0.5)
  }

  // ── UI ───────────────────────────────────────────────────────────

  /** A faint tick for a button press (at most one per 60 ms). */
  tick(): void {
    const ctx = this.live()
    if (!ctx) return
    const now = performance.now()
    if (now - this.lastTick < 60) return
    this.lastTick = now
    const t = ctx.currentTime
    const g = this.gain(0, this.sfx)
    g.gain.setValueAtTime(0.02, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04)
    this.tone('sine', 1900, t, t + 0.05, g).frequency.exponentialRampToValueAtTime(1400, t + 0.025)
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private gain(value: number, dest?: AudioNode | AudioParam): GainNode {
    const g = this.ctx!.createGain()
    g.gain.value = value
    if (dest) g.connect(dest as AudioNode)
    return g
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7, dest?: AudioNode): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    if (dest) f.connect(dest)
    return f
  }

  private tone(type: OscillatorType, freq: number, t0: number, t1: number, dest: AudioNode | AudioParam): OscillatorNode {
    const o = this.ctx!.createOscillator()
    o.type = type
    o.frequency.value = freq
    o.connect(dest as AudioNode)
    o.start(t0)
    o.stop(t1)
    return o
  }

  private noiseSrc(buf: AudioBuffer, t0: number, dur: number, dest: AudioNode): void {
    const s = this.ctx!.createBufferSource()
    s.buffer = buf
    s.loop = true
    s.connect(dest)
    s.start(t0, Math.random() * buf.duration)
    s.stop(t0 + dur)
  }

  /** A soft bell: a sine and its inharmonic partial, with an echo. */
  private bell(f: number, t: number, peak: number, decay: number, type: OscillatorType = 'sine'): void {
    const g = this.gain(0, this.sfx)
    g.connect(this.gain(0.5, this.echo))
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    this.tone(type, f, t, t + decay + 0.05, g)
    this.tone('sine', f * 2.76, t, t + decay * 0.5, this.gain(0.25, g))
  }

  private noise(seconds: number, brown: boolean): AudioBuffer {
    const ctx = this.ctx!
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1
      if (brown) {
        last = (last + 0.02 * w) / 1.02
        d[i] = last * 3.5
      } else d[i] = w
    }
    return buf
  }
}

export const audio = new AudioEngine()
