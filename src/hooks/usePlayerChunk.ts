import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { interiorController } from '../systems/InteriorController'
import { chunkOfWorld } from '../stores/worldVoxels'
import type { BlueprintDraft } from '@aweborn/shared/blueprint'

/** The terrain chunk the player is in (inside a world). Updates only when they cross a chunk edge. */
export function usePlayerChunk(terrain: BlueprintDraft['terrain'] | null | undefined): [number, number] {
  const [chunk, setChunk] = useState<[number, number]>([0, 0])
  const last = useRef<[number, number]>([0, 0])
  useFrame(() => {
    if (!terrain) return
    const s = interiorController.state
    const [cx, cz] = chunkOfWorld(terrain, s.x, s.z)
    if (cx !== last.current[0] || cz !== last.current[1]) {
      last.current = [cx, cz]
      setChunk([cx, cz])
    }
  })
  return chunk
}
