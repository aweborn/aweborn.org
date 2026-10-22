/**
 * Keybindings: the single list of everything a key can do, plus the pure
 * rules for remapping (no DOM, no storage, so it is unit-testable).
 *
 * Bindings are keyed by physical key `code` (`KeyW`, `Digit1`, `Space`), the
 * same thing InputManager listens for, so a remap works on any keyboard layout.
 *
 * The universe and a world interior reuse the same keys for different jobs
 * (Z is "lock behind" in flight and "rotate held" inside a world), so each
 * action says which contexts it lives in. Two actions only collide if their
 * contexts overlap.
 */

export type KeyContext = 'universe' | 'world'

export type BindingGroup = 'move' | 'camera' | 'interact' | 'mods' | 'build' | 'panels'

export const GROUP_ORDER: readonly BindingGroup[] = ['move', 'camera', 'interact', 'mods', 'build', 'panels']

export const GROUP_LABEL: Record<BindingGroup, string> = {
  move: 'Movement',
  camera: 'Camera',
  interact: 'Interact',
  mods: 'Star mods',
  build: 'Building',
  panels: 'Panels',
}

export interface BindingDef {
  /** InputManager action name for game actions; a plain id for UI shortcuts. */
  id: string
  group: BindingGroup
  /** Shown in the universe (and the fallback everywhere). */
  label: string
  /** Shown instead of `label` on the world tab, where the same key means something else. */
  worldLabel?: string
  /** Where this action is live. */
  contexts: readonly KeyContext[]
  /** Default physical key. */
  default: string
}

const BOTH: readonly KeyContext[] = ['universe', 'world']
const UNI: readonly KeyContext[] = ['universe']
const WORLD: readonly KeyContext[] = ['world']

