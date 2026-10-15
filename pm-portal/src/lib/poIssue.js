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

// 되돌리기용 (v4.58.0) — 불출 표시를 바꾸기 「전」 값을 떠 두었다가 그대로 돌려놓는다
//   (끄기로 되돌리면 원래 켜져 있던 호기까지 꺼지므로, 반대값이 아니라 원래값으로 돌린다)
export async function snapIssued(poIds) {
  const ids = [...new Set((poIds || []).filter(Boolean))]
  const pos = [], prods = []
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200)
    pos.push(...(must(await supabase.from('purchase_orders').select('id,material_issued').in('id', part), '불출 표시 읽기') || []))
    prods.push(...(must(await supabase.from('production').select('id,part_issue').in('po_id', part), '호기 불출 표시 읽기') || []))
  }
  // 값만 떠 둔다 (받아 온 줄 객체를 그대로 쥐고 있지 않게)
  return { pos: pos.map(r => ({ id: r.id, material_issued: !!r.material_issued })), prods: prods.map(r => ({ id: r.id, part_issue: !!r.part_issue })) }
}
export async function restoreIssued(snap) {
  if (!snap) return
  const grp = (rows, k) => rows.reduce((m, r) => { const v = !!r[k]; (m[v] ??= []).push(r.id); return m }, {})
  for (const [v, ids] of Object.entries(grp(snap.pos || [], 'material_issued')))
    for (let i = 0; i < ids.length; i += 200)
      must(await supabase.from('purchase_orders').update({ material_issued: v === 'true' }).in('id', ids.slice(i, i + 200)), '불출 표시 되돌리기')
  for (const [v, ids] of Object.entries(grp(snap.prods || [], 'part_issue')))
    for (let i = 0; i < ids.length; i += 200)
      must(await supabase.from('production').update({ part_issue: v === 'true' }).in('id', ids.slice(i, i + 200)), '호기 불출 표시 되돌리기')
}
