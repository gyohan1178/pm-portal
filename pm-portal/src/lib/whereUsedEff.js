// 역전개(사용처) 결과에 「대당 소요」를 붙인다 (2026-10-01)
//
//   get_where_used_all 의 qty 는 BOM 줄에 적힌 수량을 그대로 더한 값이다.
//   위 조립품이 수량 0(참조용)이거나 구매/자작 표시가 있어도 반영되지 않아,
//   BOM 화면은 「대당 0」인데 역전개는 1 로 보였다 (예: 110167070 의 500002148).
//   → 부족자재 · 소요량 조회와 같은 계산(pm_bom_explode)으로 상위 1대당 실제 소요를 구해 같이 보여 준다.
import { supabase } from './supabase'
import { explodeProjects } from './bomSupply'

const MAX_ROOTS = 300   // 품명으로 넓게 찾으면 상위가 수백 개 — 그때는 원래 수량만

export async function addEffQty(rows) {
  if (!rows?.length) return rows || []
  const { data: cs } = await supabase.from('customers').select('id,code')
  const csId = Object.fromEntries((cs || []).map(c => [String(c.code || '').toUpperCase(), c.id]))
  const out = rows.map(r => ({ ...r }))
  const byCs = {}
  for (const r of out) (byCs[String(r.customer_code || '').toUpperCase()] ||= []).push(r)
  for (const [code, list] of Object.entries(byCs)) {
    const id = csId[code]
    if (!id) continue
    const pcodes = [...new Set(list.map(r => r.parent_code).filter(Boolean))]
    const ccodes = [...new Set(list.map(r => r.child_code).filter(Boolean))]
    if (!pcodes.length || pcodes.length > MAX_ROOTS) continue
    const pj = {}, it = {}
    for (let i = 0; i < pcodes.length; i += 200) {
      const { data } = await supabase.from('projects').select('id,code').eq('customer_id', id).in('code', pcodes.slice(i, i + 200))
      ;(data || []).forEach(p => { pj[p.code] = p.id })
    }
    for (let i = 0; i < ccodes.length; i += 200) {
      const { data } = await supabase.from('items').select('id,std_code').in('std_code', ccodes.slice(i, i + 200))
      ;(data || []).forEach(x => { it[x.std_code] = x.id })
    }
    const roots = [...new Set(Object.values(pj))]
    if (!roots.length) continue
    const ex = await explodeProjects(id, roots)
    if (ex === null) continue                       // 계산 함수가 없으면(SQL 전) 원래 수량만
    const q = new Map(ex.map(e => [`${e.project_id}|${e.item_id}`, e.qty_per_unit]))
    for (const r of list) {
      const p = pj[r.parent_code], c = it[r.child_code]
      if (p && c) r.eff = q.get(`${p}|${c}`) ?? 0
    }
  }
  return out
}
