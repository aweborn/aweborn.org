import { useEffect, useRef, useState } from 'react'
import { ORIGIN_WORLD_ID } from '@aweborn/shared/crdt-schema'
import { usePhotoStore } from '../stores/photoStore'
import { useUniverseStore } from '../stores/universeStore'
import { isFaceUp, useWorldIndexStore, worldEntryFor } from '../stores/worldIndexStore'
import { keyCapLabel, matchesBinding, useKeybindingStore } from '../stores/keybindingStore'
import { warpSystem } from '../systems/WarpSystem'
import { inputManager } from '../systems/InputManager'
import { captureFrame, saveWholeScreen, shareOrSave } from '../lib/photo'
import { CARD_CHECKOUT_ON } from '../lib/cardCheckout'
import { getPlayerSnapshot } from '../lib/player'
import { WorldCard } from './WorldCard'

/**
 * Photo mode (Rough Draft M6b; Phase 08 "Card Art": the in-game snapshot tool).
 *
 * Controls hide, a card-shaped frame (the 55 × 45 mm art window, 11:9) sits
 * over the scene, and the player keeps flying or walking to compose. The
 * shutter crops exactly that frame (lib/photo.ts). The preview shows the shot
 * on the world's card, with: Use on a card (→ that world's checkout), Save,
 * and Retake.
 *
 * Which world it's of: the one you came from (Get this card → Take a photo),
 * else the one you're inside, else the one you're locked on to.
 *
 * Open: ••• More → Photo mode (touch), the gear panel or key 5 (desktop).
 */

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

