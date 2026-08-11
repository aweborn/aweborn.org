import { useEffect, useState, useMemo } from 'react'

interface FallbackSceneProps {
  onReady: () => void
  onDonate: () => void
}

/** Best-effort browser detection for tailored instructions. */
function detectBrowser(): 'chrome' | 'firefox' | 'edge' | 'safari' | 'other' {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('edg/')) return 'edge'
  if (ua.includes('chrome') && !ua.includes('edg/')) return 'chrome'
  if (ua.includes('firefox')) return 'firefox'
  if (ua.includes('safari') && !ua.includes('chrome')) return 'safari'
  return 'other'
}

const browserInstructions: Record<string, { name: string; steps: string[] }> = {
  chrome: {
    name: 'Google Chrome',
    steps: [
      'Open chrome://settings/system in a new tab',
      'Enable "Use graphics acceleration when available"',
      'Click "Relaunch" to restart Chrome',
    ],
  },
  edge: {
    name: 'Microsoft Edge',
    steps: [
      'Open edge://settings/system in a new tab',
      'Enable "Use graphics acceleration when available"',
      'Click "Restart" to restart Edge',
    ],
  },
  firefox: {
    name: 'Firefox',
    steps: [
      'Open about:config in a new tab and accept the warning',
      'Search for webgl.disabled and set it to false',
      'Also ensure layers.acceleration.disabled is false',
      'Restart Firefox',
    ],
  },
  safari: {
    name: 'Safari',
    steps: [
      'Open Safari → Settings → Advanced',
      'Check "Show Develop menu in menu bar"',
      'Go to Develop menu → Experimental Features',
      'Ensure WebGL 2.0 is enabled',
    ],
  },
  other: {
    name: 'your browser',
    steps: [
      'Check your browser settings for hardware acceleration or WebGL',
      'Ensure hardware acceleration / GPU rendering is enabled',
      'Restart your browser after making changes',
    ],
  },
}

export function FallbackScene({ onReady, onDonate }: FallbackSceneProps) {
  const [showHelp, setShowHelp] = useState(false)
  const browser = useMemo(() => detectBrowser(), [])
  const info = browserInstructions[browser]

  useEffect(() => {
    // Immediately tell App we are ready since there's no 3D loading
    onReady()
  }, [onReady])

  return (
    <div className="fallback-scene">
      {/* Animated star particles */}
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
              opacity: 0.5,
            }}
          />
        ))}
      </div>

      <h1 className="fallback-title">Explore the Cosmos</h1>

      <p className="fallback-body">
        Your browser doesn't currently support 3D graphics (WebGL).
        <br />
        You can still support the Aweborn mission below!
      </p>

      <button className="donate-btn" onClick={onDonate} style={{ maxWidth: '300px' }}>
        ✦ Donate Now ✦
      </button>

      {/* Collapsible "How to enable 3D" helper */}
      <button
        className="fallback-help-toggle"
        onClick={() => setShowHelp((v) => !v)}
        aria-expanded={showHelp}
      >
        {showHelp ? '▾ Hide instructions' : '▸ Want the full 3D experience?'}
      </button>

      {showHelp && (
        <div className="fallback-help-panel">
          <p className="fallback-help-intro">
            Enable hardware acceleration in <strong>{info.name}</strong>, then
            reload this page:
          </p>
          <ol className="fallback-help-steps">
            {info.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
