import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider, MutationCache, QueryCache } from '@tanstack/react-query'
import App from './App'
import Toaster from './components/Toaster'
import { toast } from './lib/toast'
import './index.css'

// 배포 직후 옛 캐시가 새 조각을 못 찾을 때(404) 자동 새로고침 — 사용자는 에러 대신 최신 화면을 봄
window.addEventListener('vite:preloadError', () => {
  window.location.reload()
})

const queryClient = new QueryClient({
  // 전역 오류 표면화 — 어떤 화면이든 작업/불러오기 실패가 조용히 묻히지 않게
  mutationCache: new MutationCache({
    onError: (err) => toast(err?.message || '작업 중 오류가 발생했습니다', 'error'),
  }),
  queryCache: new QueryCache({
    onError: (err) => toast(err?.message || '데이터 불러오기 오류', 'error'),
  }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5분
      retry: 1,
      refetchOnWindowFocus: false, // 창/탭 전환마다 재조회 방지 — 전환 즉각화 (mutation·수동갱신으로 신선도 유지)
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  </React.StrictMode>
)
