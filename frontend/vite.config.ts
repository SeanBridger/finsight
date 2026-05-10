import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/documents/': 'http://localhost:8000',
      '/research': 'http://localhost:8000',
      '/chat': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      '/sessions': 'http://localhost:8000',
      '/metrics': 'http://localhost:8000',
      '/guardrail': 'http://localhost:8000',
    },
  },
})