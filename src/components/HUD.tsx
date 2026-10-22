import { memo, useEffect, useRef, useState, useCallback } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { inputManager } from '../systems/InputManager'
import { flightController } from '../systems/FlightController'
import { warpSystem } from '../systems/WarpSystem'
import { starModSlots, MOD_LABELS } from '../systems/StarModSlots'
import { useHudPrefsStore } from '../stores/hudPrefsStore'
import { RadarMinimap } from './RadarMinimap'
import { PlayerAccount } from './PlayerAccount'
import { WorldIndexChip } from './WorldIndex'
import { DisplaySettings } from './DisplaySettings'
import { KeybindingsButton, KeybindingsPanel } from './KeybindingsPanel'
import { useKeybindingStore, keyCapLabel } from '../stores/keybindingStore'
import { DEF_BY_ID } from '@aweborn/shared/keybindings'

// ── Mod Slot Labels (shared with ••• More, in StarModSlots) ──────────

const { trail: TRAIL_LABELS, aura: AURA_LABELS, shape: SHAPE_LABELS } = MOD_LABELS

// ── Live key caps ────────────────────────────────────────────────────

type ActionKey = keyof ReturnType<typeof inputManager.getActions>

/** Actions that have a key cap or key hint on screen; polled each frame for the pressed highlight. */
const HUD_ACTIONS: readonly ActionKey[] = ['yawLeft', 'thrust', 'pitchUp', 'yawRight', 'rollRight', 'reverse', 'pitchDown', 'rollLeft', 'autoOrient', 'lockBehind', 'freeLook', 'lookBehind', 'gravityToggle', 'modTrail', 'modAura', 'modShape', 'modEmote', 'lockOn', 'warp', 'scan', 'interact', 'worldIndex', 'cameraClose', 'cameraMedium', 'cameraFar', 'cameraCinematic', 'brake', 'escape']

/** What a cap shows for an action: its current key (follows the player's remaps), or a dash if unbound. */
function useKeyText(action: string): string {
  const code = useKeybindingStore((s) => s.bindings[action] ?? null)
  const layout = useKeybindingStore((s) => s.layout)
  if (action === 'escape') return 'ESC' // fixed, never remapped
  if (!code) return '–'
  return code === 'Space' ? 'SPACE' : keyCapLabel(code, layout)
}

/**
 * A single key cap that lights up when its action is active. It shows the
 * key the action is bound to right now, so the HUD stays truthful after a remap.
 */
const KeyCap = memo(function KeyCap({ action, pressed, wide }: { action: ActionKey; pressed: boolean; wide?: boolean }) {
  const text = useKeyText(action)
  const def = DEF_BY_ID.get(action)
  return (
    <div
      className={`hud-keycap${pressed ? ' hud-keycap--active' : ''}${wide ? ' hud-keycap--wide' : ''}`}
      title={def?.label ?? (action === 'escape' ? 'Exit' : action)}
    >
      {text}
    </div>
  )
})

/** Inline <kbd> hint that follows the binding. */
function Kbd({ action }: { action: string }) {
  return <kbd>{useKeyText(action)}</kbd>
}

/** 12.3 nearby; 1,204 across the universe (World Index locks). */
function formatDistance(d: number): string {
  return d < 1000 ? d.toFixed(1) : Math.round(d).toLocaleString()
}

/**
 * HUD overlay — displays flight telemetry, warp status, mod slots,
 * and a live keyboard layout with active-key highlighting.
 */
