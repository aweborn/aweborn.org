import { CARD_PHOTO } from '@aweborn/shared/cards'

/**
 * Photo mode, pixels side (Rough Draft M6b; Phase 08 "Card Art").
 *
 * The scene canvas keeps its drawing buffer (Scene.tsx: preserveDrawingBuffer),
 * so a shot is a crop of what's on screen, bloom and all: the 11:9 frame the
 * player composed, scaled to at most 1100 × 900 and saved as JPEG. That is the
 * card's 55 × 45 mm art window, the same shape the server checks.
 */

export interface Shot {
  blob: Blob
  /** Object URL for previews (revoked when the shot is replaced). */
  url: string
  width: number
  height: number
  at: number
  /** The world this shot is of (inside it, or locked on to it), if any. */
  worldId: string | null
  worldName: string | null
  /** Narrower than the print minimum, so it was upscaled (prints soft). */
  soft: boolean
}

export function sceneCanvas(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>('.canvas-container canvas')
}

const toBlob = (c: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/jpeg', quality))

/** Crop the scene to `frame` (CSS px) at the art window's shape. */
export async function captureFrame(frame: DOMRect): Promise<Omit<Shot, 'url' | 'worldId' | 'worldName' | 'at'> | null> {
  const src = sceneCanvas()
  if (!src) return null
  const cr = src.getBoundingClientRect()
  const sx = src.width / cr.width
  const sy = src.height / cr.height
  // Source rect in canvas pixels, clamped to the canvas, forced to exactly 11:9
  let w = Math.min(frame.width * sx, src.width)
  let h = Math.min(frame.height * sy, src.height)
  if (w / h > 11 / 9) w = (h * 11) / 9
  else h = (w * 9) / 11
  const x = Math.max(0, Math.min(src.width - w, (frame.left - cr.left) * sx + (frame.width * sx - w) / 2))
  const y = Math.max(0, Math.min(src.height - h, (frame.top - cr.top) * sy + (frame.height * sy - h) / 2))

  const soft = w < CARD_PHOTO.minWidth
  const outW = Math.round(Math.min(CARD_PHOTO.width, Math.max(CARD_PHOTO.minWidth, w)))
  const outH = Math.round((outW * 9) / 11)
  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const ctx = out.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, x, y, w, h, 0, 0, outW, outH)

  for (const q of [0.9, 0.82, 0.72, 0.6]) {
    const blob = await toBlob(out, q)
    if (!blob) return null
    if (blob.size <= CARD_PHOTO.maxBytes) return { blob, width: outW, height: outH, soft }
  }
  return null
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(blob)
  })
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

/** Share sheet where there is one (phones), otherwise a download. */
export function shareOrSave(blob: Blob, name = `aweborn-${stamp()}`): void {
  const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png'
  const file = new File([blob], `${name}.${ext}`, { type: blob.type })
  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    void navigator.share({ files: [file], title: 'Aweborn' }).catch(() => {
      /* user dismissed share sheet */
    })
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** The whole screen, as it is (no controls: they're HTML, not in the canvas). */
export function saveWholeScreen(): void {
  const src = sceneCanvas()
  src?.toBlob((blob) => blob && shareOrSave(blob), 'image/png')
}
