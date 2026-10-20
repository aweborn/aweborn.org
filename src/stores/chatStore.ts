/**
 * Chat state that isn't part of the world document: how to send (the sync
 * connection lives in CRDTDevOverlay), whether the box is open, and the last
 * notice from the server ("slow down"). The messages themselves are the
 * world's own chat log (worldStore.chat), written only by the server.
 */
import { create } from 'zustand'
import { CHAT_MAX_CHARS } from '@aweborn/shared/chat'

export type ChatSender = (worldId: string, text: string) => void

interface ChatState {
  sender: ChatSender | null
  /** Typing box focused. */
  open: boolean
  /** Short server notice shown under the log, or null. */
  notice: string | null
  setSender: (s: ChatSender | null) => void
  setOpen: (open: boolean) => void
  /** Send a line to a world; returns false if there's nothing to send or no connection. */
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

/** Turn a server `chat` payload ({ error }) into a visible notice. */
export function onChatNotice(data: Uint8Array): void {
  try {
    const body = JSON.parse(new TextDecoder().decode(data)) as { error?: unknown }
    if (typeof body.error === 'string') {
      useChatStore.getState().showNotice(NOTICES[body.error] ?? 'That message could not be sent.')
    }
  } catch {
    /* ignore malformed notices */
  }
}
