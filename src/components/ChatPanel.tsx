import { useEffect, useMemo, useRef, useState } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { useWorldStore } from '../stores/worldStore'
import { useChatStore, SPACE_CHAT } from '../stores/chatStore'
import { usePresence } from '../hooks/usePresence'
import { matchesBinding, keyCapLabel, useKeybindingStore } from '../stores/keybindingStore'
import { CHAT_MAX_CHARS, prepareChat } from '@aweborn/shared/chat'
import { useNameStore, requestNames, displayName } from '../stores/nameStore'
import { useMuteStore } from '../stores/muteStore'

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
function colorOf(id: string): string {
  return `hsl(${hash(id) % 360}, 70%, 72%)`
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)

/**
 * Chat everywhere: inside a world it's the world's own log; out in space
 * (Origin and the open universe, 2026-10-20) it's the space log the server
 * keeps. A log in the corner (Enter to talk, Esc to stop) plus speech bubbles
 * over heads (ChatBubble). Latecomers can read recent history. Everything is
 * rendered as text; nothing here ever touches innerHTML.
 */
export function ChatPanel() {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const loaded = useWorldStore((s) => s.loaded)
  const worldChat = useWorldStore((s) => s.chat)
  const spaceChat = useChatStore((s) => s.space)
  const open = useChatStore((s) => s.open)
  const notice = useChatStore((s) => s.notice)
  const { playerId } = usePresence()
  const [text, setText] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const inputRef = useRef<HTMLInputElement>(null)
  const chatKey = useKeybindingStore((s) => keyCapLabel(s.bindings.chat ?? null, s.layout))
  const logRef = useRef<HTMLDivElement>(null)
  const target = activeWorldId ?? SPACE_CHAT
  const visible = activeWorldId ? loaded : true
  const chat = activeWorldId ? worldChat : spaceChat

  // Cleaned once per change (the server already did; this covers older lines)
  const muted = useMuteStore((s) => s.muted)
  const lines = useMemo(
    () =>
      chat
        .map((m, i) => ({ key: `${m.t}-${i}`, sender: m.sender, t: m.t, text: prepareChat(m.text) }))
        .filter((m) => m.text && !muted.has(m.sender)),
    [chat, muted],
  )
  const names = useNameStore((s) => s.names)
  useEffect(() => {
    requestNames(new Set(lines.slice(-OPEN_LINES).map((m) => m.sender)))
  }, [lines])

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

  if (!visible) return null

  const shown = open
    ? lines.slice(-OPEN_LINES)
    : lines.slice(-RESTING_LINES).filter((m) => Math.abs(now - m.t) < FADE_MS)

  const submit = () => {
    const sent = useChatStore.getState().send(target, text)
    if (sent) setText('')
    useChatStore.getState().setOpen(false)
  }

  return (
    <section className={`chat-panel${open ? ' is-open' : ''}${activeWorldId ? '' : ' is-space'}`} aria-label="Chat">
      <div className="chat-log" ref={logRef} role="log" aria-live="polite" aria-relevant="additions">
        {shown.length === 0 && open && (
          <p className="chat-empty">{activeWorldId ? 'Nothing said here yet. Say hello.' : 'Nothing said out in space yet. Say hello.'}</p>
        )}
        {shown.map((m) => {
          const mine = m.sender === playerId
          return (
            <p key={m.key} className="chat-line">
              {mine || !open ? (
                <span className="chat-name" style={{ color: colorOf(m.sender) }}>
                  {mine ? 'You' : displayName(m.sender, names)}
                </span>
              ) : (
                <button
                  type="button"
                  className="chat-name chat-name--btn"
                  style={{ color: colorOf(m.sender) }}
                  title="Mute or report"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => useMuteStore.getState().openActions(m.sender, target)}
                >
                  {displayName(m.sender, names)}
                </button>
              )}
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
          aria-label={`Open chat (${chatKey})`}
          title={`Chat (${chatKey})`}
          onClick={() => useChatStore.getState().setOpen(true)}
        >
          💬
        </button>
      )}
    </section>
  )
}
