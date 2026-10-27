import { useEffect, useState } from 'react'
import { Html } from '@react-three/drei'
import { useWorldStore } from '../stores/worldStore'
import { useChatStore } from '../stores/chatStore'
import { useMuteStore } from '../stores/muteStore'
import { prepareChat } from '@aweborn/shared/chat'
import type { ChatMessage } from '@aweborn/shared/crdt-schema'

/** How long a speech bubble stays up after the line arrives. */
const BUBBLE_MS = 7000
/** Cap simultaneous speech bubbles so a 60-player Origin crowd doesn't wall-of-text the screen. */
const MAX_ACTIVE_BUBBLES = 4

function latestFrom(chat: ChatMessage[], playerId: string): ChatMessage | null {
  const seenSenders = new Set<string>()
  for (let i = chat.length - 1; i >= 0; i--) {
    const msg = chat[i]
    seenSenders.add(msg.sender)
    if (seenSenders.size > MAX_ACTIVE_BUBBLES) return null
    if (msg.sender === playerId) return msg
  }
  return null
}

/**
 * A speech bubble over a player's head: their latest chat line, for a few
 * seconds. The text goes in as a React text node (never HTML), and is cleaned
 * again here as a second line of defence behind the server.
 *
 * `source`: the world's log (avatars inside a world) or the space log (player
 * orbs out in space, 2026-10-20). In space the bubble keeps a fixed on-screen
 * size (`distanceFactor` off), since orbs are tiny and often far away.
 */
export function ChatBubble({
  playerId,
  height = 2.15,
  source = 'world',
}: {
  playerId: string
  height?: number
  source?: 'world' | 'space'
}) {
  const worldLine = useWorldStore((s) => (source === 'world' ? latestFrom(s.chat, playerId) : null))
  const spaceLine = useChatStore((s) => (source === 'space' ? latestFrom(s.space, playerId) : null))
  const line = source === 'world' ? worldLine : spaceLine
  const [shown, setShown] = useState<string | null>(null)

  useEffect(() => {
    // Lines already old when we get them (history on arrival) get no bubble
    if (!line || Math.abs(Date.now() - line.t) > 15_000) return
    const text = prepareChat(line.text)
    if (!text) return
    setShown(text)
    const timer = setTimeout(() => setShown(null), BUBBLE_MS)
    return () => clearTimeout(timer)
  }, [line])

  const isMuted = useMuteStore((s) => s.muted.has(playerId))
  if (!shown || isMuted) return null
  return (
    <Html
      position={[0, height, 0]}
      center
      distanceFactor={source === 'world' ? 9 : undefined}
      zIndexRange={[20, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <div className={`chat-bubble${source === 'space' ? ' chat-bubble--space' : ''}`}>{shown}</div>
    </Html>
  )
}
