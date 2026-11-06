import { useEffect, useRef } from 'react'
import { useSheetStore, type SheetName } from '../stores/sheetStore'
import { useScrollHint } from '../hooks/useScrollHint'

const TABS: [SheetName, string][] = [
  ['library', '▦ Library'],
  ['create', '✦ Create'],
  ['plan', '✧ Plan'],
  ['plant', '🌱 Portal'],
]

/**
 * Touch only (hidden on desktop by CSS, which keeps its B / C / P buttons):
 * the Make sheet's top row, so Library, Create and Plan feel like one sheet
 * opened from the dock's 🧱 Make (docs/mobile-ui/SPEC.md → Panels).
 */
export function MakeTabs({ current }: { current: SheetName }) {
  const setSheet = useSheetStore((s) => s.setSheet)
  const ref = useRef<HTMLElement>(null)
  useScrollHint(ref, [current])
  // The open sheet's tab stays in view when the row scrolls sideways (narrow phones)
  useEffect(() => {
    document.getElementById(`make-tab-${current}`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [current])
  return (
    <nav ref={ref} className="make-tabs" role="tablist" aria-label="Make">
      {TABS.map(([name, label]) => (
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
