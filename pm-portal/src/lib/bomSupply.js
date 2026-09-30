// BOM 상위품목 구매 / 자작 구분 (2026-09-30)
//   DB 의 pm_bom_eff · pm_bom_explode 와 같은 규칙 — 화면 표시용(BOM 상세)과 소요량 산출(ReqBOM)에서 쓴다.
//
//   · 하위 수량은 「상위 1개당」 → 위로 곱해 올라간다 (상위 수량 0 이면 곱하지 않음)
//   · 구매(buy) 상위 : 상위만 세고 그 밑 하위는 전부 뺀다
//   · 자작(make) 상위: 상위는 빼고 하위만 센다
//   · 미지정         : 상위 · 하위 둘 다 센다 (예전과 같음)
//   · 순서(seq)가 빈 줄은 위치를 몰라 단독으로 센다
import { supabase } from './supabase'
import { fetchAll } from './paginate'

export const SUPPLY_LABEL = { buy: '🛒 구매', make: '🔧 자작' }

// rows: BOM 한 장 (seq 순서) — { id, item_id, level, seq, qty_per_unit, items:{std_code} }
// supply: { [item_id]: 'buy' | 'make' } · subCodes: 서브 BOM 이 있는 품번 Set
// → 줄마다 { hasKids, sub, refExpanded, parentable, mode, state, eff }
//   sub: 이 BOM 안엔 하위가 없는데 그 품번의 별도 BOM 이 있음 (고객사 리포트에서 전개가 빠진 조립품)
//        → 부족자재·소요량 계산은 그 별도 BOM 으로 펼친다 (DB pm_bom_explode)
//   refExpanded: 같은 BOM 의 다른 위치에서는 전개돼 있음 (리포트가 첫 위치에만 전개하는 경우)
//   state: normal | buyParent | buySkip(구매 상위의 하위 — 소요 제외) | makeParent(자작 — 소요 제외)
export function bomSupplyTree(rows, supply = {}, subCodes = new Set()) {
  const out = new Map()
  const stack = []   // { lv, mul, skip }
  const kidsOf = rows.map((r, i) => {
    const nx = rows[i + 1]
    return r.seq != null && !!nx && nx.seq != null && (Number(nx.level) || 1) > (Number(r.level) || 1)
  })
  const expandedItems = new Set(rows.filter((r, i) => kidsOf[i]).map(r => r.item_id))
  rows.forEach((r, i) => {
    const lv = Number(r.level) || 1
    const q = Number(r.qty_per_unit) || 0
    const mode = supply[r.item_id] || null
    const hasKids = kidsOf[i]
    const sub = !hasKids && subCodes.has(r.items?.std_code)
    const refExpanded = sub && expandedItems.has(r.item_id)
    const parentable = hasKids || sub
    if (r.seq == null) {
      out.set(r.id, { hasKids: false, sub, refExpanded, parentable, mode, state: sub && mode === 'make' ? 'makeParent' : 'normal', eff: q })
      return
    }
    while (stack.length && stack[stack.length - 1].lv >= lv) stack.pop()
    const top = stack[stack.length - 1]
    const pe = top ? top.mul : 1, ps = top ? top.skip : false
    const eff = q * pe
    let state = 'normal'
    if (ps) state = 'buySkip'
    else if (parentable && mode === 'make') state = 'makeParent'
    else if (parentable && mode === 'buy') state = 'buyParent'
    out.set(r.id, { hasKids, sub, refExpanded, parentable, mode, state, eff })
    stack.push({ lv, mul: q > 0 ? eff : pe, skip: ps || (hasKids && mode === 'buy') })
  })
  return out
}

// 상위품목 구매/자작 표시 읽기 — 표가 아직 없으면(SQL 전) { missing: true }
export async function fetchSupply(itemIds) {
  const ids = [...new Set(itemIds.filter(Boolean))]
  const map = {}
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await supabase.from('pm_item_supply').select('item_id,mode').in('item_id', ids.slice(i, i + 300))
    if (error) {
      if (/pm_item_supply|does not exist|schema cache/i.test(error.message || '')) return { map, missing: true }
      throw error
    }
    ;(data || []).forEach(x => { map[x.item_id] = x.mode })
  }
  return { map, missing: false }
}

// 상위품번(프로젝트) 1대당 실제 소요 — DB 의 pm_bom_explode (부족자재와 같은 규칙)
//   반환: [{ project_id, item_id, qty_per_unit }] · 함수가 아직 없으면(SQL 전) null → 예전 방식으로
export async function explodeProjects(customerId, projectIds) {
  if (!projectIds.length) return []
  try {
    const rows = await fetchAll(() => supabase
      .rpc('pm_bom_explode', { cs_id: customerId, p_recurse_unmarked: false, p_roots: projectIds })
      .order('root_id').order('item_id'))
    return rows.map(r => ({ project_id: r.root_id, item_id: r.item_id, qty_per_unit: Number(r.qty) || 0 }))
  } catch (e) {
    if (/pm_bom_explode|Could not find the function|does not exist|schema cache/i.test(e?.message || '')) return null
    throw e
  }
}
