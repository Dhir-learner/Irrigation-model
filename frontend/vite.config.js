import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// API routes served by FastAPI. Both `npm run dev` and `npm run preview` proxy them,
// so the UI works on :3000 / :4173 while uvicorn runs on API_TARGET (default :8000).
const API_ROUTES = [
  '/farms', '/fleet', '/options', '/validation', '/coverage', '/feedback', '/figures',
  '/feeder-schedule', '/what-if', '/advisory', '/predict', '/irrigation-plan', '/health', '/model-info',
]

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.API_TARGET || 'http://localhost:8000'
  const proxy = Object.fromEntries(API_ROUTES.map(route => [route, { target, changeOrigin: true }]))
  return {
    plugins: [react()],
    base: '/app/',
    server: { port: 3000, proxy },
    preview: { port: 4173, proxy },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 1200,
    },
  }
})
