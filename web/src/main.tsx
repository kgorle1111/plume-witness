import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted variable fonts, Latin subset only (fonts.css says why).
import './fonts.css'
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
