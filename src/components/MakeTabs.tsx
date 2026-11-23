import { useEffect, useRef } from 'react'
import { useSheetStore, type SheetName } from '../stores/sheetStore'
import { useScrollHint } from '../hooks/useScrollHint'
import { useOwnsCurrentWorld } from '../lib/worldActor'

const TABS: [SheetName, string][] = [
  ['library', '▦ Library'],
  ['create', '✦ Create'],
  ['plan', '✧ Plan'],
  ['plant', '🌱 Portal'],
]
/** Only the world's creator and builders set up its game (Phase 10). */
const GAME_TAB: [SheetName, string] = ['game', '🎯 Game']

/**
 * Touch only (hidden on desktop by CSS, which keeps its B / C / P buttons):
 * the Make sheet's top row, so Library, Create and Plan feel like one sheet
 * opened from the dock's 🧱 Make (docs/mobile-ui/SPEC.md → Panels).
 */
export function MakeTabs({ current }: { current: SheetName }) {
  const setSheet = useSheetStore((s) => s.setSheet)
  const ref = useRef<HTMLElement>(null)
  const owner = useOwnsCurrentWorld()
  const tabs = owner || current === 'game' ? [...TABS, GAME_TAB] : TABS
  useScrollHint(ref, [current])
  // The open sheet's tab stays in view when the row scrolls sideways (narrow phones)
  useEffect(() => {
    document.getElementById(`make-tab-${current}`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [current])
  return (
    <nav ref={ref} className="make-tabs" role="tablist" aria-label="Make">
      {tabs.map(([name, label]) => (
        <button
          key={name}
          id={`make-tab-${name}`}
          type="button"
          role="tab"
          aria-selected={current === name}
          className={`make-tab${current === name ? ' is-on' : ''}`}
          onClick={() => setSheet(name, true)}
        >
          {label}
        </button>
      ))}
    </nav>
  )
}
