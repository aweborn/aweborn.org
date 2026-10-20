import { create } from 'zustand'
import {
  rebind as rebindRule, resetBinding as resetRule, resolveBindings, sanitizeOverrides, isBindable,
  codeLabel, DEF_BY_ID,
  type BindingMap, type BindingOverrides, type RebindResult,
} from '@aweborn/shared/keybindings'

/**
 * Player keybindings. Only the player's changes are stored (localStorage), so
 * a default we later change reaches everyone who never touched that key.
 * Systems read the resolved map; the Keys & controls panel edits it.
 */

const STORAGE_KEY = 'aweborn.keybindings'

function read(): BindingOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? sanitizeOverrides(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

function write(o: BindingOverrides): void {
  try {
    if (Object.keys(o).length === 0) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(o))
  } catch {
    // Private mode or full storage: the remap still holds for this session.
  }
}

interface KeybindingState {
  overrides: BindingOverrides
  bindings: BindingMap
  /** The keys-and-controls panel is open. */
  open: boolean
  /** What the keyboard actually prints for each code (non-QWERTY layouts), once known. */
  layout: ReadonlyMap<string, string> | null
  setOpen: (open: boolean) => void
  rebind: (id: string, code: string | null) => RebindResult
  reset: (id: string) => RebindResult
  resetAll: () => void
}

const initial = read()

export const useKeybindingStore = create<KeybindingState>((set, get) => {
  const apply = (res: RebindResult): RebindResult => {
    if (res.overrides !== get().overrides) {
      write(res.overrides)
      set({ overrides: res.overrides, bindings: resolveBindings(res.overrides) })
    }
    return res
  }
  return {
    overrides: initial,
    bindings: resolveBindings(initial),
    open: false,
    layout: null,
    setOpen: (open) => set({ open }),
    rebind: (id, code) => apply(rebindRule(get().overrides, id, code)),
    reset: (id) => apply(resetRule(get().overrides, id)),
    resetAll: () => {
      write({})
      set({ overrides: {}, bindings: resolveBindings({}) })
    },
  }
})

// Keyboard layout (AZERTY, Dvorak …): label keys by what they print, not their QWERTY position.
// Chromium only; elsewhere the static labels stand.
type KeyboardLike = { getLayoutMap?: () => Promise<ReadonlyMap<string, string>> }
const kb = (navigator as unknown as { keyboard?: KeyboardLike }).keyboard
kb?.getLayoutMap?.().then(
  (layout) => useKeybindingStore.setState({ layout }),
  () => {},
)

/** Key cap text for a code, using the real layout when the browser tells us. */
export function keyCapLabel(code: string | null, layout: ReadonlyMap<string, string> | null): string {
  if (!code) return 'Unbound'
  const printed = layout?.get(code)
  if (printed && printed.length === 1 && /[\p{L}\p{N}=\-[\];',./\\`]/u.test(printed)) return printed.toUpperCase()
  return codeLabel(code)
}

/** The code currently bound to an action (null if unbound). */
export function bindingCode(id: string): string | null {
  return useKeybindingStore.getState().bindings[id] ?? null
}

/**
 * Does this keydown/keyup belong to the action? Use in place of `e.code === 'KeyX'`.
 * An action is only live in its own contexts: callers are already in the right one.
 */
export function matchesBinding(e: KeyboardEvent, id: string): boolean {
  const code = useKeybindingStore.getState().bindings[id]
  return !!code && e.code === code
}

export { isBindable, DEF_BY_ID }
