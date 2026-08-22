import { useEffect, useRef, useState, useCallback } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { inputManager } from '../systems/InputManager'
import { warpSystem } from '../systems/WarpSystem'
import { starModSlots } from '../systems/StarModSlots'
import { RadarMinimap } from './RadarMinimap'

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

// ── Key → ActionState mapping (for live highlighting) ────────────────

type ActionKey = keyof ReturnType<typeof inputManager.getActions>

/**
 * Maps physical key codes (as displayed on the keyboard visual)
 * to the action they trigger in InputManager.
 */
const KEY_TO_ACTION_MAP: Record<string, ActionKey> = {
  Q: 'yawLeft',
  W: 'pitchUp',
  E: 'pitchDown',
  R: 'yawRight',
  A: 'rollLeft',
  S: 'reverse',
  D: 'strafe',
  F: 'rollRight',
  V: 'thrust',
  T: 'autoOrient',
  Z: 'lockBehind',
  X: 'freeLook',
  C: 'lookBehind',
  U: 'modTrail',
  I: 'modAura',
  O: 'modShape',
  P: 'modEmote',
  J: 'lockOn',
  K: 'warp',
  L: 'scan',
  N: 'interact',
  '1': 'cameraClose',
  '2': 'cameraMedium',
  '3': 'cameraFar',
  '4': 'cameraCinematic',
  SPACE: 'brake',
  ESC: 'escape',
}

// ── Key labels & tooltips ────────────────────────────────────────────

const KEY_LABELS: Record<string, string> = {
  Q: 'Yaw ←',
  W: 'Pitch ↑',
  E: 'Pitch ↓',
  R: 'Yaw →',
  A: 'Roll ←',
  S: 'Reverse',
  D: 'Strafe',
  F: 'Roll →',
  V: 'Thrust',
  T: 'Auto-orient',
  Z: 'Lock behind',
  X: 'Free look',
  C: 'Look behind',
  U: 'Trail mod',
  I: 'Aura mod',
  O: 'Shape mod',
  P: 'Emote',
  J: 'Lock-on',
  K: 'Warp',
  L: 'Scan',
  N: 'Interact',
  '1': 'Close cam',
  '2': 'Medium cam',
  '3': 'Far cam',
  '4': 'Cinematic cam',
  SPACE: 'Brake',
  ESC: 'Exit',
}

/**
 * A single key cap that lights up when its corresponding action is active.
 */
function KeyCap({ keyName, pressed, wide }: { keyName: string; pressed: boolean; wide?: boolean }) {
  return (
    <div
      className={`hud-keycap${pressed ? ' hud-keycap--active' : ''}${wide ? ' hud-keycap--wide' : ''}`}
      title={KEY_LABELS[keyName] ?? keyName}
    >
      {keyName}
    </div>
  )
}

/**
 * HUD overlay — displays flight telemetry, warp status, mod slots,
 * and a live keyboard layout with active-key highlighting.
 */
