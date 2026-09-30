import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/app/',
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ''),
      },
      '/farms':            { target: 'http://localhost:8000', changeOrigin: true },
      '/fleet':            { target: 'http://localhost:8000', changeOrigin: true },
      '/options':          { target: 'http://localhost:8000', changeOrigin: true },
      '/validation':       { target: 'http://localhost:8000', changeOrigin: true },
      '/coverage':         { target: 'http://localhost:8000', changeOrigin: true },
      '/feedback':         { target: 'http://localhost:8000', changeOrigin: true },
      '/figures':          { target: 'http://localhost:8000', changeOrigin: true },
      '/feeder-schedule':  { target: 'http://localhost:8000', changeOrigin: true },
      '/what-if':          { target: 'http://localhost:8000', changeOrigin: true },
      '/advisory':         { target: 'http://localhost:8000', changeOrigin: true },
      '/predict':          { target: 'http://localhost:8000', changeOrigin: true },
      '/irrigation-plan':  { target: 'http://localhost:8000', changeOrigin: true },
      '/health':           { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
