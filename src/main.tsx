import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <App />,
)

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
