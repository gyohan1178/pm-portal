import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cloudflare Pages: 루트(/) 배포. base를 '/'로 — main.jsx의 basename이 이 값을 따라감
export default defineConfig({
  plugins: [react()],
  base: '/',
})
