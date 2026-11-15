// Everything the replay map uses from deck.gl, behind one dynamic import that EventMap.tsx runs after its basemap's
// first render (deckGate.ts says when).
export { Deck, MapView } from '@deck.gl/core'
export { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
