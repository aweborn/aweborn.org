import { useCallback, useEffect, useRef, useState } from 'react'
import { useLifeTarget, closeLife } from '../stores/lifeStore'
import { cleanLife, creationTitle, GAITS, VOICES, VOICE_IDS, ANIMATE_ESTIMATE, LIFE_LIMITS, type Gait, type ObjectLife, type VoiceId } from '@aweborn/shared/life'
import { useWorldStore, setObjectLife, restoreStillAsset } from '../stores/worldStore'
import { useUniverseStore } from '../stores/universeStore'
import { AUTH_URL } from '../lib/player'
import { inputManager } from '../systems/InputManager'
import { audio } from '../audio/engine'
import { refreshProgress } from '../stores/progressStore'
import { libraryThumb } from '../lib/libraryThumbs'
import './LifePanel.css'

/**
 * Bring it to life (Phase 07 Life & minds): one sheet per placed creation.
 *
 *   Body   Still · Alive (free: breathes, turns to you, roams) · Animated (a skeleton
 *          and clips from Meshy, ≈ 22 credits, humanoid/biped shapes only)
 *   Mind   describe who it is → a persona, a voice, a greeting; it answers players
 *          who talk near it in world chat.
 *
 * Opened from the carried-object bar (✦). Changes to the body are free CRDT writes
 * (anyone who may edit the object); animating and minds go through the server.
 */


const MIND_HOLD = 6
const POLL_MS = 2500

async function post(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${AUTH_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: res.ok, status: res.status, json: ((await res.json().catch(() => ({}))) as Record<string, unknown>) }
}

const errorText = (status: number, j: Record<string, unknown>) =>
  typeof j.message === 'string' ? j.message : status === 401 || status === 403 ? 'Save your player first to bring things to life.' : 'Something went wrong. Try again soon.'

export function LifePanel() {
  const id = useLifeTarget((s) => s.id)
  if (!id) return null
  return <LifeDialog key={id} id={id} />
}

