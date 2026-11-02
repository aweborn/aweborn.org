import { audio } from './engine'

/**
 * Creature sounds (Phase 07 Life & minds): synthesized, free, positional.
 *
 * A living creation breathes and groans and its feet land; until a creator makes
 * real sound effects (ElevenLabs SFX needs the key), these come from WebAudio:
 * a groan is a low sawtooth pushed through two moving vocal-tract formants plus
 * breath noise; a footfall is a falling sine thump with a dusty noise tail. Size
 * sets the pitch (a giant's groan sits near 45 Hz). Everything goes through the
 * engine's world bus, so mute, volume and hidden tabs apply.
 *
 * Voice lines of minds also play here: lower and slower for big creatures
 * (playbackRate lowers pitch and formants together: "huge"), with a low-shelf boost.
 */

export type CreatureSize = 'small' | 'human' | 'large' | 'giant'

const PITCH: Record<CreatureSize, number> = { small: 240, human: 120, large: 75, giant: 46 }
const RATE: Record<CreatureSize, number> = { small: 1.12, human: 1, large: 0.9, giant: 0.8 }
const BOOST_DB: Record<CreatureSize, number> = { small: 0, human: 0, large: 4, giant: 7 }

function panner(ctx: AudioContext, x: number, y: number, z: number, ref: number, max: number): PannerNode {
  const p = ctx.createPanner()
  p.panningModel = 'equalpower' // HRTF is ~10× the CPU on phones
  p.distanceModel = 'inverse'
  p.refDistance = ref
  p.maxDistance = max
  p.rolloffFactor = 1.1
  if (p.positionX) {
    p.positionX.value = x
    p.positionY.value = y
    p.positionZ.value = z
  } else p.setPosition(x, y, z)
  return p
}

let noiseBuf: AudioBuffer | null = null
function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const d = b.getChannelData(0)
  let lp = 0
  for (let i = 0; i < d.length; i++) {
    lp += (Math.random() * 2 - 1 - lp) * 0.2 // a little pink-ish: less hiss
    d[i] = lp * 2.2
  }
  noiseBuf = b
  return b
}

/** A slow, chesty groan from (x, y, z). `seed` varies the contour between creatures. */
export function groan(x: number, y: number, z: number, size: CreatureSize, seed = Math.random()): void {
  const bus = audio.worldBus()
  if (!bus || !audio.audibleNow) return
  const { ctx, input } = bus
  const t = ctx.currentTime
  const dur = size === 'giant' ? 2.6 + seed * 1.2 : 1.4 + seed * 0.8
  const f0 = PITCH[size] * (0.92 + seed * 0.16)
  const out = panner(ctx, x, y, z, size === 'giant' ? 8 : 3, 80)
  out.connect(input)
  const env = ctx.createGain()
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(0.5, t + dur * 0.25)
  env.gain.setTargetAtTime(0.0001, t + dur * 0.6, dur * 0.18)
  env.connect(out)

  // Voice: sawtooth with a slow pitch fall and a little wobble
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(f0 * 1.08, t)
  osc.frequency.exponentialRampToValueAtTime(f0 * 0.82, t + dur)
  const wob = ctx.createOscillator()
  wob.frequency.value = 5 + seed * 3
  const wobG = ctx.createGain()
  wobG.gain.value = f0 * 0.03
  wob.connect(wobG).connect(osc.frequency)

  // Two formants sliding from "o" toward "uh"
  const mix = ctx.createGain()
  mix.gain.value = 0.9
  for (const [a, b, q] of [[380, 520, 6], [800, 1050, 8]] as const) {
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = q
    const k = PITCH[size] / 120
    f.frequency.setValueAtTime(a * Math.sqrt(k), t)
    f.frequency.linearRampToValueAtTime(b * Math.sqrt(k), t + dur)
    osc.connect(f).connect(mix)
  }
  // Body: the fundamental itself, low-passed
  const body = ctx.createBiquadFilter()
  body.type = 'lowpass'
  body.frequency.value = f0 * 3
  osc.connect(body).connect(mix)
  mix.connect(env)

  // Breath / gravel
  const n = ctx.createBufferSource()
  n.buffer = noise(ctx)
  const nf = ctx.createBiquadFilter()
  nf.type = 'bandpass'
  nf.frequency.value = size === 'giant' ? 260 : 700
  nf.Q.value = 0.8
  const ng = ctx.createGain()
  ng.gain.value = 0.25
  n.connect(nf).connect(ng).connect(env)

  osc.start(t)
  wob.start(t)
  n.start(t, Math.random())
  const end = t + dur + 1
  osc.stop(end)
  wob.stop(end)
  n.stop(end)
  window.setTimeout(() => out.disconnect(), (dur + 1.2) * 1000)
}

/** A footfall at (x, y, z): weight 0 (light) … 1 (colossus). */
export function footstep(x: number, y: number, z: number, weight: number): void {
  const bus = audio.worldBus()
  if (!bus || !audio.audibleNow) return
  const { ctx, input } = bus
  const t = ctx.currentTime
  const w = Math.max(0, Math.min(1, weight))
  const out = panner(ctx, x, y, z, 2 + w * 8, 70)
  out.connect(input)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.18 + w * 0.5, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25 + w * 0.6)
  g.connect(out)
  const thump = ctx.createOscillator()
  thump.type = 'sine'
  thump.frequency.setValueAtTime(110 - w * 60, t)
  thump.frequency.exponentialRampToValueAtTime(30, t + 0.2 + w * 0.3)
  thump.connect(g)
  const n = ctx.createBufferSource()
  n.buffer = noise(ctx)
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 300 + (1 - w) * 900
  const ng = ctx.createGain()
  ng.gain.setValueAtTime(0.35, t)
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.15 + w * 0.35)
  n.connect(lp).connect(ng).connect(out)
  thump.start(t)
  n.start(t, Math.random())
  thump.stop(t + 1.2)
  n.stop(t + 1.2)
  window.setTimeout(() => out.disconnect(), 1500)
}

/**
 * A mind's spoken line from (x, y, z). Returns how long it lasts in seconds (0 if it
 * couldn't play), so the body can talk for that long.
 */
export async function speak(url: string, x: number, y: number, z: number, size: CreatureSize): Promise<number> {
  const bus = audio.worldBus()
  if (!bus || !audio.audibleNow) return 0
  const buf = await audio.loadClip(url)
  if (!buf) return 0
  const { ctx, input } = bus
  const out = panner(ctx, x, y, z, size === 'giant' ? 10 : 4, 90)
  out.connect(input)
  const shelf = ctx.createBiquadFilter()
  shelf.type = 'lowshelf'
  shelf.frequency.value = 140
  shelf.gain.value = BOOST_DB[size]
  shelf.connect(out)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = RATE[size]
  const g = ctx.createGain()
  g.gain.value = 1
  src.connect(g).connect(shelf)
  src.onended = () => out.disconnect()
  src.start()
  return buf.duration / RATE[size]
}

