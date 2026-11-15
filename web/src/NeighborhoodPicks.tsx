import { kmText } from './geo'
import { NEIGHBORHOODS } from './neighborhoods'
import { nearestSite, type SpikeRow } from './spikes'
import { useT } from './useT'

/** A way in by neighborhood: each chip sets the monitor filter to the monitor nearest that place. Fixed points, so
 *  it works offline and sends nothing. Houston only (the points are Ship Channel neighborhoods). */
export function NeighborhoodPicks({ rows, picked, onPick }: {
  rows: SpikeRow[]
  /** The label of the chip that set the current monitor filter, or null. */
  picked: string | null
  /** Called with the place and its nearest monitor's site id; null clears the pick and the monitor filter. */
  onPick: (pick: { label: string; site: string } | null) => void
}) {
  const t = useT()
  const place = NEIGHBORHOODS.find((p) => p.label === picked)
  const near = place ? nearestSite(rows, place) : null
  return (
    <div className="sl-nb">
      <p className="sl-nb-label" id="sl-nb-label">{t('spikes.nbLabel')}</p>
      <div className="chips" role="group" aria-labelledby="sl-nb-label">
        {NEIGHBORHOODS.map((p) => (
          <button key={p.label} type="button" className="chip" aria-pressed={p.label === picked}
            onClick={() => {
              const n = nearestSite(rows, p)
              onPick(p.label === picked || !n ? null : { label: p.label, site: n.site_id })
            }}>
            {p.label}
          </button>
        ))}
      </div>
      {/* Always rendered, so the first result is announced. */}
      <p className="sl-nb-result" role="status">
        {place && near ? t('spikes.nbResult', { place: place.label, site: near.site, km: kmText(near.km) }) : ''}
      </p>
    </div>
  )
}
