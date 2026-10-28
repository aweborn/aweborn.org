/**
 * Card sets in the World Index (Rough Draft M6d; ROADMAP "Collector view").
 *
 * The list is small and public (`GET /card-sets` on the sync service). It is
 * fetched when the World Index opens (at most every 5 minutes) and kept in
 * localStorage so the grouping still works offline.
 */
import { useSyncExternalStore } from 'react'
import type { WorldIndexEntry } from '@aweborn/shared/crdt-schema'
import { cardSetNumber, type CardSet } from '@aweborn/shared/cards'
import { AUTH_URL } from './player'

const STORAGE_KEY = 'aweborn.cardSets.v1'
const REFRESH_MS = 5 * 60_000

function readStored(): readonly CardSet[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    return isSetList(v) ? v : []
  } catch {
    return []
  }
}

function isSetList(v: unknown): v is CardSet[] {
  return Array.isArray(v) && v.every((s) =>
    s && typeof s === 'object'
    && typeof (s as CardSet).id === 'string'
    && typeof (s as CardSet).name === 'string'
    && Array.isArray((s as CardSet).worldIds))
}

let sets: readonly CardSet[] = typeof localStorage === 'undefined' ? [] : readStored()
let fetchedAt = 0
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Fetch the sets (no-op if fetched in the last 5 minutes; offline keeps the stored list). */
export function refreshCardSets(): void {
  if (Date.now() - fetchedAt < REFRESH_MS) return
  fetchedAt = Date.now()
  void fetch(`${AUTH_URL}/card-sets`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { sets?: unknown } | null) => {
      if (!j || !isSetList(j.sets)) return
      sets = j.sets
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sets)) } catch { /* private mode */ }
      for (const fn of listeners) fn()
    })
    .catch(() => { fetchedAt = 0 })
}

export function useCardSets(): readonly CardSet[] {
  return useSyncExternalStore(subscribe, () => sets)
}

/** What a world's card says in its footer: its (first) set and number, else "World Index". */
export interface CardSetLabel { name: string; number: string }

export function setLabels(list: readonly CardSet[]): Map<string, CardSetLabel> {
  const m = new Map<string, CardSetLabel>()
  for (const s of list) {
    s.worldIds.forEach((id, i) => {
      if (!m.has(id)) m.set(id, { name: s.name, number: cardSetNumber(i, s.worldIds.length) })
    })
  }
  return m
}

export interface SetSlot {
  worldId: string
  /** "03 / 12" ("" for a one-card set). */
  number: string
  /** Your World Index entry for this world, or null if you haven't found it. */
  entry: WorldIndexEntry | null
}

export interface SetGroup {
  set: CardSet
  slots: SetSlot[]
  /** Visited (face-up) cards of this set. */
  discovered: number
}

/**
 * Group your entries by set: every set you have found at least one world of
 * (in set order, with empty slots for the rest), then everything in no set.
 * Sets you haven't touched stay hidden (no spoilers). Linear in entries + set sizes.
 */
export function groupBySet(
  entries: ReadonlyMap<string, WorldIndexEntry>,
  list: readonly CardSet[],
  isFaceUp: (e: WorldIndexEntry) => boolean,
): { groups: SetGroup[]; rest: WorldIndexEntry[] } {
  const inSet = new Set<string>()
  const groups: SetGroup[] = []
  for (const set of list) {
    let found = 0
    let discovered = 0
    const slots = set.worldIds.map((worldId, i) => {
      const entry = entries.get(worldId) ?? null
      if (entry) {
        found++
        if (isFaceUp(entry)) discovered++
      }
      return { worldId, number: cardSetNumber(i, set.worldIds.length), entry }
    })
    if (found === 0) continue
    for (const id of set.worldIds) inSet.add(id)
    groups.push({ set, slots, discovered })
  }
  const rest: WorldIndexEntry[] = []
  for (const e of entries.values()) if (!inSet.has(e.worldId)) rest.push(e)
  return { groups, rest }
}
