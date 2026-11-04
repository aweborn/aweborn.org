import type { PoolBand } from '@aweborn/shared/mana-level'
import {
  CHORDS, HOME_THEME, bassNote, driftMood, hash32, hz, leadPhrase, nextChord, rng, shimmerNotes, voiceChord,
  type ChordDef, type MusicSeed, type Note,
} from '@aweborn/shared/music'
import type { MusicKit } from './kit'

/**
 * One generative piece of music (2026-11-03 grill: cosmic and dreamy, Lydian
 * wonder that drifts bittersweet, always on). The universe plays one; every
 * world nearby plays its own, seeded from its ID. The director crossfades them.
 *
 *   pads     detuned saw pairs, voice-led, a slow filter swell (CS-80 strings)
 *   bass     a soft sine root under each chord
 *   lead     phrases that drift in and out: brass, glass, flute or choir
 *   shimmer  high bells through the long echo
 *   company  a faint choir voice for each player nearby
 *
 * Everything goes through `level` (the director's crossfade), then splits
 * into `dest` (dry, maybe a 3D panner) and the shared reverb (wet).
 */

export interface PieceParams {
  band: PoolBand
  /** The sun's height for this player, −1 (midnight) … +1 (noon). */
  sun: number
  /** Flight speed, 0 … 1. */
  speed: number
  /** 0 … 1: the Frontier edge, Ghost worlds. */
  unresolved: number
  /** 0 … 1: near Origin (the home theme). Only the universe piece uses it. */
  home: number
  /** Players nearby (0 … 4): each adds a faint voice. */
  company: number
  /** Warp charge, 0 … 1. */
  charge: number
}

const DEFAULTS: PieceParams = { band: 'medium', sun: 0, speed: 0, unresolved: 0, home: 0, company: 0, charge: 0 }

interface Layers {
  padVoices: number
  pad: number
  bass: number
  /** Chance a chord carries a lead phrase. */
  lead: number
  /** Shimmer bells per chord. */
  shimmer: number
  bright: number
}

/** The pool shapes how full the music is, never silent (critical = one faint voice). */
const LAYERS: Record<PoolBand, Layers> = {
  high: { padVoices: 5, pad: 1, bass: 1, lead: 0.62, shimmer: 3, bright: 1 },
  medium: { padVoices: 4, pad: 0.85, bass: 0.7, lead: 0.42, shimmer: 1.4, bright: 0.72 },
  low: { padVoices: 3, pad: 0.62, bass: 0.28, lead: 0.24, shimmer: 0.4, bright: 0.48 },
  critical: { padVoices: 1, pad: 0.5, bass: 0, lead: 0, shimmer: 0, bright: 0.32 },
}

interface Voice {
  oscs: OscillatorNode[]
  gain: GainNode
}

const PAD_ATTACK = 3.2
const PAD_RELEASE = 5.5
const LOOKAHEAD = 1.5

export class GenerativePiece {
  /** The director's crossfade. */
  readonly level: GainNode
  private readonly ctx: BaseAudioContext
  private readonly sum: GainNode
  private readonly dry: GainNode
  private readonly wet: GainNode
  private readonly padFilter: BiquadFilterNode
  private readonly padGain: GainNode
  private readonly bassGain: GainNode
  private readonly leadGain: GainNode
  private readonly shimmerGain: GainNode
  private readonly choirFilter: BiquadFilterNode
  private readonly lfo: OscillatorNode
  private readonly lfoDepth: GainNode
  private readonly rand: () => number

  private p: PieceParams = { ...DEFAULTS }
  private chord: ChordDef = CHORDS.I
  private mood: number
  private voicing: number[] | null = null
  private pads: Voice[] = []
  private bass: Voice | null = null
  private company: Voice[] = []
  private nextChange = 0
  private leadUntil = 0
  private lastLeadNote: number | null = null
  private lastHome = -Infinity
  private chordCount = 0
  private stopped = false
  private disposeTimer: number | undefined
  private lastCutoff = -1

  readonly seed: MusicSeed

