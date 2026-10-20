import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BINDING_DEFS, GROUP_LABEL, GROUP_ORDER, DEFAULT_BINDINGS, DEF_BY_ID, isBindable,
  type BindingDef, type KeyContext, type RebindResult,
} from '@aweborn/shared/keybindings'
import { useKeybindingStore, keyCapLabel } from '../stores/keybindingStore'
import { useUniverseStore } from '../stores/universeStore'
import { inputManager } from '../systems/InputManager'
import './KeybindingsPanel.css'

/**
 * Keys & controls: every key in the game, grouped, and the place to change
 * them. It is the legend (open it with H, or the keyboard button under the FPS
 * counter) and the settings page in one: click a key, press its replacement.
 *
 * Flight and worlds reuse the same keys for different jobs, so the legend has
 * a tab for each; an action only shows on the tab(s) where it does something.
 */

const CONTEXT_LABEL: Record<KeyContext, string> = { universe: 'Flying', world: 'Inside a world' }

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

function describe(res: RebindResult, ctx: KeyContext): string {
  const name = (id: string) => {
    const d = DEF_BY_ID.get(id)
    return (ctx === 'world' && d?.worldLabel) || d?.label || id
  }
  const parts: string[] = []
  if (res.swapped.length) parts.push(`${res.swapped.map(name).join(', ')} took the key it gave up.`)
  if (res.unbound.length) parts.push(`${res.unbound.map(name).join(', ')} now has no key. Pick one below.`)
  return parts.join(' ')
}

export function KeybindingsButton() {
  const open = useKeybindingStore((s) => s.open)
  const setOpen = useKeybindingStore((s) => s.setOpen)
  const code = useKeybindingStore((s) => s.bindings.keybindings)
  const layout = useKeybindingStore((s) => s.layout)
  const hint = keyCapLabel(code ?? null, layout)
  return (
    <button
      id="keybindings-toggle"
      type="button"
      className={`keybindings-toggle${open ? ' keybindings-toggle--open' : ''}`}
      aria-haspopup="dialog"
      aria-label={`Keys and controls (${hint})`}
      title={code ? `Keys & controls (${hint})` : 'Keys & controls'}
      onClick={(e) => {
        setOpen(true)
        // Mouse click: hand the keyboard back to flight when the panel closes.
        if (e.detail > 0) e.currentTarget.blur()
      }}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
        <path
          fill="currentColor"
          d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm1.5 2.5v1.8h1.8V8.5H5.5Zm3.3 0v1.8h1.8V8.5H8.8Zm3.3 0v1.8h1.8V8.5h-1.8Zm3.3 0v1.8h1.8V8.5h-1.8Zm3.3 0v1.8h1.8V8.5h-1.8ZM5.5 11.7v1.8h1.8v-1.8H5.5Zm3.3 0v1.8h1.8v-1.8H8.8Zm3.3 0v1.8h1.8v-1.8h-1.8Zm3.3 0v1.8h1.8v-1.8h-1.8ZM8 14.9v1.7h8v-1.7H8Z"
        />
      </svg>
    </button>
  )
}

