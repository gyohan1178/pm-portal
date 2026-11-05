import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider, MutationCache, QueryCache } from '@tanstack/react-query'
import App from './App'
import Toaster from './components/Toaster'
import { toast } from './lib/toast'
import './index.css'
import { initScale } from './lib/viewPrefs'
import { isNetErr, reportNetFail, reportNetOk, queryRetry, queryRetryDelay } from './lib/netStatus'

// 화면 크기 (노트북이면 조금 작게) — 첫 화면부터 맞춘다 (v4.63.0)
initScale()

// 배포 직후 옛 캐시가 새 조각을 못 찾을 때(404) 자동 새로고침 — 사용자는 에러 대신 최신 화면을 봄
window.addEventListener('vite:preloadError', () => {
  window.location.reload()
})

const queryClient = new QueryClient({
  // 전역 오류 표면화 — 어떤 화면이든 작업/불러오기 실패가 조용히 묻히지 않게
  mutationCache: new MutationCache({
    // 화면에서 직접 오류를 알리는 작업(onError 있음)은 여기서 또 띄우지 않는다 — 같은 오류가 두 번 뜨던 문제
    onError: (err, _v, _c, mutation) => {
      // 인터넷 끊김 (v4.154.0) — 위 「⚠ 인터넷 불안정」 줄을 켜고, 저장이 안 됐다고 알아듣게
      if (isNetErr(err)) reportNetFail()
      if (mutation?.options?.onError) return
      toast(isNetErr(err) ? '인터넷이 불안정해 저장하지 못했습니다 — 연결을 확인하고 다시 눌러 주세요' : (err?.message || '작업 중 오류가 발생했습니다'), 'error')
    },
    onSuccess: () => reportNetOk(),
  }),
  queryCache: new QueryCache({
    // 인터넷 끊김은 알림 대신 위 줄로 (다시 시도까지 다 실패한 뒤에만 옴) — 화면마다 빨간 알림이 쏟아지지 않게
    onError: (err) => { if (isNetErr(err)) { reportNetFail(); return } toast(err?.message || '데이터 불러오기 오류', 'error') },
    onSuccess: () => reportNetOk(),
  }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5분
      retry: queryRetry,            // 인터넷 끊김이면 3번까지 (1 · 2 · 4초 뒤) · 서버 오류는 예전처럼 1번 (v4.154.0)
      retryDelay: queryRetryDelay,
      refetchOnWindowFocus: false, // 창/탭 전환마다 재조회 방지 — 전환 즉각화 (mutation·수동갱신으로 신선도 유지)
    },
  },
})

// 저장 뒤 갱신 — invalidateQueries(['키']) 처럼 배열로 부르면 React Query v5 는
//   키를 보지 않고 「열려 있는 쿼리 전부」를 다시 받는다. 화면 사이 갱신 누락을 메워 주고 있어 그대로 두되,
//   업무 자료와 무관한 사이드바 알림 · 로그인 정보는 저장할 때마다 다시 받지 않는다.
//   (알림은 10분마다 · 요청 화면에서 따로 갱신된다)
const SKIP_ON_SAVE = new Set(['menuAlerts', 'profile', 'me', 'myRoleLite', 'myProfile', 'customers', 'dbUsage', 'tableSizes'])
const origInvalidate = queryClient.invalidateQueries.bind(queryClient)
queryClient.invalidateQueries = (filters, options) => {
  if (Array.isArray(filters)) {
    return origInvalidate({ predicate: q => !SKIP_ON_SAVE.has(q.queryKey?.[0]) }, options)
  }
  return origInvalidate(filters, options)
}

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
