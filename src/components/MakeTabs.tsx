import { useSheetStore, type SheetName } from '../stores/sheetStore'

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
  return (
    <nav className="make-tabs" role="tablist" aria-label="Make">
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
