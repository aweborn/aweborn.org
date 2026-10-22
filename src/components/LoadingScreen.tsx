import { useEffect, useState } from 'react'

interface LoadingScreenProps {
  progress: number
  onComplete: () => void
}

/** Fade-out length; matches `.loading-screen` transition in index.css. */
const FADE_MS = 300

/**
 * Splash while the 3D scene starts. The bar is no longer a fake percentage
 * (2026-10-22): there's nothing to measure once the JS has loaded, only
 * "the first frame is drawn". So it sweeps (indeterminate) until the Scene
 * reports 100, then the splash fades out at once (was +600 ms hold +800 ms fade).
 */
export function LoadingScreen({ progress, onComplete }: LoadingScreenProps) {
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (progress >= 100) {
      setLoaded(true)
      const timer = setTimeout(onComplete, FADE_MS)
      return () => clearTimeout(timer)
    }
  }, [progress, onComplete])

  return (
    <div className={`loading-screen ${loaded ? 'loaded' : ''}`}>
      {/* Floating background particles */}
      <div className="loading-particles">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="loading-particle"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${40 + Math.random() * 40}%`,
              animationDelay: `${Math.random() * 4}s`,
              animationDuration: `${3 + Math.random() * 3}s`,
            }}
          />
        ))}
      </div>

      {/* Logo */}
      <div className="loading-logo">aweborn</div>
      <div className="loading-subtitle">Entering the cosmos</div>

      {/* Progress bar: sweeps until the scene is drawn, then fills */}
      <div className="loading-bar-container" role="progressbar" aria-label="Loading">
        <div className={`loading-bar${progress >= 100 ? ' is-done' : ''}`} />
      </div>
    </div>
  )
}
