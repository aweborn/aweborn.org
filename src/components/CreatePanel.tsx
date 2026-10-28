import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useUniverseStore } from '../stores/universeStore'
import { placeMedia, placeModel, setWorldSound, useWorldStore } from '../stores/worldStore'
import { placeOnTerrain } from '../stores/worldVoxels'
import { interiorController } from '../systems/InteriorController'
import { AUTH_URL, getPlayerSnapshot, subscribePlayer } from '../lib/player'
import { usePresence } from '../hooks/usePresence'
import { matchesBinding } from '../stores/keybindingStore'
import { ManaSeal, useCanChannel } from './ManaSeal'
import { useSheet } from '../stores/sheetStore'
import { MakeTabs } from './MakeTabs'
import { audio } from '../audio/engine'
import { refreshProgress } from '../stores/progressStore'
import { makeEstimate, MUSIC_SECONDS, VOICE_MAX_CHARS, type MakeKind } from '@aweborn/shared/make-costs'

/**
 * Create panel (Phase 07, first gen-AI slice; Rough Draft M5 adds media):
 * inside a world, pick what to make, describe it, and it's made and placed in
 * front of you.
 *
 *   Object   Meshy text-to-3D → a model
 *   Picture  an image → a framed picture on a stand
 *   Sound    a sound effect / ambience → an orb that sounds in 3D (loops while you're near)
 *   Music    a short piece → an orb that plays it; or make it the world's own sound
 *   Voice    words spoken aloud → an orb that says them as you walk up
 *   Lore     a few lines of in-world story → a sign
 *
 * Press C or tap ✦ Create. Mana is reserved at admission and settled on
 * completion by sync-service (the real cost; the rest goes back); a failed
 * making draws nothing.
 */

interface Making {
  jobId: string
  kind: Exclude<MakeKind, 'lore'>
  prompt: string
  loop: boolean
  progress: number
  status: 'queued' | 'processing' | 'complete' | 'failed'
  message?: string
  /** Sounds/music, once made: offered as the world's own sound. */
  asset?: string
}

const KINDS: { kind: MakeKind; label: string; icon: string; placeholder: string }[] = [
  { kind: 'model', label: 'Object', icon: '◆', placeholder: 'What do you want to make? (a mossy stone lantern…)' },
  { kind: 'image', label: 'Picture', icon: '▣', placeholder: 'Paint a picture of… (a lighthouse on a floating island)' },
  { kind: 'sound', label: 'Sound', icon: '∿', placeholder: 'What does it sound like? (waves on pebbles, a crackling fire)' },
  { kind: 'music', label: 'Music', icon: '♪', placeholder: 'What kind of music? (a slow harp lullaby under the stars)' },
  { kind: 'voice', label: 'Voice', icon: '❝', placeholder: 'What should it say? (Welcome, traveller, to the Humming Well.)' },
  { kind: 'lore', label: 'Lore', icon: '✎', placeholder: 'Lore about… (the old stone well that hums at night)' },
]
const SOUND_LENGTHS = [3, 8, 20] as const
const MUSIC_LENGTHS = [15, 30, 60] as const
const KIND_WORD: Record<Making['kind'], string> = { model: 'object', image: 'picture', sound: 'sound', music: 'music', voice: 'voice' }

const POLL_MS = 2000

/**
 * Just ahead of the player, on the ground, turned to face them: `dist` ahead of the
 * character and `side` to its right (negative = left). Small things go off to a side:
 * the camera looks past the avatar, so straight ahead at waist height is exactly where
 * the avatar hides them.
 */
function spotAhead(dist = 3.5, side = 0) {
  const s = interiorController.state
  const x = s.x + s.fx * dist - s.fz * side
  const z = s.z + s.fz * dist + s.fx * side
  let y = Math.max(0, s.y)
  const t = useWorldStore.getState().voxelTerrain
  if (t) y = placeOnTerrain(t, [x + t.size[0] / 2, 0, z + t.size[2] / 2]).y
  return { pos: { x, y, z }, rotY: Math.atan2(s.x - x, s.z - z) }
}

