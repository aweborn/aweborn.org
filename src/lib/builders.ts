import { create } from 'zustand'
import type { BuildRequestView, MyBuildRequest } from '@aweborn/shared/build-requests'
import { wandererTag } from '@aweborn/shared/names'
import { AUTH_URL } from './player'

/**
 * Builders and asking to build (2026-11-07). The server enforces every rule
 * (shared/world-policy.ts planBuilderChange, shared/build-requests.ts); this is
 * the client's calls plus the inbox of asks waiting for you, which arrives with
 * the World Index refresh (`/api/player/me`) and after each answer.
 */

export type Result<T> = { ok: true; data: T } | { ok: false; message: string; retryAt?: number }

async function call<T>(path: string, body?: unknown): Promise<Result<T>> {
  const res = await fetch(`${AUTH_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  }).catch(() => null)
  if (!res) return { ok: false, message: 'You seem to be offline. Try again when you’re connected.' }
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; retryAt?: number }
  if (!res.ok) return { ok: false, message: data.message ?? 'That didn’t work. Please try again.', retryAt: data.retryAt }
  return { ok: true, data }
}

type BuildersReply = { worldId: string; coCreators: string[] }

/** Add or remove one builder (creator + builders add; only the creator removes; anyone steps down). */
export const changeBuilder = (worldId: string, change: { add: string } | { remove: string }) =>
  call<BuildersReply>('/api/player/world/builders', { worldId, ...change })

export const myAsk = (worldId: string) =>
  call<MyBuildRequest>(`/api/player/world/build-request?worldId=${encodeURIComponent(worldId)}`)

export const askToBuild = (worldId: string) => call<MyBuildRequest>('/api/player/world/build-request', { worldId })

export const withdrawAsk = (worldId: string) => call<MyBuildRequest>('/api/player/world/build-request/withdraw', { worldId })

/** Approve (they become a builder) or decline an ask; the inbox updates either way. */
export async function answerAsk(worldId: string, requester: string, approve: boolean): Promise<Result<Partial<BuildersReply>>> {
  const r = await call<Partial<BuildersReply>>('/api/player/world/build-request/decide', { worldId, requester, approve })
  // Answered (by us, or someone else got there first): it leaves the inbox
  useBuildRequestsStore.getState().drop(worldId, requester)
  void refreshBuildRequests()
  return r
}

// ── Inbox ────────────────────────────────────────────────────────────

interface BuildRequestsState {
  requests: BuildRequestView[]
  /** New asks to tell the player about once (the World Index chip shows the notice). */
  announce: { fresh: BuildRequestView[]; seq: number } | null
  set: (requests: BuildRequestView[]) => void
  drop: (worldId: string, requester: string) => void
}

export const useBuildRequestsStore = create<BuildRequestsState>((set) => ({
  requests: [],
  announce: null,
  set: (requests) => set({ requests }),
  drop: (worldId, requester) =>
    set((s) => ({ requests: s.requests.filter((r) => !(r.worldId === worldId && r.requester === requester)) })),
}))

const SEEN_KEY = 'aw.buildAsksSeen'

function lastSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0
  } catch {
    return 0
  }
}

function markSeen(at: number): void {
  try {
    localStorage.setItem(SEEN_KEY, String(at))
  } catch {
    /* private mode: we may tell them twice */
  }
}

/** Take a fresh inbox (from /me or the inbox route); flag asks the player hasn't been told about. */
export function receiveBuildRequests(requests: BuildRequestView[] | undefined): void {
  if (!Array.isArray(requests)) return
  useBuildRequestsStore.getState().set(requests)
  const seen = lastSeen()
  const fresh = requests.filter((r) => r.askedAt > seen)
  if (!fresh.length) return
  markSeen(Math.max(...fresh.map((r) => r.askedAt)))
  useBuildRequestsStore.setState((s) => ({ announce: { fresh, seq: (s.announce?.seq ?? 0) + 1 } }))
}

/** The notice for newly arrived asks. */
export function announceTitle(fresh: BuildRequestView[]): string {
  return fresh.length === 1
    ? `${askerName(fresh[0])} asked to build in ${fresh[0].worldName}`
    : `${fresh.length} people asked to build in your worlds`
}

/** Their chosen name, or their wanderer tag. */
export const askerName = (r: BuildRequestView): string => r.requesterName ?? wandererTag(r.requester)

export async function refreshBuildRequests(): Promise<void> {
  const r = await call<{ requests: BuildRequestView[] }>('/api/player/build-requests')
  if (r.ok) receiveBuildRequests(r.data.requests)
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** "just now", "2 days ago", "in 5 days". */
export function relativeTime(at: number, now = Date.now()): string {
  const s = (at - now) / 1000
  const abs = Math.abs(s)
  if (abs < 60) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), 'hour')
  return rtf.format(Math.round(s / 86_400), 'day')
}