export const BINDING_DEFS: readonly BindingDef[] = [
  // Movement
  { id: 'thrust', group: 'move', label: 'Thrust', worldLabel: 'Walk forward', contexts: BOTH, default: 'KeyW' },
  { id: 'reverse', group: 'move', label: 'Reverse', worldLabel: 'Walk back', contexts: BOTH, default: 'KeyS' },
  { id: 'rollRight', group: 'move', label: 'Roll right', worldLabel: 'Strafe left', contexts: BOTH, default: 'KeyA' },
  { id: 'pitchDown', group: 'move', label: 'Pitch down', worldLabel: 'Strafe right', contexts: BOTH, default: 'KeyD' },
  { id: 'yawLeft', group: 'move', label: 'Yaw left', worldLabel: 'Turn left', contexts: BOTH, default: 'KeyQ' },
  { id: 'pitchUp', group: 'move', label: 'Pitch up', worldLabel: 'Turn right', contexts: BOTH, default: 'KeyE' },
  { id: 'yawRight', group: 'move', label: 'Yaw right', worldLabel: 'Look up', contexts: BOTH, default: 'KeyR' },
  { id: 'rollLeft', group: 'move', label: 'Roll left', worldLabel: 'Look down', contexts: BOTH, default: 'KeyF' },
  { id: 'brake', group: 'move', label: 'Brake', worldLabel: 'Jump', contexts: BOTH, default: 'Space' },
  { id: 'warp', group: 'move', label: 'Warp (hold to charge)', worldLabel: 'Sprint', contexts: BOTH, default: 'KeyK' },
  { id: 'gravityToggle', group: 'move', label: 'Neutral / drive mode', contexts: UNI, default: 'KeyG' },
  { id: 'autoOrient', group: 'move', label: 'Auto-orient', contexts: UNI, default: 'KeyT' },

  // Camera
  { id: 'cameraClose', group: 'camera', label: 'Close camera', contexts: BOTH, default: 'Digit1' },
  { id: 'cameraMedium', group: 'camera', label: 'Medium camera', contexts: BOTH, default: 'Digit2' },
  { id: 'cameraFar', group: 'camera', label: 'Far camera', contexts: BOTH, default: 'Digit3' },
  { id: 'cameraCinematic', group: 'camera', label: 'Cinematic camera', contexts: BOTH, default: 'Digit4' },
  { id: 'lockBehind', group: 'camera', label: 'Lock camera behind', contexts: UNI, default: 'KeyZ' },
  { id: 'freeLook', group: 'camera', label: 'Free look', contexts: UNI, default: 'KeyX' },
  { id: 'lookBehind', group: 'camera', label: 'Look behind', contexts: UNI, default: 'KeyC' },

  // Interact
  { id: 'interact', group: 'interact', label: 'Interact', worldLabel: 'Kick', contexts: BOTH, default: 'KeyN' },
  { id: 'lockOn', group: 'interact', label: 'Lock on to a target', contexts: UNI, default: 'KeyJ' },
  { id: 'scan', group: 'interact', label: 'Scan', contexts: UNI, default: 'KeyL' },
  { id: 'chat', group: 'interact', label: 'Chat', contexts: BOTH, default: 'Enter' },

  // Star mods
  { id: 'modTrail', group: 'mods', label: 'Cycle trail', contexts: UNI, default: 'KeyU' },
  { id: 'modAura', group: 'mods', label: 'Cycle aura', contexts: UNI, default: 'KeyI' },
  { id: 'modShape', group: 'mods', label: 'Cycle shape', contexts: UNI, default: 'KeyO' },
  { id: 'modEmote', group: 'mods', label: 'Emote', contexts: UNI, default: 'KeyP' },

  // Building (inside a world)
  { id: 'placeHeld', group: 'build', label: 'Place item in hand', contexts: WORLD, default: 'KeyV' },
  { id: 'carry', group: 'build', label: 'Pick up / set down', contexts: WORLD, default: 'KeyG' },
  { id: 'heldRotateLeft', group: 'build', label: 'Rotate held item left', contexts: WORLD, default: 'KeyZ' },
  { id: 'heldRotateRight', group: 'build', label: 'Rotate held item right', contexts: WORLD, default: 'KeyX' },
  { id: 'heldGrow', group: 'build', label: 'Grow held item', contexts: WORLD, default: 'Equal' },
  { id: 'heldShrink', group: 'build', label: 'Shrink held item', contexts: WORLD, default: 'Minus' },

  // Panels
  { id: 'worldIndex', group: 'panels', label: 'World Index', contexts: BOTH, default: 'KeyM' },
  { id: 'library', group: 'panels', label: 'Library', contexts: WORLD, default: 'KeyB' },
  { id: 'createPanel', group: 'panels', label: 'Create (text to 3D)', contexts: WORLD, default: 'KeyC' },
  { id: 'plannerPanel', group: 'panels', label: 'World Planner', contexts: WORLD, default: 'KeyP' },
  { id: 'plantWorld', group: 'panels', label: 'Plant a world', contexts: UNI, default: 'KeyY' },
  { id: 'keybindings', group: 'panels', label: 'Keys & controls', contexts: BOTH, default: 'KeyH' },
]

export const DEF_BY_ID: ReadonlyMap<string, BindingDef> = new Map(BINDING_DEFS.map((d) => [d.id, d]))

/** Keys with a fixed job. Never bindable (Escape closes panels and leaves worlds everywhere). */
export const RESERVED_CODES: ReadonlySet<string> = new Set([
  'Escape', 'Backquote', 'Tab',
  'MetaLeft', 'MetaRight', 'ContextMenu',
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'CapsLock', 'NumLock', 'ScrollLock', 'Pause', 'PrintScreen',
])

export function isBindable(code: string): boolean {
  if (!code || code === 'Unidentified') return false
  if (RESERVED_CODES.has(code)) return false
  if (/^F\d+$/.test(code)) return false // browser/OS shortcuts (F5, F11, F12 …)
  return true
}

/** The player's changes only: `null` means deliberately unbound. */
export type BindingOverrides = Readonly<Record<string, string | null>>

export type BindingMap = Readonly<Record<string, string | null>>

export function resolveBindings(overrides: BindingOverrides): BindingMap {
  const out: Record<string, string | null> = {}
  for (const d of BINDING_DEFS) {
    out[d.id] = d.id in overrides ? overrides[d.id] : d.default
  }
  return out
}

/** Defaults only: used to diff against and to reset to. */
export const DEFAULT_BINDINGS: BindingMap = resolveBindings({})

