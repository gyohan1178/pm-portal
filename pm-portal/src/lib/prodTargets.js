// 생산관리 대상 · 수주대장 ↔ 생산관리 매칭 (v4.102.0)
//
//   pm_prod_group  — 고객사별 그룹 (주요품목 · Sub 품목 · 3rd party … 사람이 더함)
//   pm_prod_target — 생산관리에서 운영할 품번. active=false 면 「제외」 → 고객사 PO 연동이 호기를 안 만듦
//                    목록에 없는 AX-11 품번은 예전처럼 자동 대상 (pm_is_prod_target)
//   pm_prod_order_v — 생산관리 줄 ↔ 수주대장 줄 (저장 안 함, 늘 지금 데이터로 계산)
//                    AX: 호기의 고객사 PO → 같은 PO · 라인 · 분할 / CSK: Plnd order number / VM: PROJECT 코드 = 호기
//                    ED: 수주 줄 PROJECT(발주서 프로젝트 줄) = 생산관리 프로젝트 + 호기 (앞부분만 같으면 「추정」)
//   화면은 묶음 보기만 읽는다 — pm_prod_link_sum_v (생산관리 줄마다) · pm_line_prod_v (진행 중 수주 줄마다)
//     (Edwards 는 한 프로젝트 · 호기에 수주 줄이 수백 개라 줄 단위로는 2만 줄이 넘는다)
//   SQL: 생산관리대상_매칭_반영_261026.sql
import { supabase } from './supabase'
import { fetchAll } from './paginate'

export const PT_SQL_HINT = '생산관리 대상 표가 아직 없습니다 — Supabase SQL Editor 에서 생산관리대상_매칭_반영_261026.sql 을 먼저 실행해 주세요'
const missingTbl = (e) => e && (e.code === '42P01' || e.code === 'PGRST205' || /pm_prod_(group|target|order_v|link_sum_v)|pm_line_prod_v/.test(e.message || ''))
const wrap = (e) => { if (missingTbl(e)) { const x = new Error(PT_SQL_HINT); x.missing = true; return x } return e }

// 고객사 — mode: auto(수주 → 호기 자동, 대상 목록이 생산관리를 정함) · link(지금 방식으로 만들고 수주와 연결만) · hold(보류)
export const PT_CUSTS = [
  { code: 'AX', name: 'AXCELIS', dot: '#8b5cf6', mode: 'auto', rule: '호기에 붙은 고객사 PO → 같은 PO · 라인 · 분할의 수주대장 줄', how: '고객사 PO 연동이 이 목록의 품번만 호기를 만듭니다 (목록에 없는 AX-11 품번은 예전처럼 자동 · 「제외」한 품번은 안 만듦)' },
  { code: 'CSK', name: 'CSK', dot: '#f59e0b', mode: 'link', rule: 'Plnd order number (발주 1건 = 1대)', how: '생산관리는 지금처럼 CSK 생산 일정 엑셀로 만들고, 수주대장과는 Plnd 번호로 연결만 합니다' },
  { code: 'VM', name: 'VM', dot: '#10b981', mode: 'link', rule: '수주대장 줄 메모의 PROJECT 코드(없으면 PO 메모) = 생산관리 호기', how: '생산관리는 지금 그대로(새로 만들지 않음) · PROJECT 코드가 같은 수주 줄을 연결만 합니다' },
  { code: 'ED', name: 'Edwards', dot: '#3b82f6', mode: 'link', rule: '발주서 프로젝트 줄(예: Gen2 Plus_SS H2D #10) = 생산관리 프로젝트 + 호기 · 이름 앞부분만 같으면 「추정」', how: '생산관리는 지금처럼 포캐스트로 만들고, 수주 PO 와는 프로젝트 + 호기로 연결만 합니다 (고객사가 구성을 빼고 발주하는 경우가 있어 PO 줄 = 한 대는 아님)' },
]
export const ptCust = (code) => PT_CUSTS.find((c) => c.code === code) || PT_CUSTS[0]
export const GROUP_TONES = {
  violet: 'bg-violet-50 text-violet-700 border-violet-200', blue: 'bg-blue-50 text-blue-700 border-blue-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200', emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200', slate: 'bg-slate-100 text-slate-600 border-slate-200',
}
export const GROUP_COLORS = Object.keys(GROUP_TONES)
const DONE = (st) => st === '완료'
const s = (v) => (v == null ? '' : String(v).trim())

