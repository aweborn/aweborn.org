import { useEffect, useMemo, useRef, useState } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { useWorldStore } from '../stores/worldStore'
import { useChatStore } from '../stores/chatStore'
import { usePresence } from '../hooks/usePresence'
import { matchesBinding } from '../stores/keybindingStore'
import { CHAT_MAX_CHARS, prepareChat } from '@aweborn/shared/chat'

/** Lines older than this fade out of the corner while you're not typing. */
const FADE_MS = 14_000
/** Lines shown in the corner (resting) and in the open scrollback. */
const RESTING_LINES = 5
const OPEN_LINES = 60

function hash(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}
/** A short, stable handle: players have no names yet, so "Wanderer 4K2Q". */
function tagOf(id: string): string {
  return hash(id).toString(36).toUpperCase().padStart(4, '0').slice(-4)
}
function colorOf(id: string): string {
  return `hsl(${hash(id) % 360}, 70%, 72%)`
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)

/**
 * In-world chat: a log in the corner (Enter to talk, Esc to stop) plus the
 * speech bubbles over heads (ChatBubble). The log is the world's own chat
 * history, so latecomers can read what was said. Everything is rendered as
 * text; nothing here ever touches innerHTML.
 */
export function ChatPanel() {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const loaded = useWorldStore((s) => s.loaded)
  const chat = useWorldStore((s) => s.chat)
  const open = useChatStore((s) => s.open)
  const notice = useChatStore((s) => s.notice)
  const { playerId } = usePresence()
  const [text, setText] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const inputRef = useRef<HTMLInputElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const visible = !!activeWorldId && loaded

  // Cleaned once per change (the server already did; this covers older lines)
  const lines = useMemo(
    () => chat.map((m, i) => ({ key: `${m.t}-${i}`, sender: m.sender, t: m.t, text: prepareChat(m.text) })).filter((m) => m.text),
    [chat],
  )

  // Open with Enter from the world (never while typing somewhere else)
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (!matchesBinding(e, 'chat') || e.repeat || e.isComposing || typing(e.target)) return
      e.preventDefault()
      useChatStore.getState().setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible])

  useEffect(() => {
    if (!visible) useChatStore.getState().setOpen(false)
  }, [visible])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
    else inputRef.current?.blur()
  }, [open])

  // Fade clock (only ticks while there's something to fade)
  useEffect(() => {
    if (!visible) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [visible])

  // Keep the newest line in view
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length, open])

  if (!visible || !activeWorldId) return null

  const shown = open
    ? lines.slice(-OPEN_LINES)
    : lines.slice(-RESTING_LINES).filter((m) => Math.abs(now - m.t) < FADE_MS)

  const submit = () => {
    const sent = useChatStore.getState().send(activeWorldId, text)
    if (sent) setText('')
    useChatStore.getState().setOpen(false)
  }

  return (
    <section className={`chat-panel${open ? ' is-open' : ''}`} aria-label="Chat">
      <div className="chat-log" ref={logRef} role="log" aria-live="polite" aria-relevant="additions">
        {shown.length === 0 && open && <p className="chat-empty">Nothing said here yet. Say hello.</p>}
        {shown.map((m) => {
          const mine = m.sender === playerId
          return (
            <p key={m.key} className="chat-line">
              <span className="chat-name" style={{ color: colorOf(m.sender) }}>
                {mine ? 'You' : `Wanderer ${tagOf(m.sender)}`}
              </span>
              <span className="chat-text">{m.text}</span>
            </p>
          )
        })}
      </div>
      {notice && <p className="chat-notice" role="status">{notice}</p>}
      {open ? (
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <input
            ref={inputRef}
            id="chat-input"
            className="chat-input"
            value={text}
            maxLength={CHAT_MAX_CHARS}
            placeholder="Say something… (Enter to send, Esc to close)"
            autoComplete="off"
            autoCorrect="off"
            enterKeyHint="send"
            aria-label="Chat message"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') useChatStore.getState().setOpen(false)
            }}
            onBlur={() => useChatStore.getState().setOpen(false)}
          />
        </form>
      ) : (
        <button
          id="chat-open"
          type="button"
          className="chat-open"
          aria-label="Open chat (Enter)"
          title="Chat (Enter)"
          onClick={() => useChatStore.getState().setOpen(true)}
        >
          💬
        </button>
      )}
    </section>
  )
}
