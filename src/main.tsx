import React from 'react'
import { createRoot } from 'react-dom/client'
import { AppProvider } from './context/ctx'
import App from './App'
import './styles/app.css'

createRoot(document.getElementById('root')!).render(
  <AppProvider>
    <App />
  </AppProvider>
)
