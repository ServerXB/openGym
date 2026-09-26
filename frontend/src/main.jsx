import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import { registerAppServiceWorker } from './lib/service-worker.js'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
)

// Not in the mobile build: the native shell already serves everything from disk.
// Browsers regard HTTPS and loopback hosts as trustworthy contexts; the helper
// deliberately supports localhost so offline behaviour can be tested locally.
registerAppServiceWorker({ mobile: MOBILE })
