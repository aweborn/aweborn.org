import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUniverseStore } from '../stores/universeStore'
import { useWorldStore } from '../stores/worldStore'
import { placeOnTerrain } from '../stores/worldVoxels'
import { interiorController } from '../systems/InteriorController'
import { matchesBinding } from '../stores/keybindingStore'
import { AUTH_URL } from '../lib/player'
import { markMeaningfulMoment } from '../lib/onramp'
import { ManaSeal, useCanChannel } from './ManaSeal'
import { MakeTabs } from './MakeTabs'
import { useSheet } from '../stores/sheetStore'

/**
 * Create World (Alex, 2026-10-21; recursive worlds-within-worlds 2026-10-23):
 * "plant where you stand". Out in space, tap 🌱 Plant a world (or press Y).
 * Inside a world, open 🌱 Portal from the Make tabs (or press Y) to plant a
 * nested child world portal right on the terrain ahead of you!
 */

/** Distance ahead of the player the new world is planted in space (THREE forward is -Z). */
const AHEAD = 10
/** Distance ahead of the player a nested portal is planted inside a world (meters). */
const INTERIOR_AHEAD = 4
const NAME_MAX = 40

type Planted = { id: string; name: string; color: string; leftToday: number }

function plantPosition(inWorld: boolean) {
  if (inWorld) {
    const s = interiorController.state
    const x = Math.max(-150, Math.min(150, s.x + s.fx * INTERIOR_AHEAD))
    const z = Math.max(-150, Math.min(150, s.z + s.fz * INTERIOR_AHEAD))
    let y = Math.max(0, s.y)
    const t = useWorldStore.getState().voxelTerrain
    if (t) {
      y = placeOnTerrain(t, [x + t.size[0] / 2, 0, z + t.size[2] / 2]).y
    }
    return { x, y, z }
  }
  const { playerPosition: p, playerRotation: q } = useUniverseStore.getState()
  // v' = q * (0,0,-1) * q⁻¹, expanded for v = (0,0,-1)
  const fx = -2 * (q.x * q.z + q.w * q.y)
  const fy = -2 * (q.y * q.z - q.w * q.x)
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y))
  return { x: p.x + fx * AHEAD, y: p.y + fy * AHEAD, z: p.z + fz * AHEAD }
}

export function PlantWorldPanel() {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const { canChannel } = useCanChannel()
  const [open, setOpen] = useSheet('plant')

  // Switching worlds closes the sheet.
  useEffect(() => {
    setOpen(false)
  }, [activeWorldId, setOpen])

  // Y toggles it in space or inside a world (not while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (matchesBinding(e, 'plantWorld')) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  const close = useCallback(() => setOpen(false), [setOpen])

  return (
    <div className="plant-panel">
      {!activeWorldId && (
        <button
          id="plant-open"
          className={`plant-open${canChannel ? '' : ' is-sealed'}`}
          type="button"
          onClick={() => setOpen(true)}
          title="Plant a world here (Y)"
        >
          <span aria-hidden="true">🌱</span> Plant a world <kbd>Y</kbd>
        </button>
      )}
      {open && !canChannel && <ManaSeal kind="world" onClose={close} />}
      {open && canChannel && <PlantSheet parentWorldId={activeWorldId} onClose={close} />}
    </div>
  )
}