  constructor(kit: MusicKit, seed: MusicSeed, dest: AudioNode, salt = '') {
    this.ctx = kit.ctx
    this.seed = seed
    this.mood = seed.mood
    // Each player hears the same world's character but not the same notes in lockstep
    this.rand = rng(hash32(`${seed.root}:${seed.lead}:${seed.swell}:${salt}:${Math.random()}`))
    const ctx = this.ctx

    this.level = this.g(0)
    this.sum = this.g(1)
    this.sum.connect(this.level)
    this.dry = this.g(0.8)
    this.wet = this.g(0.45)
    this.level.connect(this.dry).connect(dest)
    this.level.connect(this.wet).connect(kit.reverb)

    this.padFilter = ctx.createBiquadFilter()
    this.padFilter.type = 'lowpass'
    this.padFilter.Q.value = 0.9
    this.padFilter.frequency.value = 900
    this.padGain = this.g(0)
    this.padFilter.connect(this.padGain).connect(this.sum)
    // The slow swell: the pads' filter breathes once every `swell` seconds
    this.lfo = ctx.createOscillator()
    this.lfo.frequency.value = 1 / seed.swell
    this.lfoDepth = this.g(350)
    this.lfo.connect(this.lfoDepth).connect(this.padFilter.frequency)
    this.lfo.start()

    this.bassGain = this.g(0)
    this.bassGain.connect(this.sum)
    this.leadGain = this.g(0)
    this.leadGain.connect(this.sum)
    this.leadGain.connect(this.g(0.35, kit.echo))
    this.shimmerGain = this.g(0)
    this.shimmerGain.connect(this.sum)
    this.shimmerGain.connect(this.g(0.6, kit.echo))
    // A wordless "ah" for company voices and the choir lead
    this.choirFilter = ctx.createBiquadFilter()
    this.choirFilter.type = 'lowpass'
    this.choirFilter.frequency.value = 1600
    this.choirFilter.connect(this.sum)
  }

  /** Begin: the first chord swells in now. */
  start(): void {
    this.nextChange = this.ctx.currentTime + 0.1
    this.applyMix(true)
    this.tick()
  }

  set(params: Partial<PieceParams>): void {
    const before = this.p
    this.p = { ...this.p, ...params }
    if (before.band !== this.p.band || Math.abs(before.sun - this.p.sun) > 0.02 || before.unresolved !== this.p.unresolved) this.applyMix(false)
    this.applyBrightness()
  }

  /** Fade out and free everything. */
  stop(fade = 2.5): void {
    if (this.stopped) return
    this.stopped = true
    const t = this.ctx.currentTime
    this.level.gain.cancelScheduledValues(t)
    this.level.gain.setValueAtTime(this.level.gain.value, t)
    this.level.gain.setTargetAtTime(0, t, fade / 4)
    this.disposeTimer = window.setTimeout(() => this.dispose(), (fade + 0.5) * 1000)
  }

  /** A warp landed: everything blooms onto a new chord, now. */
  leap(): void {
    if (this.stopped) return
    const t = this.ctx.currentTime + 0.05
    const options = Object.values(CHORDS).filter((c) => c.root !== this.chord.root && c.bitter < 0.7)
    this.changeTo(options[Math.floor(this.rand() * options.length)], t, 0.7)
    this.nextChange = t + this.seed.chordSeconds
    shimmerNotes(this.seed.root, this.chord, this.rand, 6).sort((a, b) => a - b).forEach((m, i) => this.bell(m, t + 0.1 + i * 0.09, 0.05))
  }

  /** What's playing (console: `awebornMusic.status()`). */
  status(): { chord: string; mood: number; key: number; lead: string; voices: number } {
    return { chord: this.chord.id, mood: Math.round(this.mood * 100) / 100, key: this.seed.root, lead: this.seed.lead, voices: this.pads.length }
  }

  /** Called a few times a second by the director: schedules the next chord when it's near. */
  tick(): void {
    if (this.stopped) return
    const now = this.ctx.currentTime
    if (now + LOOKAHEAD < this.nextChange) return
    const at = Math.max(now + 0.05, this.nextChange)
    this.chordCount++
    const night = Math.max(0, -this.p.sun)
    this.mood = driftMood(this.mood, this.seed.mood, this.rand)

    let next: ChordDef
    const homeDue = this.p.home > 0.5 && at - this.lastHome > 45
    if (this.chordCount === 1) next = this.p.unresolved > 0.5 ? CHORDS.Isus : CHORDS.I
    else if (homeDue && this.chord.id !== 'I') next = CHORDS.I
    else next = nextChord(this.chord.id, { mood: this.mood, unresolved: this.p.unresolved }, this.rand)
    this.changeTo(next, at, PAD_ATTACK)

    const len = this.seed.chordSeconds * (0.8 + this.rand() * 0.45) * (1 + 0.25 * night) * (1 + 0.3 * this.p.unresolved)
    this.nextChange = at + len

    const layers = LAYERS[this.p.band]
    // The home theme near Origin, else (sometimes) a phrase that drifts in
    if (homeDue && next.id === 'I' && at >= this.leadUntil) {
      this.lastHome = at
      this.playLead(HOME_THEME.map((n) => ({ midi: n.midi === null ? null : 62 + n.midi, dur: n.dur })), at + 1.2)
    } else if (at >= this.leadUntil && this.rand() < layers.lead * (1 - 0.5 * this.p.unresolved)) {
      const phrase = leadPhrase(this.seed.root, next, this.rand, { from: this.lastLeadNote, pace: 1 + 0.3 * night })
      this.playLead(phrase, at + 0.8 + this.rand() * Math.max(0.5, len * 0.4))
    }
    // Shimmer: sparse bells, more of them when flying fast
    const bells = layers.shimmer * (1 + 1.5 * this.p.speed) * (1 - 0.4 * this.p.unresolved)
    const count = Math.floor(bells) + (this.rand() < bells % 1 ? 1 : 0)
    for (const m of shimmerNotes(this.seed.root, next, this.rand, count)) {
      this.bell(m, at + 1 + this.rand() * Math.max(1, len - 2), 0.022 + 0.01 * this.rand())
    }
  }

