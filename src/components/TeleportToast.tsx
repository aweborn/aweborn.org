import { useEffect, type CSSProperties } from 'react'
import { useTeleportStore } from '../systems/TeleportSystem'

/** How long an arrival / error notice stays up (ms). */
const NOTICE_MS = { arrived: 6000, error: 8000 } as const

/**
 * Teleport notice: "arrived at <world>" or a friendly error for bad links.
 * Rendered after loading finishes, so the timer starts when it's visible.
 */
export function TeleportToast() {
  const notice = useTeleportStore((s) => s.notice)
  const seq = useTeleportStore((s) => s.noticeSeq)
  const pending = useTeleportStore((s) => s.pending)
  const dismiss = useTeleportStore((s) => s.dismiss)

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(dismiss, NOTICE_MS[notice.kind])
    return () => clearTimeout(t)
  }, [notice, seq, dismiss])

  if (!notice && !pending) return null

  if (!notice) {
    return (
      <div className="teleport-toast teleport-toast--pending" role="status" aria-live="polite">
        <span className="teleport-toast__spinner" aria-hidden="true" />
        <span className="teleport-toast__detail">Teleporting…</span>
      </div>
    )
  }

  return (
    <div
      key={seq}
      id="teleport-toast"
      className={`teleport-toast teleport-toast--${notice.kind}`}
      role={notice.kind === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      style={notice.color ? ({ '--teleport-color': notice.color } as CSSProperties) : undefined}
    >
      <span className="teleport-toast__orb" aria-hidden="true" />
      <span className="teleport-toast__text">
        <span className="teleport-toast__title">{notice.title}</span>
        <span className="teleport-toast__detail">{notice.detail}</span>
      </span>
      <button
        id="teleport-toast-dismiss"
        className="teleport-toast__close"
        onClick={dismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