export async function fetchPtGroups(cust) {
  const { data, error } = await supabase.from('pm_prod_group').select('*').eq('customer_code', cust).order('sort').order('id')
  if (error) throw wrap(error)
  return data || []
}
export async function fetchPtTargets(cust) {
  try {
    return await fetchAll(() => supabase.from('pm_prod_target').select('*, items(std_code,name)').eq('customer_code', cust).order('id'))
  } catch (e) { throw wrap(e) }
}
// 생산관리 줄 (그 고객사 전체 — 완료 포함)
export async function fetchPtProd(cust) {
  return fetchAll(() => supabase.from('production').select('id,pn,name,hogi,status,req_date,po_id,csk').eq('customer_code', cust).order('id'))
}
// 연결 — 생산관리 줄마다 { id(생산관리 줄), n_lines, pos, guess }
export async function fetchPtLinks(cust) {
  try {
    return await fetchAll(() => supabase.from('pm_prod_link_sum_v').select('*').eq('customer_code', cust).order('id'))
  } catch (e) { throw wrap(e) }
}
// AXCELIS 진행 중 고객사 PO (품번별 진행 수주 수량) — 대상 목록 옆 숫자
export async function fetchAxOpenPo() {
  const { data: cs } = await supabase.from('customers').select('id').ilike('code', 'ax').limit(1)
  const cid = cs?.[0]?.id
  if (!cid) return []
  return fetchAll(() => supabase.from('purchase_orders').select('id,item_id,qty_ordered,third_party,items!purchase_orders_item_id_fkey(std_code,name)')
    .eq('customer_id', cid).eq('order_type', 'customer_po').eq('status', '진행중').order('id'))
}

// 매칭 요약 — 생산관리 줄마다 연결된 수주 줄
export function linkSummary(prod, links, cust) {
  const byProd = new Map(links.map((l) => [l.id, l]))
  const open = prod.filter((p) => !DONE(p.status))
  const linkedOpen = open.filter((p) => byProd.has(p.id))
  const unlinked = open.filter((p) => !byProd.has(p.id)).map((p) => ({ ...p, why: whyUnlinked(p, cust) }))
  return {
    total: prod.length, open: open.length, linkedAll: prod.filter((p) => byProd.has(p.id)).length, linkedOpen: linkedOpen.length,
    unlinked, pos: new Set(links.flatMap((l) => String(l.pos || '').split(', ').filter(Boolean))).size,
    guess: open.filter((p) => byProd.get(p.id)?.guess).length, byProd,
  }
}
function whyUnlinked(p, cust) {
  if (cust === 'AX') return p.po_id ? '수주대장에 이 PO · 라인 줄이 없음' : '고객사 PO 가 아직 안 붙음 (PO 연동 전)'
  if (cust === 'CSK') return p.csk?.plnd ? `수주대장에 Plnd ${p.csk.plnd} 줄이 없음` : '생산 일정에 Plnd 번호 없음'
  if (cust === 'VM') return `수주대장에 PROJECT ${p.hogi || '—'} 로 된 PO 가 없음`
  if (cust === 'ED') return `수주대장에 PROJECT 「${p.pn} ${p.hogi || ''}」 PO 가 없음 (이름이 많이 다르거나 아직 발주 전)`
  return '—'
}

