/**
 * "Playing on another screen" (M9 one screen steers). Shown while another
 * screen of the same player steers; "Play here" (or just flying) takes over.
 */
import { simLink } from '../lib/simLink'
import { useSteerStore } from '../stores/steerStore'

export function SteerBanner() {
  const follower = useSteerStore((s) => s.follower)
  if (!follower) return null
  return (
    <div className="steer-banner" role="status">
      <span className="steer-banner-dot" aria-hidden="true" />
      <span className="steer-banner-text">Playing on another screen</span>
      <button type="button" id="steer-play-here" className="steer-banner-btn" onClick={() => simLink.claimSteer()}>
        Play here
      </button>
    </div>
  )
}
