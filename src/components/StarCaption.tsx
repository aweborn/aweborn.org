import { useEffect, useState } from 'react'
import { useSkyStore } from '../stores/skyStore'

const SHOW_MS = 4200

/**
 * The words for a shooting star (Rough Draft M4): what left the pool, how
 * much, and its Form 990 line. Appears where you tapped (or hovered) a star,
 * or near the top for rare stars (a creation, a shortfall). Fades by itself.
 */
export function StarCaption() {
  const caption = useSkyStore((s) => s.caption)
  const clear = useSkyStore((s) => s.clearCaption)
  const [vw, setVw] = useState(() => window.innerWidth)

  useEffect(() => {
    if (!caption) return
    const t = setTimeout(clear, SHOW_MS)
    return () => clearTimeout(t)
  }, [caption, clear])

  useEffect(() => {
    const onResize = () => setVw(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (!caption) return null
  const width = Math.min(300, vw - 24)
  const left = Math.max(12, Math.min(vw - width - 12, caption.x - width / 2))
  const top = Math.max(76, caption.y - 96)
  return (
    <div
      key={caption.at}
      id="star-caption"
      className="star-caption"
      role="status"
      aria-live="polite"
      style={{ left, top, width, ['--star-color' as string]: caption.color }}
    >
      <span className="star-caption-dot" aria-hidden="true" />
      <div className="star-caption-body">
        <div className="star-caption-title">{caption.title}</div>
        <div className="star-caption-detail">{caption.detail}</div>
      </div>
    </div>
  )
}