// 진행 중 수주 줄 id → { hogis, n_prod, any_open, guess, prod_pns } (수주대장 「🏭 호기」). 표가 없으면(SQL 전) 빈 Map
//   v4.117.0 — 자재불출 여부(pm_line_issue_v)도 함께: issued(true/false) · issued_src(어디서 불출로 봤는지)
//     보기가 없으면(SQL 전) 불출 정보만 빠지고 나머지는 그대로
export async function fetchLineProdMap() {
  const sortH = (t) => String(t || '').split(' ').filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }))
  const [prod, iss] = await Promise.all([
    fetchAll(() => supabase.from('pm_line_prod_v').select('*').order('id')).catch(() => []),
    fetchAll(() => supabase.from('pm_line_issue_v').select('id,issued,src').order('id')).catch(() => []),
  ])
  const m = new Map(prod.map((r) => [r.id, { ...r, hogiList: sortH(r.hogis) }]))
  for (const r of iss) {
    const cur = m.get(r.id) || { id: r.id, hogiList: [] }
    m.set(r.id, { ...cur, issued: !!r.issued, issued_src: r.src || null })
  }
  return m
}

// ── 그룹 ──
export async function addPtGroup(cust, name, color) {
  const n = s(name)
  if (!n) throw new Error('그룹 이름을 적어 주세요')
  const { data: last } = await supabase.from('pm_prod_group').select('sort').eq('customer_code', cust).order('sort', { ascending: false }).limit(1)
  const { data, error } = await supabase.from('pm_prod_group').insert({ customer_code: cust, name: n, color: color || 'slate', sort: (last?.[0]?.sort || 0) + 1 }).select('*').single()
  if (error) throw (error.code === '23505' ? new Error('같은 이름의 그룹이 있습니다') : wrap(error))
  return data
}
export async function updatePtGroup(id, patch) {
  const p = { ...patch }
  if ('name' in p) { p.name = s(p.name); if (!p.name) throw new Error('그룹 이름을 적어 주세요') }
  const { error } = await supabase.from('pm_prod_group').update(p).eq('id', id)
  if (error) throw (error.code === '23505' ? new Error('같은 이름의 그룹이 있습니다') : wrap(error))
}
export async function deletePtGroup(id, count) {
  if (count > 0) throw new Error('품번이 남아 있는 그룹은 지울 수 없습니다 — 품번을 다른 그룹으로 옮긴 뒤 지우세요')
  const { error } = await supabase.from('pm_prod_group').delete().eq('id', id)
  if (error) throw wrap(error)
}

// ── 대상 품번 ──
//   품번 입력 → 품목 찾기 (숫자만 넣으면 고객사 접두 · AX- 를 붙여 본다)
export async function lookupPtItem(cust, code) {
  const c = s(code).toUpperCase()
  if (!c) return null
  const pre = { AX: 'AX-', CSK: 'CS-', VM: '', ED: 'ED-' }[cust] || ''
  const tries = [...new Set([c, pre && !c.startsWith(pre) ? pre + c : null].filter(Boolean))]
  for (const t of tries) {
    const { data } = await supabase.from('items').select('id,std_code,name').ilike('std_code', t).limit(1)
    if (data && data[0]) return data[0]
  }
  return null
}
export async function addPtTarget(cust, code, groupId, meName) {
  const it = await lookupPtItem(cust, code)
  if (!it) throw new Error(`품목 마스터에 없는 품번입니다 — ${s(code)}`)
  const { data, error } = await supabase.from('pm_prod_target')
    .upsert({ customer_code: cust, item_id: it.id, pn: it.std_code, group_id: groupId || null, active: true, created_name: meName || null, updated_at: new Date().toISOString() }, { onConflict: 'customer_code,pn' })
    .select('*, items(std_code,name)').single()
  if (error) throw wrap(error)
  return data
}
export async function updatePtTarget(id, patch) {
  const { error } = await supabase.from('pm_prod_target').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw wrap(error)
}
