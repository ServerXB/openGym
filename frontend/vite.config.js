import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildServiceWorker } from './scripts/build-service-worker.mjs'

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'
const media = process.env.MEDIA_TARGET || 'http://127.0.0.1:8888'
const root = path.dirname(fileURLToPath(import.meta.url))

function offlineShell() {
  return {
    name: 'opengym-offline-shell',
    apply: 'build',
    async closeBundle() {
      await buildServiceWorker({
        outputDirectory: path.join(root, 'dist'),
        templateFile: path.join(root, 'public', 'sw.js')
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), offlineShell()],
  base: './',
  server: {
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/img': { target: media, changeOrigin: true },
      '/gif': { target: media, changeOrigin: true }
    }
  },
  build: { chunkSizeWarningLimit: 1500 }
})
