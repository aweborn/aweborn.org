import { useEffect, useState } from 'react'
import { useWaveStore, WAVE_BANNER_S } from '../stores/waveStore'

/**
 * The words and the light for the Solidification Wave (Phase 05): a golden
 * flash when the front sweeps past you, and the recognition line
 * ("A wave of light from ★ a generous soul"; opt-in donor names later).
 */
export function WaveBanner() {
  const seq = useWaveStore((s) => s.seq)
  const message = useWaveStore((s) => s.message)
  const passedAt = useWaveStore((s) => s.passedAt)
  const [showText, setShowText] = useState(false)

  useEffect(() => {
    if (seq === 0) return
    setShowText(true)
    const t = setTimeout(() => setShowText(false), WAVE_BANNER_S * 1000)
    return () => clearTimeout(t)
  }, [seq])

  return (
    <>
      {passedAt !== null && <div key={passedAt} className="wave-flash" aria-hidden="true" />}
      <div className={`wave-banner${showText ? ' wave-banner--on' : ''}`} role="status" aria-live="polite">
        {showText && (
          <>
            <div className="wave-banner__line">{message}</div>
            <div className="wave-banner__sub">The Frontier is expanding</div>
          </>
        )}
      </div>
    </>
  )
}
