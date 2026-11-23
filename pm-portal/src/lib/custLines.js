import { supabase } from './supabase'
import { fetchAll } from './paginate'
import { must } from './db'
import { prodLineIds } from './axLines'

// AXCELIS 밖 고객사(Edwards · CSK · VM · 기타)의 수주대장 진행 중 줄 — 하네스 출도 · 불출 고객사 탭 (v4.230.0)
//   lib/axLines 와 같은 모양으로 맞춘다 (화면이 그대로 쓰게) · 생산관리 호기가 붙은 줄은 그쪽에서 관리하므로 뺀다
//   ⚠ AXCELIS 밖 줄은 구분(하네스 · 구매품 · 전장)이 없다 → 화면에서 「미분류」 · 「구분 바꾸기」로 품번마다 정한다
export async function fetchOtherLines() {
  const [live, heads, links] = await Promise.all([
    fetchAll(() => supabase.from('pm_order_line_live_v').select('*').order('id')),
    fetchAll(() => supabase.from('pm_order').select('id,po_no,customer_code,customer_name,ccn,planned').neq('customer_code', 'AX').order('id')),
    fetchAll(() => supabase.from('pm_prod_order_link').select('order_line_id').order('order_line_id')).catch(() => []),
  ])
  const head = new Map(heads.filter((h) => !h.planned).map((h) => [h.id, h]))
  const inProd = new Set(links.map((k) => k.order_line_id))
  const rows = live.filter((l) => head.has(l.order_id) && !l.cancelled && (Number(l.delivered_qty) || 0) < (Number(l.qty) || 0))
  ;(await prodLineIds(rows.map((r) => r.id))).forEach((id) => inProd.add(id))   // 호기가 줄 id 로 붙은 것도 (v4.233.0)
  const itemIds = [...new Set(rows.map((r) => r.item_id).filter(Boolean))]
  const items = {}
  for (let i = 0; i < itemIds.length; i += 150) {
    const part = must(await supabase.from('items').select('id,std_code,name,manufacturer,manufacturer_code').in('id', itemIds.slice(i, i + 150)), '품목 읽기')
    ;(part || []).forEach((it) => { items[it.id] = it })
  }
  return rows.map((l) => {
    const h = head.get(l.order_id)
    const q = Number(l.qty) || 0, d = Number(l.delivered_qty) || 0
    return {
      id: l.id, line: true, cpo_id: null, in_prod: inProd.has(l.id),
      customer_code: h.customer_code, customer_name: h.customer_name || '',
      po_number: h.po_no, order_line: l.line_no, del_line: l.del_line,
      item_id: l.item_id, items: items[l.item_id] || (l.raw_pn ? { std_code: l.raw_pn, name: l.raw_desc } : null),
      qty_ordered: q, qty_received: d, qty_remaining: Math.max(0, q - d),
      promise_date: l.due_date, material_issued: !!l.material_issued, division: l.division || null,
      ccn: h.ccn || null, item_rev: l.rev || null, item_brev: l.brev || null,
    }
  }).filter((p) => !p.in_prod)
}
