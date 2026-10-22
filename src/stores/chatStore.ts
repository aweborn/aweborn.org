/**
 * Chat state that isn't part of a world document: how to send (the sync
 * connection lives in SyncBridge), whether the box is open, the last
 * notice from the server ("slow down"), and the **space** log. Inside a
 * world, messages are the world's own chat log (worldStore.chat), written
 * only by the server. Out in space (Origin included) there is no world doc,
 * so the server sends lines directly and they live here (2026-10-20).
 */
import { create } from 'zustand'
import { CHAT_HISTORY, CHAT_MAX_CHARS } from '@aweborn/shared/chat'
import type { ChatMessage } from '@aweborn/shared/crdt-schema'

/** Chat target id for space; matches SPACE_CHAT_ID in the server's rooms.ts. */
export const SPACE_CHAT = 'space'

export type ChatSender = (worldId: string, text: string) => void

interface ChatState {
  sender: ChatSender | null
  /** Typing box focused. */
  open: boolean
  /** Short server notice shown under the log, or null. */
  notice: string | null
  /** What's been said out in space (server-stamped, newest last). */
  space: ChatMessage[]
  setSender: (s: ChatSender | null) => void
  setOpen: (open: boolean) => void
  /** Send a line to a world (or SPACE_CHAT); returns false if there's nothing to send or no connection. */
  send: (worldId: string, text: string) => boolean
  showNotice: (text: string | null) => void
}

const NOTICES: Record<string, string> = {
  too_fast: 'Easy there — one message at a time.',
  too_many: "You're chatting a lot. Give it a moment.",
  no_session: 'Chat needs a signed-in session (guests are fine). Try reloading.',
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null

export const useChatStore = create<ChatState>((set, get) => ({
  sender: null,
  open: false,
  notice: null,
  space: [],
  setSender: (sender) => set({ sender }),
  setOpen: (open) => set({ open }),
  send: (worldId, text) => {
    const line = Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, CHAT_MAX_CHARS).join('')
    const { sender } = get()
    if (!line || !sender) return false
    sender(worldId, line)
    return true
  },
  showNotice: (text) => {
    if (noticeTimer) clearTimeout(noticeTimer)
    set({ notice: text })
    if (text) noticeTimer = setTimeout(() => set({ notice: null }), 4000)
  },
}))

function isLine(m: unknown): m is ChatMessage {
  const o = m as ChatMessage
  return !!o && typeof o.sender === 'string' && typeof o.text === 'string' && typeof o.t === 'number'
}

/**
 * A server `chat` payload: `{ error }` becomes a visible notice; for space,
 * `{ lines, history? }` appends to (or, for history on (re)connect, replaces)
 * the space log.
 */
export function onChatNotice(data: Uint8Array, worldId: string | null = null): void {
  try {
    const body = JSON.parse(new TextDecoder().decode(data)) as { error?: unknown; lines?: unknown; history?: unknown }
    if (typeof body.error === 'string') {
      useChatStore.getState().showNotice(NOTICES[body.error] ?? 'That message could not be sent.')
      return
    }
    if (worldId === SPACE_CHAT && Array.isArray(body.lines)) {
      const lines = body.lines.filter(isLine)
      useChatStore.setState((s) => ({
        space: (body.history ? lines : [...s.space, ...lines]).slice(-CHAT_HISTORY),
      }))
    }
  } catch {
    /* ignore malformed notices */
  }
}
