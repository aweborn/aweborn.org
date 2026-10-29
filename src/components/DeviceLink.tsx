/**
 * "Play on another device" inside the account panel (Phase 08 I2, M9).
 *
 * Show: asks for a link code and shows it as a QR + typeable code with a
 * 5-minute countdown. Redeem (anonymous devices only, so a saved player is
 * never swapped out by accident): type or scan a code, the page reloads as
 * that player. A camera that opened `/link#<code>` lands here with the code
 * filled in; the player still taps "Link" (no silent sign-in from a link).
 */
import QRCode from 'qrcode'
import { useEffect, useState, type FormEvent } from 'react'
import { createLinkCode, linkUrl, prettyCode, redeemLinkCode, type LinkCode } from '../lib/deviceLink'

type Msg = { tone: 'info' | 'error' | 'success'; text: string } | null

export function DeviceLink({ canRedeem, initialCode }: { canRedeem: boolean; initialCode: string | null }) {
  const [code, setCode] = useState<LinkCode | null>(null)
  const [qr, setQr] = useState('')
  const [left, setLeft] = useState(0)
  const [typed, setTyped] = useState(initialCode ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  useEffect(() => {
    if (initialCode) setTyped(initialCode)
  }, [initialCode])

  // QR of the link URL (same look as the mesh QR).
  useEffect(() => {
    if (!code) return setQr('')
    let live = true
    QRCode.toString(linkUrl(code.code), { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0b0a1a', light: '#ffffff' } })
      .then((svg) => live && setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [code])

  // Countdown; the code is dropped when it runs out.
  useEffect(() => {
    if (!code) return
    const tick = () => {
      const s = Math.max(0, Math.ceil((code.expiresAt - Date.now()) / 1000))
      setLeft(s)
      if (s === 0) {
        setCode(null)
        setMsg({ tone: 'info', text: 'That code expired. Make a new one when you’re ready.' })
      }
    }
    tick()
    const t = window.setInterval(tick, 1000)
    return () => window.clearInterval(t)
  }, [code])

  const show = async () => {
    setBusy(true)
    setMsg(null)
    const r = await createLinkCode()
    setBusy(false)
    if ('error' in r) setMsg({ tone: 'error', text: r.error })
    else setCode(r)
  }

  const redeem = async (e: FormEvent) => {
    e.preventDefault()
    if (!typed.trim()) return
    setBusy(true)
    setMsg(null)
    const r = await redeemLinkCode(typed)
    if (r.ok) {
      setMsg({ tone: 'success', text: 'Linked! Loading your player…' })
      window.location.replace('/')
      return
    }
    setBusy(false)
    setMsg({ tone: 'error', text: r.message })
  }

  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`

  return (
    <details className="pa-devlink" open={Boolean(initialCode) || undefined}>
      <summary id="player-devlink-summary" className="pa-devlink-summary">Play on another device</summary>
      <div className="pa-devlink-body">
        {code ? (
          <figure className="pa-devlink-qr">
            {qr ? (
              <img id="player-devlink-qr" src={qr} width={200} height={200} alt={`QR code to link a device. Code ${prettyCode(code.code)}`} />
            ) : (
              <div className="pa-devlink-qr-blank" />
            )}
            <figcaption>
              <p id="player-devlink-code" className="pa-devlink-code">{prettyCode(code.code)}</p>
              <p className="pa-hint">
                Scan it with the other device’s camera, or type the code there. Works once, for <span className="pa-devlink-time">{mmss}</span>.
              </p>
              <button type="button" id="player-devlink-done" className="pa-link" onClick={() => setCode(null)}>
                Done
              </button>
            </figcaption>
          </figure>
        ) : (
          <>
            <p className="pa-hint pa-hint--left">Play this same player on your phone, tablet or computer. No password needed.</p>
            <button type="button" id="player-devlink-show" className="pa-btn pa-btn--ghost" disabled={busy} onClick={() => void show()}>
              {busy ? 'Making a code…' : 'Show a link code'}
            </button>
          </>
        )}

        {canRedeem ? (
          <form className="pa-devlink-form" onSubmit={(e) => void redeem(e)}>
            <label htmlFor="player-devlink-input" className="pa-label">Have a code from your other device?</label>
            <div className="pa-devlink-row">
              <input
                id="player-devlink-input"
                className="pa-input pa-devlink-input"
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="ABCD-2345"
                maxLength={16}
                autoComplete="one-time-code"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                enterKeyHint="go"
                aria-describedby="player-devlink-note"
              />
              <button type="submit" id="player-devlink-redeem" className="pa-btn pa-btn--primary pa-btn--sm" disabled={busy || !typed.trim()}>
                Link
              </button>
            </div>
            <p id="player-devlink-note" className="pa-hint pa-hint--left">
              This device switches to that player. The player you have here now stays on this device’s old session only.
            </p>
          </form>
        ) : initialCode ? (
          <p className="pa-hint pa-hint--left">This device already plays a saved player. Sign out first to use that code here.</p>
        ) : null}

        <p className={`pa-status${msg ? ` pa-status--${msg.tone}` : ''}`} role="status" aria-live="polite">
          {msg?.text ?? ''}
        </p>
      </div>
    </details>
  )
}
