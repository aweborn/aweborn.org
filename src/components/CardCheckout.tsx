import { useId, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { WorldIndexEntry } from '@aweborn/shared/crdt-schema'
import { CARD_MAX_QUANTITY, CARD_PRICE_CENTS, type CardArrival } from '@aweborn/shared/cards'
import { getPlayerSnapshot, subscribePlayer } from '../lib/player'
import { SoonError, formatCardPrice as price, startCardCheckout } from '../lib/cardCheckout'
import { useNameStore } from '../stores/nameStore'

/**
 * "Get this card" (Rough Draft M6a): order printed NFC cards of a world.
 *
 *   1. POST sync /api/player/cards/checkout → an unpaid order (server checks
 *      the world, the name, and per-player limits)
 *   2. POST payment API /create-card-checkout { orderId } → Stripe Checkout
 *      (collects the shipping address; we never see the card number)
 *   3. Stripe sends the buyer to /order.html?o=<id>, the order's status page
 *
 * The network side lives in lib/cardCheckout.ts.
 */

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string } | { kind: 'soon' }

export function CardCheckout({ entry, onBack }: { entry: WorldIndexEntry; onBack: () => void }) {
  const player = useSyncExternalStore(subscribePlayer, getPlayerSnapshot)
  const myName = useNameStore((s) => (player ? s.names[player.playerId] ?? null : null))
  const [quantity, setQuantity] = useState(1)
  const [arrival, setArrival] = useState<CardArrival>('enter')
  const [showName, setShowName] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const uid = useId()
  const qtyId = `${uid}-qty`
  const nameHintId = `${uid}-name-hint`
  const worldName = entry.world?.name ?? 'this world'
  const total = CARD_PRICE_CENTS * quantity
  const busy = status.kind === 'busy'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setStatus({ kind: 'busy' })
    try {
      const url = await startCardCheckout({ worldId: entry.worldId, quantity, arrival, showName: showName && !!myName })
      window.location.assign(url)
    } catch (err) {
      if (err instanceof SoonError) setStatus({ kind: 'soon' })
      else setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' })
    }
  }

  return (
    <form id="card-checkout" className="cc" onSubmit={submit} aria-labelledby={`${uid}-title`}>
      <h3 id={`${uid}-title`} className="cc-title">
        Hold <span className="cc-world">{worldName}</span> in your hand
      </h3>
      <p className="cc-lede">
        A printed card with a chip inside. Tap it with a phone and anyone lands right here. Your purchase keeps the
        universe running.
      </p>

      <fieldset className="cc-field">
        <legend className="cc-legend">How many</legend>
        <div className="cc-qty">
          <button
            type="button"
            id="card-qty-minus"
            className="cc-qty-btn"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1 || busy}
            aria-label="One fewer"
            aria-controls={qtyId}
          >
            −
          </button>
          <output id={qtyId} className="cc-qty-n" aria-live="polite">
            {quantity}
          </output>
          <button
            type="button"
            id="card-qty-plus"
            className="cc-qty-btn"
            onClick={() => setQuantity((q) => Math.min(CARD_MAX_QUANTITY, q + 1))}
            disabled={quantity >= CARD_MAX_QUANTITY || busy}
            aria-label="One more"
            aria-controls={qtyId}
          >
            +
          </button>
          <span className="cc-each">{price(CARD_PRICE_CENTS)} each · free US shipping</span>
        </div>
      </fieldset>

      <fieldset className="cc-field">
        <legend className="cc-legend">When someone taps it</legend>
        <div className="cc-options">
          <label className="cc-option" htmlFor="card-arrival-enter">
            <input
              type="radio"
              id="card-arrival-enter"
              name="arrival"
              value="enter"
              checked={arrival === 'enter'}
              onChange={() => setArrival('enter')}
              disabled={busy}
            />
            <span className="cc-option-text">
              <strong>Step inside</strong>
              <span>They open their eyes in the world.</span>
            </span>
          </label>
          <label className="cc-option" htmlFor="card-arrival-land">
            <input
              type="radio"
              id="card-arrival-land"
              name="arrival"
              value="land"
              checked={arrival === 'land'}
              onChange={() => setArrival('land')}
              disabled={busy}
            />
            <span className="cc-option-text">
              <strong>Land beside it</strong>
              <span>They see it from space first, then fly in.</span>
            </span>
          </label>
        </div>
      </fieldset>

      <label className="cc-check" htmlFor="card-show-name">
        <input
          type="checkbox"
          id="card-show-name"
          name="showName"
          checked={showName && !!myName}
          onChange={(e) => setShowName(e.target.checked)}
          disabled={!myName || busy}
          aria-describedby={nameHintId}
        />
        <span>
          Show my name in the sky
          <span id={nameHintId} className="cc-check-hint">
            {myName
              ? `When it's paid, everyone sees \u201c\u2605 ${myName} brought a card of ${worldName} into the world\u201d.`
              : 'Name your character in your account to sign the sky. Otherwise it stays anonymous.'}
          </span>
        </span>
      </label>

      <div className="cc-actions">
        <button type="button" id="card-back" className="pa-btn pa-btn--ghost" onClick={onBack} disabled={busy}>
          Back
        </button>
        <button type="submit" id="card-pay" className="pa-btn pa-btn--primary cc-pay" disabled={busy}>
          {busy ? 'Opening checkout…' : `Pay ${price(total)}`}
        </button>
      </div>

      <p className="cc-status" role="status" aria-live="polite">
        {status.kind === 'error' && <span className="cc-error">{status.message}</span>}
        {status.kind === 'soon' && (
          <span className="cc-soon">Card orders open soon. Nothing was charged.</span>
        )}
      </p>
      <p className="cc-fine">
        Checkout and your shipping address are handled by Stripe. A person checks every card before it&rsquo;s printed;
        you can get a full refund until then. <a href="/terms.html#cards" target="_blank" rel="noopener">Terms</a> ·{' '}
        <a href="/privacy.html#cards" target="_blank" rel="noopener">Privacy</a>
      </p>
    </form>
  )
}
