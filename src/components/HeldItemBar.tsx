import { useHeldItemStore, triggerHeldAdjust, triggerPlaceHeld, triggerCarryToggle } from '../stores/heldItemStore'
import { useUniverseStore } from '../stores/universeStore'
import { useKeybindingStore, keyCapLabel } from '../stores/keybindingStore'

/**
 * Held-item HUD bar: shows the item currently in your hand (from the Library)
 * or the world object you're carrying (GRAB / G), with quick controls to
 * rotate (⟲ / ⟳), resize (− / +), place, or put it away (×).
 */
export function HeldItemBar() {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const item = useHeldItemStore((s) => s.item)
  const carryingId = useHeldItemStore((s) => s.carryingId)
  const clear = useHeldItemStore((s) => s.clear)
  const placeCode = useKeybindingStore((s) => s.bindings.placeHeld ?? null)
  const carryCode = useKeybindingStore((s) => s.bindings.carry ?? null)
  const layout = useKeybindingStore((s) => s.layout)

  if (!activeWorldId || (!item && !carryingId)) return null

  if (carryingId) {
    return (
      <div id="held-item-bar" className="held-item-bar" role="region" aria-label="Carried object controls">
        <span className="held-item-badge">✋ Carrying</span>
        <div className="held-item-tools" role="group" aria-label="Adjust carried object">
          <button type="button" className="held-tool-btn" onClick={() => triggerHeldAdjust('rotLeft')} aria-label="Rotate left" title="Rotate left (Z)">⟲</button>
          <button type="button" className="held-tool-btn" onClick={() => triggerHeldAdjust('rotRight')} aria-label="Rotate right" title="Rotate right (X)">⟳</button>
          <button type="button" className="held-tool-btn" onClick={() => triggerHeldAdjust('shrink')} aria-label="Shrink" title="Shrink (-)">−</button>
          <button type="button" className="held-tool-btn" onClick={() => triggerHeldAdjust('grow')} aria-label="Grow" title="Grow (=)">+</button>
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
