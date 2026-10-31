import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE нужен для хостингов с подпапкой (GitHub Pages отдаёт сайт
// с /<репозиторий>/, поэтому в CI задаём VITE_BASE=/Exams/).
// VITE_NATIVE=1 — сборка внутрь мобильного приложения (Capacitor): там файлы
// лежат рядом с index.html, поэтому все пути должны быть относительными ('./'),
// иначе WebView ищет /assets/... в корне файловой системы и получает белый экран.
export default defineConfig({
  base: process.env.VITE_NATIVE ? './' : (process.env.VITE_BASE || '/'),
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