function PlantSheet({ parentWorldId, onClose }: { parentWorldId: string | null; onClose: () => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#ff7b54')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [planted, setPlanted] = useState<Planted | null>(null)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const inWorld = Boolean(parentWorldId)

  useEffect(() => {
    // Focus after the sheet's rise so iOS scrolls it above the keyboard.
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = name.trim()
    if (!clean || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${AUTH_URL}/api/player/world`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: clean,
          color,
          position: plantPosition(inWorld),
          ...(parentWorldId ? { parentWorldId } : {}),
        }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        world?: { id: string; name: string; color: string }
        leftToday?: number
        error?: string
        message?: string
      }
      if (!res.ok || !j.world) {
        setError(
          j.message ??
            (j.error === 'bad_name'
              ? 'That name can’t be used. Try another.'
              : 'The universe didn’t take root this time. Try again in a moment.'),
        )
        return
      }
      markMeaningfulMoment('world-created')
      setPlanted({ ...j.world, leftToday: j.leftToday ?? 0 })
    } catch {
      setError('Can’t reach the universe right now. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  const link = planted ? `${location.origin}/w/${planted.id}` : ''
  const share = async () => {
    if (!planted) return
    try {
      if (navigator.share) {
        await navigator.share({ title: planted.name, text: `Come see ${planted.name} on Aweborn`, url: link })
        return
      }
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* share sheet dismissed */
    }
  }

  return createPortal(
    <div className="mana-seal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="mana-seal plant-sheet" role="dialog" aria-modal="true" aria-labelledby="plant-title">
        {inWorld && <MakeTabs current="plant" />}
        <button id="plant-close" className="mana-seal-close" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div
          className={`plant-orb${planted ? ' is-planted' : ''}`}
          style={{ '--orb': planted?.color ?? color } as React.CSSProperties}
          aria-hidden="true"
        />
        {planted ? (
          <>
            <p className="mana-seal-eyebrow">{inWorld ? 'A portal opens inside this world' : 'A new world takes root'}</p>
            <h2 id="plant-title" className="mana-seal-title">{planted.name}</h2>
            <p className="mana-seal-body">
              {inWorld
                ? 'Its portal is glowing just ahead of you, and in your World Index. Anyone can step inside or use the link.'
                : 'It’s just ahead of you, and in your World Index. Share the link and anyone can fly straight to it.'}
            </p>
            <div className="plant-link">
              <code id="plant-link-url">{link.replace(/^https?:\/\//, '')}</code>
              <button id="plant-share" type="button" className="plant-link-btn" onClick={share}>
                {copied ? 'Copied ✓' : 'Share'}
              </button>
            </div>
            <button
              id="plant-enter"
              type="button"
              className="mana-seal-cta"
              onClick={() => {
                onClose()
                useUniverseStore.getState().enterWorld(planted.id)
              }}
            >
              Enter {planted.name}
            </button>
            <button id="plant-done" type="button" className="mana-seal-secondary" onClick={onClose}>
              {inWorld ? 'Stay in this world' : 'Keep flying'}
            </button>
            <p className="mana-seal-note">
              {planted.leftToday > 0
                ? `You can plant ${planted.leftToday} more today.`
                : 'That’s your last world for today.'}
            </p>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="mana-seal-eyebrow">{inWorld ? 'Worlds within worlds' : 'Plant where you stand'}</p>
            <h2 id="plant-title" className="mana-seal-title">{inWorld ? 'Plant a world portal' : 'Plant a world'}</h2>
            <p className="mana-seal-body">
              {inWorld
                ? 'Plants a glowing portal just ahead of you that leads into a nested world of its own.'
                : 'It appears just ahead of you and stays in the universe forever.'}
            </p>
            <label className="plant-field" htmlFor="plant-name">
              <span>Name</span>
              <input
                id="plant-name"
                ref={inputRef}
                value={name}
                maxLength={NAME_MAX}
                autoComplete="off"
                enterKeyHint="go"
                placeholder="Moss Garden, The Long Night…"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="plant-field plant-field--color" htmlFor="plant-color">
              <span>Colour</span>
              <input id="plant-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              <code>{color}</code>
            </label>
            {error && (
              <p className="plant-error" role="alert">
                {error}
              </p>
            )}
            <button id="plant-submit" type="submit" className="mana-seal-cta" disabled={busy || !name.trim()}>
              {busy ? 'Planting…' : 'Plant it here'}
            </button>
          </form>
        )}
      </section>
    </div>,
    document.body,
  )
}
