// Story mode's words, English and Spanish. Kept beside the story (not in i18n.ts) so the page is a pure addition; the
// numbers are filled in from the night file by Story.tsx, never typed in here.
import type { Lang } from './i18n'

export const STORY_STEPS = ['spike', 'upwind', 'record', 'question'] as const
export type StoryStep = (typeof STORY_STEPS)[number]

/** "#upwind" → 1; anything else (no hash, a stray one) opens the first step. */
export function storyStepIndex(hash: string): number {
  return Math.max(0, STORY_STEPS.indexOf(hash.replace(/^#/, '') as StoryStep))
}

type Copy = {
  enter: string
  enterSub: string
  loading: string
  failed: string
  retry: string
  exit: string
  back: string
  progress: (n: number, of: number) => string
  bar: (place: string, date: string) => string
  eyebrow: Record<StoryStep, string>
  // 1 · The spike
  spikeTitle: (hour: string, place: string) => string
  spikeOf: (compound: string, times: number, usual: string) => string
  spikeBody: string
  spanish: (pct: number, dist: string) => string
  spikeNext: string
  // 2 · Upwind
  upwindTitle: (n: number) => string
  wind: (dir: string, deg: number, mph: number) => string
  more: (n: number) => string
  noSource: string
  upwindNext: string
  // 3 · The record
  recordTitle: string
  rowDay: string
  rowOngoing: string
  rowAfter: (until: string) => string
  before30: string
  handWork: (spikes: number) => string
  howSearched: string
  result: string
  noMatch: string
  matched: string
  noReport: string
  reported: string
  pending: string
  caveatLead: string
  caveat: string
  recordNext: string
  // 4 · The question
  questionTitle: string
  showIn: string
  person: string
  openReplay: string
  bigNumber: string
  outOf: (spikes: number, monitors: number) => string
  seeAll: (n: number) => string
  again: string
}

export const STORY_COPY: Record<Lang, Copy> = {
  en: {
    enter: 'Story mode',
    enterSub: 'One real night, four screens',
    loading: 'Loading the story…',
    failed: 'The story could not load. Check the connection and try again.',
    retry: 'Try again',
    exit: 'Exit story',
    back: 'Back',
    progress: (n, of) => `Step ${n} of ${of}`,
    bar: (place, date) => `Story · ${place} · ${date}`,
    eyebrow: { spike: 'The spike', upwind: 'Upwind', record: 'The record', question: 'The question' },
    spikeTitle: (hour, place) => `At ${hour}, the air in ${place} spiked.`,
    spikeOf: (compound, times, usual) => `of ${compound}, about ${times}× its usual ${usual}`,
    spikeBody: 'A Texas state monitor recorded it, in the hourly readings the state publishes.',
    spanish: (pct, dist) => `${pct}% of residents within ${dist} of this monitor speak Spanish at home.`,
    spikeNext: 'Where did it come from?',
    upwindTitle: (n) => `${n} permitted facilities sit upwind.`,
    wind: (dir, deg, mph) => `Wind from the ${dir} (${deg}°) at ${mph} mph`,
    more: (n) => `${n} more, nearest first`,
    noSource: 'Wind direction alone can’t tell these apart, so we name no source.',
    upwindNext: 'Did any of them report it?',
    recordTitle: 'We searched every state report.',
    rowDay: 'Emissions-event reports starting that day in the county',
    rowOngoing: 'Earlier reports still running that night',
    rowAfter: (until) => `Reports starting just after midnight (by ${until})`,
    before30: '30 days before',
    handWork: (spikes) => `By hand, this is a 31-day search and a check of each upwind facility. The app did it for all ${spikes} spikes.`,
    howSearched: 'How we searched',
    result: 'Result',
    noMatch: 'No matching report',
    matched: 'A matching report was found',
    noReport: 'No report',
    reported: 'Reported',
    pending: 'Not checked yet',
    caveatLead: 'A question, not a finding.',
    caveat: 'Texas requires a report only above a reportable quantity, and air readings can’t measure how much was released.',
    recordNext: 'So who asks the state?',
    questionTitle: 'A person asks the state, in their own language.',
    showIn: 'Show the question in',
    person: 'A person reviews, edits and files it. Nothing is sent by the app.',
    openReplay: 'Review it in the full replay',
    bigNumber: 'spikes like this one: specific questions for the state that no public report answers.',
    outOf: (spikes, monitors) => `Out of ${spikes} spikes at ${monitors} Houston monitors, 2024–2025.`,
    seeAll: (n) => `See all ${n} questions`,
    again: 'Replay the story',
  },
  es: {
    enter: 'Modo historia',
    enterSub: 'Una noche real, cuatro pantallas',
    loading: 'Cargando la historia…',
    failed: 'No se pudo cargar la historia. Revise la conexión e intente de nuevo.',
    retry: 'Intentar de nuevo',
    exit: 'Salir de la historia',
    back: 'Atrás',
    progress: (n, of) => `Paso ${n} de ${of}`,
    bar: (place, date) => `Historia · ${place} · ${date}`,
    eyebrow: { spike: 'El pico', upwind: 'Viento arriba', record: 'El registro', question: 'La pregunta' },
    spikeTitle: (hour, place) => `A las ${hour}, el aire en ${place} tuvo un pico.`,
    spikeOf: (compound, times, usual) => `de ${compound}, unas ${times} veces su nivel usual de ${usual}`,
    spikeBody: 'Lo registró un monitor estatal de Texas, en las lecturas por hora que publica el estado.',
    spanish: (pct, dist) => `El ${pct}% de los residentes a menos de ${dist} de este monitor habla español en casa.`,
    spikeNext: '¿De dónde vino?',
    upwindTitle: (n) => `Hay ${n} instalaciones con permiso viento arriba.`,
    wind: (dir, deg, mph) => `Viento del ${dir} (${deg}°) a ${mph} mph`,
    more: (n) => `${n} más, de la más cercana a la más lejana`,
    noSource: 'La dirección del viento sola no permite distinguirlas, así que no nombramos una fuente.',
    upwindNext: '¿Alguna lo reportó?',
    recordTitle: 'Buscamos en todos los reportes estatales.',
    rowDay: 'Reportes de eventos de emisiones que empezaron ese día en el condado',
    rowOngoing: 'Reportes anteriores que seguían abiertos esa noche',
    rowAfter: (until) => `Reportes que empezaron justo después de la medianoche (hasta las ${until})`,
    before30: '30 días antes',
    handWork: (spikes) => `A mano, esto es una búsqueda de 31 días y revisar cada instalación viento arriba. La app lo hizo para los ${spikes} picos.`,
    howSearched: 'Cómo buscamos',
    result: 'Resultado',
    noMatch: 'Ningún reporte coincide',
    matched: 'Se encontró un reporte que coincide',
    noReport: 'Sin reporte',
    reported: 'Reportado',
    pending: 'Aún sin revisar',
    caveatLead: 'Una pregunta, no una conclusión.',
    caveat: 'Texas exige un reporte solo por encima de una cantidad reportable, y las lecturas del aire no pueden medir cuánto se liberó.',
    recordNext: 'Entonces, ¿quién le pregunta al estado?',
    questionTitle: 'Una persona le pregunta al estado, en su propio idioma.',
    showIn: 'Mostrar la pregunta en',
    person: 'Una persona la revisa, la edita y la presenta. La app no envía nada.',
    openReplay: 'Revisarla en la repetición completa',
    bigNumber: 'picos como este: preguntas concretas para el estado que ningún reporte público responde.',
    outOf: (spikes, monitors) => `De ${spikes} picos en ${monitors} monitores de Houston, 2024–2025.`,
    seeAll: (n) => `Ver las ${n} preguntas`,
    again: 'Repetir la historia',
  },
}
