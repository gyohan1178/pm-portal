import { supabase } from './supabase'

// 자재 요청 타당성 표시 (v4.234.0) — 요청하는 사람 · 처리하는 사람이 같이 본다
//   · 직전 요청: 같은 품목을 최근 120일 안에 요청한 것 중 이번 요청 전 가장 최근 (반려 제외)
//   · BOM 1세트분: 그 품목이 들어가는 어셈블리를 1대씩 만들 때 드는 수량 합 (bom.qty_per_unit 합)
//   주황 기준: 직전 요청 뒤 30일 안에 또 · 또는 BOM 1세트분의 20배 이상
//   ⚠ 공용볼트처럼 BOM 과 1:1 이 아닌 소모품은 참고 숫자 — 막지 않고 보여만 준다
export const MR_RECENT_DAYS = 30
export const MR_BOM_X = 20

export async function fetchMrCheck(itemIds) {
  const ids = [...new Set((itemIds || []).filter(Boolean))]
  const reqs = {}, bom = {}
  if (!ids.length) return { reqs, bom }
  const since = new Date(Date.now() - 120 * 86400000).toISOString()
  for (let i = 0; i < ids.length; i += 150) {
    const part = ids.slice(i, i + 150)
    const [a, b] = await Promise.all([
      supabase.from('pm_material_request').select('item_id,req_no,qty,issued_qty,status,created_at,requester_name')
        .in('item_id', part).gte('created_at', since).order('created_at', { ascending: false }).limit(1000),
      supabase.from('bom').select('item_id,qty_per_unit').in('item_id', part).limit(5000),
    ])
    ;(a.data || []).forEach((r) => { (reqs[r.item_id] ||= []).push(r) })
    ;(b.data || []).forEach((r) => { bom[r.item_id] = (bom[r.item_id] || 0) + (Number(r.qty_per_unit) || 0) })
  }
  return { reqs, bom }
}

const day = (v) => String(v || '').slice(0, 10)
const diffDays = (a, b) => Math.round((new Date(day(a)) - new Date(day(b))) / 86400000)

// 한 줄 판정 — at: 이번 요청 날짜(없으면 오늘) · reqNo: 이번 요청 번호(같은 요청은 빼고 본다)
export function judgeMr(data, itemId, qty, at, reqNo) {
  if (!data || !itemId) return null
  const when = day(at) || new Date().toISOString().slice(0, 10)
  const skip = new Set(Array.isArray(reqNo) ? reqNo : [reqNo])   // 묶음이면 그 안 요청들은 빼고 본다
  const prev = (data.reqs[itemId] || []).find((r) => !skip.has(r.req_no) && r.status !== '반려' && day(r.created_at) <= when)
  const bomSet = data.bom[itemId] || 0
  const q = Number(qty) || 0
  const gap = prev ? diffDays(when, prev.created_at) : null
  const recent = prev && gap != null && gap <= MR_RECENT_DAYS
  const times = bomSet > 0 && q > 0 ? q / bomSet : null
  const big = times != null && times >= MR_BOM_X
  return { prev, gap, recent, bomSet, times, big, warn: !!(recent || big) }
}

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')
// 화면에 쓸 짧은 글 — [직전 요청, BOM 배수]
export function mrCheckText(j) {
  if (!j) return []
  const out = []
  if (j.prev) out.push({ warn: j.recent, t: `직전 ${day(j.prev.created_at).slice(5)} ${n(j.prev.qty)}개${j.gap != null ? ` (${j.gap}일 전)` : ''}${j.prev.status && j.prev.status !== '완료' ? ` · ${j.prev.status}` : ''}` })
  else out.push({ warn: false, t: '최근 120일 요청 없음' })
  if (j.times != null) out.push({ warn: j.big, t: `BOM 1세트 ${n(j.bomSet)} · ${j.times >= 10 ? Math.round(j.times) : j.times.toFixed(1)}배` })
  return out
}
