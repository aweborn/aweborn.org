import { useEffect, useState } from 'react'
import { Html } from '@react-three/drei'
import { useWorldStore } from '../stores/worldStore'
import { prepareChat } from '@aweborn/shared/chat'

/** How long a speech bubble stays up after the line arrives. */
const BUBBLE_MS = 7000

/**
 * A speech bubble over a player's head: their latest chat line, for a few
 * seconds. The text goes in as a React text node (never HTML), and is cleaned
 * again here as a second line of defence behind the server.
 */
export function ChatBubble({ playerId, height = 2.15 }: { playerId: string; height?: number }) {
  const line = useWorldStore((s) => {
    for (let i = s.chat.length - 1; i >= 0; i--) if (s.chat[i].sender === playerId) return s.chat[i]
    return null
  })
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

  if (!shown) return null
  return (
    <Html position={[0, height, 0]} center distanceFactor={9} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div className="chat-bubble">{shown}</div>
    </Html>
  )
}
