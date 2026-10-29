import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { useMeshStore, closeMeshPanel, meshHost, meshJoin, meshAcceptAnswer, meshLeave, MAX_MESH_PEERS } from '../lib/mesh'
import { useUniverseStore } from '../stores/universeStore'
import { inputManager } from '../systems/InputManager'
import './MeshPanel.css'

/**
 * Play nearby (Phase 06, Rough Draft M7b): two phones in one room, same world,
 * no internet. The host shows a code, the other phone scans it and shows one
 * back, the host scans that. Lazy-loaded (QR drawing + scanning) from App.
 */
export default function MeshPanel() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { phase, code, error, peers, joinText } = useMeshStore()
  const inWorld = useUniverseStore((s) => s.activeWorldId !== null)
  const [scanning, setScanning] = useState<null | 'offer' | 'answer'>(null)
  const [codeError, setCodeError] = useState('')
  const [pasted, setPasted] = useState('')
  const wasEnabled = useRef(true)

  // Opened from the store: modal, the game's keys off while it is open
  useEffect(() => {
    const d = dialogRef.current
    if (!d || d.open) return
    wasEnabled.current = inputManager.isEnabled()
    d.showModal()
    inputManager.setEnabled(false)
  }, [])

  const onClosed = useCallback(() => {
    if (wasEnabled.current) inputManager.setEnabled(true)
    closeMeshPanel()
  }, [])

  // A phone camera opened /j#<offer>: join straight away
  useEffect(() => {
    if (!joinText) return
    useMeshStore.setState({ joinText: null })
    meshJoin(joinText).catch((e: Error) => setCodeError(e.message))
  }, [joinText])

  const submit = useCallback(
    async (text: string, kind: 'offer' | 'answer') => {
      setCodeError('')
      try {
        if (kind === 'offer') await meshJoin(text)
        else await meshAcceptAnswer(text)
        setScanning(null)
        setPasted('')
      } catch (e) {
        setCodeError((e as Error).message)
      }
    },
    [],
  )

  const startOver = () => {
    setScanning(null)
    setCodeError('')
    useMeshStore.setState({ phase: peers > 0 ? 'connected' : 'idle', error: null, code: null })
  }

  const close = () => dialogRef.current?.close()

  const peerText = peers === 1 ? '1 nearby player' : `${peers} nearby players`
  let body: React.ReactNode
  if (scanning) {
    body = (
      <>
        <p className="mesh-lead">
          {scanning === 'offer' ? 'Point the camera at the code on the phone that’s sharing.' : 'Point the camera at the code the other phone shows now.'}
        </p>
        <QrScanner onCode={(t) => void submit(t, scanning)} />
        <CodeError text={codeError} />
        <PasteCode value={pasted} onChange={setPasted} onSubmit={() => void submit(pasted, scanning)} />
        <div className="mesh-actions">
          <button type="button" id="mesh-scan-cancel" className="mesh-btn" onClick={() => { setScanning(null); setCodeError('') }}>
            Back
          </button>
        </div>
      </>
    )
  } else if (phase === 'preparing' || phase === 'connecting') {
    body = (
      <div className="mesh-wait" role="status">
        <span className="mesh-spinner" aria-hidden="true" />
        {phase === 'preparing' ? 'Getting ready…' : 'Connecting…'}
      </div>
    )
  } else if (phase === 'showing-offer' && code) {
    body = (
      <>
        <p className="mesh-lead">
          <b>1.</b> On the other phone: <b>••• More → Play nearby → Join</b>, then scan this.
        </p>
        <QrCode text={code} label="Code for the other phone to scan" />
        <p className="mesh-lead">
          <b>2.</b> It shows a code back. Scan that one:
        </p>
        <div className="mesh-actions">
          <button type="button" id="mesh-scan-answer" className="mesh-btn mesh-btn--primary" autoFocus onClick={() => setScanning('answer')}>
            Scan their code
          </button>
        </div>
      </>
    )
  } else if (phase === 'showing-answer' && code) {
    body = (
      <>
        <p className="mesh-lead">Show this to the phone that’s sharing. You’re connected as soon as it scans it.</p>
        <QrCode text={code} label="Code for the sharing phone to scan" />
        <div className="mesh-wait mesh-wait--quiet" role="status">
          <span className="mesh-spinner" aria-hidden="true" />
          Waiting for them to scan…
        </div>
      </>
    )
  } else if (phase === 'failed') {
    body = (
      <>
        <p className="mesh-error" role="alert">{error}</p>
        <div className="mesh-actions">
          <button type="button" id="mesh-retry" className="mesh-btn mesh-btn--primary" autoFocus onClick={startOver}>
            Try again
          </button>
        </div>
      </>
    )
  } else {
    // idle / connected
    body = (
      <>
        {peers > 0 ? (
          <p className="mesh-ok" role="status">
            <span aria-hidden="true">✓</span> Playing with {peerText}. What anyone builds here appears for everyone, and
            reaches the universe when each phone is back online.
          </p>
        ) : (
          <p className="mesh-lead">
            Phones next to each other can play the same world with <b>no internet</b>. Both need to be on the same Wi-Fi or
            one phone’s hotspot.
          </p>
        )}
        <div className="mesh-choices">
          {inWorld && peers < MAX_MESH_PEERS && (
            <button type="button" id="mesh-host" className="mesh-choice" autoFocus onClick={() => void meshHost()}>
              <span className="mesh-choice-icon" aria-hidden="true">📡</span>
              <span className="mesh-choice-text">
                <span className="mesh-choice-title">{peers > 0 ? 'Add another player' : 'Share this world'}</span>
                <span className="mesh-choice-sub">Show a code for a nearby phone to scan</span>
              </span>
            </button>
          )}
          {peers === 0 && (
            <button type="button" id="mesh-join" className="mesh-choice" autoFocus={!inWorld} onClick={() => setScanning('offer')}>
              <span className="mesh-choice-icon" aria-hidden="true">📷</span>
              <span className="mesh-choice-text">
                <span className="mesh-choice-title">Join</span>
                <span className="mesh-choice-sub">Scan the code on the phone that’s sharing</span>
              </span>
            </button>
          )}
        </div>
        {!inWorld && peers === 0 && <p className="mesh-note">To share a world, step into it first.</p>}
        <CodeError text={codeError} />
        {peers > 0 && (
          <div className="mesh-actions">
            <button type="button" id="mesh-leave" className="mesh-btn mesh-btn--quiet" onClick={meshLeave}>
              Disconnect
            </button>
            <button type="button" id="mesh-done" className="mesh-btn mesh-btn--primary" onClick={close}>
              Done
            </button>
          </div>
        )}
      </>
    )
  }

  return (
    <dialog
      ref={dialogRef}
      id="mesh-panel"
      className="mesh-panel"
      aria-labelledby="mesh-title"
      {...({ closedby: 'any' } as object)}
      onClose={onClosed}
      onClick={(e) => {
        // Where closedby isn't supported (Safari): the dialog has no padding, so only the backdrop is the target
        if (e.target === dialogRef.current) close()
      }}
    >
      <div className="mesh-shell">
        <header className="mesh-head">
          <h2 id="mesh-title" className="mesh-title">Play nearby</h2>
          <button type="button" id="mesh-close" className="mesh-close" aria-label="Close" onClick={close}>
            ✕
          </button>
        </header>
        {body}
      </div>
    </dialog>
  )
}

