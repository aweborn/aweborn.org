import type { MusicKit } from './kit'

/**
 * A world's generated music (or its creator's ambient sound) as an endless
 * loop: each pass fades into the next over a few seconds, so a ~3 minute
 * piece never has an audible seam. Goes through `level` (the director's
 * crossfade) into `dest`.
 */
const XFADE = 4

export class FileLoop {
  readonly level: GainNode
  private readonly ctx: BaseAudioContext
  private nextStart = 0
  private stopped = false
  private live: { src: AudioBufferSourceNode; gain: GainNode }[] = []
  private readonly buffer: AudioBuffer
  private readonly peak: number

  constructor(kit: MusicKit, buffer: AudioBuffer, dest: AudioNode, peak = 0.5) {
    this.ctx = kit.ctx
    this.buffer = buffer
    this.peak = peak
    this.level = this.ctx.createGain()
    this.level.gain.value = 0
    this.level.connect(dest)
  }

  start(): void {
    this.nextStart = this.ctx.currentTime + 0.05
    this.tick()
  }

  /** Schedules the next pass shortly before this one ends. */
  tick(): void {
    if (this.stopped) return
    const now = this.ctx.currentTime
    if (now + 1.5 < this.nextStart) return
    const at = Math.max(now + 0.05, this.nextStart)
    const dur = this.buffer.duration
    const fade = Math.min(XFADE, dur / 4)
    const src = this.ctx.createBufferSource()
    src.buffer = this.buffer
    const gain = this.ctx.createGain()
    const first = this.live.length === 0
    gain.gain.setValueAtTime(first ? this.peak : 0, at)
    if (!first) gain.gain.linearRampToValueAtTime(this.peak, at + fade)
    gain.gain.setValueAtTime(this.peak, at + dur - fade)
    gain.gain.linearRampToValueAtTime(0, at + dur)
    src.connect(gain).connect(this.level)
    src.start(at)
    src.stop(at + dur + 0.05)
    const entry = { src, gain }
    this.live.push(entry)
    src.onended = () => {
      this.live = this.live.filter((e) => e !== entry)
      gain.disconnect()
    }
    this.nextStart = at + dur - fade
  }

  stop(fade = 2.5): void {
    if (this.stopped) return
    this.stopped = true
    const t = this.ctx.currentTime
    this.level.gain.cancelScheduledValues(t)
    this.level.gain.setValueAtTime(this.level.gain.value, t)
    this.level.gain.setTargetAtTime(0, t, fade / 4)
    window.setTimeout(() => {
      for (const e of this.live) try { e.src.stop() } catch { /* ended */ }
      this.level.disconnect()
    }, (fade + 0.5) * 1000)
  }
}
