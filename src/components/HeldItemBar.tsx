import {
  useHeldItemStore,
  triggerHeldAdjust,
  triggerHeldRecolor,
  triggerPlaceHeld,
  triggerCarryToggle,
} from '../stores/heldItemStore'
import { useUniverseStore } from '../stores/universeStore'
import { useWorldStore } from '../stores/worldStore'
import { useKeybindingStore, keyCapLabel } from '../stores/keybindingStore'

/**
 * Held-item HUD bar: shows the item currently in your hand (from the Library)
 * or the world object you're carrying (GRAB / G), with quick controls to
 * rotate (⟲ / ⟳), resize (− / +), recolor, duplicate (⧉), delete (🗑), place, or put it away (×).
 */
export function HeldItemBar() {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const item = useHeldItemStore((s) => s.item)
  const carryingId = useHeldItemStore((s) => s.carryingId)
  const clear = useHeldItemStore((s) => s.clear)
  const carriedObj = useWorldStore((s) => (carryingId ? s.objects.get(carryingId) : undefined))
  const worldColor = useWorldStore((s) => s.meta?.color ?? '#6b3fa0')
  const placeCode = useKeybindingStore((s) => s.bindings.placeHeld ?? null)
  const carryCode = useKeybindingStore((s) => s.bindings.carry ?? null)
  const layout = useKeybindingStore((s) => s.layout)

  if (!activeWorldId || (!item && !carryingId)) return null

  if (carryingId) {
    const canRecolor = carriedObj && carriedObj.type !== 'model'
    const currentColor = carriedObj?.color ?? worldColor
    return (
      <div id="held-item-bar" className="held-item-bar" role="region" aria-label="Carried object controls">
        <span className="held-item-badge">✋</span>
        <div className="held-item-tools" role="group" aria-label="Adjust carried object">
          <button type="button" className="held-tool-btn" onClick={() => triggerHeldAdjust('rotLeft')} aria-label="Rotate left" title="Rotate left (Z)">⟲</button>
          <button type="button" className="held-tool-btn" onClick={() => triggerHeldAdjust('rotRight')} aria-label="Rotate right" title="Rotate right (X)">⟳</button>
          <button type="button" className="held-tool-btn" onClick={() => triggerHeldAdjust('shrink')} aria-label="Shrink" title="Shrink (-)">−</button>
          <button type="button" className="held-tool-btn" onClick={() => triggerHeldAdjust('grow')} aria-label="Grow" title="Grow (=)">+</button>
          {canRecolor && (
            <label className="held-color-btn" title="Change color">
              <input
                type="color"
                aria-label="Change object color"
                value={/^#[0-9a-f]{6}$/i.test(currentColor) ? currentColor : '#6b3fa0'}
                onChange={(e) => triggerHeldRecolor(e.target.value)}
              />
              <span className="held-color-dot" style={{ background: currentColor }} aria-hidden="true" />
            </label>
          )}
          <button
            id="held-duplicate-btn"
            type="button"
            className="held-tool-btn"
            onClick={() => triggerHeldAdjust('duplicate')}
            aria-label="Duplicate object"
            title="Stamp a copy here"
          >
            ⧉
          </button>
          <button
            id="held-delete-btn"
            type="button"
            className="held-tool-btn held-tool-btn--danger"
            onClick={() => triggerHeldAdjust('delete')}
            aria-label="Delete object"
            title="Delete object (Backspace / Delete)"
          >
            🗑
          </button>
        </div>
        <button id="held-drop-btn" type="button" className="held-place-btn" onClick={triggerCarryToggle}>
          Drop <kbd>{keyCapLabel(carryCode, layout)}</kbd>
        </button>
      </div>
    )
  }

  if (!item) return null

  const label =
    item.kind === 'block'
      ? item.block.name
      : item.kind === 'shape'
        ? `${item.shape.name} (${item.size}m)`
        : item.prompt

  const swatchColor =
    item.kind === 'block' ? item.block.color : item.kind === 'shape' ? item.color : '#9fe8ff'

  return (
    <div id="held-item-bar" className="held-item-bar" role="region" aria-label="Item in hand">
      <span className="held-item-swatch" style={{ background: swatchColor }} aria-hidden="true" />
      <span className="held-item-name" title={label}>{label}</span>
      {item.kind !== 'block' && (
        <div className="held-item-tools" role="group" aria-label="Adjust held item">
          <button type="button" className="held-tool-btn" onClick={() => triggerHeldAdjust('rotLeft')} aria-label="Rotate left" title="Rotate left (Z)">⟲</button>
          <button type="button" className="held-tool-btn" onClick={() => triggerHeldAdjust('rotRight')} aria-label="Rotate right" title="Rotate right (X)">⟳</button>
          <button type="button" className="held-tool-btn" onClick={() => triggerHeldAdjust('shrink')} aria-label="Shrink" title="Shrink (-)">−</button>
          <button type="button" className="held-tool-btn" onClick={() => triggerHeldAdjust('grow')} aria-label="Grow" title="Grow (=)">+</button>
        </div>
      )}
      <button id="held-place-btn" type="button" className="held-place-btn" onClick={triggerPlaceHeld}>
        Place <kbd>{keyCapLabel(placeCode, layout)}</kbd>
      </button>
      <button
        id="held-clear-btn"
        type="button"
        className="held-clear-btn"
        onClick={clear}
        aria-label="Put away held item"
        title="Put away"
      >
        ×
      </button>
    </div>
  )
}
