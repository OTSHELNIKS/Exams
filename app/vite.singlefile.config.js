import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Однофайловая сборка для просмотра внутри чата (Arena file viewer):
// весь JS, CSS, шрифты и картинки встраиваются в один HTML.
// Запуск: npm run build:singlefile  ->  app/dist-singlefile/index.html
export default defineConfig({
  plugins: [react(), viteSingleFile({ useRecommendedBuildConfig: true })],
  build: {
    outDir: 'dist-singlefile',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 5000,
  },
})
