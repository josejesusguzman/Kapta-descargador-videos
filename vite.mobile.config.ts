// Build de la interfaz para Android (Capacitor): la misma app de src/renderer con la entrada de src/mobile.
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: resolve('src/mobile'),
  base: './',
  resolve: { alias: { '@shared': resolve('src/shared') } },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve('out/mobile'),
    emptyOutDir: true,
    target: 'chrome110'
  }
})