  // ── Chords ───────────────────────────────────────────────────────

  private changeTo(chord: ChordDef, at: number, attack: number): void {
    this.chord = chord
    const layers = LAYERS[this.p.band]
    const night = Math.max(0, -this.p.sun)
    const shift = Math.round(night * 3) // night voicings sit a little lower: deeper
    const tones = chord.tones.map((t) => (this.seed.root + t) % 12)
    this.voicing = voiceChord(tones, this.voicing, layers.padVoices, 50 - shift, 76 - shift)

    // Release what's sounding. The one faint voice (critical) overlaps longer and
    // swells in faster, so there's never a gap between its notes.
    const faint = this.p.band === 'critical'
    const rel = faint ? PAD_RELEASE * 2 : PAD_RELEASE
    if (faint) attack = Math.min(attack, 1.5)
    for (const v of this.pads) this.release(v, at, rel)
    if (this.bass) this.release(this.bass, at, PAD_RELEASE)
    for (const v of this.company) this.release(v, at, PAD_RELEASE)
    this.pads = []
    this.bass = null
    this.company = []

    const per = faint ? 0.11 : 0.085 / Math.sqrt(this.voicing.length)
    this.voicing.forEach((m, i) => {
      const pan = this.voicing!.length > 1 ? -0.6 + (1.2 * i) / (this.voicing!.length - 1) : 0
      this.pads.push(this.padVoice(m, at, attack, per, pan, faint))
    })
    if (layers.bass > 0) this.bass = this.bassVoice(bassNote(this.seed.root, chord), at, attack)
    const voices = Math.min(4, Math.max(0, Math.round(this.p.company)))
    for (let i = 0; i < voices; i++) {
      const pool = tones.flatMap((t) => [t + 60, t + 72]).filter((m) => m >= 64 && m <= 81)
      const m = pool[Math.floor(this.rand() * pool.length)]
      this.company.push(this.choirVoice(m, at + 0.5 + i * 0.7, 0.02))
    }
  }

  private padVoice(midi: number, at: number, attack: number, peak: number, pan: number, faint: boolean): Voice {
    const ctx = this.ctx
    const gain = this.g(0)
    const panner = ctx.createStereoPanner()
    panner.pan.value = pan
    gain.connect(panner).connect(this.padFilter)
    const f = hz(midi)
    const oscs: OscillatorNode[] = []
    const shapes: [OscillatorType, number][] = faint ? [['sine', 0]] : [['sawtooth', -7], ['sawtooth', 7]]
    for (const [type, detune] of shapes) {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = f
      o.detune.value = detune + (this.rand() - 0.5) * 3
      o.connect(gain)
      o.start(at)
      oscs.push(o)
    }
    gain.gain.setValueAtTime(0, at)
    gain.gain.setTargetAtTime(peak, at, attack / 3)
    return { oscs, gain }
  }

  private bassVoice(midi: number, at: number, attack: number): Voice {
    const gain = this.g(0, this.bassGain)
    const o = this.osc('sine', hz(midi), at, gain)
    const o2 = this.osc('triangle', hz(midi + 12), at, this.g(0.18, gain))
    gain.gain.setValueAtTime(0, at)
    gain.gain.setTargetAtTime(0.16, at, attack / 2.5)
    return { oscs: [o, o2], gain }
  }

