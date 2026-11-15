// Reads every night the site lists (public/nights/index.json and public/regions/<key>/nights/index.json) into the
// rows share/stubs.ts renders. The usual level and units come from each night's own file; the index has neither.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { STUB_ID, type StubNight } from './stubs.ts'

interface IndexRow { id: string; date: string; hour_cst: number; site: string; site_name: string; compound: string; value: number; status: string }
interface NightFile {
  compound: { units: string }
  detection?: { site_id: string; baseline?: number | null }
  monitors: { site_id: string; baseline?: number | null }[]
}

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'))

function regionDirs(publicDir: string): [key: string, dir: string][] {
  const out: [string, string][] = [['houston', publicDir]]
  const regions = join(publicDir, 'regions')
  if (existsSync(regions)) {
    for (const e of readdirSync(regions, { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(join(regions, e.name, 'nights', 'index.json'))) out.push([e.name, join(regions, e.name)])
    }
  }
  return out
}

/** Throws on a row the stubs could not describe honestly, so a bad index fails the build instead of shipping a stub. */
export function collectNights(publicDir: string): StubNight[] {
  const out: StubNight[] = []
  const seen = new Map<string, string>()
  for (const [region, dir] of regionDirs(publicDir)) {
    const rows = readJson(join(dir, 'nights', 'index.json'))
    if (!Array.isArray(rows)) throw new Error(`${dir}/nights/index.json is not a list`)
    for (const r of rows as IndexRow[]) {
      if (typeof r?.id !== 'string' || !STUB_ID.test(r.id)) throw new Error(`${region}: bad night id ${JSON.stringify(r?.id)}`)
      // Stubs share one folder; two regions listing one id would make one stub open the wrong region.
      const other = seen.get(r.id)
      if (other) throw new Error(`night ${r.id} is listed in both ${other} and ${region}`)
      seen.set(r.id, region)
      if (typeof r.value !== 'number' || typeof r.hour_cst !== 'number' || typeof r.site_name !== 'string'
        || typeof r.compound !== 'string' || typeof r.status !== 'string' || typeof r.date !== 'string') {
        throw new Error(`${region}: night ${r.id} is missing a field the preview needs`)
      }
      const ev = readJson(join(dir, 'nights', `${r.id}.json`)) as NightFile
      const site = ev.detection?.site_id ?? r.site
      const baseline = ev.detection?.baseline ?? ev.monitors.find((m) => m.site_id === site)?.baseline ?? null
      out.push({
        id: r.id, region, date: r.date, hour_cst: r.hour_cst, site_name: r.site_name, compound: r.compound,
        value: r.value, baseline: typeof baseline === 'number' ? baseline : null, units: ev.compound.units, status: r.status,
      })
    }
  }
  return out
}
