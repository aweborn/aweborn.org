import { Html } from '@react-three/drei'
import { useNameStore, requestNames } from '../stores/nameStore'
import { useEffect } from 'react'

/**
 * A quiet name over a player's head (Rough Draft M1, 2026-10-27). Only named
 * players get one, so a crowd of fresh "Wanderers" stays uncluttered; text
 * goes in as a React text node, never HTML.
 */
export function NameTag({ playerId, height = 1.75 }: { playerId: string; height?: number }) {
  const name = useNameStore((s) => s.names[playerId])
  useEffect(() => {
    if (name === undefined) requestNames([playerId])
  }, [name, playerId])
  if (!name) return null
  return (
    <Html position={[0, height, 0]} center distanceFactor={9} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className="name-tag">{name}</div>
    </Html>
  )
}
