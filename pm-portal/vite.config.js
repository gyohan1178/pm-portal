import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync } from 'fs'
import { resolve } from 'path'

// Cloudflare Pages SPA: 빌드 후 index.html을 404.html로 복사.
// 존재하지 않는 경로(/board 등)로 들어오면 Cloudflare가 404.html을 주는데,
// 그게 index.html과 동일 → 앱이 정상 렌더 → React Router가 경로 처리.
// location.replace 같은 '튕김'이 없어 #426(suspend) 오류가 안 남.
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'spa-404-fallback',
      closeBundle() {
        try {
          copyFileSync(resolve(__dirname, 'dist/index.html'), resolve(__dirname, 'dist/404.html'))
          console.log('✓ dist/404.html = index.html 복사 완료 (SPA fallback)')
        } catch (e) { console.warn('404 복사 스킵:', e.message) }
      },
    },
  ],
  base: '/',
})
