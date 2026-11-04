/**
 * The music's shared plumbing: a bus, one long soft reverb and a slow echo
 * (2026-11-03). The engine builds it on the live context; the offline
 * renderer (render.ts) builds the same on an OfflineAudioContext so a piece
 * can be bounced to a file and listened to away from the game.
 */

export interface MusicKit {
  ctx: BaseAudioContext
  /** Every piece ends here (the engine's Music volume sits on it). */
  bus: GainNode
  reverb: AudioNode
  echo: AudioNode
}

export function createMusicKit(ctx: BaseAudioContext, dest: AudioNode, busGain = 0): MusicKit {
  const bus = ctx.createGain()
  bus.gain.value = busGain
  bus.connect(dest)

  const reverb = ctx.createConvolver()
  reverb.buffer = impulse(ctx, 5.5)
  reverb.connect(bus)

  // A slower echo for the lead and shimmer (Vangelis' long delays)
  const echo = ctx.createGain()
  const delay = ctx.createDelay(2)
  delay.delayTime.value = 0.46
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = 2200
  const fb = ctx.createGain()
  fb.gain.value = 0.42
  const out = ctx.createGain()
  out.gain.value = 0.55
  echo.connect(delay)
  delay.connect(tone)
  tone.connect(fb).connect(delay)
  tone.connect(out).connect(bus)

  return { ctx, bus, reverb, echo }
}

/** A stereo reverb tail: decorrelated noise under an exponential decay, darker as it fades. */
export function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const x = i / len
      // One-pole lowpass whose cutoff falls over the tail (air absorbs the highs)
      const k = 0.55 - 0.45 * x
      lp += k * (Math.random() * 2 - 1 - lp)
      const pre = Math.min(1, i / (ctx.sampleRate * 0.03)) // 30 ms swell, no hard attack
      d[i] = lp * pre * Math.exp(-4.2 * x) * 0.9
    }
  }
  return buf
}

