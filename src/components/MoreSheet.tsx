import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { useSheet } from '../stores/sheetStore'
import { useUniverseStore } from '../stores/universeStore'
import { useHudPrefsStore, openGive } from '../stores/hudPrefsStore'
import { getPlayerSnapshot, subscribePlayer } from '../lib/player'
import { starModSlots, MOD_LABELS } from '../systems/StarModSlots'
import { touchInputAdapter, isFullscreen, isStandalone } from '../systems/TouchInputAdapter'
import { QualityControl } from './DisplaySettings'
import { openAccount } from './ManaSeal'

/**
 * ••• More (touch, 2026-10-22): everything a phone needs that isn't a thumb
 * control or the dock's three big jobs. It replaced the gear, the fullscreen
 * button and the "Save · Sign in" chip at the top right / top left, which
 * crowded a portrait screen (docs/mobile-ui/SPEC.md → ••• More).
 *
 *   Me        your player (save / sign in) + your star's look (U/I/O/P on keys)
 *   Settings  quality, full screen, FPS counter
 *   Controls  the touch legend (the keyboard panel has nothing to show on a phone)
 *   Give      the gift modal
 *
 * Touch only (the dock opens it). Desktop keeps the gear, keys panel and chip.
 */
export function MoreSheet() {
  const [open, setOpen] = useSheet('more')
  const inWorld = useUniverseStore((s) => s.activeWorldId !== null)
  const player = useSyncExternalStore(subscribePlayer, getPlayerSnapshot, getPlayerSnapshot)
  const showFps = useHudPrefsStore((s) => s.showFps)
  const setShowFps = useHudPrefsStore((s) => s.setShowFps)
  const [mods, setMods] = useState(() => ({ ...starModSlots.getState() }))
  const [full, setFull] = useState(isFullscreen)

  useEffect(() => {
    if (!open) return
    setMods({ ...starModSlots.getState() })
    const onFs = () => setFull(isFullscreen())
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('fullscreenchange', onFs)
    document.addEventListener('webkitfullscreenchange', onFs)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      document.removeEventListener('webkitfullscreenchange', onFs)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])

  if (!open) return null

  const cycle = (slot: 'trail' | 'aura' | 'shape') => {
    starModSlots.cycle(slot)
    setMods({ ...starModSlots.getState() })
  }
  const saved = player ? !player.isAnonymous && !player.isGuest : false

  const capturePhoto = () => {
    const srcCanvas = document.querySelector<HTMLCanvasElement>('.canvas-container canvas')
    if (!srcCanvas) return
    setOpen(false)
    requestAnimationFrame(() => {
      srcCanvas.toBlob((blob) => {
        if (!blob) return
        const filename = `aweborn-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`
        const file = new File([blob], filename, { type: 'image/png' })
        if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
          void navigator.share({ files: [file], title: 'Aweborn' }).catch(() => {
            /* user dismissed share sheet */
          })
          return
        }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 5000)
      }, 'image/png')
    })
  }

  return (
    <section id="more-sheet" className={`more-sheet${inWorld ? '' : ' is-space'}`} aria-labelledby="more-title">
      <header className="more-head">
        <h2 id="more-title" className="more-title">More</h2>
        <button id="more-close" type="button" className="more-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
      </header>

      <div className="more-body">
        <h3 className="more-section">Me</h3>
        <button
          id="more-account"
          type="button"
          className="more-row"
          onClick={() => { setOpen(false); openAccount() }}
        >
          <span className="more-orb" style={{ '--more-color': player?.color ?? '#9fe8ff' } as CSSProperties} aria-hidden="true" />
          <span className="more-row-text">
            <span className="more-row-title">{saved ? 'Your player' : 'Save your player'}</span>
            <span className="more-row-sub">{saved ? 'Saved · sign-in methods, characters' : 'Sign in so it follows you to any device'}</span>
          </span>
          <span className="more-chev" aria-hidden="true">›</span>
        </button>
        <div className="more-mods" role="group" aria-label="Your star's look">
          {(['trail', 'aura', 'shape'] as const).map((slot) => (
            <button key={slot} id={`more-mod-${slot}`} type="button" className="more-mod" onClick={() => cycle(slot)}>
              <span className="more-mod-kind">{slot}</span>
              <span className="more-mod-value">{MOD_LABELS[slot][mods[slot]] ?? mods[slot]}</span>
            </button>
          ))}
          <button id="more-mod-emote" type="button" className="more-mod" onClick={() => starModSlots.emote()}>
            <span className="more-mod-kind">emote</span>
            <span className="more-mod-value">👋 Wave</span>
          </button>
        </div>

        <h3 className="more-section">Settings</h3>
        <div className="more-card">
          <QualityControl />
        </div>
        {!isStandalone() && (
          <button id="more-fullscreen" type="button" className="more-row" onClick={() => void touchInputAdapter.toggleFullscreen()}>
            <span className="more-icon" aria-hidden="true">⛶</span>
            <span className="more-row-text">
              <span className="more-row-title">{full ? 'Leave full screen' : 'Full screen'}</span>
            </span>
          </button>
        )}
        <label className="more-row more-toggle" htmlFor="more-fps">
          <span className="more-icon" aria-hidden="true">⏱</span>
          <span className="more-row-text"><span className="more-row-title">Show FPS</span></span>
          <input id="more-fps" type="checkbox" role="switch" checked={showFps} onChange={(e) => setShowFps(e.target.checked)} />
        </label>
        <button id="more-photo" type="button" className="more-row" onClick={capturePhoto}>
          <span className="more-icon" aria-hidden="true">📸</span>
          <span className="more-row-text">
            <span className="more-row-title">Share or save photo</span>
            <span className="more-row-sub">Clean snapshot without controls</span>
          </span>
        </button>

        <h3 className="more-section">Controls</h3>
        <ul className="more-legend">
          {inWorld ? (
            <>
              <li><b>Left stick</b> walk · push to the rim to sprint</li>
              <li><b>Right stick</b> look around (or drag the sky)</li>
              <li><b>Pinch</b> zoom camera in or out</li>
              <li><b>JUMP</b> jump · <b>KICK</b> kick · <b>GRAB</b> pick up / carry</li>
              <li><b>🧱 Make → Library</b> pick a block or shape to hold in hand, then tap <b>PLACE</b></li>
              <li><b>Hold the world name</b> (top right) to return to space</li>
            </>
          ) : (
            <>
              <li><b>Left stick</b> steer</li>
              <li><b>THRUST</b> hold to fly · slide down to brake</li>
              <li><b>Pinch</b> zoom camera in or out</li>
              <li><b>Tap a world</b> (or its radar dot) to lock on · tap the name at the top to switch</li>
              <li><b>WARP</b> appears when you're locked on · hold, then let go to leap</li>
              <li><b>ENTER</b> appears when you're close enough to land</li>
              <li><b>DRIVE / NEUTRAL</b> switch flight mode</li>
            </>
          )}
        </ul>

        <h3 className="more-section">Give</h3>
        <button id="more-give" type="button" className="more-row more-row--give" onClick={() => { setOpen(false); openGive() }}>
          <span className="more-icon" aria-hidden="true">✨</span>
          <span className="more-row-text">
            <span className="more-row-title">Give mana</span>
            <span className="more-row-sub">Every gift lights up the universe for everyone</span>
          </span>
          <span className="more-chev" aria-hidden="true">›</span>
        </button>
      </div>
    </section>
  )
}
