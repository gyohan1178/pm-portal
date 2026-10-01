// 자재 상황판 › 소요예측 — Edwards 소요 만들기 (2026-10-01)
//
//   Edwards 포캐스트 품번(NKB943000 · IEDF… 등)은 장비 품번이라 BOM(NKB943_하네스 · H2D-LH …)과 이어지지 않아
//   소요예측에서 부품 소요가 나오지 않았다.
//   → 생산관리 Edwards 진행 줄(포캐스트로 만든 호기 포함)의 하네스 · 전장 불출 건마다
//     연결된 BOM 을 「불출 예정 월」에 1대씩 넣는다. 소요량 매칭(lib/edNeed.js)과 같은 규칙.
//       · 이미 불출한 건은 뺀다 (불출했으니 재고에서 나갔다)
//       · 불출했는데 미불출 자재가 적혀 있으면 → 그 품목만
//       · 불출 예정이 지난 달이거나 날짜가 없으면 → 이번 달
//       · BOM 이 연결 안 된 건은 뺀다 (「⚙ 불출 기준」 ③ 에서 연결)
//   만든 소요는 pm_ed_demand 에 넣고, DB 의 소요예측(get_shortage_forecast)이 포캐스트 대신 그것을 BOM 전개한다.
import { supabase } from './supabase'
import { fetchAll } from './paginate'
import { loadRules, KINDS } from './edForecast'
import { buildEvents } from './edNeed'

const ym = (d) => String(d).slice(0, 7)
const thisYm = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

// 순수 계산 — 시험하기 쉽게 따로 둔다
export function demandFromEvents(events, missCode, today = thisYm()) {
  const agg = new Map()
  let noBom = 0, unresolved = 0, used = 0
  const add = (code, month, qty, src) => {
    const m = !month || month < today ? today : month
    const k = code + '|' + m
    const cur = agg.get(k) || { std_code: code, year_month: m, qty: 0, src: [] }
    cur.qty += qty
    if (cur.src.length < 12) cur.src.push(src)
    agg.set(k, cur)
  }
  for (const e of events) {
    const where = `${e.row.pn} ${e.row.hogi} ${e.kind}`
    if (e.which === 'miss') {
      for (const m of e.missing || []) {
        const code = missCode[String(m.pn || '').trim()]
        if (!code) { unresolved++; continue }
        add(code, e.due && ym(e.due), Number(m.qty) || 1, `${where} 미불출`)
      }
      used++
      continue
    }
    if (!e.proj) { if (KINDS.includes(e.kind)) noBom++; continue }
    add(e.proj.code, e.due && ym(e.due), 1, `${where} ${e.which === 'harn' ? '하네스' : '전장'}`)
    used++
  }
  const rows = [...agg.values()].map(r => ({ ...r, src: r.src.join(' · ') }))
  return { rows, used, noBom, unresolved }
}

export async function buildEdDemand() {
  const { data: cs, error: e1 } = await supabase.from('customers').select('id,code')
  if (e1) throw e1
  const ed = (cs || []).find(c => String(c.code || '').toUpperCase() === 'ED')
  if (!ed) throw new Error('Edwards 고객사(코드 ED)를 찾을 수 없습니다')
  const [rules, projects, rows] = await Promise.all([
    loadRules(supabase),
    fetchAll(() => supabase.from('projects').select('id,code,name').eq('customer_id', ed.id).order('code').order('id')),
    fetchAll(() => supabase.from('production').select('*').eq('customer_code', 'ED').order('id')),
  ])
  const events = buildEvents(rows, rules, projects)
  // 미불출 자재 품번 → 품목 코드 (ED- · 그대로 · AX- 순)
  const pns = [...new Set(events.flatMap(e => (e.missing || []).map(m => String(m.pn || '').trim())).filter(Boolean))]
  const missCode = {}
  if (pns.length) {
    const codes = [...new Set(pns.flatMap(p => (/^(ED|AX)-/i.test(p) ? [p] : [`ED-${p}`, p, `AX-${p}`])))]
    const have = new Set()
    for (let i = 0; i < codes.length; i += 300) {
      const { data } = await supabase.from('items').select('std_code').in('std_code', codes.slice(i, i + 300))
      ;(data || []).forEach(x => have.add(x.std_code))
    }
    for (const p of pns) missCode[p] = (/^(ED|AX)-/i.test(p) ? [p] : [`ED-${p}`, p, `AX-${p}`]).find(c => have.has(c)) || null
  }
  return { csId: ed.id, ...demandFromEvents(events, missCode) }
}

// 소요예측 「↻ 재계산」 전에 부른다
export async function saveEdDemand() {
  const d = await buildEdDemand()
  const { data, error } = await supabase.rpc('pm_ed_demand_save', { p_cs: d.csId, p_rows: d.rows })
  if (error) {
    if (/pm_ed_demand_save|Could not find the function|schema cache/i.test(error.message || ''))
      throw new Error('SQL pm_ed_demand_261001 을 먼저 실행하세요')
    throw error
  }
  return { ...d, saved: data }
}
