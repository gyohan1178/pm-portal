import { supabase } from './supabase'
import { fetchAll } from './paginate'
import { must } from './db'

// AXCELIS 수주대장 줄 — 예전 「고객사 PO」 줄과 같은 모양으로 (v4.158.0 · 수주대장 기준 전환 4단계)
//   하네스 출도 · 불출 등 고객사 PO 를 읽던 화면이 그대로 쓰게 칸 이름을 맞춘다
//   · id = 수주대장 줄 id · line = true (불출 표시는 lib/poIssue 가 수주대장 줄로 저장)
//   · cpo_id = 같은 PO · 라인 · 분할 · 품목의 고객사 PO (있으면 — 전환이 끝날 때까지 같이 맞춤)
//   · in_prod = 생산관리 호기가 붙은 줄 (그쪽 「자재불출」로 관리)
//   poNos 를 주면 그 PO 들의 줄 전부(납품 · 취소 포함, status 로 구분), 비우면 진행 중 줄만
//   SQL: pm_ax_order_lines (수주대장전환_4단계_하네스 SQL)
export async function fetchAxLines(poNos = null) {
  const rows = await fetchAll(() => supabase.rpc('pm_ax_order_lines', { p_po_nos: poNos && poNos.length ? poNos : null }).order('id'))
  const itemIds = [...new Set(rows.map(r => r.item_id).filter(Boolean))]
  const items = {}
  for (let i = 0; i < itemIds.length; i += 150) {
    const part = must(await supabase.from('items').select('id,std_code,name,manufacturer,manufacturer_code').in('id', itemIds.slice(i, i + 150)), '품목 읽기')
    ;(part || []).forEach(it => { items[it.id] = it })
  }
  return rows.map(r => ({ ...r, line: true, qty_ordered: Number(r.qty_ordered) || 0, qty_received: Number(r.qty_received) || 0,
    qty_remaining: Number(r.qty_remaining) || 0, items: items[r.item_id] || null }))
}

// SQL(4단계) 전이면 함수가 없다 — 그때는 예전처럼 고객사 PO 를 읽는다 (화면이 SQL 보다 먼저 배포돼도 깨지지 않게)
export const isMissingFn = (e) => /pm_ax_order_lines|PGRST202|does not exist|schema cache/i.test(String(e?.message || e?.code || e || ''))
const AX_ID = 'd7b268b4-1e8e-45f3-860b-4bd0e08ded77'
export async function fetchCpoLegacy(poNos = null) {
  const SEL = 'id,item_id,po_number,ccn,order_line,del_line,division,item_rev,item_brev,qty_ordered,qty_received,qty_remaining,promise_date,status,material_issued, items!purchase_orders_item_id_fkey(std_code,name,manufacturer,manufacturer_code)'
  const rows = []
  if (poNos && poNos.length) {
    const want = [...new Set(poNos.flatMap(x => [x, String(x).toLowerCase()]))]
    for (let i = 0; i < want.length; i += 150)
      rows.push(...await fetchAll(() => supabase.from('purchase_orders').select(SEL)
        .eq('customer_id', AX_ID).eq('order_type', 'customer_po').in('po_number', want.slice(i, i + 150)).order('id')))
  } else {
    rows.push(...await fetchAll(() => supabase.from('purchase_orders').select(SEL)
      .eq('customer_id', AX_ID).eq('order_type', 'customer_po').not('status', 'in', '(완료,취소)').order('id')))
  }
  const prod = await fetchAll(() => supabase.from('production').select('id,po_id').not('po_id', 'is', null).order('id'))
  const inProd = new Set(prod.map(r => r.po_id))
  return rows.map(p => ({ ...p, cpo_id: p.id, in_prod: inProd.has(p.id) }))
}
export const fetchAxLinesSafe = (poNos = null) => fetchAxLines(poNos).catch(e => (isMissingFn(e) ? fetchCpoLegacy(poNos) : Promise.reject(e)))
