/**
 * Aweborn — Teleport System (Phase 08, Milestone 8A)
 *
 * Handles teleport links: `https://aweborn.org/w/<worldId>`.
 * NFC cards and QR codes encode these URLs, so this is a permanent public API.
 *
 * Flow: parse the URL on boot → `GET /worlds/:id` on the sync-service →
 * reuse the warp arrival flash → **enter the world** (every link lands inside,
 * like opening a game pack; Alex, 2026-10-13) → show a notice. Origin has no
 * interior, so its link arrives at the portal. Older links may carry `?a=in`;
 * the query string is ignored.
 *
 * Tapping a card while the app is open is a normal navigation (new page
 * load), so boot handling covers it. `teleportToId()` is the in-app entry
 * point for future share links / World Index warps.
 */

import * as THREE from 'three'
import { create } from 'zustand'
import {
  parseTeleportLink,
  type Vec3,
} from '@aweborn/shared/crdt-schema'
import { flightController } from './FlightController'
import { warpSystem } from './WarpSystem'
import { useUniverseStore } from '../stores/universeStore'
import { recordArrival } from '../stores/worldIndexStore'

// ── Config ───────────────────────────────────────────────────────────

const SYNC_URL: string = import.meta.env.VITE_SYNC_URL ?? 'ws://localhost:1234'
/** HTTP origin of the sync-service (ws→http, wss→https). */
export const SYNC_HTTP_URL = SYNC_URL.replace(/^ws/, 'http').replace(/\/+$/, '')

/**
 * Arrival distance from a world's center, where the player briefly appears
 * (inside GravitySystem's captured-orbit band, 0.8–3) before entering it.
 */
const ORBIT_ARRIVAL_DISTANCE = 2.5

/** The portal is bigger (halo r≈2.5, ring r=3): arrive just outside it. */
const PORTAL_ARRIVAL_DISTANCE = 6

/** Pause between the arrival flash and entering the world. */
const ENTER_DELAY_MS = 700

const LOOKUP_TIMEOUT_MS = 8000

// ── Types ────────────────────────────────────────────────────────────

/** Response of `GET /worlds/:id` (server/sync-service/src/index.ts). */
export interface WorldLookup {
  id: string
  name: string
  color: string
  /** Added for the World Index; absent on older servers. */
  creator?: string
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

export function showNotice(notice: TeleportNotice): void {
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
  async handleBootLink(location: Pick<Location, 'pathname'> = window.location): Promise<void> {
    const link = parseTeleportLink(location.pathname)
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
    await this.teleportToId(link.worldId)
  }

  /** Look up a world by ID and teleport into it. */
  async teleportToId(worldId: string): Promise<boolean> {
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

    this.teleportTo(result.world)
    return true
  }

  /** Teleport into an already-resolved world (Origin: to the portal). */
  teleportTo(world: WorldLookup): void {
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
    recordArrival(world) // sighted by link (a card tap is a link)

    // The portal has no interior, so Origin's link arrives at the portal.
    const enter = !world.isOrigin
    showNotice({
      kind: 'arrived',
      title: world.name,
      detail: enter ? 'Teleporting inside…' : 'The Aweborn Portal',
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
  /** Ask FlightSystem to snap the camera on the next frame (e.g. after restoring a saved spot). */
  requestSnap(): void {
    this._snapRequested = true
  }

  consumeSnapRequest(): boolean {
    const requested = this._snapRequested
    this._snapRequested = false
    return requested
  }
}

/** Singleton teleport system. */
export const teleportSystem = new TeleportSystem()
