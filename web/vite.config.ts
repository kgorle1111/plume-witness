import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The brief view imports ../docs/brief.md; let the dev server read that one folder outside web/.
  server: { fs: { allow: ['.', '../docs'] } },
})
