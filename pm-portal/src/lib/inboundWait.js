// 입고 화면 — 받은 자재를 「어디에 두고 · 누가 기다리는지」 (v4.191.0)
//   · 보관 위치: 재고(inventory.location) + 보조 칸
//   · 자재 요청 대기: 아직 처리 안 끝난 자재 요청(pm_material_request) 건수 · 남은 수량
//   · 미불출 호기: 생산관리 호기의 미불출(production.missing_parts)에 걸린 호기
//   받자마자 위치와 줄 곳이 보여야 다른 화면에서 다시 찾지 않는다
import { supabase } from './supabase'
import { fetchAll } from './paginate'
import { stockByItemIds } from './stockLookup'
import { stripPrefix } from './custPrefix'

const up = (v) => stripPrefix(String(v || '').trim()).toUpperCase()

// 계산만 (시험용) — reqs: 열린 자재 요청 줄 · prods: 진행 중 호기
export function buildWait(stock, reqs, prods) {
  const req = new Map()
  for (const r of reqs || []) {
    if (!r.item_id || r.status === '완료' || r.status === '반려') continue
    const left = Math.max(0, (Number(r.qty) || 0) - (Number(r.issued_qty) || 0))
    const e = req.get(r.item_id) || { n: new Set(), qty: 0 }
    e.n.add(r.req_no || r.id); e.qty += left; req.set(r.item_id, e)
  }
  const miss = new Map()
  for (const p of prods || []) {
    if (p.status === '완료') continue
    for (const m of (Array.isArray(p.missing_parts) ? p.missing_parts : [])) {
      if (!m) continue
      const k = up(m.std_code || m.pn); if (!k) continue
      const e = miss.get(k) || { hogis: [], qty: 0 }
      const tag = `${p.pn || ''} ${p.hogi || ''}`.trim()
      if (!e.hogis.includes(tag)) e.hogis.push(tag)
      e.qty += Number(m.qty) || 0; miss.set(k, e)
    }
  }
  return {
    of(itemId, stdCode) {
      const s = stock?.[itemId], r = req.get(itemId), m = miss.get(up(stdCode))
      return { loc: s?.location || '', stock: s ? s.qty : null, reqN: r ? r.n.size : 0, reqQty: r ? r.qty : 0, hogis: m ? m.hogis : [], missQty: m ? m.qty : 0 }
    },
  }
}

export async function fetchInboundWait(itemIds) {
  const ids = [...new Set((itemIds || []).filter(Boolean))]
  if (!ids.length) return buildWait({}, [], [])
  const reqP = (async () => {
    const out = []
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await supabase.from('pm_material_request').select('id,req_no,item_id,qty,issued_qty,status')
        .in('item_id', ids.slice(i, i + 150)).not('status', 'in', '(완료,반려)').limit(1000)
      if (error) {
        // 부분 불출 칸(issued_qty)이 아직 없는 DB — 그 칸 없이 다시
        const r2 = await supabase.from('pm_material_request').select('id,req_no,item_id,qty,status').in('item_id', ids.slice(i, i + 150)).not('status', 'in', '(완료,반려)').limit(1000)
        if (r2.error) throw r2.error
        out.push(...(r2.data || []))
      } else out.push(...(data || []))
    }
    return out
  })()
  const prodP = fetchAll(() => supabase.from('production').select('id,pn,hogi,missing_parts,status').not('missing_parts', 'is', null).order('id'))
  // 셋 중 하나가 실패해도 나머지는 보인다 (곁 정보라 입고 처리를 막지 않는다)
  const [stock, reqs, prods] = await Promise.all([stockByItemIds(ids).catch(() => ({})), reqP.catch(() => []), prodP.catch(() => [])])
  return buildWait(stock, reqs, prods)
}
