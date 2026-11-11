// 기타 고객사의 BOM 기준 고객사 (v4.130.0)
//
//   제스코 · 벨류엔지니어링처럼 Axcelis 품목 · BOM 을 그대로 쓰는 협력사, 남일처럼 Edwards 협력사는
//   포털에 고객사로 등록돼 있지 않아도(견적 접수 「기타 · 직접 입력」) 등록된 BOM 이 있으면 그걸로 점검 · 견적한다.
//   예전: 기타 고객사는 BOM 없이 단품 품목만 찾아 「BOM · 품목 없음」으로 막혔다.
//
//   기준 고객사 정하기
//     ① pm_settings 'etc_customer_ref' — { 정규화한 이름: 고객사 코드 } (견적 접수 화면에서 고르면 저장 · 다음부터 그대로)
//     ② 아래 기본값 (사용자가 알려 준 곳)
//     ③ 없으면 「자동」 — 등록 고객사를 차례로(AXCELIS → Edwards → CSK → VM …) 찾아 BOM 이 먼저 나오는 곳
import { supabase } from './supabase'
import { codeCandidates } from './custPrefix'

export const REF_KEY = 'etc_customer_ref'
export const REF_DEFAULTS = { 제스코: 'ax', 벨류엔지니어링: 'ax', 남일: 'ed', 두웰: 'ed', 한화컨버전스: 'hc', 한화: 'hc' }   // 두웰 v4.134.0 · 한화 v4.175.0
const ORDER = ['ax', 'ed', 'csk', 'vm', 'hc']

// (주)벨류엔지니어링 · 벨류 엔지니어링 · ㈜제스코 → 벨류엔지니어링 · 제스코
export const normName = (s) => String(s || '')
  .replace(/\(주\)|㈜|주식회사|\(유\)|유한회사/g, '').replace(/[\s·.,()-]/g, '').toLowerCase()

export async function fetchRefSetup() {
  const [{ data: cs, error: e1 }, { data: st }] = await Promise.all([
    supabase.from('customers').select('id, code, name'),
    supabase.from('pm_settings').select('value').eq('key', REF_KEY).maybeSingle(),
  ])
  if (e1) throw e1
  const customers = (cs || []).map((c) => ({ ...c, code: String(c.code || '').toLowerCase() }))
    .sort((a, b) => (ORDER.indexOf(a.code) + 1 || 99) - (ORDER.indexOf(b.code) + 1 || 99))
  return { customers, map: st?.value || {} }
}

// 이 기타 고객사의 기준 고객사 코드 — 정해진 게 없으면 null(자동)
export function refCodeOf(name, setup) {
  const k = normName(name)
  if (!k) return null
  // 저장해 둔 값이 기본값보다 먼저 (빈 값 = 「자동」으로 고른 것)
  const saved = Object.entries(setup?.map || {}).find(([n]) => normName(n) === k)
  if (saved) return saved[1] ? String(saved[1]).toLowerCase() : null
  // 기본값은 이름 앞부분만 맞아도 (남일 = 남일인스트루먼트 · v4.134.0)
  const def = Object.entries(REF_DEFAULTS).find(([n]) => normName(n) === k) || Object.entries(REF_DEFAULTS).find(([n]) => k.startsWith(normName(n)))
  return def ? def[1] : null
}

// 찾아볼 고객사 순서 — 정해져 있으면 그곳만, 아니면 전부(자동)
export function refCustomers(name, setup) {
  const code = refCodeOf(name, setup)
  const all = setup?.customers || []
  if (code) return all.filter((c) => c.code === code)
  return all
}

// 기타 고객사 품번으로 등록 어셈블리(BOM) 찾기 — { proj, cs } 또는 null
//   고객사마다 그 고객사 접두를 붙여 찾는다 (110123660 → AX-110123660 · ED-110123660 …)
export async function findAssyFor(pn, customers) {
  for (const cs of customers || []) {
    const cands = codeCandidates(pn, cs.code)
    if (!cands.length) continue
    const { data, error } = await supabase.from('projects').select('id, code, name, rev')
      .eq('customer_id', cs.id).in('code', cands)
    if (error) throw new Error('어셈블리 조회 — ' + error.message)
    const proj = cands.map((c) => (data || []).find((x) => x.code === c)).find(Boolean)
    if (proj) return { proj, cs }
  }
  return null
}

// 단품 후보 품번 — 기준 고객사 접두를 붙인 것까지 (AX-… · ED-… · 그대로)
export function itemCandidatesFor(pn, customers) {
  const out = []
  for (const cs of customers || []) for (const c of codeCandidates(pn, cs.code)) if (!out.includes(c)) out.push(c)
  for (const c of codeCandidates(pn, '')) if (!out.includes(c)) out.push(c)
  return out
}

// 기준 고객사 저장 (견적 접수에서 고를 때) — code 가 비면 「자동」(지움)
export async function saveRefCode(name, code) {
  const k = String(name || '').trim()
  if (!k) return
  const { data: cur } = await supabase.from('pm_settings').select('value').eq('key', REF_KEY).maybeSingle()
  const v = { ...(cur?.value || {}) }
  Object.keys(v).forEach((n) => { if (normName(n) === normName(k)) delete v[n] })
  v[k] = code || ''   // 빈 값 = 자동 (기본값도 쓰지 않음)
  const { error } = await supabase.from('pm_settings').upsert({ key: REF_KEY, value: v, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw error
}
