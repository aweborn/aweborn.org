import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { WorldIndexEntry } from '@aweborn/shared/crdt-schema'
import { ORIGIN_WORLD_ID } from '@aweborn/shared/crdt-schema'
import {
  creatorLabel,
  formatCoords,
  isFaceUp,
  refresh,
  useWorldIndexStore,
  worldEntryFor,
} from '../stores/worldIndexStore'
import { useUniverseStore } from '../stores/universeStore'
import { getPlayerSnapshot, subscribePlayer } from '../lib/player'
import { inputManager } from '../systems/InputManager'
import { warpSystem } from '../systems/WarpSystem'
import { showNotice } from '../systems/TeleportSystem'
import { WorldCard } from './WorldCard'
import { matchesBinding } from '../stores/keybindingStore'

/**
 * World Index (Phase 08B): every world you've found, as cards. Press M (or
 * the HUD chip). Sighted worlds are face-down; visited ones show their art.
 * Pick one to see details and warp there (free: lock on, then hold K).
 */

type Filter = 'all' | 'visited' | 'sighted'

const NO_CHARACTERS: readonly string[] = []
const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

function usePlayerCharacters(): readonly string[] {
  const player = useSyncExternalStore(subscribePlayer, getPlayerSnapshot)
  return player?.characters ?? NO_CHARACTERS
}

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

function counts(entries: Map<string, WorldIndexEntry>) {
  let visited = 0
  for (const e of entries.values()) if (e.state === 'visited') visited++
  return { visited, sighted: entries.size - visited, total: entries.size }
}

// ── HUD chip ─────────────────────────────────────────────────────────

export function WorldIndexChip() {
  const entries = useWorldIndexStore((s) => s.entries)
  const toggle = useWorldIndexStore((s) => s.toggle)
  const revealSeq = useWorldIndexStore((s) => s.reveal?.seq ?? 0)
  const [pulse, setPulse] = useState(false)
  const { total } = counts(entries)

  // The revealed card flies into the chip (CardReveal); glow as it lands.
  useEffect(() => {
    if (!revealSeq) return
    const on = setTimeout(() => setPulse(true), 3300)
    const off = setTimeout(() => setPulse(false), 4600)
    return () => {
      clearTimeout(on)
      clearTimeout(off)
    }
  }, [revealSeq])

  return (
    <button
      type="button"
      id="world-index-chip"
      className={`wi-chip${pulse ? ' wi-chip--pulse' : ''}`}
      onClick={toggle}
      aria-haspopup="dialog"
      title="World Index (M)"
    >
      <svg className="wi-chip-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="5" width="11" height="15" rx="2" transform="rotate(-10 9 12.5)" />
        <rect x="9.5" y="4" width="11" height="15" rx="2" transform="rotate(8 15 11.5)" />
      </svg>
      <span className="wi-chip-label">World Index</span>
      <span className="wi-chip-count">{total}</span>
      <kbd className="wi-chip-kbd">M</kbd>
    </button>
  )
}

// ── Panel ────────────────────────────────────────────────────────────

