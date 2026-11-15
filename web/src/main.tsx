import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted variable fonts (index.css --sans / --mono): no third-party font request, and they work offline.
// kn: every subset is imported; the browser fetches only what a page's text needs (unicode-range), but the
// service worker precaches all of them (~145 kB). Import per-subset @font-face rules if that matters.
import '@fontsource-variable/plus-jakarta-sans'
import '@fontsource-variable/jetbrains-mono'
import './index.css'
import './SpikeLog.css'
import './motion.css'
import './dark.css'
import Site from './Site'
import { registerServiceWorker } from './pwa'
import { initTheme } from './theme'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Site />
  </StrictMode>,
)

registerServiceWorker()
