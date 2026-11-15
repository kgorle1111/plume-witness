import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './SpikeLog.css'
import App from './App.tsx'

// ?view=spikes opens the past-spikes log; its code and spikes.json load only then.
const SpikeLog = lazy(() => import('./SpikeLog.tsx'))
// ?view=brief opens the printable method brief, rendered from docs/brief.md.
const Brief = lazy(() => import('./Brief.tsx'))
const view = new URLSearchParams(window.location.search).get('view')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {view === 'spikes' ? (
      <Suspense fallback={<main className="state-msg"><p>Loading the spike log…</p></main>}>
        <SpikeLog />
      </Suspense>
    ) : view === 'brief' ? (
      <Suspense fallback={<main className="state-msg"><p>Loading the brief…</p></main>}>
        <Brief />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
