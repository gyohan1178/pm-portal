// 수주대장 이관분 「납기에 맞춰 공급된 것으로」 (v4.108.0)
//   엑셀 · AX PO 파일로 옮겨 온 PO 중 2026-10-29 전에 들어온 줄은 납기일이 지나면 그날 납품 · 판매입력 끝난 것으로 표시한다.
//   서버 함수 pm_order_deliver_legacy() (수주대장_이관분납품_반영_261028.sql) 가 처리하고 기록을 남긴다.
//   이 브라우저에서 하루 한 번만 부른다 — 사이드바 · 업무 흐름 숫자를 받기 전 · 수주대장을 받기 전.
//   함수가 없거나(SQL 전) 실패해도 조용히 넘어간다 (화면은 그대로 그려야 한다).
import { supabase } from './supabase'

const KEY = 'pm_legacy_dlv_day'
const dayKST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
let inflight = null

export function autoDeliverLegacy() {
  const day = dayKST()
  try { if (localStorage.getItem(KEY) === day) return Promise.resolve(0) } catch { /* 저장 안 되는 브라우저 — 그래도 부른다 */ }
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const { data, error } = await supabase.rpc('pm_order_deliver_legacy')
      if (error) return 0
      try { localStorage.setItem(KEY, day) } catch { /* noop */ }
      return Number(data) || 0
    } catch { return 0 } finally { inflight = null }
  })()
  return inflight
}
