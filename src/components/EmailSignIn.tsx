/**
 * Aweborn: email in the "Save your player" panel.
 *
 * Codes first: enter an email, get a 6-digit code, type it here. That saves
 * *this* player, even if the email is opened on another device. A password
 * is the quiet alternative, confirmed with the same kind of code.
 *
 * mode="save": anonymous players (new email saves, known email signs in).
 * mode="add":  saved players without an email yet (passkey only).
 */

import { useId, useRef, useState, type FormEvent } from 'react'
import {
  confirmAddEmail,
  confirmEmail,
  resendConfirmCode,
  resetPasswordWithCode,
  sendAddEmailCode,
  sendEmailCode,
  sendResetCode,
  signInWithPassword,
  signUpWithPassword,
  verifyEmailCode,
  type AuthResult,
} from '../lib/player'

type Step =
  | { kind: 'email' }
  | { kind: 'code'; purpose: 'signin' | 'confirm' | 'add' }
  | { kind: 'password' }
  | { kind: 'reset' }

type Status = { tone: 'info' | 'error' | 'success'; text: string } | null

const MailMark = () => (
  <svg className="pa-btn-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="m4 7 8 6 8-6" />
  </svg>
)

export function EmailSignIn({ mode, disabled, onDone }: {
  mode: 'save' | 'add'
  disabled?: boolean
  onDone: (message: string) => void
}) {
  const uid = useId()
  const [step, setStep] = useState<Step>({ kind: 'email' })
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [hasPassword, setHasPassword] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  const go = (next: Step, note: Status = null) => {
    setStep(next)
    setStatus(note)
    setCode('')
    if (next.kind === 'code' || next.kind === 'reset') requestAnimationFrame(() => codeRef.current?.focus())
  }

  async function act(fn: () => Promise<AuthResult & { needsCode?: boolean }>, onOk: () => void) {
    setBusy(true)
    setStatus(null)
    try {
      const res = await fn()
      if (res.ok) onOk()
      else if (res.needsCode) go({ kind: 'code', purpose: 'confirm' }, { tone: 'info', text: res.message })
      else setStatus({ tone: res.cancelled ? 'info' : 'error', text: res.message })
    } catch {
      setStatus({ tone: 'error', text: 'Something went wrong. Your player is safe. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  const sent = { tone: 'info' as const, text: `We sent a 6-digit code to ${email.trim()}. It works for 10 minutes.` }

  const sendCode = () =>
    act(
      () => (mode === 'add' ? sendAddEmailCode(email) : sendEmailCode(email)),
      () => go({ kind: 'code', purpose: mode === 'add' ? 'add' : 'signin' }, sent),
    )

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (step.kind === 'email') return void sendCode()
    if (step.kind === 'code') {
      const check =
        step.purpose === 'signin' ? verifyEmailCode : step.purpose === 'confirm' ? confirmEmail : confirmAddEmail
      return void act(() => check(email, code), () =>
        onDone(step.purpose === 'add' ? 'Email added. You can sign in with a code any time.' : 'Saved! Sign in with your email on any device.'))
    }
    if (step.kind === 'password') {
      if (hasPassword) return void act(() => signInWithPassword(email, password), () => onDone('Signed in. Welcome back!'))
      return void act(() => signUpWithPassword(email, password), () =>
        go({ kind: 'code', purpose: 'confirm' }, { tone: 'info', text: `Almost there! We sent a code to ${email.trim()} to confirm it's you.` }))
    }
    if (step.kind === 'reset') {
      return void act(() => resetPasswordWithCode(email, code, password), () => onDone('New password set. Welcome back!'))
    }
  }

  const ids = { email: `${uid}-email`, code: `${uid}-code`, password: `${uid}-password` }
  const off = disabled || busy

  return (
    <form className="pa-email" onSubmit={onSubmit} noValidate={false}>
      {(step.kind === 'email' || step.kind === 'password') && (
        <div className="pa-field">
          <label htmlFor={ids.email} className="pa-label">Email</label>
          <input
            id={ids.email}
            className="pa-input"
            type="email"
            name="email"
            autoComplete={step.kind === 'password' ? 'username' : 'email'}
            inputMode="email"
            spellCheck={false}
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={off}
          />
        </div>
      )}

      {step.kind === 'email' && (
        <>
          <button type="submit" id={`player-email-${mode}`} className="pa-btn pa-btn--light" disabled={off || !email.includes('@')}>
            <MailMark />
            {busy ? 'Sending…' : mode === 'add' ? 'Send me a code' : 'Email me a code'}
          </button>
          {mode === 'save' && (
            <button type="button" id="player-use-password" className="pa-link pa-link--quiet" disabled={off} onClick={() => go({ kind: 'password' })}>
              Use a password instead
            </button>
          )}
        </>
      )}

      {(step.kind === 'code' || step.kind === 'reset') && (
        <div className="pa-field">
          <label htmlFor={ids.code} className="pa-label">6-digit code</label>
          <input
            ref={codeRef}
            id={ids.code}
            className="pa-input pa-input--code"
            type="text"
            name="one-time-code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="\d{3}\s?\d{3}"
            maxLength={7}
            required
            placeholder="123 456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
            disabled={off}
          />
        </div>
      )}

      {(step.kind === 'password' || step.kind === 'reset') && (
        <div className="pa-field">
          <label htmlFor={ids.password} className="pa-label">
            {step.kind === 'reset' ? 'New password' : hasPassword ? 'Password' : 'Choose a password'}
          </label>
          <input
            id={ids.password}
            className="pa-input"
            type="password"
            name="password"
            autoComplete={step.kind === 'password' && hasPassword ? 'current-password' : 'new-password'}
            minLength={step.kind === 'password' && hasPassword ? undefined : 10}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={off}
          />
          {(step.kind === 'reset' || !hasPassword) && <p className="pa-hint pa-hint--left">At least 10 characters. A short phrase works great.</p>}
        </div>
      )}

      {step.kind === 'code' && (
        <>
          <button type="submit" id="player-email-confirm" className="pa-btn pa-btn--primary" disabled={off || code.replace(/\D/g, '').length !== 6}>
            {busy ? 'Checking…' : step.purpose === 'add' ? 'Add my email' : 'Save my player'}
          </button>
          <div className="pa-row">
            <button
              type="button"
              className="pa-link pa-link--quiet"
              disabled={off}
              onClick={() => step.purpose === 'confirm' ? act(() => resendConfirmCode(email), () => go(step, sent)) : sendCode()}
            >
              Send a new code
            </button>
            <button type="button" className="pa-link pa-link--quiet" disabled={off} onClick={() => go({ kind: 'email' })}>
              Use a different email
            </button>
          </div>
        </>
      )}

      {step.kind === 'password' && (
        <>
          <button type="submit" id="player-password-submit" className="pa-btn pa-btn--primary" disabled={off || !email.includes('@') || !password}>
            {busy ? 'One moment…' : hasPassword ? 'Sign in' : 'Save my player'}
          </button>
          <div className="pa-row">
            <button type="button" className="pa-link pa-link--quiet" disabled={off} onClick={() => { setHasPassword(!hasPassword); setStatus(null) }}>
              {hasPassword ? 'New here? Create a password' : 'I already have a password'}
            </button>
            {hasPassword && (
              <button
                type="button"
                className="pa-link pa-link--quiet"
                disabled={off || !email.includes('@')}
                title={email.includes('@') ? undefined : 'Enter your email first'}
                onClick={() => act(() => sendResetCode(email), () => { setPassword(''); go({ kind: 'reset' }, sent) })}
              >
                Forgot it?
              </button>
            )}
          </div>
          <button type="button" className="pa-link pa-link--quiet" disabled={off} onClick={() => go({ kind: 'email' })}>
            Use an email code instead
          </button>
        </>
      )}

      {step.kind === 'reset' && (
        <>
          <button type="submit" id="player-reset-submit" className="pa-btn pa-btn--primary" disabled={off || code.replace(/\D/g, '').length !== 6 || password.length < 10}>
            {busy ? 'One moment…' : 'Set new password'}
          </button>
          <button type="button" className="pa-link pa-link--quiet" disabled={off} onClick={() => go({ kind: 'password' })}>
            Back
          </button>
        </>
      )}

      {status && (
        <p className={`pa-email-status pa-status--${status.tone}`} role="status" aria-live="polite">{status.text}</p>
      )}
    </form>
  )
}
