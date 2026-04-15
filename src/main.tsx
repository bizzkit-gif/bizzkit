import React from 'react'
import { createRoot } from 'react-dom/client'
import { AppProvider } from './context/ctx'
import App from './App'
import './styles/app.css'
import { registerServiceWorker } from './lib/push'

void registerServiceWorker()

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
