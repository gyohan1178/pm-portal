// 내 오늘 할 일 — 자동 모음 (v4.191.0)
//   할 일은 사람이 적어야만 생겼다. 매일 아침 챙길 것(오늘 들어올 발주 · 지난 입고 · 회신 · 자재 요청)은
//   이미 포털에 있는 숫자라, 할 일 화면 맨 위에 모아 보여 준다 (새 표 없음 · 읽기만)
//   발주는 「내 고객사」로 좁힐 수 있다 — 팀 업무가 고객사별로 나뉘어 있어서
import { supabase } from './supabase'
import { fetchAll } from './paginate'

const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
// 이번 주 일요일 (월요일 시작)
export const weekEndOf = (today) => { const w = new Date(`${today}T12:00:00Z`).getUTCDay() || 7; return addDays(today, 7 - w) }

// 계산만 (시험용) — rows: 미입고 발주 [{id, customer_id, promise_date, vendor_date}] · 받을 날 = 협력사 변경일이 있으면 그 날
export function tallyPo(rows, today, customerId = null) {
  const end = weekEndOf(today), out = { today: 0, late: 0, week: 0 }
  const seen = new Set()
  for (const r of rows || []) {
    if (!r || seen.has(r.id)) continue
    seen.add(r.id)
    if (customerId && r.customer_id !== customerId) continue
    const due = r.vendor_date || r.promise_date
    if (!due) continue
    if (due < today) out.late++
    else if (due === today) out.today++
    else if (due <= end) out.week++
  }
  return out
}

// 이번 주까지 받을 미입고 발주 — 요청 납기 기준 + 협력사 변경일 기준 둘 다 받아 합친다 (변경일이 당겨진 줄을 놓치지 않게)
export async function fetchDuePo(today) {
  const end = weekEndOf(today)
  const base = (col) => () => supabase.from('purchase_orders').select('id,customer_id,promise_date,vendor_date')
    .eq('order_type', 'purchase').not('status', 'in', '(완료,취소)').lte(col, end).order('id')
  const [a, b] = await Promise.all([fetchAll(base('promise_date')), fetchAll(base('vendor_date')).catch(() => [])])
  return [...a, ...b]
}
