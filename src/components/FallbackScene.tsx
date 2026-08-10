import { useEffect } from 'react'

interface FallbackSceneProps {
  onReady: () => void
  onDonate: () => void
}

export function FallbackScene({ onReady, onDonate }: FallbackSceneProps) {
  useEffect(() => {
    // Immediately tell App we are ready since there's no 3D loading
    onReady()
  }, [onReady])

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(circle at center, #111144 0%, #050510 100%)',
      zIndex: 1,
      padding: '2rem',
      textAlign: 'center'
    }}>
      {/* Some CSS stars for the background */}
      <div className="loading-particles">
        {Array.from({ length: 40 }).map((_, i) => (
          <div
            key={i}
            className="loading-particle"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 4}s`,
              animationDuration: `${3 + Math.random() * 3}s`,
              opacity: 0.5
            }}
          />
        ))}
      </div>

      <h1 style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--text-4xl)',
        fontWeight: 800,
        marginBottom: '1rem',
        background: 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent'
      }}>
        Explore the Cosmos
      </h1>
      <p style={{
        fontFamily: 'var(--font-body)',
        fontSize: 'var(--text-lg)',
        color: 'var(--color-text-secondary)',
        maxWidth: '500px',
        marginBottom: '2.5rem',
        lineHeight: 1.6
      }}>
        It looks like your browser or device doesn't support our 3D immersive experience. 
        You can still support the Aweborn mission by making a donation!
      </p>

      <button className="donate-btn" onClick={onDonate} style={{ maxWidth: '300px' }}>
        ✦ Donate Now ✦
      </button>
    </div>
  )
}
