import { supabase } from './supabase'
import { must } from './db'
import { logActivity } from './activityLog'

// 고객사 PO 「자재불출」 표시 — 하네스 출도 · 불출 화면과 다품목 출고(넘겨받은 줄)가 같이 쓴다 (v4.57.0)
//   · purchase_orders.material_issued 를 켜고/끄고, 고객사 PO 화면 토글과 같게 연결된 생산 호기(po_id) part_issue 도 맞춘다
//   · 표시만 한다 — 재고 수량은 출고 화면에서 출고할 때만 줄어든다
//   rows: [{ id, po_number?, order_line?, del_line?, pn? }]
export async function markPoIssued(rows, val, label = '하네스 출도 → 불출 처리') {
  const ids = [...new Set((rows || []).map(r => r.id).filter(Boolean))]
  if (!ids.length) return 0
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200)
    must(await supabase.from('purchase_orders').update({ material_issued: val }).in('id', part), '고객사 PO 불출 표시')
    must(await supabase.from('production').update({ part_issue: val }).in('po_id', part), '생산 호기 불출 표시')
  }
  await logActivity('update', 'purchase_orders', null, `${label} ${ids.length}줄`,
    { rows: (rows || []).map(r => ({ id: r.id, po: r.po_number, ol: r.order_line, dl: r.del_line, pn: r.pn })) }, 'AXCELIS')
  return ids.length
}
