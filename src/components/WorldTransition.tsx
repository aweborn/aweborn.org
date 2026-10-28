import { useRef, useState, useEffect, useMemo } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { useWorldStore } from '../stores/worldStore'
import { useWorldLoadProgress } from '../stores/worldVoxels'
import { useModelShapes } from '../stores/modelShapes'

/**
 * Animated transition overlay + determinate world-loading HUD bar when entering/exiting worlds.
 *
 * Enter: Quick white flash (0.65s) + non-blocking top-center progress bar proportional to
 *        CRDT sync, terrain chunks streamed, and placed 3D models downloaded/decimated.
 * Exit:  Fade out → flash → universe view (0.7s)
 */

type TransitionState = 'none' | 'entering' | 'exiting'

const ENTER_DURATION = 0.65 // seconds
const EXIT_DURATION = 0.7  // seconds

export function WorldTransition() {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const worlds = useUniverseStore((s) => s.worlds)
  const worldLoaded = useWorldStore((s) => s.loaded)
  const worldMeta = useWorldStore((s) => s.meta)
  const objects = useWorldStore((s) => s.objects)
  const voxelTerrain = useWorldStore((s) => s.voxelTerrain)
  const chunksReady = useWorldLoadProgress((s) => s.chunksReady)
  const chunksTotal = useWorldLoadProgress((s) => s.chunksTotal)
  const models = useModelShapes((s) => s.models)
  const shapes = useModelShapes((s) => s.shapes)

  const prevWorldId = useRef<string | null>(null)
  const [state, setState] = useState<TransitionState>('none')
  const [opacity, setOpacity] = useState(0)
  const [showLoadHud, setShowLoadHud] = useState(false)
  const timerRef = useRef(0)
  const durationRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef(0)

  const distinctAssets = useMemo(() => {
    const s = new Set<string>()
    objects.forEach((o) => {
      // Pictures/sounds also carry `asset`, but they stream in on approach — not a load gate
      if (o.type === 'model' && o.asset) s.add(o.asset)
    })
    return [...s]
  }, [objects])

  const modelsTotal = distinctAssets.length
  const modelsReady = useMemo(() => {
    let n = 0
    for (const a of distinctAssets) {
      if (models[a]) n += 1
      else if (shapes[a]) n += 0.5 // downloaded + proxy ready, decimating LODs
    }
    return n
  }, [distinctAssets, models, shapes])

  const hasTerrain = Boolean(voxelTerrain)
  const totalUnits = 1 + (hasTerrain ? Math.max(9, chunksTotal) : 0) + modelsTotal * 4
  const doneUnits =
    (worldLoaded ? 1 : 0.25) +
    (hasTerrain ? Math.min(Math.max(9, chunksTotal), chunksReady) : 0) +
    modelsReady * 4
  const isComplete =
    worldLoaded &&
    (!hasTerrain || (chunksTotal > 0 && chunksReady >= chunksTotal)) &&
    modelsReady >= modelsTotal

  // Detect enter/exit transitions (including stepping between parent and child worlds)
  useEffect(() => {
    const prev = prevWorldId.current
    const isEntering = activeWorldId !== null && activeWorldId !== prev
    const isExiting = activeWorldId === null && prev !== null

    if (isEntering) {
      useWorldLoadProgress.getState().setChunkProgress(0, 0)
      setShowLoadHud(true)
      setState('entering')
      timerRef.current = 0
      durationRef.current = ENTER_DURATION
      lastTimeRef.current = performance.now()
      startAnimation()
    } else if (isExiting) {
      setShowLoadHud(false)
      setState('exiting')
      timerRef.current = 0
      durationRef.current = EXIT_DURATION
      lastTimeRef.current = performance.now()
      startAnimation()
    }

    prevWorldId.current = activeWorldId
  }, [activeWorldId])

  useEffect(() => {
    if (!activeWorldId) {
      setShowLoadHud(false)
      return
    }
    if (!isComplete) {
      setShowLoadHud(true)
      return
    }
    const t = setTimeout(() => setShowLoadHud(false), 380)
    return () => clearTimeout(t)
  }, [activeWorldId, isComplete])

  function startAnimation() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)

    function tick(now: number) {
      const delta = (now - lastTimeRef.current) / 1000
      lastTimeRef.current = now

      timerRef.current += delta
      const t = Math.min(timerRef.current / durationRef.current, 1)

      let newOpacity = 0
      const currentState = timerRef.current < durationRef.current
        ? (durationRef.current === ENTER_DURATION ? 'entering' : 'exiting')
        : 'none'

      if (currentState === 'entering' || (durationRef.current === ENTER_DURATION && t < 1)) {
        if (t < 0.28) {
          newOpacity = t / 0.28
        } else {
          newOpacity = 1 - (t - 0.28) / 0.72
        }
      } else if (currentState === 'exiting' || (durationRef.current === EXIT_DURATION && t < 1)) {
        if (t < 0.2) {
          newOpacity = t / 0.2 * 0.8
        } else {
          newOpacity = 0.8 * (1 - (t - 0.2) / 0.8)
        }
      }

      setOpacity(Math.max(0, newOpacity))

      if (t >= 1) {
        setState('none')
        setOpacity(0)
        rafRef.current = null
        return
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const entry = activeWorldId ? worlds.get(activeWorldId) : undefined
  const worldName = worldMeta?.name || entry?.name || 'World'
  const worldColor = worldMeta?.color || entry?.color || '#5ac8fa'

  let statusDetail = 'Syncing world…'
  if (worldLoaded) {
    if (hasTerrain && chunksReady < chunksTotal) {
      statusDetail = `Shaping terrain (${chunksReady}/${chunksTotal})…`
    } else if (modelsTotal > 0 && modelsReady < modelsTotal) {
      statusDetail = `Preparing creations (${Math.floor(modelsReady)}/${modelsTotal})…`
    } else {
      statusDetail = 'Ready'
    }
  }

  if (state === 'none' && opacity === 0 && !showLoadHud) return null

  return (
    <>
      {(state !== 'none' || opacity > 0) && (
        <div
          className="world-transition-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            pointerEvents: 'none',
            backgroundColor: `rgba(255, 255, 255, ${opacity * 0.82})`,
            mixBlendMode: 'screen',
          }}
        />
      )}
      {activeWorldId && showLoadHud && (
        <div
          className={`world-load-hud${isComplete ? ' is-complete' : ''}`}
          style={{ '--world-load-color': worldColor } as React.CSSProperties}
          role="status"
          aria-live="polite"
        >
          <div className="world-load-hud__row">
            <span className="world-load-hud__orb" aria-hidden="true" />
            <span className="world-load-hud__name">{worldName}</span>
            <span className="world-load-hud__detail">{statusDetail}</span>
          </div>
          <progress
            className="world-load-progress"
            value={Math.min(totalUnits, doneUnits)}
            max={totalUnits}
            aria-label={`Loading ${worldName}`}
          />
        </div>
      )}
    </>
  )
}