/** Do two actions ever live in the same context? */
export function contextsOverlap(a: BindingDef, b: BindingDef): boolean {
  return a.contexts.some((c) => b.contexts.includes(c))
}

/** Other actions that already use `code` somewhere `id` also lives. */
export function conflictsFor(map: BindingMap, id: string, code: string): string[] {
  const me = DEF_BY_ID.get(id)
  if (!me) return []
  const out: string[] = []
  for (const d of BINDING_DEFS) {
    if (d.id === id || map[d.id] !== code) continue
    if (contextsOverlap(me, d)) out.push(d.id)
  }
  return out
}

export interface RebindResult {
  overrides: BindingOverrides
  /** Actions that shared the new key and were moved to this action's old key. */
  swapped: string[]
  /** Actions left without a key because they could not take this action's old one. */
  unbound: string[]
}

/** Strip overrides that equal the default, so storage only holds real changes. */
function tidy(overrides: Record<string, string | null>): BindingOverrides {
  const out: Record<string, string | null> = {}
  for (const [id, v] of Object.entries(overrides)) {
    const d = DEF_BY_ID.get(id)
    if (d && d.default !== v) out[id] = v
  }
  return out
}

/**
 * Give `id` the key `code`. An action already on that key swaps: it takes
 * the key `id` had, so nothing is silently lost. If that key can't be used
 * by the displaced action (it collides there too, or `id` had none), the
 * displaced action is unbound instead and reported.
 */
export function rebind(overrides: BindingOverrides, id: string, code: string | null): RebindResult {
  const map: Record<string, string | null> = { ...resolveBindings(overrides) }
  const swapped: string[] = []
  const unbound: string[] = []
  if (!DEF_BY_ID.has(id)) return { overrides, swapped, unbound }
  if (code !== null && !isBindable(code)) return { overrides, swapped, unbound }

  const old = map[id]
  if (code !== null) {
    const clashing = conflictsFor(map, id, code)
    map[id] = code
    for (const other of clashing) {
      map[other] = null
      if (old && conflictsFor(map, other, old).length === 0) {
        map[other] = old
        swapped.push(other)
      } else {
        unbound.push(other)
      }
    }
  } else {
    map[id] = null
  }
  return { overrides: tidy(map), swapped, unbound }
}

export function resetBinding(overrides: BindingOverrides, id: string): RebindResult {
  const d = DEF_BY_ID.get(id)
  if (!d) return { overrides, swapped: [], unbound: [] }
  // If another action sits on the default key now, it swaps to the key being given up.
  return rebind(overrides, id, d.default)
}

/** Drop unknown ids and unusable keys from whatever came out of storage. */
export function sanitizeOverrides(raw: unknown): BindingOverrides {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string | null> = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!DEF_BY_ID.has(id)) continue
    if (v === null || (typeof v === 'string' && isBindable(v))) out[id] = v
  }
  // Two actions on one key in the same context would make both fire: repair by unbinding the later one.
  const map: Record<string, string | null> = { ...resolveBindings(out) }
  for (const d of BINDING_DEFS) {
    const code = map[d.id]
    if (!code) continue
    if (conflictsFor({ ...map, [d.id]: null }, d.id, code).length > 0) {
      map[d.id] = null
    }
  }
  return tidy(map)
}

/** Which action (in this context) does a physical key trigger? */
export function actionsForCode(map: BindingMap, code: string, ctx: KeyContext): string[] {
  return BINDING_DEFS.filter((d) => map[d.id] === code && d.contexts.includes(ctx)).map((d) => d.id)
}

/** Printable name for a key code, with no layout knowledge. */
export function codeLabel(code: string | null): string {
  if (!code) return 'Unbound'
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`
  const names: Record<string, string> = {
    Space: 'Space', Enter: 'Enter', Backspace: '⌫', Delete: 'Del',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'Shift', ShiftRight: 'R-Shift',
    Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
    IntlBackslash: '\\', NumpadAdd: 'Num +', NumpadSubtract: 'Num -',
    NumpadMultiply: 'Num ×', NumpadDivide: 'Num ÷', NumpadEnter: 'Num Enter', NumpadDecimal: 'Num .',
    Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn', Insert: 'Ins',
  }
  return names[code] ?? code
}
