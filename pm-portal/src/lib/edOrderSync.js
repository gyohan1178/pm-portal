// Edwards 생산관리 ← 수주대장 (v4.118.0)
//   수주대장의 진행 중 Edwards 발주를 「프로젝트 · 호기 · 파트」로 묶은 것(pm_ed_order_groups)을 받아
//   · 생산관리에 없는 묶음 → 새 줄 (「📥 수주대장에서 불러오기」 — 미리 보고 실행)
//   · 있는 줄 → 발주서 · 품목 줄 · 금액 표시
//   이미 있는 줄은 건드리지 않는다 (상태 · 날짜 · 불출 · 미불출 · 비고 그대로)
//   호기 번호가 없는 발주(IS Factored · KFA · 단품류 …)는 만들지 않는다
//     단 SIC 는 호기 없이 오는 발주라 프로젝트 하나 = 한 줄(호기 「-」)로 만든다 (2026-10-29)
import { normProj } from './edForecast'
import { projOf } from './edMonthly'

// '#3' · '3' · '#3,4' → [3] · [3] · [3, 4]
export const hogiNums = (h) => [...String(h || '').matchAll(/\d+/g)].map((m) => +m[0])
const partKey = (p) => String(p || '').trim().toUpperCase()
// 호기 번호 없이도 만드는 파트
export const NO_HOGI_PARTS = ['SIC']
const noHogiOk = (g) => !!g.proj && !g.hogiNums.length && NO_HOGI_PARTS.includes(partKey(g.part))
// 묶음의 호기 열쇠들 — 번호가 없으면 「-」
const nsOf = (nums) => (nums.length ? nums : ['-'])
// 묶음 열쇠 — 프로젝트(정리) | 호기 번호 | 파트
export const edKey = (pn, n, part) => `${normProj(pn)}|${n}|${partKey(part)}`
// 호기 열쇠 — 화면에서 호기로 묶을 때
export const edHogiKey = (pn, hogi) => `${normProj(pn)}|${hogiNums(hogi).join(',') || String(hogi || '').trim()}`

// 받기 — 함수가 없으면(SQL 전) setup:false
export async function fetchEdOrderGroups(supabase) {
  const { data, error } = await supabase.rpc('pm_ed_order_groups')
  if (error) return { setup: false, groups: [] }
  return { setup: true, groups: (data || []).map((g) => ({ ...g, pos: g.pos || [], hogiNums: hogiNums(g.hogi) })) }
}

// 생산관리 줄 → 발주 묶음 찾기 (호기 번호 하나라도 같고 파트 같으면)
export function orderIndex(groups) {
  const m = new Map()
  for (const g of groups || []) {
    if (!g.proj || (!g.hogiNums.length && !noHogiOk(g))) continue
    for (const n of nsOf(g.hogiNums)) m.set(edKey(g.proj, n, g.part), g)
  }
  return m
}
export function orderOf(idx, r) {
  if (!idx) return null
  for (const n of nsOf(hogiNums(r.hogi))) { const g = idx.get(edKey(r.pn, n, r.part)); if (g) return g }
  return null
}

// 불러오기 계획 — rows: 지금 생산관리(Edwards) 줄 전부
export function planEdImport(groups, rows) {
  const have = new Set()
  for (const r of rows || []) for (const n of nsOf(hogiNums(r.hogi))) have.add(edKey(r.pn, n, r.part))
  const ins = [], exist = [], noHogi = { lines: 0, projs: new Set() }
  for (const g of groups || []) {
    if (!g.proj || (!g.hogiNums.length && !noHogiOk(g))) { noHogi.lines += g.n_lines || 0; if (g.proj) noHogi.projs.add(g.proj); continue }
    if (nsOf(g.hogiNums).some((n) => have.has(edKey(g.proj, n, g.part)))) exist.push(g)
    else ins.push(g)
  }
  return { ins, exist, noHogi: { lines: noHogi.lines, projs: [...noHogi.projs] } }
}

const newId = () => 'pb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

// 새 줄 모양 — 월간 실적 · 포캐스트가 만드는 줄과 같은 칸
export function rowFromGroup(g, by) {
  const pn = projOf(g.proj) || g.proj
  const now = new Date().toISOString()
  return {
    id: newId(), customer_code: 'ED', created_at: now, updated_at: now,
    name: pn, pn, hogi: g.hogiNums.length ? '#' + g.hogiNums.join(',') : '-',
    part: g.part === '미분류' ? null : g.part, part2: g.sub || null, part3: null,
    status: 'PO접수', po_received: true,                   // 수주대장에 발주서가 있으니 접수
    req_date: g.due || null,                                // 정한 납기가 없을 때 쓰는 납품요청일 = 가장 빠른 발주 납기
    missing_parts: [],
    changes: [{ type: '수주대장 불러오기', at: now, by: by || null, pos: g.pos, lines: g.n_lines, guessed: g.guessed || 0 }],
  }
}

export async function applyEdImport(supabase, plan, by) {
  const recs = plan.ins.map((g) => rowFromGroup(g, by))
  for (let i = 0; i < recs.length; i += 200) {
    const { error } = await supabase.from('production').insert(recs.slice(i, i + 200))
    if (error) throw error
  }
  return recs.length
}

// 미리 보기 글 (확인 창)
export function planEdText(plan) {
  const won = (n) => Math.round(+n || 0).toLocaleString('ko-KR')
  const lines = plan.ins.map((g) =>
    `＋ ${g.proj} ${g.hogiNums.length ? '#' + g.hogiNums.join(',') : '(호기 없음)'} · ${g.part}${g.sub ? ` (${g.sub})` : ''} — 발주 ${g.pos.length}건 · ${g.n_lines}줄 · ₩${won(g.amt)} · 납기 ${String(g.due || '').slice(5)}${g.guessed ? ` · 파트 추정 ${g.guessed}줄` : ''}`)
  if (plan.exist.length) lines.push(`이미 있음 ${plan.exist.length}줄 — 그대로 둠`)
  if (plan.noHogi.lines) lines.push(`호기 번호 없는 발주 ${plan.noHogi.lines}줄 — 만들지 않음 (${plan.noHogi.projs.slice(0, 5).join(' · ')}${plan.noHogi.projs.length > 5 ? ' …' : ''})`)
  return lines
}
