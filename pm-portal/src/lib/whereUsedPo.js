// 역전개(사용처) 결과에 상위품목의 「고객사 PO 수량」을 붙인다 (2026-10-06)
//
//   이 부품이 실제로 얼마나 나가는지 보려면 상위품목이 얼마나 팔렸는지가 필요하다.
//   기준 (사용자 결정):
//     · 납기(약속일) 기준 — 오늘부터 거꾸로 3개월 · 6개월 · 12개월 안에 납기가 든 고객사 PO
//     · 완료(납품)된 PO 포함 · 취소는 제외
//     · 3rd party(동신 · 동원파츠) 발주분 포함 — 같은 고객사 PO 표에 들어 있다
//   상위품목 코드 = 품목 코드인 것만 잡힌다 (AXCELIS 처럼 PO 가 그 품번으로 오는 경우).
//   PO 가 품번으로 오지 않는 상위(Edwards BOM 이름 등)는 빈칸(—)으로 둔다.
import { supabase } from './supabase'
import { fetchAll } from './paginate'

const MAX_PARENTS = 300
const p2 = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
// 오늘에서 n 달 전 같은 날 (그 달에 없는 날이면 말일)
export function monthsAgo(today, n) {
  const [y, m, d] = today.split('-').map(Number)
  const first = new Date(y, m - 1 - n, 1)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return ymd(new Date(first.getFullYear(), first.getMonth(), Math.min(d, last)))
}
export const PO_SPANS = [['m3', 3, '3개월'], ['m6', 6, '6개월'], ['m12', 12, '1년']]

// rows: 납기가 (n달 전 날짜) 초과 ~ 오늘 이하인 것을 센다
export function sumByWindow(pos, today) {
  const from = Object.fromEntries(PO_SPANS.map(([k, n]) => [k, monthsAgo(today, n)]))
  const out = {}
  for (const p of pos) {
    if (p.status === '취소') continue
    const d = String(p.promise_date || '').slice(0, 10)
    if (!d || d > today) continue
    const q = Number(p.qty_ordered) || 0
    const o = (out[p.item_id] ||= { m3: 0, m6: 0, m12: 0 })
    for (const [k] of PO_SPANS) if (d > from[k]) o[k] += q
  }
  return out
}

export async function addPoQty(rows, today = ymd(new Date())) {
  if (!rows?.length) return rows || []
  const pcodes = [...new Set(rows.map((r) => r.parent_code).filter(Boolean))]
  if (!pcodes.length || pcodes.length > MAX_PARENTS) return rows
  const idOf = {}
  for (let i = 0; i < pcodes.length; i += 200) {
    const { data, error } = await supabase.from('items').select('id,std_code').in('std_code', pcodes.slice(i, i + 200))
    if (error) throw error
    ;(data || []).forEach((x) => { idOf[x.std_code] = x.id })
  }
  const ids = [...new Set(Object.values(idOf))]
  if (!ids.length) return rows
  const start = monthsAgo(today, 12)
  const pos = []
  for (let i = 0; i < ids.length; i += 100) {
    // 취소는 조회가 아니라 계산에서 뺀다 — .neq 는 상태가 빈 줄까지 떨어뜨린다
    const part = await fetchAll(() => supabase.from('purchase_orders')
      .select('id,item_id,qty_ordered,promise_date,status')
      .eq('order_type', 'customer_po').in('item_id', ids.slice(i, i + 100))
      .gte('promise_date', start).lte('promise_date', today).order('id'))
    pos.push(...part)
  }
  const sum = sumByWindow(pos, today)
  return rows.map((r) => {
    const id = idOf[r.parent_code]
    return id ? { ...r, po: sum[id] || { m3: 0, m6: 0, m12: 0 } } : r
  })
}

// 부품 소요 = 대당 소요 × 상위 PO 수량 (대당 소요를 못 구했으면 BOM 수량으로)
export const partDemand = (r, k) => (r.po ? (Number(r.eff ?? r.qty) || 0) * (r.po[k] || 0) : null)