  private choirVoice(midi: number, at: number, peak: number): Voice {
    const gain = this.g(0)
    // Two formants of an open "ah"
    for (const [f, q, lvl] of [[730, 7, 1], [1090, 9, 0.6]] as const) {
      const bp = this.ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = f
      bp.Q.value = q
      gain.connect(bp).connect(this.g(lvl * 3.2, this.choirFilter))
    }
    const o = this.osc('sawtooth', hz(midi), at, gain)
    const vib = this.osc('sine', 4.6 + this.rand(), at, this.g(hz(midi) * 0.004, o.frequency))
    gain.gain.setValueAtTime(0, at)
    gain.gain.setTargetAtTime(peak, at, 1.4)
    return { oscs: [o, vib], gain }
  }

  private release(v: Voice, at: number, release: number): void {
    v.gain.gain.cancelScheduledValues(at)
    v.gain.gain.setTargetAtTime(0, at, release / 4)
    for (const o of v.oscs) {
      try { o.stop(at + release + 0.5) } catch { /* already stopped */ }
    }
  }

  // ── Lead ─────────────────────────────────────────────────────────

  private playLead(phrase: Note[], at: number): void {
    const total = phrase.reduce((s, n) => s + n.dur, 0)
    this.leadUntil = at + total
    const notes = phrase.filter((n) => n.midi !== null)
    if (notes.length) this.lastLeadNote = notes[notes.length - 1].midi
    if (this.seed.lead === 'glass') {
      let t = at
      for (const n of phrase) {
        if (n.midi !== null) this.bell(n.midi, t, 0.05, Math.max(2.4, n.dur * 1.6), 3.5)
        t += n.dur
      }
      return
    }
    this.monoLead(phrase, at, total)
  }

  /** Brass, flute or choir: one gliding voice with a delayed vibrato. */
  private monoLead(phrase: Note[], at: number, total: number): void {
    const ctx = this.ctx
    const lead = this.seed.lead
    const end = at + total + 3
    const out = this.g(0, this.leadGain)
    const first = phrase.find((n) => n.midi !== null)!.midi!
    const freq = ctx.createConstantSource() // one frequency for every oscillator in the voice
    freq.offset.value = hz(first)
    freq.start(at)
    freq.stop(end)

    let shaper: AudioNode = out
    let filter: BiquadFilterNode | null = null
    if (lead === 'brass') {
      filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.Q.value = 2.2
      filter.frequency.value = 700
      filter.connect(out)
      shaper = filter
    } else if (lead === 'choir') {
      const mix = this.g(1)
      for (const [f, q, lvl] of [[730, 7, 1], [1090, 9, 0.6], [2440, 10, 0.25]] as const) {
        const bp = ctx.createBiquadFilter()
        bp.type = 'bandpass'
        bp.frequency.value = f
        bp.Q.value = q
        mix.connect(bp).connect(this.g(lvl * 3, out))
      }
      shaper = mix
    } else {
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 2600
      lp.connect(out)
      shaper = lp
    }

    const shapes: [OscillatorType, number, number][] =
      lead === 'brass' ? [['sawtooth', -6, 1], ['sawtooth', 6, 1]]
      : lead === 'choir' ? [['sawtooth', -4, 1], ['sawtooth', 5, 0.8]]
      : [['triangle', 0, 1], ['sine', 1200, 0.25]] // flute: + a soft octave
    const vibrato = this.g(0)
    const vib = ctx.createOscillator()
    vib.frequency.value = lead === 'flute' ? 5.4 : 4.9
    vib.connect(vibrato)
    vib.start(at)
    vib.stop(end)
    for (const [type, detune, lvl] of shapes) {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = 0
      o.detune.value = detune
      freq.connect(o.frequency)
      vibrato.connect(o.detune)
      o.connect(lvl === 1 ? shaper : this.g(lvl, shaper))
      o.start(at)
      o.stop(end)
    }
    if (lead === 'flute') {
      // A little breath
      const n = ctx.createBufferSource()
      n.buffer = this.breath()
      n.loop = true
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 2400
      bp.Q.value = 1.2
      n.connect(bp).connect(this.g(0.05, out))
      n.start(at)
      n.stop(end)
    }

    const peak = lead === 'brass' ? 0.06 : lead === 'choir' ? 0.05 : 0.07
    let t = at
    out.gain.setValueAtTime(0, at)
    for (const n of phrase) {
      if (n.midi === null) {
        out.gain.setTargetAtTime(0, t, 0.35)
      } else {
        freq.offset.setTargetAtTime(hz(n.midi), t, 0.07) // portamento
        out.gain.setTargetAtTime(peak, t, lead === 'choir' ? 0.4 : 0.12)
        if (n.dur > 1.2) out.gain.setTargetAtTime(peak * 0.75, t + n.dur * 0.6, 0.5) // swell down over long notes
        // Vibrato arrives late in each note, like a player
        vibrato.gain.setValueAtTime(0, t)
        vibrato.gain.linearRampToValueAtTime(n.dur > 0.9 ? 14 : 4, t + Math.min(1.2, n.dur * 0.7))
        if (filter) {
          filter.frequency.setTargetAtTime(2600 + 900 * this.p.speed, t, 0.09)
          filter.frequency.setTargetAtTime(1300, t + 0.35, 0.6)
        }
      }
      t += n.dur
    }
    out.gain.setTargetAtTime(0, t, 0.6)
  }

