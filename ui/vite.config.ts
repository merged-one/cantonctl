import * as path from 'node:path'

import react from '@vitejs/plugin-react'
import {defineConfig} from 'vite'

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: path.resolve(__dirname, '../dist/ui'),
  },
  plugins: [react()],
  root: __dirname,
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
})