export function HUD() {
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
  const showFps = useHudPrefsStore((s) => s.showFps)
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set())
  const framesRef = useRef(0)
  const lastTimeRef = useRef(performance.now())
  const prevKeysRef = useRef<string>('')
  // Warp lock changes don't touch any store (e.g. a World Index lock while stationary): poll them too.
  const [, setWarpKey] = useState('')
  const prevWarpRef = useRef('')

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
      for (const action of HUD_ACTIONS) {
        if (actions[action]) {
          active.add(action)
        }
      }

      // Only trigger React re-render when pressed keys actually change
      const serialized = Array.from(active).sort().join(',')
      if (serialized !== prevKeysRef.current) {
        prevKeysRef.current = serialized
        setPressedKeys(active)
      }

      const w = warpSystem.getState()
      const warpKey = `${w.phase}:${w.lockedTarget?.id ?? ''}:${Math.round(w.chargeProgress * 50)}`
      if (warpKey !== prevWarpRef.current) {
        prevWarpRef.current = warpKey
        setWarpKey(warpKey)
      }

      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  const isPressed = useCallback((key: string) => pressedKeys.has(key), [pressedKeys])

  return (
    <div className="hud-overlay">
      <KeybindingsPanel />
      {/* Top left — Brand + player ("Save your player") */}
      <div className="hud-top-left">
        <div className="hud-brand">aweborn</div>
        <PlayerAccount />
        <WorldIndexChip />
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
        <div className={`hud-fps${showFps ? ' hud-fps--pinned' : ''}`}>{fps} FPS</div>
        <div className="hud-tools">
          <KeybindingsButton />
          <DisplaySettings />
        </div>
      </div>

      {/* Top center — Lock-on target. Tap / click = next target in range (like J). */}
      {isLocked && warp.lockedTarget && (
        <div className="hud-top-center">
          <button
            id="hud-target-chip"
            type="button"
            className="hud-target-info"
            onClick={(e) => {
              warpSystem.cycleTarget()
              if (e.detail > 0) e.currentTarget.blur() // hand the keys back to flight
            }}
            aria-label={`Locked on ${warp.lockedTarget.name}. Switch target`}
          >
            <span className="hud-target-name">
              ◇ {warp.lockedTarget.name}
            </span>
            <span className="hud-target-distance">
              {warp.lockedTargetPosition ? formatDistance(warp.lockedTargetPosition.distanceTo(flightController.position)) : '?'} u
            </span>
            {warp.candidates.length > 1 && <span className="hud-target-switch">tap to switch</span>}
          </button>
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
                style={{ width: `${Math.min(speed / (flightController.isGravityEnabled() ? 25 : 60) * 100, 100)}%` }}
              />
            </div>
            <div className="hud-speed-value">
              {speed.toFixed(1)} <span className="hud-speed-unit">u/s</span>
            </div>
          </div>

          {/* Gravity mode indicator */}
          <div className={`hud-gravity-mode ${flightController.isGravityEnabled() ? 'hud-gravity-mode--neutral' : 'hud-gravity-mode--drive'}`}>
            <Kbd action="gravityToggle" /> {flightController.isGravityEnabled() ? '◉ NEUTRAL' : '⬡ DRIVE'}
          </div>

          {/* Mod slot indicators */}
          <div className="hud-mod-slots">
            <div className={`hud-mod-slot${isPressed('modTrail') ? ' hud-mod-slot--active' : ''}`} title="Trail">
              <Kbd action="modTrail" /> {TRAIL_LABELS[mods.trail] ?? mods.trail}
            </div>
            <div className={`hud-mod-slot${isPressed('modAura') ? ' hud-mod-slot--active' : ''}`} title="Aura">
              <Kbd action="modAura" /> {AURA_LABELS[mods.aura] ?? mods.aura}
            </div>
            <div className={`hud-mod-slot${isPressed('modShape') ? ' hud-mod-slot--active' : ''}`} title="Shape">
              <Kbd action="modShape" /> {SHAPE_LABELS[mods.shape] ?? mods.shape}
            </div>
          </div>
        </div>
      )}

      {/* Bottom — Live keyboard layout */}
      {!isInWorld && (
        <div className="hud-keyboard">
          {/* Left cluster — Navigation */}
          <div className="hud-keyboard-cluster hud-keyboard-left">
            <div className="hud-cluster-label">Navigation</div>
            {/* Number row (camera) */}
            <div className="hud-key-row">
              <KeyCap action="cameraClose" pressed={isPressed('cameraClose')} />
              <KeyCap action="cameraMedium" pressed={isPressed('cameraMedium')} />
              <KeyCap action="cameraFar" pressed={isPressed('cameraFar')} />
              <KeyCap action="cameraCinematic" pressed={isPressed('cameraCinematic')} />
            </div>
            {/* QWER row */}
            <div className="hud-key-row">
              <KeyCap action="yawLeft" pressed={isPressed('yawLeft')} />
              <KeyCap action="thrust" pressed={isPressed('thrust')} />
              <KeyCap action="pitchUp" pressed={isPressed('pitchUp')} />
              <KeyCap action="yawRight" pressed={isPressed('yawRight')} />
              <KeyCap action="autoOrient" pressed={isPressed('autoOrient')} />
            </div>
            {/* ASDF row */}
            <div className="hud-key-row hud-key-row--offset-1">
              <KeyCap action="rollRight" pressed={isPressed('rollRight')} />
              <KeyCap action="reverse" pressed={isPressed('reverse')} />
              <KeyCap action="pitchDown" pressed={isPressed('pitchDown')} />
              <KeyCap action="rollLeft" pressed={isPressed('rollLeft')} />
            </div>
            {/* ZXC row */}
            <div className="hud-key-row hud-key-row--offset-2">
              <KeyCap action="lockBehind" pressed={isPressed('lockBehind')} />
              <KeyCap action="freeLook" pressed={isPressed('freeLook')} />
              <KeyCap action="lookBehind" pressed={isPressed('lookBehind')} />
              <KeyCap action="gravityToggle" pressed={isPressed('gravityToggle')} />
            </div>
            {/* Space */}
            <div className="hud-key-row hud-key-row--space">
              <KeyCap action="brake" pressed={isPressed('brake')} wide />
            </div>
          </div>

          {/* Right cluster — Interaction + Mods */}
          <div className="hud-keyboard-cluster hud-keyboard-right">
            <div className="hud-cluster-label">Interact / Mods</div>
            {/* UIOP row (mods) */}
            <div className="hud-key-row">
              <KeyCap action="modTrail" pressed={isPressed('modTrail')} />
              <KeyCap action="modAura" pressed={isPressed('modAura')} />
              <KeyCap action="modShape" pressed={isPressed('modShape')} />
              <KeyCap action="modEmote" pressed={isPressed('modEmote')} />
            </div>
            {/* JKL row */}
            <div className="hud-key-row hud-key-row--offset-1">
              <KeyCap action="lockOn" pressed={isPressed('lockOn')} />
              <KeyCap action="warp" pressed={isPressed('warp')} />
              <KeyCap action="scan" pressed={isPressed('scan')} />
            </div>
            {/* N row */}
            <div className="hud-key-row hud-key-row--offset-2">
              <KeyCap action="interact" pressed={isPressed('interact')} />
              <KeyCap action="worldIndex" pressed={isPressed('worldIndex')} />
            </div>
          </div>
        </div>
      )}

      {/* World interior — minimal ESC keycap */}
      {isInWorld && (
        <div className="hud-keyboard hud-keyboard--world">
          <div className="hud-keyboard-cluster">
            <div className="hud-key-row">
              <KeyCap action="escape" pressed={isPressed('escape')} />
              <span className="hud-key-label">Exit World</span>
            </div>
          </div>
        </div>
      )}

      {/* Center — Crosshair (subtle) + Warp charge ring */}
      {!isInWorld && (
        <div
          className="hud-crosshair"
          style={
            (isLocked || isWarping) && warp.targetScreenPos
              ? {
                  left: `${warp.targetScreenPos.x}%`,
                  top: `${warp.targetScreenPos.y}%`,
                }
              : undefined
          }
        >
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
