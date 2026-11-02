import { useCallback, useEffect, useRef } from 'react'
import { useMadeFromTarget, closeMadeFrom } from '../stores/madeFromStore'
import { useWorldStore } from '../stores/worldStore'
import { inputManager } from '../systems/InputManager'
import { SOUND_COLORS, SOUND_LABELS, defaultLoop } from '../lib/soundKinds'
import './LifePanel.css'

/**
 * Made from (Alex, 2026-11-02 playtest): pick up a sound orb, tap ✦, and see the
 * words it was made from. Read-only on purpose: what a sound was manifested with
 * stays as it was (the server reverts edits to it, shared/world-policy.ts
 * FIXED_MEDIA_KEYS). A different sound is a new creation (✦ Create) or another
 * one from the Library's Sounds shelf.
 */

export function MadeFromPanel() {
  const id = useMadeFromTarget((s) => s.id)
  if (!id) return null
  return <MadeFromDialog key={id} id={id} />
}

function MadeFromDialog({ id }: { id: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  const obj = useWorldStore((s) => s.objects.get(id))
  const wasEnabled = useRef(true)

  useEffect(() => {
    const d = ref.current
    if (!d || d.open) return
    wasEnabled.current = inputManager.isEnabled()
    d.showModal()
    inputManager.setEnabled(false)
  }, [])
  const onClosed = useCallback(() => {
    if (wasEnabled.current) inputManager.setEnabled(true)
    closeMadeFrom()
  }, [])
  // Deleted (or no longer a sound) while the sheet was open
  useEffect(() => {
    if (!obj || obj.type !== 'sound') ref.current?.close()
  }, [obj])

  const kind = obj?.media ?? 'sound'
  const loop = obj?.loop ?? defaultLoop(kind)
  const prompt = obj?.prompt?.trim()

  return (
    <dialog ref={ref} id="made-from-panel" className="life-panel" aria-labelledby="made-from-title" onClose={onClosed}>
      <div className="life-shell">
        <header className="life-head">
          <span className="made-from-orb" style={{ background: SOUND_COLORS[kind] }} aria-hidden="true">∿</span>
          <div className="life-head-text">
            <h2 id="made-from-title" className="life-title">Made from</h2>
            <p className="life-sub">
              {SOUND_LABELS[kind]} · {loop ? 'loops while you’re near' : 'plays once as you walk up'}
            </p>
          </div>
          <button type="button" className="life-close" aria-label="Close" onClick={() => ref.current?.close()}>✕</button>
        </header>

        <section className="life-section" aria-labelledby="made-from-words-h">
          <h3 id="made-from-words-h" className="life-h">Its words</h3>
          {prompt ? (
            <blockquote id="made-from-prompt" className="made-from-prompt">{prompt}</blockquote>
          ) : (
            <p className="life-note">No words were kept with this one.</p>
          )}
          <p className="life-note">
            What a sound was made from stays as it was. For a different one, make a new sound in <b>✦ Create</b>, or hold one from the Library’s <b>Sounds</b> shelf.
          </p>
        </section>
      </div>
    </dialog>
  )
}
