import { useState } from 'react'
import { useStripeCheckout } from '../hooks/useStripeCheckout'

interface DonationModalProps {
  isOpen: boolean
  onClose: () => void
}

const PRESET_AMOUNTS = [
  { label: '$10', cents: 1000 },
  { label: '$25', cents: 2500 },
  { label: '$50', cents: 5000 },
  { label: '$100', cents: 10000 },
  { label: '$250', cents: 25000 },
  { label: '$500', cents: 50000 },
]

export function DonationModal({ isOpen, onClose }: DonationModalProps) {
  const [selectedAmount, setSelectedAmount] = useState<number | null>(2500)
  const [customAmount, setCustomAmount] = useState('')
  const { loading, error, createCheckoutSession, clearError } = useStripeCheckout()

  if (!isOpen) return null

  const handlePresetClick = (cents: number) => {
    setSelectedAmount(cents)
    setCustomAmount('')
    clearError()
  }

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9.]/g, '')
    setCustomAmount(value)
    setSelectedAmount(null)
    clearError()
  }

  const getAmountInCents = (): number => {
    if (customAmount) {
      const parsed = parseFloat(customAmount)
      return isNaN(parsed) ? 0 : Math.round(parsed * 100)
    }
    return selectedAmount || 0
  }

  const handleDonate = () => {
    const cents = getAmountInCents()
    if (cents < 100) return // Minimum $1
    createCheckoutSession(cents)
  }

  const amountInCents = getAmountInCents()
  const displayAmount = amountInCents > 0
    ? `$${(amountInCents / 100).toFixed(2)}`
    : '$0.00'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} id="donation-modal-close" aria-label="Close">
          ✕
        </button>

        <h2 className="modal-title">Support Aweborn</h2>
        <p className="modal-subtitle">
          Your donation fuels our mission. Every contribution makes a difference.
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
            Or enter a custom amount
          </label>
          <span className="custom-amount-prefix">$</span>
          <input
            id="custom-amount-input"
            className="custom-amount-input"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={customAmount}
            onChange={handleCustomChange}
          />
        </div>

        {/* Error display */}
        {error && (
          <p style={{
            color: '#e8594a',
            fontSize: 'var(--text-sm)',
            marginBottom: 'var(--space-md)',
            textAlign: 'center',
          }}>
            {error}
          </p>
        )}

        {/* Donate button */}
        <button
          className="donate-btn"
          onClick={handleDonate}
          disabled={loading || amountInCents < 100}
          id="donate-submit-btn"
        >
          {loading ? 'Redirecting…' : `Donate ${displayAmount}`}
        </button>

        {/* Security note */}
        <div className="security-note">
          <span>🔒</span>
          <span>Secure payment powered by Stripe</span>
        </div>
      </div>
    </div>
  )
}
