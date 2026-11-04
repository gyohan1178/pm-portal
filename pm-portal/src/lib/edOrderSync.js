// Edwards 생산관리 ← 수주대장 (v4.118.0)
//   수주대장의 진행 중 Edwards 발주를 「프로젝트 · 호기 · 파트」로 묶은 것(pm_ed_order_groups)을 받아
//   · 생산관리에 없는 묶음 → 새 줄 (「📥 수주대장에서 불러오기」 — 미리 보고 실행)
//   · 있는 줄 → 발주서 · 품목 줄 · 금액 표시
//   이미 있는 줄은 건드리지 않는다 (상태 · 날짜 · 불출 · 미불출 · 비고 그대로)
//   호기 번호가 없는 발주(IS Factored · KFA · 단품류 …)는 만들지 않는다
//     단 SIC 는 호기 없이 오는 발주라 프로젝트 하나 = 한 줄(호기 「-」)로 만든다 (2026-10-29)
import { normProj, hasOrderMark } from './edForecast'
import { projOf } from './edMonthly'

// '#3' · '3' · '#3,4' → [3] · [3] · [3, 4]
export const hogiNums = (h) => [...String(h || '').matchAll(/\d+/g)].map((m) => +m[0])
// 「미분류」 = 빈칸 — 생산관리 줄은 미분류를 빈칸(null)으로 저장한다. 예전엔 열쇠가 달라 불러올 때마다 다시 만들었다 (v4.135.0)
const partKey = (p) => { const x = String(p || '').trim().toUpperCase(); return x === '미분류' ? '' : x }
// 호기 번호 없이도 만드는 파트
export const NO_HOGI_PARTS = ['SIC']
// 생산관리에 만들지 않는 파트 — 단품은 생산 관리 대상이 아님 (2026-10-29)
export const SKIP_PARTS = ['단품']
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
//   due (v4.143.0) — 이미 있는 진행 중 줄의 납품요청일을 수주대장 가장 빠른 발주 납기로 맞춘다 (납기가 바뀌면 따라감 · 발주서 접수 ✔)
//     예전엔 처음 만들 때 한 번만 넣고 다시 안 봐서, 수주대장에서 납기를 바꿔도 생산관리는 그대로였다
const isPartnerRow = (r) => (Array.isArray(r?.changes) ? r.changes : []).some((c) => c && c.pkey)
export function planEdImport(groups, rows) {
  const have = new Set()
  for (const r of rows || []) for (const n of nsOf(hogiNums(r.hogi))) have.add(edKey(r.pn, n, r.part))
  // 묶음 열쇠 → 가장 빠른 발주 납기
  const dueBy = new Map()
  for (const g of groups || []) {
    if (SKIP_PARTS.includes(partKey(g.part)) || !g.proj || (!g.hogiNums.length && !noHogiOk(g)) || !g.due) continue
    for (const n of nsOf(g.hogiNums)) { const k = edKey(g.proj, n, g.part); const d = String(g.due).slice(0, 10); if (!dueBy.has(k) || d < dueBy.get(k)) dueBy.set(k, d) }
  }
  const due = []
  for (const r of rows || []) {
    if (r.status === '완료' || isPartnerRow(r)) continue
    const ds = nsOf(hogiNums(r.hogi)).map((n) => dueBy.get(edKey(r.pn, n, r.part))).filter(Boolean)
    if (!ds.length) continue
    const to = ds.reduce((a, c) => (c < a ? c : a))
    const from = r.req_date ? String(r.req_date).slice(0, 10) : null
    if (from !== to || !r.po_received || !hasOrderMark(r)) due.push({ r, from, to, po: !r.po_received })
  }
  const ins = [], exist = [], noHogi = { lines: 0, projs: new Set() }, skip = { lines: 0, projs: new Set() }
  for (const g of groups || []) {
    if (SKIP_PARTS.includes(partKey(g.part))) { skip.lines += g.n_lines || 0; if (g.proj) skip.projs.add(g.proj); continue }
    if (!g.proj || (!g.hogiNums.length && !noHogiOk(g))) { noHogi.lines += g.n_lines || 0; if (g.proj) noHogi.projs.add(g.proj); continue }
    if (nsOf(g.hogiNums).some((n) => have.has(edKey(g.proj, n, g.part)))) exist.push(g)
    else ins.push(g)
  }
  return { ins, exist, due, noHogi: { lines: noHogi.lines, projs: [...noHogi.projs] }, skip: { lines: skip.lines, projs: [...skip.projs] } }
}

// 납기 맞추기 실행 — 줄마다 이력 「납기변경 11-16 → 11-20 (수주대장)」
export async function applyEdDue(supabase, plan, by) {
  const now = new Date().toISOString()
  let n = 0
  for (const u of plan?.due || []) {
    const msg = u.from !== u.to ? `${u.from || '-'} → ${u.to}` : `수주대장 PO 납기 ${u.to} 연결`
    const chg = { type: u.from !== u.to ? '납기변경' : 'PO연결', msg: msg + (u.po ? ' · 발주서 접수' : ''), from: u.from, to: u.to, src: '수주대장', at: now, by: by || null }
    const { error } = await supabase.from('production').update({
      req_date: u.to, po_received: true, updated_at: now,
      changes: [...(Array.isArray(u.r.changes) ? u.r.changes : []), chg],
    }).eq('id', u.r.id)
    if (error) throw error
    n++
  }
  return n
}

const newId = () => 'pb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

// 새 줄 모양 — 월간 실적 · 포캐스트가 만드는 줄과 같은 칸
export function rowFromGroup(g, by) {
  const pn = projOf(g.proj) || g.proj
  const now = new Date().toISOString()
  return {
    id: newId(), customer_code: 'ED', created_at: now, updated_at: now,
    company: 'Edwards',                                     // 비우면 DB 기본값 「AXCELIS」가 들어갔다 (v4.136.0)
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
  const lines = plan.ins.map((g) =>
    `＋ ${g.proj} ${g.hogiNums.length ? '#' + g.hogiNums.join(',') : '(호기 없음)'} · ${g.part}${g.sub ? ` (${g.sub})` : ''} — 발주서 ${g.pos.join(', ')} · 납기 ${String(g.due || '').slice(5)}${g.guessed ? ` · 파트 추정` : ''}`)
  for (const u of plan.due || []) lines.push(`✎ ${u.r.pn} ${u.r.hogi || ''} · ${u.r.part || '미분류'} — ${u.from !== u.to ? `납기 ${u.from ? u.from.slice(5) : '없음'} → ${u.to.slice(5)}` : `PO 납기 ${u.to.slice(5)} 로 보기`}${u.po ? ' · 발주서 접수' : ''}`)
  if (plan.exist.length) lines.push(`이미 있음 ${plan.exist.length}줄 — 상태 · 불출 · 비고는 그대로 (납기만 수주대장에 맞춤)`)
  if (plan.skip?.lines) lines.push(`단품 발주 ${plan.skip.lines}줄 — 만들지 않음`)
  if (plan.noHogi.lines) lines.push(`호기 번호 없는 발주 ${plan.noHogi.lines}줄 — 만들지 않음 (${plan.noHogi.projs.slice(0, 5).join(' · ')}${plan.noHogi.projs.length > 5 ? ' …' : ''})`)
  return lines
}
