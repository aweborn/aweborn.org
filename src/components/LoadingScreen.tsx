import { useEffect, useState } from 'react'

interface LoadingScreenProps {
  progress: number
  onComplete: () => void
}

export function LoadingScreen({ progress, onComplete }: LoadingScreenProps) {
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (progress >= 100) {
      const timer = setTimeout(() => {
        setLoaded(true)
        setTimeout(onComplete, 800)
      }, 600)
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

      {/* Progress bar */}
      <div className="loading-bar-container">
        <div
          className="loading-bar"
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>
    </div>
  )
}
