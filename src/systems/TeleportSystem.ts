/**
 * Aweborn — Teleport System (Phase 08, Milestone 8A)
 *
 * Handles teleport links: `https://aweborn.org/w/<worldId>[?a=in]`.
 * NFC cards and QR codes encode these URLs, so this is a permanent public API.
 *
 * Flow: parse the URL on boot → `GET /worlds/:id` on the sync-service →
 * place the player in the world's gravity well (orbit, the default) or enter
 * it (`?a=in`) → reuse the warp arrival flash → show a notice.
 *
 * Tapping a card while the app is open is a normal navigation (new page
 * load), so boot handling covers it. `teleportToId()` is the in-app entry
 * point for future share links / Worlidex warps.
 */

import * as THREE from 'three'
import { create } from 'zustand'
import {
  parseTeleportLink,
  type ArrivalMode,
  type Vec3,
} from '@aweborn/shared/crdt-schema'
import { flightController } from './FlightController'
import { warpSystem } from './WarpSystem'
import { useUniverseStore } from '../stores/universeStore'

// ── Config ───────────────────────────────────────────────────────────

const SYNC_URL: string = import.meta.env.VITE_SYNC_URL ?? 'ws://localhost:1234'
/** HTTP origin of the sync-service (ws→http, wss→https). */
export const SYNC_HTTP_URL = SYNC_URL.replace(/^ws/, 'http').replace(/\/+$/, '')

/**
 * Orbit arrival distance from a world's center. Inside GravitySystem's
 * captured-orbit band (0.8–3), so the orbit logic takes over on arrival.
 */
const ORBIT_ARRIVAL_DISTANCE = 2.5

/** The portal is bigger (halo r≈2.5, ring r=3): arrive just outside it. */
const PORTAL_ARRIVAL_DISTANCE = 6

/** Pause between the arrival flash and entering the world (`?a=in`). */
const ENTER_DELAY_MS = 700

const LOOKUP_TIMEOUT_MS = 8000

// ── Types ────────────────────────────────────────────────────────────

/** Response of `GET /worlds/:id` (server/sync-service/src/index.ts). */
export interface WorldLookup {
  id: string
  name: string
  color: string
  solidified: boolean
  sector: string
  position: Vec3
  isOrigin: boolean
}

export interface TeleportNotice {
  kind: 'arrived' | 'error'
  title: string
  detail: string
  color?: string
}

interface TeleportState {
  /** In-flight lookup (for a "Teleporting…" hint). */
  pending: boolean
  notice: TeleportNotice | null
  /** Bumps on every new notice so the toast restarts its timer. */
  noticeSeq: number
  dismiss: () => void
}

export const useTeleportStore = create<TeleportState>((set) => ({
  pending: false,
  notice: null,
  noticeSeq: 0,
  dismiss: () => set({ notice: null }),
}))

function showNotice(notice: TeleportNotice): void {
  useTeleportStore.setState((s) => ({ notice, noticeSeq: s.noticeSeq + 1 }))
}

// ── Lookup ───────────────────────────────────────────────────────────

type LookupResult =
  | { ok: true; world: WorldLookup }
  | { ok: false; reason: 'not_found' | 'unreachable' }

async function lookupWorld(worldId: string): Promise<LookupResult> {
  try {
    const res = await fetch(`${SYNC_HTTP_URL}/worlds/${encodeURIComponent(worldId)}`, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    })
    if (res.status === 404 || res.status === 400) return { ok: false, reason: 'not_found' }
    if (!res.ok) return { ok: false, reason: 'unreachable' }
    return { ok: true, world: (await res.json()) as WorldLookup }
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}

// ── Teleport System ──────────────────────────────────────────────────

class TeleportSystem {
  private _snapRequested = false
  private _enterTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Handle a teleport link in the current URL, if any. Call once on boot.
   * Resets the address bar to `/` afterwards so a reload doesn't re-teleport.
   */
  async handleBootLink(location: Pick<Location, 'pathname' | 'search'> = window.location): Promise<void> {
    const link = parseTeleportLink(location.pathname, location.search)
    if (!link) return
    window.history.replaceState(null, '', '/')

    if (!link.worldId) {
      showNotice({
        kind: 'error',
        title: 'That link doesn’t lead anywhere',
        detail: 'It isn’t a valid world address. You’re at the Aweborn Portal.',
      })
      return
    }
    await this.teleportToId(link.worldId, link.arrival)
  }

  /** Look up a world by ID and teleport to it. */
  async teleportToId(worldId: string, arrival: ArrivalMode = 'orbit'): Promise<boolean> {
    useTeleportStore.setState({ pending: true })
    const result = await lookupWorld(worldId)
    useTeleportStore.setState({ pending: false })

    if (!result.ok) {
      showNotice(
        result.reason === 'not_found'
          ? {
              kind: 'error',
              title: 'This world has faded',
              detail: 'It’s no longer in the universe, or never was. You’re at the Aweborn Portal.',
            }
          : {
              kind: 'error',
              title: 'Couldn’t reach the universe',
              detail: 'Check your connection and try the link again.',
            },
      )
      return false
    }

    this.teleportTo(result.world, arrival)
    return true
  }

  /** Teleport to an already-resolved world. */
  teleportTo(world: WorldLookup, arrival: ArrivalMode): void {
    const store = useUniverseStore.getState()
    if (this._enterTimer) clearTimeout(this._enterTimer)
    if (store.activeWorldId) store.exitWorld()
    warpSystem.cancel()
    warpSystem.skipFirstSpawnLock() // auto-lock the world we arrive at, not the portal

    // Arrive on the world's +Z side. Identity rotation faces −Z, i.e. the world.
    const distance = world.isOrigin ? PORTAL_ARRIVAL_DISTANCE : ORBIT_ARRIVAL_DISTANCE
    const arrivalPos = new THREE.Vector3(world.position.x, world.position.y, world.position.z + distance)
    flightController.reset(arrivalPos, new THREE.Quaternion())
    this._snapRequested = true
    warpSystem.requestArrivalEffect()

    // The portal has no interior, so `?a=in` on Origin still orbits.
    const enter = arrival === 'in' && !world.isOrigin
    showNotice({
      kind: 'arrived',
      title: world.name,
      detail: enter ? 'Teleporting inside…' : world.isOrigin ? 'The Aweborn Portal' : 'You’ve arrived in orbit',
      color: world.color,
    })

    if (enter) {
      this._enterTimer = setTimeout(() => {
        this._enterTimer = null
        useUniverseStore.getState().enterWorld(world.id)
      }, ENTER_DELAY_MS)
    }
  }

  /**
   * True once after a teleport: FlightSystem snaps the camera to the new
   * position instead of smoothly chasing it across the universe.
   */
  consumeSnapRequest(): boolean {
    const requested = this._snapRequested
    this._snapRequested = false
    return requested
  }
}

/** Singleton teleport system. */
export const teleportSystem = new TeleportSystem()
