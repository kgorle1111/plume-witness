import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './SpikeLog.css'
import Site from './Site'
import { registerServiceWorker } from './pwa'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Site />
  </StrictMode>,
)

registerServiceWorker()
