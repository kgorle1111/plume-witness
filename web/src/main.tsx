import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './SpikeLog.css'
import App from './App.tsx'

// ?view=spikes opens the past-spikes log; its code and spikes.json load only then.
const SpikeLog = lazy(() => import('./SpikeLog.tsx'))
const FacilityViews = lazy(() => import('./FacilityViews.tsx'))
const view = new URLSearchParams(window.location.search).get('view')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {view === 'facility' || view === 'facilities' ? (
      <Suspense fallback={<main className="state-msg"><p>Loading…</p></main>}>
        <FacilityViews view={view} />
      </Suspense>
    ) : view === 'spikes' ? (
      <Suspense fallback={<main className="state-msg"><p>Loading the spike log…</p></main>}>
        <SpikeLog />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
