// 역전개(사용처) 결과에 상위품목의 「고객사 PO 수량」을 붙인다 (2026-10-06)
//
//   이 부품이 실제로 얼마나 나가는지 보려면 상위품목이 얼마나 팔렸는지가 필요하다.
//   기준 (사용자 결정):
//     · 납기(약속일) 기준 — 오늘부터 거꾸로 3개월 · 6개월 · 12개월 안에 납기가 든 고객사 PO
//     · 완료(납품)된 PO 포함 · 취소는 제외
//     · 3rd party(동신 · 동원파츠) 발주분 포함 — 같은 고객사 PO 표에 들어 있다
//   과거 납품분 — 포털 고객사 PO 는 2026-06 부터만 있다. 그 전 것은 「매출 실적 업로드(Received)」로 올린
//     pm_sales 에 있다 (매출 대시보드가 쓰는 표). 둘을 합치되 같은 PO 줄(품번 · PO · 라인)은 한 번만 센다.
//     pm_sales 는 현황이 「납품 완료 · 발송 완료」인 줄만 센다 (발주 취소 · 빈칸은 제외).
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
      .select('id,item_id,po_number,order_line,del_line,qty_ordered,promise_date,status')
      .eq('order_type', 'customer_po').in('item_id', ids.slice(i, i + 100))
      .gte('promise_date', start).lte('promise_date', today).order('id'))
    pos.push(...part)
  }
  // 과거 납품 실적(pm_sales) — 포털 PO 에 없는 줄만 더한다
  try { pos.push(...await salesRows(idOf, pos, start, today)) } catch { /* 실적 표를 못 읽으면 포털 PO 만 */ }
  const sum = sumByWindow(pos, today)
  return rows.map((r) => {
    const id = idOf[r.parent_code]
    return id ? { ...r, po: sum[id] || { m3: 0, m6: 0, m12: 0 } } : r
  })
}

const bare = (code) => String(code || '').replace(/^AX-/, '')
const lineKey = (pn, po, ol, dl) => `${pn}|${String(po || '').trim()}|${String(ol ?? '').trim()}|${String(dl ?? '').trim()}`
export const isDelivered = (note) => /(납품|발송)\s*완료/.test(String(note || ''))
async function salesRows(idOf, pos, start, today) {
  const codeOf = Object.fromEntries(Object.entries(idOf).map(([code, id]) => [id, code]))
  const have = new Set(pos.map((p) => lineKey(bare(codeOf[p.item_id]), p.po_number, p.order_line, p.del_line)))
  const byPn = {}
  Object.entries(idOf).forEach(([code, id]) => { if (/^AX-/.test(code)) byPn[bare(code)] = id })
  const pns = Object.keys(byPn)
  const out = []
  for (let i = 0; i < pns.length; i += 100) {
    const part = await fetchAll(() => supabase.from('pm_sales')
      .select('part_no,po_number,order_line,del_line,qty,promise_date,status_note')
      .in('part_no', pns.slice(i, i + 100))
      .gte('promise_date', start).lte('promise_date', today)
      .order('po_number').order('order_line').order('del_line').order('part_no'))
    for (const r of part) {
      if (!isDelivered(r.status_note)) continue
      const k = lineKey(r.part_no, r.po_number, r.order_line, r.del_line)
      if (have.has(k)) continue
      have.add(k)
      out.push({ item_id: byPn[r.part_no], qty_ordered: r.qty, promise_date: r.promise_date, status: '완료', _sales: true })
    }
  }
  return out
}

// 부품 소요 = 대당 소요 × 상위 PO 수량 (대당 소요를 못 구했으면 BOM 수량으로)
export const partDemand = (r, k) => (r.po ? (Number(r.eff ?? r.qty) || 0) * (r.po[k] || 0) : null)