export function HUD({ showPrompt, onPromptClick }: HUDProps) {
  const speed = useUniverseStore((s) => s.playerSpeed)
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const worlds = useUniverseStore((s) => s.worlds)

  const isInWorld = activeWorldId !== null

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

  // ── FPS counter + live key state polling ──
  const [fps, setFps] = useState(0)
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set())
  const framesRef = useRef(0)
  const lastTimeRef = useRef(performance.now())

  useEffect(() => {
    let rafId: number
    function tick() {
      framesRef.current++
      const now = performance.now()
      const elapsed = now - lastTimeRef.current

      // Update FPS every 500ms
      if (elapsed >= 500) {
        setFps(Math.round((framesRef.current / elapsed) * 1000))
        framesRef.current = 0
        lastTimeRef.current = now
      }

      // Poll input state every frame for key highlighting
      const actions = inputManager.getActions()
      const active = new Set<string>()
      for (const [key, action] of Object.entries(KEY_TO_ACTION_MAP)) {
        if (actions[action]) {
          active.add(key)
        }
      }
      setPressedKeys(active)

      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  const isPressed = useCallback((key: string) => pressedKeys.has(key), [pressedKeys])

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
          {/* Radar minimap */}
          <RadarMinimap />

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
            <div className={`hud-mod-slot${isPressed('U') ? ' hud-mod-slot--active' : ''}`} title="Trail (U)">
              <kbd>U</kbd> {TRAIL_LABELS[mods.trail] ?? mods.trail}
            </div>
            <div className={`hud-mod-slot${isPressed('I') ? ' hud-mod-slot--active' : ''}`} title="Aura (I)">
              <kbd>I</kbd> {AURA_LABELS[mods.aura] ?? mods.aura}
            </div>
            <div className={`hud-mod-slot${isPressed('O') ? ' hud-mod-slot--active' : ''}`} title="Shape (O)">
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

      {/* Bottom — Live keyboard layout */}
      {!isInWorld && (
        <div className="hud-keyboard">
          {/* Left cluster — Navigation */}
          <div className="hud-keyboard-cluster hud-keyboard-left">
            <div className="hud-cluster-label">Navigation</div>
            {/* Number row (camera) */}
            <div className="hud-key-row">
              <KeyCap keyName="1" pressed={isPressed('1')} />
              <KeyCap keyName="2" pressed={isPressed('2')} />
              <KeyCap keyName="3" pressed={isPressed('3')} />
              <KeyCap keyName="4" pressed={isPressed('4')} />
            </div>
            {/* QWER row */}
            <div className="hud-key-row">
              <KeyCap keyName="Q" pressed={isPressed('Q')} />
              <KeyCap keyName="W" pressed={isPressed('W')} />
              <KeyCap keyName="E" pressed={isPressed('E')} />
              <KeyCap keyName="R" pressed={isPressed('R')} />
              <KeyCap keyName="T" pressed={isPressed('T')} />
            </div>
            {/* ASDF row */}
            <div className="hud-key-row hud-key-row--offset-1">
              <KeyCap keyName="A" pressed={isPressed('A')} />
              <KeyCap keyName="S" pressed={isPressed('S')} />
              <KeyCap keyName="D" pressed={isPressed('D')} />
              <KeyCap keyName="F" pressed={isPressed('F')} />
            </div>
            {/* ZXCV row */}
            <div className="hud-key-row hud-key-row--offset-2">
              <KeyCap keyName="Z" pressed={isPressed('Z')} />
              <KeyCap keyName="X" pressed={isPressed('X')} />
              <KeyCap keyName="C" pressed={isPressed('C')} />
              <KeyCap keyName="V" pressed={isPressed('V')} />
            </div>
            {/* Space */}
            <div className="hud-key-row hud-key-row--space">
              <KeyCap keyName="SPACE" pressed={isPressed('SPACE')} wide />
            </div>
          </div>

          {/* Right cluster — Interaction + Mods */}
          <div className="hud-keyboard-cluster hud-keyboard-right">
            <div className="hud-cluster-label">Interact / Mods</div>
            {/* UIOP row (mods) */}
            <div className="hud-key-row">
              <KeyCap keyName="U" pressed={isPressed('U')} />
              <KeyCap keyName="I" pressed={isPressed('I')} />
              <KeyCap keyName="O" pressed={isPressed('O')} />
              <KeyCap keyName="P" pressed={isPressed('P')} />
            </div>
            {/* JKL row */}
            <div className="hud-key-row hud-key-row--offset-1">
              <KeyCap keyName="J" pressed={isPressed('J')} />
              <KeyCap keyName="K" pressed={isPressed('K')} />
              <KeyCap keyName="L" pressed={isPressed('L')} />
            </div>
            {/* N row */}
            <div className="hud-key-row hud-key-row--offset-2">
              <KeyCap keyName="N" pressed={isPressed('N')} />
            </div>
          </div>
        </div>
      )}

      {/* World interior — minimal ESC keycap */}
      {isInWorld && (
        <div className="hud-keyboard hud-keyboard--world">
          <div className="hud-keyboard-cluster">
            <div className="hud-key-row">
              <KeyCap keyName="ESC" pressed={isPressed('ESC')} />
              <span className="hud-key-label">Exit World</span>
            </div>
          </div>
        </div>
      )}

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
