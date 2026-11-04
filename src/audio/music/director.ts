import type { PoolBand } from '@aweborn/shared/mana-level'
import { UNIVERSE_SEED, seedFromId } from '@aweborn/shared/music'
import { audio, type MusicKit } from '../engine'
import { GenerativePiece, type PieceParams } from './piece'
import { FileLoop } from './fileLoop'
import { AUTH_URL } from '../../lib/player'

/**
 * The music director (2026-11-03 grill). Always on:
 *
 *   - In space, the universe plays its piece. Every world is a sound source:
 *     as you near one, the universe music fades down and the world's music
 *     fades up from where the world is (only the 1–2 closest play; a world's
 *     generated music downloads only when you get close).
 *   - A world plays its creator's ambient sound if set, else its planner
 *     music, else its own seeded version of the universe music. The same
 *     source plays inside and out, and carries on as you step through.
 *   - Inside Origin, the universe piece plays its home theme.
 *   - The ears sit on the player's character, facing the way it faces.
 *
 * MusicDriver (a component in the 3D scene) feeds `update` ~15 times a second.
 */

export interface SoundingWorld {
  id: string
  /** Universe position (in space). */
  x: number
  y: number
  z: number
  distance: number
  music?: string
  ambient?: string
  ghost?: boolean
}

export interface DirectorInput {
  /** The ears: position, forward and up. */
  ear: { x: number; y: number; z: number; fx: number; fy: number; fz: number; ux: number; uy: number; uz: number }
  /** Inside a world (null = in space). */
  inside: { id: string; origin: boolean; music?: string; ambient?: string } | null
  /** Worlds near you in space, nearest first. */
  near: SoundingWorld[]
  originDistance: number
  /** 0 … 1, how far past the Frontier you are. */
  beyondFrontier: number
  speed: number
  charge: number
  leaping: boolean
  company: number
  sun: number
  band: PoolBand
  maxSlots: number
}

/** World music is heard from this far, and fully there this close (universe units). */
export const HEAR_FAR = 180
export const HEAR_NEAR = 28

const smooth = (far: number, near: number, d: number) => {
  const x = Math.min(1, Math.max(0, (far - d) / (far - near)))
  return x * x * (3 - 2 * x)
}

interface Slot {
  key: string
  worldId: string
  source: GenerativePiece | FileLoop | null
  panner: PannerNode
  level: number
  loading: boolean
}

export type MusicOverrides = Partial<Pick<PieceParams, 'band' | 'sun' | 'unresolved' | 'home' | 'company' | 'speed'>>

class MusicDirector {
  private universe: GenerativePiece | null = null
  private universeLevel = -1
  private slots = new Map<string, Slot>()
  private wasCharging = false
  /** Console previews (`awebornMusic.*`): fixed values that win over the game's. */
  overrides: MusicOverrides = {}
  /** Console preview: play this world's seeded music as if you stood inside it. */
  previewWorld: string | null = null

