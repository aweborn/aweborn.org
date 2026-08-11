import { useCallback, useState } from 'react'

const API_ENDPOINT = import.meta.env.VITE_API_ENDPOINT || ''

interface PaymentIntentState {
  clientSecret: string | null
  loading: boolean
  error: string | null
}

export function usePaymentIntent() {
  const [state, setState] = useState<PaymentIntentState>({
    clientSecret: null,
    loading: false,
    error: null,
  })

  const createPaymentIntent = useCallback(async (amountInCents: number) => {
    if (!API_ENDPOINT) {
      setState({
        clientSecret: null,
        loading: false,
        error: 'Donations are not yet available. Please check back soon!',
      })
      return
    }

    setState({ clientSecret: null, loading: true, error: null })

    try {
      const response = await fetch(`${API_ENDPOINT}/create-payment-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountInCents,
          currency: 'usd',
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to initialize payment')
      }

      const data = await response.json()

      if (!data.clientSecret) {
        throw new Error('No client secret returned')
      }

      setState({ clientSecret: data.clientSecret, loading: false, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setState({ clientSecret: null, loading: false, error: message })
    }
  }, [])

  const reset = useCallback(() => {
    setState({ clientSecret: null, loading: false, error: null })
  }, [])

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }))
  }, [])

  return {
    ...state,
    createPaymentIntent,
    reset,
    clearError,
  }
}