export function CreatePanel() {
  const activeWorldId = useUniverseStore((s) => s.activeWorldId)
  const meta = useWorldStore((s) => s.meta)
  const { playerId } = usePresence()
  const player = useSyncExternalStore(subscribePlayer, getPlayerSnapshot, getPlayerSnapshot)
  const { canChannel } = useCanChannel()
  const [open, setOpen] = useSheet('create')
  const [kind, setKind] = useState<MakeKind>('model')
  const [prompt, setPrompt] = useState('')
  const [soundSeconds, setSoundSeconds] = useState<number>(8)
  const [musicSeconds, setMusicSeconds] = useState<number>(MUSIC_SECONDS.default)
  const [loop, setLoop] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [makings, setMakings] = useState<Making[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const myChars = player?.characters ?? (player?.playerId ? [player.playerId] : [])
  const canSetWorldSound = !!meta && (myChars.includes(meta.creator) || (meta.coCreators ?? []).some((c) => myChars.includes(c)))
  const info = KINDS.find((k) => k.kind === kind)!
  const hold = makeEstimate(kind, {
    seconds: kind === 'sound' ? soundSeconds : kind === 'music' ? musicSeconds : undefined,
    chars: prompt.trim().length || undefined,
  })

  // C toggles the panel inside a world (not while typing)
  useEffect(() => {
    if (!activeWorldId) {
      setOpen(false)
      return
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (matchesBinding(e, 'createPanel')) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeWorldId, setOpen])

  useEffect(() => {
    if (open && canChannel) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open, canChannel])

  // Bumped after every poll round (even failed ones) so the loop always re-arms
  const [pollTick, setPollTick] = useState(0)

  // Poll open makings; place each one when it completes
  useEffect(() => {
    const pending = makings.filter((m) => m.status === 'queued' || m.status === 'processing')
    if (!pending.length) return
    const t = setTimeout(async () => {
      for (const m of pending) {
        try {
          const res = await fetch(`${AUTH_URL}/api/player/create/${m.jobId}`, { credentials: 'include' })
          if (!res.ok) continue
          const j = (await res.json()) as { status: Making['status']; progress: number; asset?: string; error?: string }
          let asset: string | undefined
          if (j.status === 'complete' && j.asset) {
            const doc = useUniverseStore.getState().activeWorldDoc
            if (doc) {
              if (m.kind === 'model') {
                const s = interiorController.state
                placeModel(doc, j.asset, m.prompt, { x: s.x + s.fx * 2.5, y: 0.5, z: s.z + s.fz * 2.5 }, playerId)
              } else {
                const { pos, rotY } = spotAhead(3.5, m.kind === 'image' ? 0 : 1.6)
                if (m.kind === 'image') placeMedia(doc, { type: 'picture', asset: j.asset, prompt: m.prompt }, pos, playerId, rotY)
                else placeMedia(doc, { type: 'sound', asset: j.asset, prompt: m.prompt, media: m.kind, loop: m.loop }, pos, playerId, rotY)
              }
            }
            if (m.kind === 'sound' || m.kind === 'music') asset = j.asset
            audio.creationDone()
            void refreshProgress()
          }
          setMakings((all) =>
            all.map((x) => (x.jobId === m.jobId ? { ...x, status: j.status, progress: j.progress, message: j.error, asset: asset ?? x.asset } : x)),
          )
        } catch {
          /* keep polling */
        }
      }
      setPollTick((n) => n + 1)
    }, POLL_MS)
    return () => clearTimeout(t)
  }, [makings, playerId, pollTick])

  // Drop finished makings after a moment (a sound offered as the world's sound stays a little longer)
  useEffect(() => {
    if (!makings.some((m) => m.status === 'complete' || m.status === 'failed')) return
    const offering = makings.some((m) => m.status === 'complete' && m.asset && canSetWorldSound)
    const t = setTimeout(() => setMakings((all) => all.filter((m) => m.status !== 'complete')), offering ? 15000 : 4000)
    return () => clearTimeout(t)
  }, [makings, canSetWorldSound])

  const fail = (j: { message?: string; suggestion?: string }, status: number) => {
    setError(j.message ?? (status === 401 ? 'Save your player first to make things.' : 'Something went wrong.'))
    if (j.suggestion) setSuggestion(j.suggestion)
  }

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const text = prompt.trim()
      if (!text || busy) return
      setBusy(true)
      setError(null)
      setSuggestion(null)
      try {
        if (kind === 'lore') {
          // Lore is quick: write it, then plant the sign right away
          audio.creationStart()
          const res = await fetch(`${AUTH_URL}/api/player/lore`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: text, subject: meta?.name }),
          })
          const j = (await res.json().catch(() => ({}))) as { text?: string; message?: string; suggestion?: string }
          if (!res.ok || !j.text) return fail(j, res.status)
          const doc = useUniverseStore.getState().activeWorldDoc
          if (doc) {
            const { pos, rotY } = spotAhead(3.5, -1.6)
            placeMedia(doc, { type: 'sign', text: j.text, prompt: text }, pos, playerId, rotY)
          }
          audio.creationDone()
          void refreshProgress()
          setPrompt('')
          setOpen(false)
          return
        }
        const body: Record<string, unknown> = { prompt: text, kind }
        if (kind === 'sound') Object.assign(body, { seconds: soundSeconds, loop })
        if (kind === 'music') body.seconds = musicSeconds
        const res = await fetch(`${AUTH_URL}/api/player/create`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const j = (await res.json().catch(() => ({}))) as { jobId?: string; message?: string; error?: string; suggestion?: string }
        if (!res.ok || !j.jobId) return fail(j, res.status)
        const k = kind as Making['kind']
        setMakings((all) => [
          ...all,
          { jobId: j.jobId!, kind: k, prompt: text, loop: k === 'music' ? true : k === 'voice' ? false : loop, progress: 0, status: 'queued' },
        ])
        audio.creationStart()
        setPrompt('')
        setOpen(false)
      } catch {
        setError('Creation is resting right now. Try again soon.')
      } finally {
        setBusy(false)
      }
    },
    [prompt, busy, kind, soundSeconds, musicSeconds, loop, meta?.name, playerId, setOpen],
  )

  const makeWorldSound = (m: Making) => {
    const doc = useUniverseStore.getState().activeWorldDoc
    if (!doc || !m.asset) return
    setWorldSound(doc, m.asset)
    setMakings((all) => all.filter((x) => x.jobId !== m.jobId))
  }

  if (!activeWorldId) return null

  return (
    <div className="create-panel">
      {makings.length > 0 && (
        <ul className="create-makings" aria-live="polite">
          {makings.map((m) => (
            <li key={m.jobId} className={`create-making create-making--${m.status}`}>
              <span className="create-making-kind">{KIND_WORD[m.kind]}</span>
              <span className="create-making-prompt">{m.prompt}</span>
              <span className="create-making-state">
                {m.status === 'failed' ? m.message ?? 'failed' : m.status === 'complete' ? 'made ✦' : `${m.progress}%`}
              </span>
              {m.status === 'complete' && m.asset && canSetWorldSound && (
                <button type="button" id={`make-world-sound-${m.jobId}`} className="create-making-action" onClick={() => makeWorldSound(m)}>
                  Make it this world’s sound
                </button>
              )}
              {m.status !== 'failed' && m.status !== 'complete' && (
                <span className="create-making-bar" style={{ width: `${Math.max(4, m.progress)}%` }} />
              )}
            </li>
          ))}
        </ul>
      )}

      {open && canChannel && <MakeTabs current="create" />}
      {open && !canChannel ? (
        <ManaSeal kind="create" onClose={() => setOpen(false)} />
      ) : open ? (
        <form className="create-form create-form--kinds" onSubmit={submit}>
          <fieldset className="make-kinds">
            <legend className="visually-hidden">What to make</legend>
            {KINDS.map((k) => (
              <label key={k.kind} className="make-kind">
                <input
                  type="radio"
                  name="make-kind"
                  id={`make-kind-${k.kind}`}
                  value={k.kind}
                  checked={kind === k.kind}
                  onChange={() => {
                    setKind(k.kind)
                    setError(null)
                    setSuggestion(null)
                    inputRef.current?.focus()
                  }}
                />
                <span aria-hidden="true" className="make-kind-icon">{k.icon}</span>
                {k.label}
              </label>
            ))}
          </fieldset>
          <input
            id="create-prompt"
            ref={inputRef}
            className="create-input"
            value={prompt}
            maxLength={kind === 'voice' ? VOICE_MAX_CHARS : kind === 'lore' ? 400 : 600}
            placeholder={info.placeholder}
            aria-label={info.placeholder}
            enterKeyHint="go"
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setOpen(false)
              }
            }}
          />
          <button id="create-submit" className="create-submit" type="submit" disabled={busy || !prompt.trim()}>
            {busy ? '…' : kind === 'lore' ? 'Write' : 'Make'}
          </button>
          {(kind === 'sound' || kind === 'music') && (
            <div className="make-options">
              <fieldset className="make-lengths">
                <legend>Length</legend>
                {(kind === 'sound' ? SOUND_LENGTHS : MUSIC_LENGTHS).map((sec) => (
                  <label key={sec} className="make-length">
                    <input
                      type="radio"
                      name="make-length"
                      id={`make-length-${sec}`}
                      checked={(kind === 'sound' ? soundSeconds : musicSeconds) === sec}
                      onChange={() => (kind === 'sound' ? setSoundSeconds(sec) : setMusicSeconds(sec))}
                    />
                    {sec} s
                  </label>
                ))}
              </fieldset>
              {kind === 'sound' && (
                <label className="make-loop">
                  <input
                    id="make-loop"
                    type="checkbox"
                    role="switch"
                    {...({ switch: '' } as Record<string, string>)}
                    checked={loop}
                    onChange={(e) => setLoop(e.target.checked)}
                  />
                  Loop while near
                </label>
              )}
            </div>
          )}
          <p className="make-hold" id="make-hold">
            Holds up to {hold} mana · you’re only charged what it really costs
          </p>
          {error && <p className="create-error">{error}</p>}
          {suggestion && (
            <button
              id="create-use-suggestion"
              type="button"
              className="create-suggestion"
              onClick={() => {
                setPrompt(suggestion)
                setSuggestion(null)
                setError(null)
                inputRef.current?.focus()
              }}
            >
              Use this idea →
            </button>
          )}
        </form>
      ) : (
        <button
          id="create-open"
          className={`create-open${canChannel ? '' : ' is-sealed'}`}
          type="button"
          onClick={() => setOpen(true)}
        >
          ✦ Create <kbd>C</kbd>
        </button>
      )}
    </div>
  )
}
