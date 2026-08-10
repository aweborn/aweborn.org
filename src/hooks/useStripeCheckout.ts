import { useCallback, useState } from 'react'

const API_ENDPOINT = import.meta.env.VITE_API_ENDPOINT || ''

interface CheckoutState {
  loading: boolean
  error: string | null
}

export function useStripeCheckout() {
  const [state, setState] = useState<CheckoutState>({
    loading: false,
    error: null,
  })

  const createCheckoutSession = useCallback(async (amountInCents: number) => {
    if (!API_ENDPOINT) {
      // Fallback: open a placeholder or show message
      console.warn('Stripe API endpoint not configured. Set VITE_API_ENDPOINT.')
      setState({ loading: false, error: 'Donations are not yet available. Please check back soon!' })
      return
    }

    setState({ loading: true, error: null })

    try {
      const response = await fetch(`${API_ENDPOINT}/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountInCents,
          currency: 'usd',
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create checkout session')
      }

      const data = await response.json()

      if (data.url) {
        window.location.href = data.url
      } else {
        throw new Error('No checkout URL returned')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setState({ loading: false, error: message })
    }
  }, [])

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }))
  }, [])

  return {
    ...state,
    createCheckoutSession,
    clearError,
  }
}