  update(input: DirectorInput): void {
    const kit = audio.musicKit()
    if (!kit || kit.ctx.state !== 'running') return
    const { ear } = input
    audio.setListener(ear.x, ear.y, ear.z, ear.fx, ear.fy, ear.fz, ear.ux, ear.uy, ear.uz)

    const o = this.overrides
    const base: PieceParams = {
      band: o.band ?? input.band,
      sun: o.sun ?? input.sun,
      speed: o.speed ?? Math.min(1, input.speed),
      unresolved: 0,
      home: 0,
      company: o.company ?? input.company,
      charge: input.charge,
    }

    // Which worlds sing, and how loud
    const wanted = new Map<string, { worldId: string; level: number; file?: string; ambient: boolean; ghost: boolean; at: [number, number, number] }>()
    const inside = this.previewWorld ? { id: this.previewWorld, origin: false } as DirectorInput['inside'] : input.inside
    let worldMix = 0
    if (inside && !inside.origin) {
      const file = inside.ambient ?? inside.music
      wanted.set(`${inside.id}|${file ?? 'seed'}`, { worldId: inside.id, level: 1, file, ambient: !!inside.ambient, ghost: false, at: [ear.x, ear.y, ear.z] })
      worldMix = 1
    } else if (!inside) {
      let nearest = 0
      for (const w of input.near.slice(0, Math.max(1, input.maxSlots))) {
        // The nearest world leads; a second one only shows through as the first fades (two keys at once is mud)
        const raw = smooth(HEAR_FAR, HEAR_NEAR, w.distance)
        const level = nearest ? raw * (1 - 0.8 * nearest) : raw
        if (!nearest) nearest = raw
        if (level < 0.005) continue
        const file = w.ambient ?? w.music
        wanted.set(`${w.id}|${file ?? 'seed'}`, { worldId: w.id, level, file, ambient: !!w.ambient, ghost: !!w.ghost, at: [w.x, w.y, w.z] })
        worldMix = Math.max(worldMix, level)
      }
    }

    // The universe piece: always in space (fading under a world), home inside Origin
    if (!this.universe || this.universe.seed !== UNIVERSE_SEED) {
      this.universe = new GenerativePiece(kit, UNIVERSE_SEED, kit.bus, 'universe')
      this.universe.start()
    }
    const uLevel = inside ? (inside.origin ? 1 : 0) : 1 - 0.88 * worldMix
    this.universe.set({
      ...base,
      home: o.home ?? (inside?.origin ? 1 : smooth(260, 50, input.originDistance)),
      unresolved: o.unresolved ?? (inside ? 0 : input.beyondFrontier),
      company: inside?.origin ? base.company : inside ? 0 : base.company,
    })
    this.fade(this.universe.level, uLevel, this.universeLevel, kit)
    this.universeLevel = uLevel
    this.universe.tick()

    // World slots
    for (const [key, slot] of this.slots) {
      if (wanted.has(key)) continue
      slot.source?.stop(2.5)
      setTimeout(() => slot.panner.disconnect(), 3500)
      this.slots.delete(key)
    }
    for (const [key, w] of wanted) {
      let slot = this.slots.get(key)
      if (!slot) {
        const panner = this.panner(kit)
        slot = { key, worldId: w.worldId, source: null, panner, level: -1, loading: false }
        this.slots.set(key, slot)
        if (w.file) this.loadFile(kit, slot, w.file, w.ambient)
        else {
          slot.source = new GenerativePiece(kit, seedFromId(w.worldId), panner, w.worldId)
          slot.source.start()
        }
      }
      this.place(slot.panner, w.at, kit, !!inside)
      if (slot.source instanceof GenerativePiece) {
        slot.source.set({ ...base, unresolved: o.unresolved ?? (inside ? 0 : w.ghost ? 0.7 : input.beyondFrontier), home: 0, company: inside ? base.company : 0 })
      }
      if (slot.source) {
        this.fade(slot.source.level, w.level, slot.level, kit)
        slot.level = w.level
        slot.source.tick()
      }
    }

    // A warp: everything is pulled into the charge, then blooms on a new chord
    if (this.wasCharging && input.leaping) {
      this.universe.leap()
      for (const s of this.slots.values()) if (s.source instanceof GenerativePiece) s.source.leap()
    }
    this.wasCharging = input.charge > 0.05
  }

  /** What's playing (console: `awebornMusic.status()`). */
  status(): Record<string, unknown> {
    return {
      universe: this.universe ? { level: Math.round(this.universeLevel * 100) / 100, ...this.universe.status() } : null,
      worlds: [...this.slots.values()].map((s) => ({
        world: s.worldId,
        level: Math.round(s.level * 100) / 100,
        source: s.source instanceof FileLoop ? 'file' : s.source ? s.source.status() : s.loading ? 'loading' : 'none',
      })),
      overrides: this.overrides,
    }
  }

  private loadFile(kit: MusicKit, slot: Slot, file: string, ambient: boolean): void {
    slot.loading = true
    void audio.loadClip(assetUrl(file)).then((buf) => {
      slot.loading = false
      if (this.slots.get(slot.key) !== slot) return // walked away meanwhile
      if (!buf) {
        // Couldn't fetch it (offline?): the world's seeded music stands in
        slot.source = new GenerativePiece(kit, seedFromId(slot.worldId), slot.panner, slot.worldId)
      } else {
        slot.source = new FileLoop(kit, buf, slot.panner, ambient ? 0.35 : 0.5)
      }
      slot.source.start()
    })
  }

  private panner(kit: MusicKit): PannerNode {
    const p = kit.ctx.createPanner()
    p.panningModel = 'equalpower' // cheap; HRTF is overkill for music
    p.distanceModel = 'linear'
    p.rolloffFactor = 0 // loudness is the crossfade, not the panner
    p.connect(kit.bus)
    return p
  }

  private place(p: PannerNode, at: [number, number, number], kit: MusicKit, instant: boolean): void {
    const t = kit.ctx.currentTime
    if (p.positionX && instant) {
      p.positionX.setValueAtTime(at[0], t)
      p.positionY.setValueAtTime(at[1], t)
      p.positionZ.setValueAtTime(at[2], t)
    } else if (p.positionX) {
      p.positionX.setTargetAtTime(at[0], t, 0.1)
      p.positionY.setTargetAtTime(at[1], t, 0.1)
      p.positionZ.setTargetAtTime(at[2], t, 0.1)
    } else p.setPosition(at[0], at[1], at[2])
  }

  private fade(g: GainNode, target: number, last: number, kit: MusicKit): void {
    if (Math.abs(target - last) < 0.004) return
    g.gain.setTargetAtTime(target, kit.ctx.currentTime, last < 0 ? 1.2 : 0.5)
  }
}

const assetUrl = (file: string) => `${AUTH_URL}/assets/${file}`

export const music = new MusicDirector()