  private breathBuf: AudioBuffer | null = null
  private breath(): AudioBuffer {
    if (this.breathBuf) return this.breathBuf
    const ctx = this.ctx
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    return (this.breathBuf = buf)
  }

  // ── Shimmer ──────────────────────────────────────────────────────

  /** A soft bell (FM: a sine and an inharmonic partial), through the long echo. */
  private bell(midi: number, at: number, peak: number, decay = 2.6, ratio = 2.76): void {
    const ctx = this.ctx
    const g = this.g(0, this.shimmerGain)
    const f = hz(midi)
    const car = this.osc('sine', f, at, g)
    const mod = ctx.createOscillator()
    mod.frequency.value = f * ratio
    const idx = this.g(0)
    mod.connect(idx).connect(car.frequency)
    idx.gain.setValueAtTime(f * 1.2, at)
    idx.gain.setTargetAtTime(0, at, decay / 6)
    mod.start(at)
    mod.stop(at + decay + 0.2)
    car.stop(at + decay + 0.2)
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(peak, at + 0.01)
    g.gain.setTargetAtTime(0, at + 0.02, decay / 5)
  }

  // ── Mix ──────────────────────────────────────────────────────────

  private applyMix(now: boolean): void {
    const t = this.ctx.currentTime
    const layers = LAYERS[this.p.band]
    const night = Math.max(0, -this.p.sun)
    const tc = now ? 0.01 : 2
    this.padGain.gain.setTargetAtTime(layers.pad, t, tc)
    this.bassGain.gain.setTargetAtTime(layers.bass, t, tc)
    this.leadGain.gain.setTargetAtTime(this.p.band === 'critical' ? 0 : 1, t, tc)
    this.shimmerGain.gain.setTargetAtTime(1, t, tc)
    // Night and the edge of the Frontier: more space
    const spread = { high: 0, medium: 0.03, low: 0.12, critical: 0.25 }[this.p.band]
    const wet = Math.min(0.95, 0.4 + 0.25 * night + 0.25 * this.p.unresolved + spread)
    this.wet.gain.setTargetAtTime(wet, t, tc)
    this.dry.gain.setTargetAtTime(1 - wet * 0.6, t, tc) // more space, not more volume
    this.lastCutoff = -1
    this.applyBrightness()
  }

  /** Brighter by day, with the pool, with speed and the warp charge; darker at the edge. */
  private applyBrightness(): void {
    const t = this.ctx.currentTime
    const layers = LAYERS[this.p.band]
    const day = (this.p.sun + 1) / 2
    let cut = (380 + 1700 * layers.bright * (0.7 + 0.3 * day)) * (1 - 0.3 * this.p.unresolved)
    cut += 900 * this.p.speed + 3200 * this.p.charge * this.p.charge
    if (Math.abs(cut - this.lastCutoff) < 15) return
    this.lastCutoff = cut
    this.padFilter.frequency.setTargetAtTime(cut, t, this.p.charge > 0 ? 0.05 : 0.8)
    this.lfoDepth.gain.setTargetAtTime(cut * 0.38, t, 0.8)
    const night = Math.max(0, -this.p.sun)
    this.lfo.frequency.setTargetAtTime((1 / this.seed.swell) * (1 + 1.5 * this.p.speed) * (1 - 0.3 * night), t, 1)
  }

  private dispose(): void {
    clearTimeout(this.disposeTimer)
    const t = this.ctx.currentTime
    for (const v of [...this.pads, ...this.company, ...(this.bass ? [this.bass] : [])]) {
      for (const o of v.oscs) try { o.stop(t) } catch { /* stopped */ }
    }
    try { this.lfo.stop(t) } catch { /* stopped */ }
    this.level.disconnect()
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private g(value: number, dest?: AudioNode | AudioParam): GainNode {
    const g = this.ctx.createGain()
    g.gain.value = value
    if (dest) g.connect(dest as AudioNode)
    return g
  }

  private osc(type: OscillatorType, freq: number, at: number, dest: AudioNode | AudioParam): OscillatorNode {
    const o = this.ctx.createOscillator()
    o.type = type
    o.frequency.value = freq
    o.connect(dest as AudioNode)
    o.start(at)
    return o
  }
}
