// 별도 BOM(서브 BOM) 끼워 넣기 — 견적 · 원가분석용 (2026-09-30)
//
//   고객사 리포트에서 전개가 빠진 조립품(BOM 안에 하위 줄이 없는데 그 품번의 별도 BOM 이 있는 것)은
//   조립품 한 줄로만 원가에 잡혀 안에 들어가는 부품 원가가 빠졌다.
//   → 그 줄 바로 밑에 별도 BOM 의 줄을 레벨을 한 단계 내려 끼워 넣는다.
//     그러면 원가 계산(explodeBOM)이 조립품을 「중간 어셈블리」로 보고 빼고, 부품을 조립품 수량만큼 곱해 센다.
//   · 수량 0(참조용) 조립품은 부품도 0 으로 계산된다 (곱하기 0)
//   · 끼워 넣은 줄은 id 를 비운다 (원가분석의 「제외」 저장이 다른 BOM 에 가지 않게) — 원래 id 는 subRowId
//   · 별도 BOM 안에도 전개 누락이 있으면 5단까지 이어서 펼친다 (같은 BOM 을 다시 만나면 멈춤)
import { supabase } from './supabase'

async function projectIdsByCode(customerId, codes) {
  const map = {}
  const list = [...new Set(codes.filter(Boolean))]
  for (let i = 0; i < list.length; i += 200) {
    const { data, error } = await supabase.from('projects').select('id,code')
      .eq('customer_id', customerId).in('code', list.slice(i, i + 200))
    if (error) throw error
    ;(data || []).forEach(p => { map[p.code] = p.id })
  }
  return map
}

// rows: 한 BOM 의 줄 (seq 순서) — { id, level, qty_per_unit, items:{ std_code } ... }
// fetchRows(customerId, projectId): 같은 모양의 줄을 돌려주는 함수 (호출한 화면의 조회 그대로)
// rootProjectId: 지금 보는 BOM (자기 자신을 다시 펼치지 않게)
// → { rows, expanded: [{ code, rows }] }
export async function spliceSubBoms(customerId, rows, fetchRows, rootProjectId) {
  const cache = new Map()
  const expanded = []
  const idOf = {}
  async function walk(list, path, depth) {
    const codes = [...new Set(list.map(r => r.items?.std_code).filter(c => c && !(c in idOf)))]
    if (codes.length) {
      const found = await projectIdsByCode(customerId, codes)
      codes.forEach(c => { idOf[c] = found[c] || null })
    }
    const out = []
    for (let i = 0; i < list.length; i++) {
      const r = list[i]
      const lv = Number(r.level) || 1
      const nx = list[i + 1]
      const hasKids = !!nx && (Number(nx.level) || 1) > lv
      const code = r.items?.std_code
      const pid = code ? idOf[code] : null
      if (hasKids || !pid || depth >= 5 || path.includes(pid)) { out.push(r); continue }
      if (!cache.has(pid)) cache.set(pid, await fetchRows(customerId, pid))
      const sub = cache.get(pid) || []
      if (!sub.length) { out.push(r); continue }
      out.push({ ...r, subCode: code, subExpanded: true })
      const kids = await walk(sub, [...path, pid], depth + 1)
      kids.forEach(k => out.push({ ...k, id: null, subRowId: k.subRowId ?? k.id, fromSub: k.fromSub || code, level: lv + (Number(k.level) || 1) }))
      if (depth === 0) expanded.push({ code, rows: kids.length })
    }
    return out
  }
  const out = await walk(rows, [rootProjectId], 0)
  return { rows: out, expanded }
}
