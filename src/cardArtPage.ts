/**
 * `/card-art.html?w=<worldId>[&size=1100x900][&ghost=1|0]` (M6 print tooling).
 *
 * Renders a world's World Index art (the same orb render as the in-game card)
 * at print size, shows it with a download link, and leaves the PNG data URL on
 * `window.__cardArt` (+ `data-ready` on <body>) for `scripts/cards/build-batch.mjs`.
 * `ghost=1` draws the Dreamt (wireframe ghost) look, `ghost=0` the solid orb;
 * by default it follows the world as it is now.
 */
import { renderCardArtImage } from './lib/cardArt'

declare global {
  interface Window { __cardArt?: string; __cardArtError?: string }
}

const SYNC_URL: string = import.meta.env.VITE_SYNC_URL ?? 'ws://localhost:1234'
const SYNC_HTTP = SYNC_URL.replace(/^ws/, 'http').replace(/\/+$/, '')
const WORLD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const title = document.getElementById('card-art-title') as HTMLElement
const status = document.getElementById('card-art-status') as HTMLElement

function fail(msg: string): void {
  status.textContent = msg
  window.__cardArtError = msg
  document.body.dataset.ready = 'error'
}

async function main(): Promise<void> {
  const q = new URLSearchParams(location.search)
  const id = (q.get('w') ?? '').toLowerCase()
  if (!WORLD_ID.test(id)) return fail('Add ?w=<world id> to the address.')
  const [w, h] = (q.get('size') ?? '1100x900').split('x').map((n) => Math.round(Number(n)))
  if (!(w >= 110 && w <= 2200 && h >= 90 && h <= 1800)) return fail('size must be between 110x90 and 2200x1800.')

  const res = await fetch(`${SYNC_HTTP}/worlds/${id}`).catch(() => null)
  if (!res?.ok) return fail(res?.status === 404 ? 'No world with that id is in the universe.' : 'Couldn’t reach the universe. Try again.')
  const world = (await res.json()) as { id: string; name: string; color: string; solidified: boolean }
  const ghost = q.get('ghost')
  const solidified = ghost === '1' ? false : ghost === '0' ? true : world.solidified

  title.textContent = world.name
  const canvas = renderCardArtImage({ id: world.id, color: world.color, solidified }, w, h)
  if (!canvas) return fail('This browser can’t draw the art (WebGL is off).')
  const url = canvas.toDataURL('image/png')

  const img = document.createElement('img')
  img.src = url
  img.width = w
  img.height = h
  img.alt = `World Index art of ${world.name}`
  const link = document.createElement('a')
  link.href = url
  link.download = `card-art-${world.id}.png`
  link.textContent = `Download PNG (${w} × ${h})`
  status.textContent = solidified ? 'Solid world' : 'Ghost (Dreamt) look'
  status.after(img, link)

  window.__cardArt = url
  document.body.dataset.ready = '1'
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)))
