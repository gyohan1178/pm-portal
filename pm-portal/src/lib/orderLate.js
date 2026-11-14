// 수주대장 — 미납 사유 (v4.190.0)
//   납기가 지났는데 아직 안 나간 줄에 「왜 못 나갔는지」를 붙인다.
//   영업이 미루는 건과 자재 · 제작 · 검수 때문에 못 나가는 건을 갈라 보려는 것 (사유별 숫자 · 거르기)
//   표 pm_order_late (수주대장_미납사유_반영_261114.sql) — 표가 없으면 화면은 예전 그대로 (사유 칸만 안 보임)
import { supabase } from './supabase'
import { fetchAll } from './paginate'
import { logActivity } from './activityLog'

export const LATE_REASONS = ['자재 부족', '제작 지연', '검수 대기', '납품만 남음', '고객사 협의 중', '기타']
export const LATE_NONE = '사유 없음'
// 누가 풀어야 하는 일인지 — 사유별 색 (구매자재 · 제조 · 품질 · 영업)
export const LATE_TONE = {
  '자재 부족': 'bg-amber-50 text-amber-700 border-amber-200', '제작 지연': 'bg-blue-50 text-blue-700 border-blue-200',
  '검수 대기': 'bg-emerald-50 text-emerald-700 border-emerald-200', '납품만 남음': 'bg-red-50 text-red-600 border-red-200',
  '고객사 협의 중': 'bg-violet-50 text-violet-700 border-violet-200', 기타: 'bg-slate-100 text-slate-600 border-slate-200',
}
export const LATE_OWNER = { '자재 부족': '구매자재', '제작 지연': '제조', '검수 대기': '품질', '납품만 남음': '영업', '고객사 협의 중': '영업' }
export const LATE_SQL_HINT = '미납 사유 표가 아직 없습니다 — Supabase SQL Editor 에서 수주대장_미납사유_반영_261114.sql 을 먼저 실행하세요'

const missing = (e) => e && (e.code === '42P01' || e.code === 'PGRST205' || (/pm_order_late/.test(e.message || '') && /does not exist|not find|schema cache/i.test(e.message || '')))

// 줄 id → { reason, memo, set_name, set_at } · 표가 없으면 null (화면이 사유 칸을 숨긴다)
export async function fetchLateMap() {
  let rows
  try {
    rows = await fetchAll(() => supabase.from('pm_order_late').select('line_id,reason,memo,set_name,set_at').order('line_id'))
  } catch (e) {
    if (missing(e)) return null
    throw e
  }
  return new Map(rows.map((r) => [r.line_id, r]))
}

// 사유 넣기 · 바꾸기 · 지우기(reason 빈 값) — 고른 줄에 한꺼번에. 변경 이력에 줄마다 남긴다
//   prevMap: 지금 화면의 사유(이력의 「전」 값) · 반환 rows 로 화면만 고친다
export async function setLateReason(lines, reason, memo, meName, prevMap) {
  if (!lines.length) throw new Error('납기 지난 줄을 고르세요')
  const r = String(reason || '').trim()
  if (r && !LATE_REASONS.includes(r)) throw new Error('사유를 목록에서 고르세요')
  const m = String(memo || '').trim() || null
  const now = new Date().toISOString()
  const ids = lines.map((l) => l.id)
  if (r) {
    const rows = ids.map((id) => ({ line_id: id, reason: r, memo: m, set_name: meName || null, set_at: now }))
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from('pm_order_late').upsert(rows.slice(i, i + 200), { onConflict: 'line_id' })
      if (error) throw new Error(missing(error) ? LATE_SQL_HINT : error.message)
    }
  } else {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await supabase.from('pm_order_late').delete().in('line_id', ids.slice(i, i + 200))
      if (error) throw new Error(missing(error) ? LATE_SQL_HINT : error.message)
    }
  }
  const txt = (x) => (x?.reason ? `${x.reason}${x.memo ? ` · ${x.memo}` : ''}` : null)
  const after = r ? txt({ reason: r, memo: m }) : null
  const logs = lines.filter((l) => txt(prevMap?.get(l.id)) !== after)
    .map((l) => ({ order_id: l.order_id, line_key: `${l.line_no}/${l.del_line}`, field: 'late_reason', before_val: txt(prevMap?.get(l.id)), after_val: after, source: 'manual', changed_name: meName || null }))
  for (let i = 0; i < logs.length; i += 500) {
    const { error } = await supabase.from('pm_order_change').insert(logs.slice(i, i + 500))
    if (error) throw error
  }
  const pos = [...new Set(lines.map((l) => l.o?.po_no).filter(Boolean))]
  logActivity('update', 'pm_order', pos.slice(0, 5).join(', ') + (pos.length > 5 ? ` 외 ${pos.length - 5}건` : ''), `미납 사유 ${r ? `「${r}」` : '지움'} · ${ids.length}품목`)
  return { ids, row: r ? { reason: r, memo: m, set_name: meName || null, set_at: now } : null }
}

// 사유별 집계 — [{ reason, n, pos }] (목록 차례 + 사유 없음 맨 뒤 · 0건은 뺀다)
export function lateSummary(lateLines, map) {
  const by = new Map()
  for (const l of lateLines) {
    const k = map?.get(l.id)?.reason || LATE_NONE
    const x = by.get(k) || { reason: k, n: 0, po: new Set() }
    x.n++; x.po.add(l.order_id); by.set(k, x)
  }
  return [...LATE_REASONS, LATE_NONE].filter((k) => by.has(k)).map((k) => ({ reason: k, n: by.get(k).n, pos: by.get(k).po.size }))
}

// PO 확인 처리 — 고른 줄의 PO 중 아직 확인 안 된 것만 「확인했음」 (회신 없이 접수만 확인할 때 · 한꺼번에)
//   반환 ids: 이번에 실제로 확인된 PO (되돌릴 때 이것만 다시 미확인으로)
export async function confirmOrders(orderIds, meName) {
  const ids = [...new Set(orderIds)]
  if (!ids.length) throw new Error('확인할 PO 가 없습니다')
  const now = new Date().toISOString()
  const done = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('pm_order').update({ confirmed_at: now, confirmed_name: meName || null, updated_at: now }).in('id', ids.slice(i, i + 200)).is('confirmed_at', null).select('id,po_no')
    if (error) throw error
    done.push(...(data || []))
  }
  if (done.length) logActivity('update', 'pm_order', done.slice(0, 5).map((d) => d.po_no).join(', ') + (done.length > 5 ? ` 외 ${done.length - 5}건` : ''), `PO 확인 처리 ${done.length}건`)
  return { ids: done.map((d) => d.id), head: { confirmed_at: now, confirmed_name: meName || null } }
}
export async function unconfirmOrders(ids) {
  if (!ids.length) return
  const now = new Date().toISOString()
  const { error } = await supabase.from('pm_order').update({ confirmed_at: null, confirmed_name: null, updated_at: now }).in('id', ids)
  if (error) throw error
}
