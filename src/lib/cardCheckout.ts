import type { CardArrival } from '@aweborn/shared/cards'
import { AUTH_URL } from './player'

/**
 * Card checkout, network side (Rough Draft M6a). See components/CardCheckout.tsx.
 *
 * Shown in dev, or in prod once VITE_CARD_CHECKOUT=1 (after the Stripe
 * price exists and the payment stack is applied).
 */
export const CARD_CHECKOUT_ON = import.meta.env.DEV || import.meta.env.VITE_CARD_CHECKOUT === '1'

const API_ENDPOINT: string = import.meta.env.VITE_API_ENDPOINT || ''
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
/** "$9", "$18", "$9.50" */
export const formatCardPrice = (cents: number): string => usd.format(cents / 100).replace(/\.00$/, '')

export async function startCardCheckout(body: { worldId: string; quantity: number; arrival: CardArrival; showName: boolean; photo?: string }): Promise<string> {
  const res = await fetch(`${AUTH_URL}/api/player/cards/checkout`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null)
  if (!res) throw new Error('You look offline. Try again when you\u2019re connected.')
  const data = (await res.json().catch(() => ({}))) as { orderId?: string; error?: string; message?: string }
  if (res.status === 401) throw new Error('Your player didn\u2019t load. Reload the page and try again.')
  if (!res.ok || !data.orderId) throw new Error(data.message ?? 'The order didn\u2019t go through. Try again in a moment.')
  if (!API_ENDPOINT) throw new SoonError()

  const pay = await fetch(`${API_ENDPOINT}/create-card-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId: data.orderId }),
  }).catch(() => null)
  if (!pay) throw new Error('Couldn\u2019t reach checkout. Try again in a moment.')
  const p = (await pay.json().catch(() => ({}))) as { url?: string; error?: string }
  if (pay.status === 503 || p.error === 'cards_not_on_sale') throw new SoonError()
  if (!pay.ok || !p.url) throw new Error('Checkout didn\u2019t open. Try again in a moment.')
  return p.url
}

/** Card sales aren't open yet (no payment API, or no Stripe price): nothing was charged. */
export class SoonError extends Error {}

