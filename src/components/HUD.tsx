import { useEffect, useRef, useState } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { inputManager } from '../systems/InputManager'
import { warpSystem } from '../systems/WarpSystem'
import { starModSlots } from '../systems/StarModSlots'

interface HUDProps {
  showPrompt: boolean
  onPromptClick: () => void
}

// ── Mod Slot Labels ──────────────────────────────────────────────────

const TRAIL_LABELS: Record<string, string> = {
  comet: '☄ Comet', sparkle: '✦ Sparkle', ribbon: '〰 Ribbon', helix: '🧬 Helix', none: '○ None',
}
const AURA_LABELS: Record<string, string> = {
  glow: '◉ Glow', pulse: '◎ Pulse', rings: '◯ Rings', flame: '🔥 Flame', none: '○ None',
}
const SHAPE_LABELS: Record<string, string> = {
  sphere: '● Sphere', crystal: '◆ Crystal', spiral: '✿ Spiral', spike: '▲ Spike', jellyfish: '🪼 Jelly',
}

/**
 * HUD overlay — displays flight telemetry, warp status, mod slots,
 * and contextual control hints over the 3D scene.
 */
export function HUD({ showPrompt, onPromptClick }: HUDProps) {
  const speed = useUniverseStore((s) => s.playerSpeed)
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const worlds = useUniverseStore((s) => s.worlds)

  const isInWorld = activeWorldId !== null
  const context = inputManager.getContext()

  // Get warp state
  const warp = warpSystem.getState()
  const isWarping = warp.phase === 'charging' || warp.phase === 'leaping'
  const isLocked = warp.phase === 'locked' || warp.phase === 'charging'

  // Get mod slot state
  const mods = starModSlots.getState()

  // Get the name of the active world if inside one
  const worldName = isInWorld && activeWorldId
    ? worlds.get(activeWorldId)?.name ?? 'Unknown World'
    : null

  // ── FPS counter ──
  const [fps, setFps] = useState(0)
  const framesRef = useRef(0)
  const lastTimeRef = useRef(performance.now())

  useEffect(() => {
    let rafId: number
    function tick() {
      framesRef.current++
      const now = performance.now()
      const elapsed = now - lastTimeRef.current
      if (elapsed >= 500) {
        setFps(Math.round((framesRef.current / elapsed) * 1000))
        framesRef.current = 0
        lastTimeRef.current = now
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  return (
    <div className="hud-overlay">
      {/* Top left — Brand */}
      <div className="hud-top-left">
        <div className="hud-brand">aweborn</div>
      </div>

      {/* Top right — Context mode */}
      <div className="hud-top-right">
        <div className="hud-mode">
          {isInWorld ? (
            <>
              <span className="hud-mode-icon">🌍</span>
              <span className="hud-mode-label">{worldName}</span>
            </>
          ) : (
            <>
              <span className="hud-mode-icon">✦</span>
              <span className="hud-mode-label">UNIVERSE</span>
            </>
          )}
        </div>
        <div className="hud-fps">{fps} FPS</div>
      </div>

      {/* Top center — Lock-on target info */}
      {isLocked && warp.lockedTarget && (
        <div className="hud-top-center">
          <div className="hud-target-info">
            <div className="hud-target-name">
              ◇ {warp.lockedTarget.name}
            </div>
            <div className="hud-target-distance">
              {warp.candidates.find((c) => c.world.id === warp.lockedTarget?.id)?.distance.toFixed(1) ?? '?'} u
            </div>
          </div>
        </div>
      )}

      {/* Bottom left — Speed indicator + Mod slots */}
      {!isInWorld && (
        <div className="hud-bottom-left">
          <div className="hud-speed">
            <div className="hud-speed-bar-track">
              <div
                className="hud-speed-bar-fill"
                style={{ width: `${Math.min(speed / 20 * 100, 100)}%` }}
              />
            </div>
            <div className="hud-speed-value">
              {speed.toFixed(1)} <span className="hud-speed-unit">u/s</span>
            </div>
          </div>

          {/* Mod slot indicators */}
          <div className="hud-mod-slots">
            <div className="hud-mod-slot" title="Trail (U)">
              <kbd>U</kbd> {TRAIL_LABELS[mods.trail] ?? mods.trail}
            </div>
            <div className="hud-mod-slot" title="Aura (I)">
              <kbd>I</kbd> {AURA_LABELS[mods.aura] ?? mods.aura}
            </div>
            <div className="hud-mod-slot" title="Shape (O)">
              <kbd>O</kbd> {SHAPE_LABELS[mods.shape] ?? mods.shape}
            </div>
          </div>
        </div>
      )}

      {/* Bottom center — Context hint / Donate prompt */}
      <div className="hud-bottom-center">
        {showPrompt ? (
          <button
            className="hud-prompt"
            onClick={onPromptClick}
            id="hud-donate-prompt"
          >
            ✦ Support Our Mission — Donate Now ✦
          </button>
        ) : (
          <div className="hud-hint">
            Explore the cosmos · Click the glowing portal to donate
          </div>
        )}
      </div>

      {/* Bottom right — Controls hint */}
      <div className="hud-bottom-right">
        <div className="hud-controls">
          {isInWorld ? (
            <>
              <div className="hud-control-row">
                <kbd>ESC</kbd> Exit World
              </div>
            </>
          ) : (
            <>
              <div className="hud-control-row">
                <kbd>V</kbd> Thrust
                <kbd>SPACE</kbd> Brake
              </div>
              <div className="hud-control-row">
                <kbd>Q</kbd><kbd>R</kbd> Yaw
                <kbd>W</kbd><kbd>E</kbd> Pitch
              </div>
              <div className="hud-control-row">
                <kbd>J</kbd> Lock-on
                <kbd>K</kbd> Warp
              </div>
              <div className="hud-control-row">
                <kbd>N</kbd> Enter World
                <kbd>1-4</kbd> Camera
              </div>
            </>
          )}
        </div>
      </div>

      {/* Center — Crosshair (subtle) + Warp charge ring */}
      {!isInWorld && (
        <div className="hud-crosshair">
          {isWarping ? (
            <div className="hud-warp-charge-ring">
              <svg viewBox="0 0 40 40" className="hud-charge-svg">
                <circle
                  cx="20" cy="20" r="16"
                  fill="none"
                  stroke="rgba(100, 140, 255, 0.15)"
                  strokeWidth="2"
                />
                <circle
                  cx="20" cy="20" r="16"
                  fill="none"
                  stroke="rgba(140, 180, 255, 0.9)"
                  strokeWidth="2.5"
                  strokeDasharray={`${warp.chargeProgress * 100.53} 100.53`}
                  strokeLinecap="round"
                  transform="rotate(-90 20 20)"
                  style={{ filter: 'drop-shadow(0 0 4px rgba(140, 180, 255, 0.6))' }}
                />
              </svg>
              <div className="hud-crosshair-dot hud-crosshair-dot--charging" />
            </div>
          ) : isLocked ? (
            <div className="hud-lock-indicator">
              <div className="hud-lock-diamond" />
            </div>
          ) : (
            <div className="hud-crosshair-dot" />
          )}
        </div>
      )}
    </div>
  )
}
