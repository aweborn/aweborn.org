import { useEffect } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { useWorldIndexStore } from '../stores/worldIndexStore'
import { useChatStore } from '../stores/chatStore'
import { useSheetStore } from '../stores/sheetStore'

/**
 * Touch dock (Alex, 2026-10-22): the bottom action bar between the thumbs.
 * It replaces the World Index chip, the chat bubble and the Library /
 * Create / Plan / Plant pills that crowded the top of a phone.
 *
 *   space:  🗺 Index · 💬 Chat · 🌱 Plant · ••• More
 *   world:  🗺 Index · 💬 Chat · 🧱 Make (Library · Create · Plan tabs) · ••• More
 *
 * Touch only: CSS shows it under `html.touch-ui`. Desktop keeps its pills and
 * keys for now (the spec's desktop dock with <kbd> hints comes later).
 * ••• More (MoreSheet) holds the account, star look, settings, controls, Give.
 */
export function TouchDock() {
  const inWorld = useUniverseStore((s) => s.activeWorldId !== null)
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const indexOpen = useWorldIndexStore((s) => s.open)
  const total = useWorldIndexStore((s) => s.entries.size)
  const chatOpen = useChatStore((s) => s.open)
  const sheet = useSheetStore((s) => s.sheet)
  const makeOpen = sheet === 'library' || sheet === 'create' || sheet === 'plan'

  // A sheet belongs to the place it was opened in: moving between space
  // and a world closes it (the Library had no such rule of its own).
  useEffect(() => {
    useSheetStore.getState().close()
  }, [activeWorldId])

  const toggleMake = () => {
    const s = useSheetStore.getState()
    if (makeOpen) s.close()
    else s.setSheet('library', true)
  }

  return (
    <nav className="touch-dock" aria-label="Actions">
      <button
        id="touch-dock-index"
        type="button"
        className={`touch-dock-btn${indexOpen ? ' is-on' : ''}`}
        onClick={() => useWorldIndexStore.getState().toggle()}
        aria-label={`World Index, ${total} worlds`}
      >
        <span className="touch-dock-icon" aria-hidden="true">🗺️</span>
        <span className="touch-dock-label">Index</span>
        {total > 0 && <span className="touch-dock-count" aria-hidden="true">{total}</span>}
      </button>
      <button
        id="touch-dock-chat"
        type="button"
        className={`touch-dock-btn${chatOpen ? ' is-on' : ''}`}
        onClick={() => useChatStore.getState().setOpen(true)}
        aria-label="Chat"
      >
        <span className="touch-dock-icon" aria-hidden="true">💬</span>
        <span className="touch-dock-label">Chat</span>
      </button>
      {inWorld ? (
        <button
          id="touch-dock-make"
          type="button"
          className={`touch-dock-btn${makeOpen ? ' is-on' : ''}`}
          onClick={toggleMake}
          aria-label="Make: Library, Create, Plan"
          aria-expanded={makeOpen}
        >
          <span className="touch-dock-icon" aria-hidden="true">🧱</span>
          <span className="touch-dock-label">Make</span>
        </button>
      ) : (
        <button
          id="touch-dock-plant"
          type="button"
          className={`touch-dock-btn${sheet === 'plant' ? ' is-on' : ''}`}
          onClick={() => useSheetStore.getState().setSheet('plant', (o) => !o)}
          aria-label="Plant a world here"
          aria-expanded={sheet === 'plant'}
        >
          <span className="touch-dock-icon" aria-hidden="true">🌱</span>
          <span className="touch-dock-label">Plant</span>
        </button>
      )}
      <button
        id="touch-dock-more"
        type="button"
        className={`touch-dock-btn${sheet === 'more' ? ' is-on' : ''}`}
        onClick={() => useSheetStore.getState().setSheet('more', (o) => !o)}
        aria-label="More: your player, settings, controls, give"
        aria-expanded={sheet === 'more'}
      >
        <span className="touch-dock-icon touch-dock-icon--more" aria-hidden="true">•••</span>
        <span className="touch-dock-label">More</span>
      </button>
    </nav>
  )
}