export function WorldIndex() {
  const open = useWorldIndexStore((s) => s.open)
  const setOpen = useWorldIndexStore((s) => s.setOpen)
  const entries = useWorldIndexStore((s) => s.entries)
  const ready = useWorldIndexStore((s) => s.ready)
  const characters = usePlayerCharacters()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // M toggles (the game's input is disabled while the panel is open, so listen directly).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matchesBinding(e, 'worldIndex') || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      const state = useWorldIndexStore.getState()
      // Don't open on top of another modal (account panel, donation).
      if (!state.open && document.querySelector('dialog[open]')) return
      e.preventDefault()
      state.toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Store → <dialog>.
  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      inputManager.setEnabled(false)
      void refresh()
    } else if (!open && d.open) {
      d.close()
    }
  }, [open])

  const onClose = useCallback(() => {
    inputManager.setEnabled(true)
    setOpen(false)
    setSelectedId(null)
  }, [setOpen])

  // Light dismiss fallback for browsers without <dialog closedby> (Safari).
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return
    const onClick = (e: MouseEvent) => {
      if (e.target !== dialog) return
      const r = dialog.getBoundingClientRect()
      const inside = r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right
      if (!inside) dialog.close()
    }
    dialog.addEventListener('click', onClick)
    return () => dialog.removeEventListener('click', onClick)
  }, [])

  const { visited, sighted, total } = counts(entries)
  const list = useMemo(() => {
    const all = [...entries.values()]
      .filter((e) => filter === 'all' || e.state === filter)
      .sort((a, b) => (b.lastVisitedAt ?? b.discoveredAt) - (a.lastVisitedAt ?? a.discoveredAt))
    return all
  }, [entries, filter])

  const selected = selectedId ? entries.get(selectedId) ?? null : null

  return (
    <dialog
      ref={dialogRef}
      id="world-index-dialog"
      className="pa-dialog wi-dialog"
      aria-labelledby="wi-title"
      onClose={onClose}
      {...{ closedby: 'any' }}
    >
      <div className="pa-panel wi-panel">
        <button type="button" className="pa-close" onClick={() => setOpen(false)} aria-label="Close">×</button>

        <header className="wi-head">
          <div>
            <h2 id="wi-title" className="wi-title">World Index</h2>
            <p className="wi-sub">
              {total === 0 ? (
                'Every world you find becomes a card.'
              ) : (
                <>
                  <strong>{visited}</strong> visited · <strong>{sighted}</strong> sighted
                </>
              )}
            </p>
          </div>
          {!selected && total > 0 && (
            <div className="wi-filters" role="radiogroup" aria-label="Show">
              {(['all', 'visited', 'sighted'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  id={`wi-filter-${f}`}
                  role="radio"
                  aria-checked={filter === f}
                  className="wi-filter"
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? 'All' : f === 'visited' ? 'Visited' : 'Sighted'}
                </button>
              ))}
            </div>
          )}
        </header>

        {selected ? (
          <WorldDetail entry={selected} characters={characters} onBack={() => setSelectedId(null)} onWarp={() => setOpen(false)} />
        ) : total === 0 ? (
          <div className="wi-empty">
            <img className="wi-empty-card" src="/cards/back.svg" alt="" />
            <p>{ready ? 'Fly close to a world to sight it. Step inside to reveal its card.' : 'Opening your index…'}</p>
          </div>
        ) : list.length === 0 ? (
          <div className="wi-empty wi-empty--filtered">
            <p>{filter === 'visited' ? 'No visited worlds yet. Step inside one to reveal its card.' : 'Nothing waiting. Every world you\u2019ve sighted, you\u2019ve visited.'}</p>
          </div>
        ) : (
          <ul className="wi-grid" aria-label="Your worlds">
            {list.map((e, i) => (
              <li key={e.worldId} className="wi-item" style={{ '--wi-i': Math.min(i, 24) } as CSSProperties}>
                <button
                  type="button"
                  id={`wi-card-${e.worldId}`}
                  className="wi-card-btn"
                  onClick={() => setSelectedId(e.worldId)}
                  aria-label={`${e.world?.name ?? 'A faded world'}, ${isFaceUp(e) && e.worldId !== ORIGIN_WORLD_ID ? 'visited' : e.state}`}
                >
                  <WorldCard entry={e} myCharacters={characters} tilt />
                </button>
                <span className="wi-caption">
                  {isFaceUp(e) ? (
                    <span className="wi-caption-state">{e.worldId === ORIGIN_WORLD_ID ? 'The Portal' : 'Visited'}</span>
                  ) : (
                    <>
                      <span className="wi-caption-name">{e.world?.name ?? 'Faded world'}</span>
                      <span className="wi-caption-state">Sighted</span>
                    </>
                  )}
                  {e.pending && <span className="wi-pending" title="Saved on this device. It syncs when you're online." />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  )
}

// ── Detail ───────────────────────────────────────────────────────────

function WorldDetail({
  entry,
  characters,
  onBack,
  onWarp,
}: {
  entry: WorldIndexEntry
  characters: readonly string[]
  onBack: () => void
  onWarp: () => void
}) {
  const inWorld = useUniverseStore((s) => s.activeWorldId !== null)
  const pos = useUniverseStore.getState().playerPosition // a snapshot is enough (updates every frame)
  const [copied, setCopied] = useState(false)
  const w = entry.world
  const isOrigin = entry.worldId === ORIGIN_WORLD_ID
  const target = worldEntryFor(entry)
  const distance = target
    ? Math.hypot(target.resolvedPosition.x - pos.x, target.resolvedPosition.y - pos.y, target.resolvedPosition.z - pos.z)
    : null
  const here = distance !== null && distance < 8

  const warp = () => {
    if (!target) return
    warpSystem.lockRemote(target)
    onWarp()
    showNotice({
      kind: 'arrived',
      title: `Locked on: ${target.name}`,
      detail: 'Hold K to warp there. Press J or Esc to cancel.',
      color: target.color,
    })
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`https://aweborn.org/w/${entry.worldId}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked: nothing to do */
    }
  }

  const found = entry.method === 'link' ? 'Arrived by link' : 'Spotted in flight'

  return (
    <div className="wi-detail">
      <button type="button" id="wi-back" className="wi-back" onClick={onBack}>
        ← All worlds
      </button>
      <div className="wi-detail-body">
        <div className="wi-detail-card">
          <WorldCard entry={entry} myCharacters={characters} tilt live />
        </div>
        <div className="wi-detail-info">
          <span className={`wi-state wi-state--${isFaceUp(entry) ? 'visited' : 'sighted'}`}>
            {isOrigin ? 'The Aweborn Portal' : entry.state === 'visited' ? 'Visited' : 'Sighted'}
          </span>
          <h3 className="wi-detail-name" style={{ '--wc-color': w?.color ?? '#8b8fa8' } as CSSProperties}>
            {w?.name ?? 'A faded world'}
          </h3>
          <p className="wi-detail-by">by {creatorLabel(w?.creator, characters)}</p>

          <dl className="wi-facts">
            <div>
              <dt>Found</dt>
              <dd>
                {dateFmt.format(entry.discoveredAt)} · {found}
              </dd>
            </div>
            {!isOrigin && (
              <div>
                <dt>Visits</dt>
                <dd>
                  {entry.visitCount === 0
                    ? 'Not yet. Step inside to reveal its card.'
                    : `${entry.visitCount} · last ${dateFmt.format(entry.lastVisitedAt ?? entry.visitedAt ?? entry.discoveredAt)}`}
                </dd>
              </div>
            )}
            {w && (
              <div>
                <dt>Where</dt>
                <dd className="wi-mono">
                  {formatCoords(w.position)} · sector {w.sector}
                  {distance !== null && !here && <span className="wi-dist"> · {Math.round(distance).toLocaleString()} u away</span>}
                </dd>
              </div>
            )}
          </dl>

          {entry.pending && (
            <p className="wi-note">Saved on this device. It syncs to your player when you&rsquo;re online.</p>
          )}

          <div className="wi-actions">
            <button
              type="button"
              id="wi-warp"
              className="pa-btn pa-btn--primary"
              onClick={warp}
              disabled={!target || inWorld || here}
            >
              {here ? 'You\u2019re here' : 'Warp here'}
            </button>
            <button type="button" id="wi-copy-link" className="pa-btn pa-btn--ghost" onClick={copyLink}>
              {copied ? 'Link copied' : 'Copy link'}
            </button>
          </div>
          {inWorld && <p className="wi-hint">Exit this world first (Esc), then warp.</p>}
          {!inWorld && !here && target && <p className="wi-hint">Free. Locks on, then hold K to leap.</p>}
        </div>
      </div>
    </div>
  )
}
