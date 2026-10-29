import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initOfflineCache } from './lib/offlineCache'
import { useUniverseStore } from './stores/universeStore'
import { takeJoinLink } from './lib/mesh'
import { takeDeviceLinkUrl } from './lib/deviceLink'

// A phone camera opened a Play nearby code (/j#<offer>, M7b): the panel joins once the app is up
takeJoinLink()
// …or a device link code (/link#<code>, M9): the account panel opens with it filled in
takeDeviceLinkUrl()

// The offline cache lives in IndexedDB (async), so load it before the first render: a cold offline card tap
// must find its cached worlds just as it did when the cache was synchronous localStorage (M7a, 2026-10-28)
void initOfflineCache()
  .catch(() => {})
  .finally(() => {
    useUniverseStore.getState().hydrateFromOfflineCache()
    createRoot(document.getElementById('root')!).render(
      <App />,
    )
  })

// <input type="checkbox" switch> (Make panel's "Loop" etc.): native in Safari; polyfilled only where missing
if (!('switch' in HTMLInputElement.prototype)) void import('./vendor/input-switch-polyfill.js')

// Register the offline app-shell service worker in production (and when supported)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        const warm = () => {
          const urls = Array.from(
            document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[rel="stylesheet"][href]'),
          )
            .map((el) => ('src' in el && el.src ? el.src : 'href' in el ? el.href : ''))
            .filter((u) => u.startsWith(window.location.origin))
          const worker = reg.active ?? reg.installing ?? reg.waiting
          worker?.postMessage({ type: 'WARM_SHELL', urls })
        }
        if (reg.active) warm()
        reg.addEventListener('updatefound', () => {
          reg.installing?.addEventListener('statechange', () => {
            if (reg.active) warm()
          })
        })
      })
      .catch(() => {})
  })
}
