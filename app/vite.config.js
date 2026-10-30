import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE нужен для хостингов с подпапкой (GitHub Pages отдаёт сайт
// с /<репозиторий>/, поэтому в CI задаём VITE_BASE=/Exams/).
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
})
