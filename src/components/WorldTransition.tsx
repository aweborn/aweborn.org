import { useRef, useState, useEffect } from 'react'
import { useUniverseStore } from '../stores/universeStore'

/**
 * Animated transition overlay when entering/exiting worlds.
 *
 * Enter: White flash → fade in world interior (1.5s)
 * Exit:  Fade out → flash → universe view (1s)
 *
 * This is a CSS-based overlay (not a 3D effect) for guaranteed
 * coverage and smooth blending regardless of scene complexity.
 *
 * Uses requestAnimationFrame instead of useFrame since this
 * component renders outside the R3F Canvas.
 */

type TransitionState = 'none' | 'entering' | 'exiting'

const ENTER_DURATION = 1.2 // seconds
const EXIT_DURATION = 0.8  // seconds

export function WorldTransition() {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const prevWorldId = useRef<string | null>(null)
  const [state, setState] = useState<TransitionState>('none')
  const [opacity, setOpacity] = useState(0)
  const timerRef = useRef(0)
  const durationRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef(0)

  // Detect enter/exit transitions
  useEffect(() => {
    const wasInWorld = prevWorldId.current !== null
    const isInWorld = activeWorldId !== null

    if (!wasInWorld && isInWorld) {
      setState('entering')
      timerRef.current = 0
      durationRef.current = ENTER_DURATION
      lastTimeRef.current = performance.now()
      startAnimation()
    } else if (wasInWorld && !isInWorld) {
      setState('exiting')
      timerRef.current = 0
      durationRef.current = EXIT_DURATION
      lastTimeRef.current = performance.now()
      startAnimation()
    }

    prevWorldId.current = activeWorldId
  }, [activeWorldId])

  function startAnimation() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)

    function tick(now: number) {
      const delta = (now - lastTimeRef.current) / 1000
      lastTimeRef.current = now

      timerRef.current += delta
      const t = Math.min(timerRef.current / durationRef.current, 1)

      // Calculate opacity based on transition state
      let newOpacity = 0
      const currentState = timerRef.current < durationRef.current
        ? (durationRef.current === ENTER_DURATION ? 'entering' : 'exiting')
        : 'none'

      if (currentState === 'entering' || (durationRef.current === ENTER_DURATION && t < 1)) {
        if (t < 0.3) {
          newOpacity = t / 0.3
        } else {
          newOpacity = 1 - (t - 0.3) / 0.7
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

  if (state === 'none' && opacity === 0) return null

  return (
    <div
      className="world-transition-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        pointerEvents: 'none',
        backgroundColor: `rgba(255, 255, 255, ${opacity * 0.9})`,
        mixBlendMode: 'screen',
      }}
    />
  )
}