function CodeError({ text }: { text: string }) {
  return text ? (
    <p className="mesh-error" role="alert">
      {text}
    </p>
  ) : null
}

/** For a laptop with no camera, or a code sent as text. */
function PasteCode({ value, onChange, onSubmit }: { value: string; onChange: (v: string) => void; onSubmit: () => void }) {
  return (
    <details className="mesh-paste">
      <summary>No camera? Paste the code instead</summary>
      <form
        className="mesh-paste-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) onSubmit()
        }}
      >
        <label htmlFor="mesh-paste-input" className="mesh-paste-label">Code</label>
        <input
          id="mesh-paste-input"
          className="mesh-paste-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button type="submit" id="mesh-paste-submit" className="mesh-btn">Use code</button>
      </form>
    </details>
  )
}

function QrCode({ text, label }: { text: string; label: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let live = true
    QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0b0a1a', light: '#ffffff' } })
      .then((svg) => live && setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [text])
  return (
    <figure className="mesh-qr">
      {src ? <img id="mesh-qr-img" src={src} width={240} height={240} alt={label} /> : <div className="mesh-qr-blank" />}
      <figcaption className="mesh-qr-copy">
        <button type="button" id="mesh-copy" className="mesh-link" onClick={() => void navigator.clipboard?.writeText(text).catch(() => {})}>
          Copy as text
        </button>
      </figcaption>
    </figure>
  )
}

type Detector = { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>> }

/** Rear camera → a QR's text. BarcodeDetector where the browser has it, else jsQR on a small frame. */
function QrScanner({ onCode }: { onCode: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [problem, setProblem] = useState('')
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  useEffect(() => {
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    let last = ''
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
    let detector: Detector | null = null
    try {
      detector = BD ? new BD({ formats: ['qr_code'] }) : null
    } catch {
      detector = null
    }

    const tick = async () => {
      const v = videoRef.current
      if (stopped || !v) return
      if (v.readyState >= 2 && v.videoWidth > 0) {
        let text = ''
        try {
          if (detector) text = (await detector.detect(v))[0]?.rawValue ?? ''
          else if (ctx) {
            const scale = Math.min(1, 480 / v.videoWidth)
            canvas.width = Math.round(v.videoWidth * scale)
            canvas.height = Math.round(v.videoHeight * scale)
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? ''
          }
        } catch {
          /* a frame that can't be read */
        }
        if (text && text !== last) {
          last = text // the same wrong code isn't re-submitted every frame
          onCodeRef.current(text)
        }
      }
      if (!stopped) timer = setTimeout(() => void tick(), 180)
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setProblem('This browser can’t use the camera here. Paste the code instead.')
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop())
        stream = s
        const v = videoRef.current
        if (v) {
          v.srcObject = s
          void v.play().catch(() => {})
        }
        void tick()
      })
      .catch(() => setProblem('No camera access. Allow the camera for aweborn.org, or paste the code instead.'))

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div className="mesh-scan">
      <video ref={videoRef} id="mesh-video" className="mesh-video" playsInline muted aria-label="Camera view" />
      <span className="mesh-scan-frame" aria-hidden="true" />
      {problem && <p className="mesh-scan-problem">{problem}</p>}
    </div>
  )
}
