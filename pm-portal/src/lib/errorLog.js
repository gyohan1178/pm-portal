// 오류 기록 (v4.196.0) — 화면이 죽거나 처리 안 된 오류가 나면 「언제 · 누가 · 어느 화면 · 무슨 오류」를 남긴다
//   · 입력값 · 자료 내용은 남기지 않는다 (오류 문구 · 화면 주소 · 버전 · 브라우저만)
//   · 같은 오류는 한 접속에 한 번, 한 접속에 20건까지만 — 오류가 반복돼도 기록이 쏟아지지 않게
//   · 표가 없으면(SQL 전) 조용히 넘어가고 이번 접속에선 다시 시도하지 않는다
import { supabase } from './supabase'
import { APP_VERSION } from './version'
import { currentPage, pageKey } from './usage'
import { isNetErr } from './netStatus'

let off = false, sent = 0, started = false
const seen = new Set()
const MAX = 20

// 배포 직후 옛 화면이 새 조각을 못 찾는 오류 — 고장이 아니라 새로고침하면 풀린다
export const isChunkErr = (e) => /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i.test(String(e?.message || e || ''))

export function reportError(err, { kind = 'error', where = '', page = null } = {}) {
  try {
    if (off || sent >= MAX) return
    const msg = String(err?.message || err || '').slice(0, 300)
    if (!msg || /ResizeObserver loop/i.test(msg)) return      // 브라우저가 내는 무해한 알림
    const key = kind + '|' + msg
    if (seen.has(key)) return
    seen.add(key); sent++
    const row = {
      kind, message: msg,
      stack: String(err?.stack || '').slice(0, 1500),
      page: page ? pageKey(page) : currentPage(),
      where_at: String(where || '').slice(0, 300),
      version: APP_VERSION,
      agent: String(navigator.userAgent || '').slice(0, 200),
    }
    Promise.resolve(supabase.rpc('pm_error_add', { p_row: row })).then(({ error }) => { if (error) off = true }).catch(() => { off = true })
  } catch { /* 기록하다 난 오류로 화면을 또 죽이지 않는다 */ }
}

// 없어도 화면이 도는 보조 자료를 못 읽었을 때 — 화면은 그대로 두되(null 로 넘김) 기록은 남긴다
//   예전에는 .catch(() => null) 로 아무 흔적 없이 넘어가서, 계속 실패해도 알 길이 없었다
//   인터넷 끊김은 위 「⚠ 인터넷 불안정」 줄이 알려 주므로 기록하지 않는다
export const swallow = (where) => (err) => { if (!isNetErr(err)) reportError(err, { kind: 'quiet', where }); return null }

// 한 번만 건다 — 어디서도 잡지 않은 오류
export function startErrorLog() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('error', (e) => { if (e?.error || e?.message) reportError(e.error || e.message, { kind: 'window' }) })
  window.addEventListener('unhandledrejection', (e) => { reportError(e?.reason, { kind: 'promise' }) })
}
export const _test = { reset: () => { off = false; sent = 0; seen.clear() } }
