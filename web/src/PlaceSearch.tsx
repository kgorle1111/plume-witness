import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { PlumeEvent } from './types'
import { kmText, placeReadout, type LatLon } from './geo'

export interface Place extends LatLon {
  label: string
}

// Fixed points so the picks work offline and send nothing. Source: OpenStreetMap Nominatim search results
// (place centroids), looked up 2026-11-14.
const PICKS: Place[] = [
  { label: 'Manchester', lat: 29.7182844, lon: -95.2618799 },
  { label: 'Harrisburg', lat: 29.7182845, lon: -95.2796581 },
  { label: 'Galena Park', lat: 29.7335616, lon: -95.2302123 },
  { label: 'Jacinto City', lat: 29.7673433, lon: -95.2336723 },
  { label: 'Pasadena', lat: 29.6910753, lon: -95.2092076 },
  { label: 'Cloverleaf', lat: 29.7782823, lon: -95.1718772 },
  { label: 'Channelview', lat: 29.7760599, lon: -95.1146533 },
  { label: 'Deer Park', lat: 29.7052284, lon: -95.1238204 },
]

// Nominatim usage policy: at most 1 request per second, no autocomplete. The viewbox only biases results
// toward the Ship Channel (bounded=0), so a far-away address still resolves and gets the coverage message.
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const SHIP_CHANNEL_VIEWBOX = '-95.45,29.90,-94.90,29.55'
const MIN_GAP_MS = 1000
const TIMEOUT_MS = 10000
const MAX_QUERY = 200
let lastRequestAt = 0

type Lookup = { ok: true; place: Place } | { ok: false; message: string }

/** Trust boundary: the response is third-party JSON. Only finite in-range coordinates and a bounded string pass. */
async function geocode(q: string, signal: AbortSignal): Promise<Lookup> {
  const wait = lastRequestAt + MIN_GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequestAt = Date.now()
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'us', viewbox: SHIP_CHANNEL_VIEWBOX, bounded: '0', q })
  let res: Response
  try {
    res = await fetch(`${NOMINATIM}?${params}`, { signal, referrerPolicy: 'strict-origin-when-cross-origin' })
  } catch {
    if (signal.aborted) return { ok: false, message: 'The search took too long. Try again, or pick a neighborhood below.' }
    return { ok: false, message: "Couldn't reach OpenStreetMap search. Pick a neighborhood below; those work offline." }
  }
  if (res.status === 429) return { ok: false, message: 'OpenStreetMap search is busy. Wait a minute and try again, or pick a neighborhood below.' }
  if (!res.ok) return { ok: false, message: `OpenStreetMap search failed (HTTP ${res.status}). Pick a neighborhood below instead.` }
  const data: unknown = await res.json().catch(() => null)
  const hit = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined
  const lat = Number(hit?.lat), lon = Number(hit?.lon)
  if (!hit || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { ok: false, message: 'No match found. Try a street address with the city, or pick a neighborhood below.' }
  }
  const name = typeof hit.display_name === 'string' ? hit.display_name : q
  // "Street, Neighborhood, City, County, State, ZIP, Country": the first three parts are enough to recognize it.
  const label = name.split(',').slice(0, 3).join(',').trim().slice(0, 120)
  return { ok: true, place: { lat, lon, label } }
}

interface Props {
  ev: PlumeEvent
  place: Place | null
  onPlace: (p: Place | null) => void
}

export function PlaceSearch({ ev, place, onPlace }: Props) {
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const ctrl = useRef<AbortController | null>(null)
  useEffect(() => () => ctrl.current?.abort(), [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim().slice(0, MAX_QUERY)
    if (!q || pending) return
    setPending(true)
    setError('')
    const c = new AbortController()
    ctrl.current = c
    const timer = window.setTimeout(() => c.abort(), TIMEOUT_MS)
    const r = await geocode(q, c.signal)
    window.clearTimeout(timer)
    if (ctrl.current !== c) return
    setPending(false)
    if (r.ok) onPlace(r.place)
    else setError(r.message)
  }

  const pick = (p: Place) => {
    // A pick wins over a search still in flight.
    ctrl.current?.abort()
    ctrl.current = null
    setPending(false)
    setError('')
    onPlace(p)
  }

  const r = place && placeReadout(ev, place)
  return (
    <section className="place-search" aria-labelledby="ps-heading">
      <h3 id="ps-heading" className="list-heading">Check a place against this night</h3>
      <form className="ps-form" role="search" onSubmit={submit}>
        <label htmlFor="ps-q" className="ps-label">Search an address or neighborhood</label>
        <div className="ps-row">
          <input
            id="ps-q"
            type="search"
            className="ps-input"
            value={query}
            maxLength={MAX_QUERY}
            autoComplete="off"
            enterKeyHint="search"
            aria-describedby="ps-note"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="btn" disabled={pending || !query.trim()}>
            {pending ? 'Searching…' : 'Search'}
          </button>
        </div>
        <p id="ps-note" className="muted small">Searches are sent to OpenStreetMap.</p>
      </form>
      <div className="ps-picks">
        <p className="muted small" id="ps-picks-label">Or pick a Ship Channel neighborhood (nothing is sent):</p>
        <div className="chips" role="group" aria-labelledby="ps-picks-label">
          {PICKS.map((p) => (
            <button key={p.label} type="button" className="chip" aria-pressed={place === p}
              onClick={() => pick(p)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {/* One polite region for results and errors, so each outcome is announced once. */}
      <div className="ps-result" role="status">
        {error && <p className="ps-error">{error}</p>}
        {!error && place && r && (
          r.kind === 'far' ? (
            <p className="ps-far"><strong>{place.label}</strong>: Plume Witness only has Houston Ship Channel data so far (one night, {ev.date_local}).</p>
          ) : (
            <div className="ps-readout">
              <p className="ps-place"><PinIcon /><strong>{place.label}</strong></p>
              <dl className="facts">
                <div><dt>Nearest state monitor</dt><dd>{r.monitor.name}, {kmText(r.monitor.km)}</dd></div>
                <div>
                  <dt>Upwind corridor</dt>
                  <dd>
                    {r.corridor === 'inside' && "Inside this night's upwind corridor (wind direction only)"}
                    {r.corridor === 'outside' && "Outside this night's upwind corridor"}
                    {r.corridor === 'none' && 'This file has no corridor'}
                  </dd>
                </div>
                {r.facility && <div><dt>Nearest listed facility</dt><dd>{r.facility.name}, {kmText(r.facility.km)}</dd></div>}
              </dl>
              <p className="muted small">Straight-line distances to points in this replay's data. The corridor is drawn from the wind around the detection hour.</p>
            </div>
          )
        )}
      </div>
      {place && (
        <button type="button" className="btn ps-clear" onClick={() => { setError(''); onPlace(null) }}>Clear place</button>
      )}
    </section>
  )
}

function PinIcon() {
  return (
    <svg className="ps-pin-icon" width="16" height="20" viewBox="0 0 16 20" aria-hidden="true" focusable="false">
      <path d="M8 19s6-6.2 6-11A6 6 0 0 0 2 8c0 4.8 6 11 6 11z" fill="var(--place)" stroke="#fff" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="2.2" fill="#fff" />
    </svg>
  )
}
