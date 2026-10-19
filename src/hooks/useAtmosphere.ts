import { useMemo } from 'react'
import { CHUNK } from '@aweborn/shared/voxel'
import { DEFAULT_SKY, type BlueprintSky } from '@aweborn/shared/blueprint'
import { useUniverseStore } from '../stores/universeStore'
import { useWorldStore } from '../stores/worldStore'
import { usePlannerStore } from '../stores/plannerStore'
import { useQualityTier } from '../stores/qualityStore'

/**
 * How a voxel world looks from inside: the sky colors, light, and fog, plus how
 * many terrain chunks the device draws. The blueprint's `sky` wins while its
 * preview is showing; otherwise the shaped world's sky; otherwise daylight.
 * Null in worlds with no voxel terrain (the old flat rooms keep their look).
 */
export interface Atmosphere {
  sky: BlueprintSky
  /** Chunks drawn around the player (from the quality tier). */
  radius: number
  /** Fog start / end in meters. The end is pulled in so the last drawn chunk fades out before it pops in. */
  fogNear: number
  fogFar: number
}

export function useAtmosphere(): Atmosphere | null {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const ghost = usePlannerStore((s) => (s.visible && s.worldId === activeWorldId ? s.blueprint : null))
  const worldTerrain = useWorldStore((s) => s.voxelTerrain)
  const worldSky = useWorldStore((s) => s.sky)
  const tier = useQualityTier()

  const hasTerrain = !!(ghost || worldTerrain)
  const sky = ghost ? (ghost.sky ?? DEFAULT_SKY) : (worldSky ?? DEFAULT_SKY)
  const skyKey = JSON.stringify(sky)
  return useMemo(() => {
    if (!hasTerrain) return null
    const radius = tier.worldChunks
    const fogFar = Math.min(sky.fog, radius * CHUNK - 8)
    return { sky, radius, fogFar, fogNear: fogFar * 0.3 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTerrain, skyKey, tier.worldChunks])
}