export function KeybindingsPanel() {
  const open = useKeybindingStore((s) => s.open)
  const setOpen = useKeybindingStore((s) => s.setOpen)
  const bindings = useKeybindingStore((s) => s.bindings)
  const layout = useKeybindingStore((s) => s.layout)
  const inWorld = useUniverseStore((s) => s.activeWorldId !== null)

  const dialogRef = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<KeyContext>(inWorld ? 'world' : 'universe')
  const [listening, setListening] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [pressed, setPressed] = useState<ReadonlySet<string>>(new Set())
  const wasEnabled = useRef(true)

  // Opening from where you are: flying shows the flight keys, a world shows its own.
  useEffect(() => {
    if (open) {
      setTab(useUniverseStore.getState().activeWorldId !== null ? 'world' : 'universe')
      setListening(null)
      setNotice('')
    }
  }, [open])

  // Store → <dialog>. The game's keys are off while it is open.
  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (open && !d.open) {
      wasEnabled.current = inputManager.isEnabled()
      d.showModal()
      inputManager.setEnabled(false)
    } else if (!open && d.open) {
      d.close()
    }
  }, [open])

  const onClosed = useCallback(() => {
    if (wasEnabled.current) inputManager.setEnabled(true)
    setListening(null)
    setPressed(new Set())
    setOpen(false)
  }, [setOpen])

  // Open/close with the bound key from anywhere (not while typing, not over another dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      const code = useKeybindingStore.getState().bindings.keybindings
      if (!code || e.code !== code || isTypingTarget(e.target)) return
      if (document.querySelector('dialog[open]')) return
      e.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  // While open: capture the next key for a rebind, light up pressed keys, and keep
  // every other panel's shortcut (M, B, C, P …) from firing underneath.
  useEffect(() => {
    if (!open) return
    const onDown = (e: KeyboardEvent) => {
      const state = useKeybindingStore.getState()
      if (listening) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        if (e.repeat) return
        if (e.code === 'Escape') {
          setListening(null)
          setNotice('')
        } else if (e.code === 'Backspace' || e.code === 'Delete') {
          state.rebind(listening, null)
          setListening(null)
          setNotice('Unbound.')
        } else if (!isBindable(e.code)) {
          setNotice(`${e.code === 'Tab' ? 'Tab' : 'That key'} can't be used. Press another, or Esc to cancel.`)
        } else {
          setNotice(describe(state.rebind(listening, e.code), tab))
          setListening(null)
        }
        return
      }
      if (e.code === 'Escape') return // the dialog closes itself
      const toggle = state.bindings.keybindings
      if (toggle && e.code === toggle && !e.repeat && !isTypingTarget(e.target)) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        return
      }
      setPressed((p) => (p.has(e.code) ? p : new Set(p).add(e.code)))
      if (Object.values(state.bindings).includes(e.code)) e.stopPropagation()
    }
    const onUp = (e: KeyboardEvent) => {
      if (listening) {
        e.stopPropagation()
        return
      }
      setPressed((p) => {
        if (!p.has(e.code)) return p
        const n = new Set(p)
        n.delete(e.code)
        return n
      })
    }
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
    }
  }, [open, listening, tab, setOpen])

  const groups = useMemo(() => {
    const defs = BINDING_DEFS.filter((d) => d.contexts.includes(tab))
    return GROUP_ORDER.map((g) => ({ group: g, defs: defs.filter((d) => d.group === g) })).filter((g) => g.defs.length > 0)
  }, [tab])

  const changed = BINDING_DEFS.some((d) => bindings[d.id] !== DEFAULT_BINDINGS[d.id])

  const rowLabel = (d: BindingDef) => (tab === 'world' && d.worldLabel) || d.label

  return (
    <dialog
      ref={dialogRef}
      id="keybindings-panel"
      className="keybindings-panel"
      aria-labelledby="keybindings-title"
      onClose={onClosed}
      onCancel={(e) => {
        // Esc while waiting for a key cancels the wait, not the panel.
        if (listening) e.preventDefault()
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) setOpen(false) // backdrop click
      }}
    >
      {open && (
        <div className="keybindings-shell">
          <header className="keybindings-head">
            <div>
              <h2 id="keybindings-title" className="keybindings-title">Keys &amp; controls</h2>
              <p className="keybindings-sub">Click a key, then press its replacement.</p>
            </div>
            <button type="button" className="keybindings-close" aria-label="Close" onClick={() => setOpen(false)}>
              ✕
            </button>
          </header>

          <div className="keybindings-tabs" role="tablist" aria-label="Controls for">
            {(['universe', 'world'] as const).map((c) => (
              <button
                key={c}
                id={`keybindings-tab-${c}`}
                type="button"
                role="tab"
                aria-selected={tab === c}
                aria-controls="keybindings-list"
                className={`keybindings-tab${tab === c ? ' keybindings-tab--active' : ''}`}
                onClick={() => {
                  setTab(c)
                  setListening(null)
                  setNotice('')
                }}
              >
                {CONTEXT_LABEL[c]}
              </button>
            ))}
          </div>

          <div id="keybindings-list" className="keybindings-list" role="tabpanel" aria-labelledby={`keybindings-tab-${tab}`}>
            {groups.map(({ group, defs }) => (
              <section key={group} className="keybindings-group" aria-label={GROUP_LABEL[group]}>
                <h3 className="keybindings-group-title">{GROUP_LABEL[group]}</h3>
                {defs.map((d) => {
                  const code = bindings[d.id] ?? null
                  const isListening = listening === d.id
                  const isDefault = code === DEFAULT_BINDINGS[d.id]
                  const lit = !!code && pressed.has(code)
                  return (
                    <div key={d.id} className={`keybindings-row${lit ? ' keybindings-row--lit' : ''}`}>
                      <span className="keybindings-label">{rowLabel(d)}</span>
                      <span className="keybindings-actions">
                        {!isDefault && !isListening && (
                          <button
                            type="button"
                            className="keybindings-reset"
                            title={`Reset to ${keyCapLabel(DEFAULT_BINDINGS[d.id], layout)}`}
                            aria-label={`Reset ${rowLabel(d)} to default`}
                            onClick={() => setNotice(describe(useKeybindingStore.getState().reset(d.id), tab))}
                          >
                            ↺
                          </button>
                        )}
                        <button
                          id={`keybinding-${d.id}`}
                          type="button"
                          className={`keybindings-key${isListening ? ' keybindings-key--listening' : ''}${!code ? ' keybindings-key--unbound' : ''}${!isDefault ? ' keybindings-key--custom' : ''}`}
                          aria-label={`${rowLabel(d)}: ${code ? keyCapLabel(code, layout) : 'unbound'}. Press to change.`}
                          onClick={() => {
                            setListening(isListening ? null : d.id)
                            setNotice('')
                          }}
                          onBlur={() => isListening && setListening(null)}
                        >
                          {isListening ? 'Press a key…' : keyCapLabel(code, layout)}
                        </button>
                      </span>
                    </div>
                  )
                })}
              </section>
            ))}

            <section className="keybindings-group" aria-label="Fixed keys">
              <h3 className="keybindings-group-title">Fixed</h3>
              <div className="keybindings-row">
                <span className="keybindings-label">{tab === 'world' ? 'Leave the world · close a panel' : 'Close a panel'}</span>
                <span className="keybindings-actions">
                  <span className="keybindings-key keybindings-key--fixed">Esc</span>
                </span>
              </div>
            </section>
          </div>

          <footer className="keybindings-foot">
            <p className="keybindings-notice" role="status" aria-live="polite">
              {listening ? 'Press the new key · Backspace to unbind · Esc to cancel' : notice}
            </p>
            <button
              id="keybindings-reset-all"
              type="button"
              className="keybindings-reset-all"
              disabled={!changed}
              onClick={() => {
                useKeybindingStore.getState().resetAll()
                setListening(null)
                setNotice('Everything is back to the defaults.')
              }}
            >
              Reset all
            </button>
          </footer>
        </div>
      )}
    </dialog>
  )
}