function photoWorld(forWorldId: string | null): { id: string; name: string } | null {
  const u = useUniverseStore.getState()
  const id = forWorldId ?? u.activeWorldId ?? warpSystem.getState().lockedTarget?.id ?? null
  if (!id) return null
  const name = u.worlds.get(id)?.name ?? useWorldIndexStore.getState().entries.get(id)?.world?.name ?? 'A world'
  return { id, name }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'world'

export function PhotoMode() {
  const composing = usePhotoStore((s) => s.composing)
  const preview = usePhotoStore((s) => s.preview)
  const forWorldId = usePhotoStore((s) => s.forWorldId)
  const frameRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [flash, setFlash] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const key = useKeybindingStore((s) => s.bindings.photoMode)
  const layout = useKeybindingStore((s) => s.layout)
  const keyLabel = key ? keyCapLabel(key, layout) : null

  // Toggle key (5) and Esc. Capture phase, so Esc leaves photo mode without also dropping a warp lock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const st = usePhotoStore.getState()
      if (st.composing && !st.preview && e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        st.close()
        return
      }
      if (!matchesBinding(e, 'photoMode') || e.repeat) return
      if (!st.composing && document.querySelector('dialog[open]')) return
      e.preventDefault()
      if (st.composing) st.close()
      else st.open()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Hide every control while composing (CSS: body.photo-mode)
  useEffect(() => {
    document.body.classList.toggle('photo-mode', composing)
    if (composing) setError(null)
    return () => document.body.classList.remove('photo-mode')
  }, [composing])

  // Preview → modal dialog (the game's input pauses meanwhile)
  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (preview && !d.open) {
      d.showModal()
      inputManager.setEnabled(false)
    } else if (!preview && d.open) {
      d.close()
    }
  }, [preview])

  if (!composing) return null

  const shoot = async () => {
    const frame = frameRef.current?.getBoundingClientRect()
    if (!frame) return
    setFlash((n) => n + 1)
    const shot = await captureFrame(frame)
    if (!shot) {
      setError('That photo didn\u2019t work. Try again.')
      return
    }
    const w = photoWorld(forWorldId)
    usePhotoStore.getState().setPreview({
      ...shot,
      url: URL.createObjectURL(shot.blob),
      at: Date.now(),
      worldId: w?.id ?? null,
      worldName: w?.name ?? null,
    })
  }

  const subject = photoWorld(forWorldId)
  const entry = preview?.worldId ? useWorldIndexStore.getState().entries.get(preview.worldId) ?? null : null
  // A card of it can be ordered: visited, still in the universe, not Origin (Alex's own print run)
  const cardable = !!entry && preview?.worldId !== ORIGIN_WORLD_ID && isFaceUp(entry) && !!worldEntryFor(entry)
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  const characters = getPlayerSnapshot()?.characters ?? []

  const useOnCard = () => {
    if (!preview?.worldId) return
    const id = preview.worldId
    usePhotoStore.getState().keep(preview)
    usePhotoStore.getState().close()
    useWorldIndexStore.getState().openTo(id, true)
  }

  return (
    <div id="photo-mode" className="pm">
      <p className="pm-top">
        <span className="pm-top-kicker">Photo mode</span>
        <span className="pm-top-world">{subject ? subject.name : 'Frame anything'}</span>
      </p>

      <div className="pm-stage">
        <div ref={frameRef} className="pm-frame" aria-hidden="true">
          <span className="pm-corner pm-corner--tl" />
          <span className="pm-corner pm-corner--tr" />
          <span className="pm-corner pm-corner--bl" />
          <span className="pm-corner pm-corner--br" />
          {flash > 0 && <span key={flash} className="pm-flash" />}
        </div>
      </div>

      <div className="pm-bar">
        <button type="button" id="pm-close" className="pm-btn" onClick={() => usePhotoStore.getState().close()} aria-label="Leave photo mode">
          ×
        </button>
        <button type="button" id="pm-shutter" className="pm-shutter" onClick={() => void shoot()} aria-label="Take photo">
          <span className="pm-shutter-core" />
        </button>
        <button type="button" id="pm-whole" className="pm-btn pm-btn--text" onClick={saveWholeScreen}>
          Whole screen
        </button>
      </div>
      <p className="pm-hint" role="status" aria-live="polite">
        {error ??
          (touch
            ? 'Drag to look around · pinch to zoom'
            : `Fly or walk as usual to frame it · Esc${keyLabel ? ` or ${keyLabel}` : ''} to leave`)}
      </p>

      <dialog
        ref={dialogRef}
        id="pm-preview"
        className="pa-dialog pm-preview"
        aria-labelledby="pm-preview-title"
        onClose={() => {
          inputManager.setEnabled(true)
          // Esc / close = back to framing (the shot stays only if it was kept)
          if (usePhotoStore.getState().preview) usePhotoStore.getState().setPreview(null)
        }}
      >
        {preview && (
          <div className="pa-panel pm-preview-panel">
            <h2 id="pm-preview-title" className="pm-preview-title">
              {preview.worldName ? `Your photo of ${preview.worldName}` : 'Your photo'}
            </h2>
            <div className="pm-preview-card">
              {entry && isFaceUp(entry) ? (
                <WorldCard entry={entry} myCharacters={characters} artUrl={preview.url} />
              ) : (
                <img className="pm-preview-img" src={preview.url} alt="" width={preview.width} height={preview.height} />
              )}
            </div>
            {cardable && CARD_CHECKOUT_ON ? (
              <p className="pm-preview-note">This is how it would sit on a printed card.</p>
            ) : (
              <p className="pm-preview-note">
                {!preview.worldId
                  ? 'Step inside a world or lock on to one to put a photo on its card.'
                  : preview.worldId === ORIGIN_WORLD_ID
                    ? 'Origin\u2019s card is printed by Aweborn. Save the photo to keep it.'
                    : entry && !isFaceUp(entry)
                      ? 'Step inside this world to reveal its card first.'
                      : 'Save it to keep it.'}
              </p>
            )}
            <div className="pm-preview-actions">
              {cardable && CARD_CHECKOUT_ON && (
                <button type="button" id="pm-use" className="pa-btn pa-btn--primary" onClick={useOnCard}>
                  Use on a card
                </button>
              )}
              <button
                type="button"
                id="pm-save"
                className={`pa-btn ${cardable && CARD_CHECKOUT_ON ? 'pa-btn--ghost' : 'pa-btn--primary'}`}
                onClick={() => shareOrSave(preview.blob, `aweborn-${slug(preview.worldName ?? 'photo')}`)}
              >
                Save
              </button>
              <button type="button" id="pm-retake" className="pa-btn pa-btn--ghost" onClick={() => dialogRef.current?.close()}>
                Retake
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  )
}