function LifeDialog({ id }: { id: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const obj = useWorldStore((s) => s.objects.get(id))
  const worldId = useUniverseStore((s) => s.activeWorldId)
  const wasEnabled = useRef(true)
  const life = cleanLife(obj?.life) ?? { mode: 'still' as const, pace: 1, roam: 0 }
  const [pace, setPace] = useState(life.pace)
  const [roam, setRoam] = useState(life.roam)
  const [gait, setGait] = useState<Gait>(life.gait ?? (Math.abs(obj?.scaleY ?? 1) >= 3 ? 'heavy' : 'calm'))
  const [rig, setRig] = useState<{ jobId: string; progress: number } | null>(null)
  const [words, setWords] = useState('')
  const [voice, setVoice] = useState<VoiceId | ''>('')
  const [spoken, setSpoken] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  /** The body check said it isn't two-legged: offer four legs / Alive, or "Animate anyway". */
  const [notBiped, setNotBiped] = useState<null | 'quadruped' | 'other'>(null)
  const [thumb, setThumb] = useState<string | null>(null)

  // A picture of what's being changed (drawn on this device once, shared with the server)
  const stillFile = obj?.stillAsset ?? obj?.asset
  useEffect(() => {
    if (!stillFile || !/^[a-f0-9]{64}\.glb$/.test(stillFile)) return
    let alive = true
    void libraryThumb(stillFile.slice(0, 64), stillFile).then((u) => alive && setThumb(u))
    return () => {
      alive = false
    }
  }, [stillFile])

  useEffect(() => {
    const d = ref.current
    if (!d || d.open) return
    wasEnabled.current = inputManager.isEnabled()
    d.showModal()
    inputManager.setEnabled(false)
  }, [])
  const onClosed = useCallback(() => {
    if (wasEnabled.current) inputManager.setEnabled(true)
    closeLife()
  }, [])
  // The creation was deleted while the sheet was open
  useEffect(() => {
    if (!obj) ref.current?.close()
  }, [obj])

  const write = useCallback(
    (next: ObjectLife | null) => {
      const doc = useUniverseStore.getState().activeWorldDoc
      if (doc) setObjectLife(doc, id, next)
    },
    [id],
  )

  // Sliders write after a short pause (one CRDT write per settle, not per pixel)
  useEffect(() => {
    if (life.mode === 'still' || (pace === life.pace && roam === life.roam)) return
    const t = setTimeout(() => write({ ...life, pace, roam }), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the sliders move
  }, [pace, roam])

  const setMode = (mode: 'still' | 'alive') => {
    setError(null)
    if (mode === 'still') write(life.mode === 'animated' ? { ...life, roam: 0 } : null)
    else write({ mode: life.mode === 'animated' ? 'animated' : 'alive', pace, roam, ...(life.gait ? { gait: life.gait } : {}) })
  }

  // Poll a running rig job (the server applies the result itself; this is the progress bar)
  useEffect(() => {
    if (!rig) return
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${AUTH_URL}/api/player/create/${rig.jobId}`, { credentials: 'include' })
        if (!res.ok) return setRig({ ...rig })
        const j = (await res.json()) as { status: string; progress: number; error?: string }
        if (j.status === 'complete') {
          setRig(null)
          audio.creationDone()
          void refreshProgress()
        } else if (j.status === 'failed') {
          setRig(null)
          setError(j.error ?? 'The rig didn’t take. Nothing was drawn.')
        } else setRig({ jobId: rig.jobId, progress: j.progress })
      } catch {
        setRig({ ...rig })
      }
    }, POLL_MS)
    return () => clearTimeout(t)
  }, [rig])

  const animate = async (force = false) => {
    if (busy || !worldId) return
    setBusy(true)
    setError(null)
    setNotBiped(null)
    try {
      const r = await post('/api/player/animate', {
        worldId, objectId: id, gait, heightM: Math.abs(obj?.scaleY ?? 1.8),
        ...(force ? { force: true } : {}),
        ...(thumb?.startsWith('data:image/png') && thumb.length < 400_000 ? { thumb } : {}),
      })
      if (r.status === 422 && r.json.error === 'not_biped') {
        setNotBiped(r.json.body === 'quadruped' ? 'quadruped' : 'other')
        return setError(errorText(r.status, r.json))
      }
      if (!r.ok || typeof r.json.jobId !== 'string') return setError(errorText(r.status, r.json))
      audio.creationStart()
      setRig({ jobId: r.json.jobId, progress: 0 })
    } catch {
      setError('Creation is resting right now. Try again soon.')
    } finally {
      setBusy(false)
    }
  }

  const giveMind = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = words.trim()
    if (!text || busy || !worldId) return
    setBusy(true)
    setError(null)
    setSuggestion(null)
    audio.creationStart()
    try {
      const r = await post('/api/player/mind', { worldId, objectId: id, prompt: text, spoken, ...(voice ? { voice } : {}) })
      if (!r.ok) {
        setError(errorText(r.status, r.json))
        if (typeof r.json.suggestion === 'string') setSuggestion(r.json.suggestion)
        return
      }
      audio.creationDone()
      setWords('')
      void refreshProgress()
    } catch {
      setError('Minds are resting right now. Try again soon.')
    } finally {
      setBusy(false)
    }
  }

  const forget = async () => {
    if (busy || !worldId) return
    setBusy(true)
    setError(null)
    try {
      const r = await post('/api/player/mind/forget', { worldId, objectId: id })
      if (!r.ok) setError(errorText(r.status, r.json))
    } finally {
      setBusy(false)
    }
  }

  const title = obj?.mind?.name ?? (creationTitle(obj?.prompt) || 'This creation')
  const animated = life.mode === 'animated'

  return (
    <dialog ref={ref} id="life-panel" className="life-panel" aria-labelledby="life-title" onClose={onClosed}>
      <div className="life-shell">
        <header className="life-head">
          {thumb && <img className="life-thumb" src={thumb} alt="" width={56} height={56} />}
          <div className="life-head-text">
            <h2 id="life-title" className="life-title">Bring it to life</h2>
            <p className="life-sub">{title}</p>
          </div>
          <button type="button" className="life-close" aria-label="Close" onClick={() => ref.current?.close()}>✕</button>
        </header>

        <section className="life-section" aria-labelledby="life-body-h">
          <h3 id="life-body-h" className="life-h">Body</h3>
          <fieldset className="life-modes">
            <legend className="visually-hidden">How it moves</legend>
            <label className="life-mode">
              <input type="radio" name="life-mode" id="life-mode-still" checked={life.mode === 'still'} onChange={() => setMode('still')} />
              <span>Still</span>
            </label>
            <label className="life-mode">
              <input type="radio" name="life-mode" id="life-mode-alive" checked={life.mode !== 'still'} onChange={() => setMode('alive')} />
              <span>{animated ? 'Animated' : 'Alive'}</span>
            </label>
          </fieldset>
          {life.mode === 'alive' && obj?.type === 'model' && (
            <label className="life-switch">
              <input
                id="life-four-legs"
                type="checkbox"
                role="switch"
                {...({ switch: '' } as Record<string, string>)}
                checked={life.legs === 4}
                onChange={(e) => {
                  const { legs: _legs, ...rest } = life
                  write(e.target.checked ? { ...rest, pace, roam, legs: 4 } : { ...rest, pace, roam })
                }}
              />
              Walks on four legs (its legs swing as it roams; free)
            </label>
          )}
          {life.mode !== 'still' && (
            <div className="life-sliders">
              <label className="life-slider">
                <span>Pace <output>{pace < 0.7 ? 'slow' : pace > 1.2 ? 'quick' : 'steady'}</output></span>
                <input id="life-pace" type="range" min={LIFE_LIMITS.pace[0]} max={LIFE_LIMITS.pace[1]} step={0.05} value={pace} onChange={(e) => setPace(Number(e.target.value))} />
              </label>
              <label className="life-slider">
                <span>Roams <output>{roam <= 0 ? 'stays put' : `${roam} m around`}</output></span>
                <input id="life-roam" type="range" min={0} max={LIFE_LIMITS.roam[1]} step={1} value={roam} onChange={(e) => setRoam(Number(e.target.value))} />
              </label>
            </div>
          )}
          {obj?.type === 'model' && !animated && (
            <div className="life-rig">
              <p className="life-note">
                <b>Animate it:</b> give it a skeleton and real movement (walk, idle, talk, a gesture). For creatures with two legs and two arms; takes a couple of minutes. Four-legged animals: switch on <i>Walks on four legs</i> above instead (free).
              </p>
              <fieldset className="life-gaits">
                <legend>Gait</legend>
                {(Object.keys(GAITS) as Gait[]).map((g) => (
                  <label key={g} className="life-gait">
                    <input type="radio" name="life-gait" id={`life-gait-${g}`} checked={gait === g} onChange={() => setGait(g)} />
                    <span>{GAITS[g].label}</span>
                  </label>
                ))}
              </fieldset>
              {rig ? (
                <div className="life-progress" role="status" aria-live="polite">
                  <span>Rigging… {rig.progress}%</span>
                  <span className="life-bar" style={{ width: `${Math.max(4, rig.progress)}%` }} />
                </div>
              ) : (
                <button type="button" id="life-animate" className="life-primary" disabled={busy} onClick={() => animate(false)}>
                  {busy ? 'Looking at it…' : `Animate · holds up to ${ANIMATE_ESTIMATE} mana`}
                </button>
              )}
            </div>
          )}
          {animated && (
            <div className="life-rig">
              <p className="life-note">Animated ({GAITS[life.gait ?? 'calm'].label.toLowerCase()} gait). Moving wrong? Undo it for free: the still model comes back and it can still breathe and roam.</p>
              {obj?.stillAsset && (
                <button
                  type="button"
                  id="life-undo-animate"
                  className="life-secondary"
                  onClick={() => {
                    const doc = useUniverseStore.getState().activeWorldDoc
                    if (doc) restoreStillAsset(doc, id)
                  }}
                >
                  Undo animation
                </button>
              )}
            </div>
          )}
        </section>

        <section className="life-section" aria-labelledby="life-mind-h">
          <h3 id="life-mind-h" className="life-h">Mind</h3>
          {obj?.mind ? (
            <div className="life-mind">
              <p className="life-mind-name">
                <b>{obj.mind.name}</b>
                {obj.mind.epithet && <span>, {obj.mind.epithet}</span>}
              </p>
              {obj.mind.greeting && <p className="life-mind-greeting">“{obj.mind.greeting}”</p>}
              <p className="life-note">
                Players who talk near it (or say its name) get an answer in chat{obj.mind.spoken ? ', spoken aloud' : ''}. Each answer is drawn from the speaker’s mana (about 1).
              </p>
              <button type="button" id="life-forget" className="life-secondary" disabled={busy} onClick={forget}>Forget its mind</button>
            </div>
          ) : (
            <form className="life-mind-form" onSubmit={giveMind}>
              <label className="life-field">
                <span>Who is it? How does it speak?</span>
                <textarea
                  id="life-mind-words"
                  rows={3}
                  maxLength={600}
                  value={words}
                  placeholder="An ancient lava giant who guards the volcano. Slow, groans, speaks rarely, in riddles."
                  onChange={(e) => setWords(e.target.value)}
                />
              </label>
              <div className="life-row">
                <label className="life-field life-field--grow">
                  <span>Voice</span>
                  <select id="life-voice" value={voice} onChange={(e) => setVoice(e.target.value as VoiceId | '')}>
                    <option value="">Let it choose</option>
                    {VOICE_IDS.map((v) => (
                      <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}: {VOICES[v]}</option>
                    ))}
                  </select>
                </label>
                <label className="life-switch">
                  <input id="life-spoken" type="checkbox" role="switch" {...({ switch: '' } as Record<string, string>)} checked={spoken} onChange={(e) => setSpoken(e.target.checked)} />
                  Speaks aloud
                </label>
              </div>
              <button type="submit" id="life-mind-submit" className="life-primary" disabled={busy || !words.trim()}>
                {busy ? '…' : `Give it a mind · holds up to ${MIND_HOLD} mana`}
              </button>
            </form>
          )}
        </section>

        {error && <p className="life-error" role="alert">{error}</p>}
        {notBiped && (
          <div className="life-row">
            {notBiped === 'quadruped' ? (
              <button type="button" id="life-four-legs-offer" className="life-primary" onClick={() => { write({ mode: 'alive', pace, roam: roam || 4, legs: 4 }); if (!roam) setRoam(4); setNotBiped(null); setError(null) }}>
                Walk on four legs (free)
              </button>
            ) : (
              <button type="button" className="life-secondary" onClick={() => { setMode('alive'); setNotBiped(null); setError(null) }}>Make it Alive (free)</button>
            )}
            <button type="button" id="life-animate-anyway" className="life-link" disabled={busy} onClick={() => animate(true)}>Animate anyway</button>
          </div>
        )}
        {suggestion && (
          <button type="button" className="life-link" onClick={() => { setWords(suggestion); setSuggestion(null); setError(null) }}>
            Use this idea →
          </button>
        )}
      </div>
    </dialog>
  )
}

