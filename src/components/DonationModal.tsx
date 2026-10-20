import { useState, useCallback, useMemo } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js'
import { usePaymentIntent } from '../hooks/usePaymentIntent'

// --- Stripe setup ---
const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || ''
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null

// --- Stripe appearance (cosmic theme) ---
const stripeAppearance = {
  theme: 'night' as const,
  variables: {
    colorPrimary: '#e8b94a',
    colorBackground: '#0d0d38',
    colorText: '#eef0f6',
    colorTextSecondary: 'rgba(238, 240, 246, 0.65)',
    colorTextPlaceholder: 'rgba(238, 240, 246, 0.4)',
    colorDanger: '#e8594a',
    colorIcon: '#e8b94a',
    colorIconHover: '#f0d78c',
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSizeBase: '15px',
    borderRadius: '0.75rem',
    spacingUnit: '4px',
    spacingGridRow: '16px',
    spacingGridColumn: '16px',
  },
  rules: {
    '.Input': {
      border: '1px solid rgba(238, 240, 246, 0.1)',
      backgroundColor: 'rgba(238, 240, 246, 0.05)',
      boxShadow: 'none',
      transition: 'border-color 150ms ease',
    },
    '.Input:focus': {
      border: '1px solid #e8b94a',
      boxShadow: '0 0 12px rgba(232, 185, 74, 0.2)',
    },
    '.Label': {
      fontSize: '0.8125rem',
      fontWeight: '500',
      color: 'rgba(238, 240, 246, 0.65)',
      letterSpacing: '0.02em',
    },
    '.Tab': {
      border: '1px solid rgba(238, 240, 246, 0.1)',
      backgroundColor: 'rgba(238, 240, 246, 0.05)',
    },
    '.Tab--selected': {
      backgroundColor: 'rgba(232, 185, 74, 0.15)',
      border: '1px solid rgba(232, 185, 74, 0.5)',
      color: '#e8b94a',
    },
    '.Tab:hover': {
      backgroundColor: 'rgba(232, 185, 74, 0.08)',
    },
  },
}

// --- Constants ---
// 1 mana = $0.01 (K = 100), so mana === cents. Players see mana; Stripe sees cents.
const PRESET_AMOUNTS = [
  { label: '🏷️ 1,000 mana', cents: 1000 },
  { label: '🏷️ 2,500 mana', cents: 2500 },
  { label: '🏷️ 5,000 mana', cents: 5000 },
  { label: '🏷️ 10,000 mana', cents: 10000 },
  { label: '🏷️ 25,000 mana', cents: 25000 },
  { label: '🏷️ 50,000 mana', cents: 50000 },
]

const formatMana = (mana: number) => `${mana.toLocaleString('en-US')} mana`

type ModalStep = 'amount' | 'payment' | 'success'

interface DonationModalProps {
  isOpen: boolean
  onClose: () => void
}

