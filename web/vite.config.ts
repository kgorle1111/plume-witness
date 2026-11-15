import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // The lazy map was one 1.8 MB chunk. MapLibre gets its own chunk so it downloads in parallel with
        // deck.gl + the app's map code, and stays cached when only app code changes. deck.gl is left in the
        // EventMap chunk: grouping it pulled Vite's preload helper into that group (the entry then loaded
        // deck.gl on first paint), and opting out of dependency pulling broke deck.gl's module init order.
        codeSplitting: {
          groups: [{ name: 'maplibre', test: /node_modules[\\/]maplibre-gl/ }],
        },
      },
    },
    // MapLibre alone is ~1.07 MB minified (~290 kB gzip) and can't be split further; it is lazy and off the
    // first paint, so warn only above that.
    chunkSizeWarningLimit: 1100,
  },
})
