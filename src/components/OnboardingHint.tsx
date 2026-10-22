/**
 * 3-step onboarding hint for first-time players (Card Event Step 5).
 *
 * Focuses on the on-screen flight & world-entry controls:
 *   1. Steer (left stick / Q E W S)
 *   2. Fly (THRUST button / W)
 *   3. Enter a world (tap world to lock + ENTER / T + N)
 *
 * Advances automatically as the player performs each action, or via Next / ×.
 */
import { useEffect, useState } from 'react'
import { inputManager } from '../systems/InputManager'
import { flightController } from '../systems/FlightController'
import { useUniverseStore } from '../stores/universeStore'
import { useTeleportStore } from '../systems/TeleportSystem'
import { useSheetStore } from '../stores/sheetStore'
import { useWorldIndexStore } from '../stores/worldIndexStore'
import { useChatStore } from '../stores/chatStore'

const STORAGE_KEY = 'aweborn.onboarding.v1'

function isDone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'done'
  } catch {
    return false
  }
}

function markDone(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'done')
  } catch {
    /* private mode */
  }
}

interface StepCopy {
  title: string
  touchBody: string
  desktopBody: string
}

const STEPS: readonly StepCopy[] = [
  {
    title: 'Steer your star',
    touchBody: 'Drag the left STEER stick to turn and look around space.',
    desktopBody: 'Use Q / E and W / S to steer and look around space.',
  },
  {
    title: 'Fly through space',
    touchBody: 'Hold THRUST on the right to fly toward a world (slide down to brake).',
    desktopBody: 'Hold W to thrust toward a world (Space to brake).',
  },
  {
    title: 'Step inside a world',
    touchBody: 'Tap any world to lock on, then fly close and tap ENTER.',
    desktopBody: 'Press T to lock onto a world, then fly close and press N to enter.',
  },
]

export function OnboardingHint() {
  const [done, setDone] = useState<boolean>(() => isDone())
  const [step, setStep] = useState<number>(0)
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const teleportNotice = useTeleportStore((s) => s.notice)
  const sheet = useSheetStore((s) => s.sheet)
  const indexOpen = useWorldIndexStore((s) => s.open)
  const chatOpen = useChatStore((s) => s.open)
  const openSheet = Boolean(sheet || indexOpen || chatOpen)

  const complete = () => {
    markDone()
    setDone(true)
  }

  // Step 3 completes automatically as soon as the player enters any world
  useEffect(() => {
    if (done) return
    if (activeWorldId && step >= 2) {
      complete()
    }
  }, [activeWorldId, step, done])

  // Poll player control inputs so steps 1 & 2 advance naturally as they play
  useEffect(() => {
    if (done || activeWorldId) return
    let activeMs = 0
    const interval = setInterval(() => {
      const a = inputManager.getActions()
      const yaw = Math.abs(inputManager.getAxis('yaw'))
      const pitch = Math.abs(inputManager.getAxis('pitch'))

      if (step === 0) {
        const steering = yaw > 0.12 || pitch > 0.12 || a.yawLeft || a.yawRight || a.pitchUp || a.pitchDown
        if (steering) {
          activeMs += 100
          if (activeMs >= 350) setStep(1)
        }
      } else if (step === 1) {
        const thrusting = flightController.getState().isThrusting || a.thrust
        if (thrusting) {
          activeMs += 100
          if (activeMs >= 400) setStep(2)
        }
      }
    }, 100)
    return () => clearInterval(interval)
  }, [done, step, activeWorldId])

  if (done || activeWorldId || teleportNotice || openSheet) return null

  const current = STEPS[step] ?? STEPS[0]
  const isTouch = typeof document !== 'undefined' && document.documentElement.classList.contains('touch-ui')
  const isLast = step >= STEPS.length - 1

  return (
    <aside id="onboarding-hint" className="onboarding-hint" aria-live="polite" aria-label="Controls guide">
      <div className="onboarding-hint__top">
        <span className="onboarding-hint__step">
          {step + 1} / {STEPS.length}
        </span>
        <strong className="onboarding-hint__title">{current.title}</strong>
        <button
          type="button"
          className="onboarding-hint__dismiss"
          onClick={complete}
          aria-label="Dismiss controls guide"
          title="Dismiss"
        >
          ×
        </button>
      </div>
      <p className="onboarding-hint__body">{isTouch ? current.touchBody : current.desktopBody}</p>
      <div className="onboarding-hint__actions">
        <div className="onboarding-hint__dots" aria-hidden="true">
          {STEPS.map((_, i) => (
            <span key={i} className={`onboarding-hint__dot${i === step ? ' is-active' : i < step ? ' is-done' : ''}`} />
          ))}
        </div>
        <button
          type="button"
          className="onboarding-hint__next"
          onClick={() => {
            if (isLast) complete()
            else setStep((s) => s + 1)
          }}
        >
          {isLast ? 'Got it' : 'Next →'}
        </button>
      </div>
    </aside>
  )
}