// ============================================
// Inner payment form (must be inside <Elements>)
// ============================================
function PaymentForm({
  amountInCents,
  onSuccess,
  onBack,
}: {
  amountInCents: number
  onSuccess: () => void
  onBack: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elementReady, setElementReady] = useState(false)

  const displayAmount = `🏷️ ${formatMana(amountInCents)}`

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stripe || !elements) return

    setProcessing(true)
    setError(null)

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}?donation=success`,
      },
      redirect: 'if_required',
    })

    if (confirmError) {
      setError(confirmError.message || 'Payment failed. Please try again.')
      setProcessing(false)
    } else {
      // Payment succeeded without redirect
      onSuccess()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="payment-form">
      <button
        type="button"
        className="payment-back-btn"
        onClick={onBack}
        disabled={processing}
        aria-label="Back to amount selection"
      >
        ← Change amount
      </button>

      <div className="payment-amount-banner">
        Adding <strong>{displayAmount}</strong>
      </div>

      <div className="stripe-element-wrapper">
        <PaymentElement
          onReady={() => setElementReady(true)}
          options={{
            layout: 'tabs',
          }}
        />
      </div>

      {error && (
        <p className="payment-error">{error}</p>
      )}

      <button
        type="submit"
        className="donate-btn"
        disabled={processing || !stripe || !elementReady}
        id="payment-submit-btn"
      >
        {processing ? (
          <span className="btn-spinner">Processing…</span>
        ) : (
          `Add mana — ${displayAmount}`
        )}
      </button>

      <div className="security-note">
        <span>🔒</span>
        <span>Secure payment powered by Stripe</span>
      </div>
    </form>
  )
}

// ============================================
// Success screen
// ============================================
function SuccessScreen({ onClose }: { onClose: () => void }) {
  return (
    <div className="donation-success">
      <div className="success-burst" />
      <div className="success-icon">✓</div>
      <h2 className="modal-title">Thank You!</h2>
      <p className="modal-subtitle">
        Your mana is in the pool. We're grateful for your generous support.
      </p>
      <button
        className="donate-btn"
        onClick={onClose}
        id="donation-success-close"
      >
        ✦ Continue Exploring ✦
      </button>
    </div>
  )
}

// ============================================
// Main DonationModal
// ============================================
export function DonationModal({ isOpen, onClose }: DonationModalProps) {
  const [step, setStep] = useState<ModalStep>('amount')
  const [selectedAmount, setSelectedAmount] = useState<number | null>(2500)
  const [customAmount, setCustomAmount] = useState('')
  const { clientSecret, loading, error, createPaymentIntent, reset, clearError } = usePaymentIntent()

  const handleFullClose = useCallback(() => {
    setStep('amount')
    setSelectedAmount(2500)
    setCustomAmount('')
    reset()
    onClose()
  }, [onClose, reset])

  // Elements options — memoized to avoid re-mounting
  const elementsOptions = useMemo(() => {
    if (!clientSecret) return null
    return {
      clientSecret,
      appearance: stripeAppearance,
    }
  }, [clientSecret])

  if (!isOpen) return null

  const handlePresetClick = (cents: number) => {
    setSelectedAmount(cents)
    setCustomAmount('')
    clearError()
  }

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9]/g, '')
    setCustomAmount(value)
    setSelectedAmount(null)
    clearError()
  }

  const getAmountInCents = (): number => {
    if (customAmount) {
      const parsed = parseFloat(customAmount)
      return isNaN(parsed) ? 0 : Math.round(parsed)
    }
    return selectedAmount || 0
  }

  const handleContinueToPayment = async () => {
    const cents = getAmountInCents()
    if (cents < 100) return // Minimum 100 mana ($1)
    await createPaymentIntent(cents)
    // Step transition happens via useEffect-like check below
  }

  const amountInCents = getAmountInCents()
  const displayAmount = `🏷️ ${formatMana(amountInCents)}`

  // Determine effective step: if we have a clientSecret and step is 'amount', advance
  const effectiveStep = step === 'amount' && clientSecret ? 'payment' : step


  return (
    <div className="modal-backdrop" onClick={handleFullClose}>
      <div
        className={`modal-content ${effectiveStep === 'success' ? 'modal-success' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {effectiveStep !== 'success' && (
          <button className="modal-close" onClick={handleFullClose} id="donation-modal-close" aria-label="Close">
            ✕
          </button>
        )}

        {/* ---- Step 1: Amount Selection ---- */}
        {effectiveStep === 'amount' && (
          <div className="modal-step modal-step-amount">
            <h2 className="modal-title">Add mana to the universe</h2>
            <p className="modal-subtitle">
              Every gift becomes mana in the universe’s pool. Half is the creative share all players create with; the rest funds our research.{' '}
              <a href="/giving.html" target="_blank" rel="noopener" id="donation-giving-link">Where your gift goes</a>
            </p>

            {/* Preset amounts */}
            <div className="amount-grid">
              {PRESET_AMOUNTS.map(({ label, cents }) => (
                <button
                  key={cents}
                  className={`amount-btn ${selectedAmount === cents ? 'selected' : ''}`}
                  onClick={() => handlePresetClick(cents)}
                  id={`amount-btn-${cents}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Custom amount */}
            <div className="custom-amount-container">
              <label className="custom-amount-label" htmlFor="custom-amount-input">
                Or enter a custom amount of mana (min 100)
              </label>
              <span className="custom-amount-prefix">🏷️</span>
              <input
                id="custom-amount-input"
                className="custom-amount-input"
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={customAmount}
                onChange={handleCustomChange}
              />
            </div>

            {/* Error display */}
            {error && (
              <p className="payment-error">{error}</p>
            )}

            {/* Continue button */}
            <button
              className="donate-btn"
              onClick={handleContinueToPayment}
              disabled={loading || amountInCents < 100}
              id="donate-continue-btn"
            >
              {loading ? (
                <span className="btn-spinner">Preparing…</span>
              ) : (
                `Continue — ${displayAmount}`
              )}
            </button>

            <div className="security-note">
              <span>🔒</span>
              <span>Secure payment powered by Stripe</span>
            </div>
          </div>
        )}

        {/* ---- Step 2: Payment ---- */}
        {effectiveStep === 'payment' && clientSecret && stripePromise && elementsOptions && (
          <div className="modal-step modal-step-payment">
            <Elements stripe={stripePromise} options={elementsOptions}>
              <PaymentForm
                amountInCents={amountInCents}
                onSuccess={() => setStep('success')}
                onBack={() => {
                  setStep('amount')
                  reset()
                }}
              />
            </Elements>
          </div>
        )}

        {/* ---- Step 3: Success ---- */}
        {effectiveStep === 'success' && (
          <div className="modal-step modal-step-success">
            <SuccessScreen onClose={handleFullClose} />
          </div>
        )}
      </div>
    </div>
  )
}
