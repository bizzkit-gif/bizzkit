import './styles/app.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { AppProvider } from './context/ctx'
import App from './App'
import { registerServiceWorker } from './lib/push'
import { primeNotificationAudio } from './lib/notify'
import { reportUnhandledError } from './lib/errorReporting'

/** Defer SW so first paint + session UI are not contending with registration (helps iOS PWA cold start). */
window.requestAnimationFrame(() => {
  void registerServiceWorker()
})

window.addEventListener('error', (event) => {
  reportUnhandledError(event.error ?? event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  reportUnhandledError(event.reason)
})

/** Unlock Web Audio on first tap (required on iOS Safari for message/call tones). */
const primeAudioOnce = () => {
  primeNotificationAudio()
  window.removeEventListener('pointerdown', primeAudioOnce)
}
window.addEventListener('pointerdown', primeAudioOnce)

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<{ type?: string; url?: string }>) => {
    if (event.data?.type === 'OPEN_URL' && event.data.url) {
      window.location.assign(event.data.url)
    }
  })
}

createRoot(document.getElementById('root')!).render(
  <AppProvider>
    <App />
  </AppProvider>
)
