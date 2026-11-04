import { UNIVERSE_SEED, seedFromId, type MusicSeed } from '@aweborn/shared/music'
import { createMusicKit } from './kit'
import { GenerativePiece, type PieceParams } from './piece'

/**
 * Bounce a piece to a WAV, away from the game (2026-11-03): agents can only
 * read meters, so this is how Alex (or anyone) listens to a band, a sun, a
 * world's seed without flying there. Console:
 *
 *   awebornMusic.render({ seconds: 90, band: 'high' })        the universe
 *   awebornMusic.render({ world: '<world id>', sun: -1 })      a world at night
 *
 * Downloads `aweborn-music-….wav`. Renders faster than real time.
 */

export { seedFromId, UNIVERSE_SEED }

export interface RenderOptions extends Partial<PieceParams> {
  seconds?: number
  /** A world's id (its seeded music); omitted = the universe. */
  world?: string
  seed?: MusicSeed
  sampleRate?: number
}

export async function renderMusic(opts: RenderOptions = {}): Promise<AudioBuffer> {
  const seconds = Math.max(5, Math.min(600, opts.seconds ?? 60))
  const rate = opts.sampleRate ?? 44100
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate)
  const master = ctx.createGain()
  master.connect(ctx.destination)
  const kit = createMusicKit(ctx, master, 1)
  const seed = opts.seed ?? (opts.world ? seedFromId(opts.world) : UNIVERSE_SEED)
  const piece = new GenerativePiece(kit, seed, kit.bus, opts.world ?? 'universe')
  const { seconds: _s, world: _w, seed: _seed, sampleRate: _r, ...params } = opts
  piece.set(params)
  piece.level.gain.value = 1
  // Tick the piece every quarter second of render time, as the director does live
  const STEP = 0.25
  for (let t = STEP; t < seconds; t += STEP) {
    void ctx.suspend(t).then(() => {
      piece.tick()
      void ctx.resume()
    })
  }
  piece.start()
  return ctx.startRendering()
}

/** 16-bit PCM WAV bytes. */
export function toWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels
  const n = buf.length
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2))
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); data.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true)
  data.setUint32(24, buf.sampleRate, true); data.setUint32(28, buf.sampleRate * ch * 2, true)
  data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true)
  str(36, 'data'); data.setUint32(40, n * ch * 2, true)
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c))
  let o = 44
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]))
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true)
      o += 2
    }
  }
  return new Blob([data.buffer], { type: 'audio/wav' })
}

/** Render, then download the file. */
export async function downloadMusic(opts: RenderOptions = {}): Promise<string> {
  const buf = await renderMusic(opts)
  const name = `aweborn-music-${opts.world ? opts.world.slice(0, 8) : 'universe'}-${opts.band ?? 'medium'}-${Math.round(buf.duration)}s.wav`
  const a = document.createElement('a')
  a.href = URL.createObjectURL(toWav(buf))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  return name
}
