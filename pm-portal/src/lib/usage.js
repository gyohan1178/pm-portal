// 사용 기록 (v4.188.0) — 어떤 화면 · 버튼을 얼마나 쓰는지 「횟수만」 센다 (안 쓰는 버튼 · 메뉴를 정리하려고)
//   · 누른 내용 · 입력값은 남기지 않는다. 하루 · 사람 · 화면 · 버튼 이름마다 횟수 한 줄
//   · 브라우저에 모아 두었다가 1분에 한 번(또는 화면을 떠날 때) 한꺼번에 보낸다 → 화면 속도에 영향 없음
//   · 표가 없으면(SQL 전) 조용히 넘어가고 그날은 다시 시도하지 않는다
import { supabase } from './supabase'

const buf = new Map()        // 'kind|page|key' → 횟수
let off = false, timer = null, started = false

// 주소에서 낱개 id 는 지운다 — /quality/fa/3f2a… → /quality/fa/:id (고객사 코드는 남김)
export const pageKey = (pathname) => String(pathname || '/').replace(/\/+$/, '').replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id').replace(/\/\d{3,}(?=\/|$)/g, '/:n') || '/'
// 버튼 이름 — 숫자(건수 · 날짜)는 지워 같은 버튼이 한 줄로 모이게, 30자까지
export const btnKey = (el) => {
  const raw = el.getAttribute('data-usage') || el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || ''
  return raw.replace(/[\d,.]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 30)
}

function add(kind, page, key) {
  if (off || !key) return
  const k = `${kind}|${page}|${key}`
  buf.set(k, (buf.get(k) || 0) + 1)
  if (buf.size > 300) flush()
}
let curPage = null          // 지금 화면 (라우터가 알려 준 주소) — 버튼을 이 화면 것으로 센다
export const currentPage = () => curPage || pageKey(window.location.pathname)
export function trackPage(pathname) { curPage = pageKey(pathname); add('page', curPage, curPage) }

export async function flush() {
  if (off || !buf.size) return
  const rows = [...buf.entries()].map(([k, n]) => { const [kind, page, ...rest] = k.split('|'); return { kind, page, key: rest.join('|'), n } })
  buf.clear()
  try {
    const { error } = await supabase.rpc('pm_usage_add', { p_rows: rows })
    if (error) off = true      // 함수가 없거나 권한이 없다 — 이번 접속에선 그만
  } catch { off = true }
}

// 한 번만 건다 — 버튼 · 링크 · 탭 누르기
export function startUsage() {
  if (started || typeof document === 'undefined') return
  started = true
  document.addEventListener('click', (e) => {
    const el = e.target?.closest?.('button, [role="button"], [role="tab"], a[href]')
    if (!el || el.closest('[data-usage-skip]')) return
    add(el.tagName === 'A' ? 'link' : 'btn', curPage || pageKey(window.location.pathname), btnKey(el))
  }, { capture: true, passive: true })
  timer = setInterval(flush, 60000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
  window.addEventListener('pagehide', flush)
}
export const _test = { buf, reset: () => { buf.clear(); off = false } }
