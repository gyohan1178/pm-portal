import { supabase } from './supabase'
import { fetchAll } from './paginate'
import { must } from './db'

// 입고 · 출고 되돌리기 (v4.58.0)
//   입고 · 출고 함수(pm_process_inbound · pm_direct_inbound · pm_process_outbound · pm_process_issue)는
//   만든 줄 id 를 돌려주지 않는다 → 처리 「전」 줄 목록을 떠 두고, 처리 「후」 새로 생긴 줄 중
//   내가 보낸 (품목 · 발주 · 수량)과 맞는 것만 고른다 (그사이 다른 사람이 같은 품목을 처리해도 섞이지 않게).
//   되돌릴 때는 입고현황 「선택 삭제」와 같은 pm_movement_delete_safe — 복구 기록을 남기고
//   pm_delete_movements 가 재고 · 발주 입고수량 · 완료 상태를 되돌린다 (출고 로트는 트리거가 되돌림).

const CH = 150
export async function moveRows({ type, poIds, itemIds, poNull, since }) {
  const keys = poIds?.length ? ['po_id', [...new Set(poIds)]] : itemIds?.length ? ['item_id', [...new Set(itemIds)]] : null
  if (!keys) return []
  const out = []
  for (let i = 0; i < keys[1].length; i += CH) {
    const part = keys[1].slice(i, i + CH)
    out.push(...await fetchAll(() => {
      let x = supabase.from('stock_movements').select('id,item_id,po_id,qty,movement_type').eq('movement_type', type).in(keys[0], part)
      if (poNull) x = x.is('po_id', null)
      if (since) x = x.gte('movement_date', since)
      return x.order('id')
    }))
  }
  return out
}
// expect: [{ item_id?, po_id?, qty }] — 하나씩 짝지어 고른다
export function pickNew(before, after, expect) {
  const old = new Set((before || []).map(r => r.id))
  const pool = (after || []).filter(r => !old.has(r.id))
  if (!expect) return pool.map(r => r.id)
  const ids = []
  for (const e of expect) {
    const i = pool.findIndex(r => (e.po_id == null || r.po_id === e.po_id) && (e.item_id == null || r.item_id === e.item_id) && Number(r.qty) === Number(e.qty))
    if (i >= 0) { ids.push(pool[i].id); pool.splice(i, 1) }
  }
  return ids
}
export async function undoMoves(ids) {
  if (!ids?.length) throw new Error('되돌릴 입출고 줄을 찾지 못했습니다 — 입고현황 · 출고현황에서 직접 지워 주세요')
  const r = must(await supabase.rpc('pm_movement_delete_safe', { p_ids: ids }), '입출고 되돌리기')
  const row = Array.isArray(r) ? r[0] : r
  return row || { cnt: ids.length }
}
// 한국 날짜 기준 어제 — 출고 함수 하나는 서버 날짜(UTC)로 찍어서 하루 넉넉히 본다
export const sinceYesterday = () => new Date(Date.now() + 9 * 3600000 - 86400000).toISOString().slice(0, 10)
