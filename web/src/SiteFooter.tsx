import { InstallHint } from './InstallHint'

const BASE = import.meta.env.BASE_URL

/** One line on every page: where the data comes from, the license, and the open-data docs. */
export function SiteFooter() {
  return (
    <footer className="site-foot">
      <span>MIT code. Government data is public domain: cite TCEQ, EPA, Census.</span>
      <a href="https://github.com/kgorle1111/plume-witness/blob/main/docs/api.md" rel="noopener">Open data docs</a>
      <a href={`${BASE}?view=facilities`}>Facilities</a>
      <a href={`${BASE}?view=spikes`}>Past spikes</a>
      <InstallHint />
    </footer>
  )
}
