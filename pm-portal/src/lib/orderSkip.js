// 발주서 PDF 등록 때 빼는 품목 (v4.142.0) — 업체마다 「수주대장에 안 넣는 줄」
//   예: 남일 발주서의 EARTH CABLE · 현장 작업 인건비 — 진선이 만들어 납품하는 품목이 아니라 수주대장 · Edwards 생산관리에 뜨면 안 된다
//   규칙 = { id, cust:'ETC'|'AX'|…, name:'남일'(기타 업체일 때 이름 앞부분), pn?:'NRE164305', text?:'EARTH CABLE 2900MM', memo? }
//     · pn   — 발주서 품번이 같으면 (고객사 접두 ED- 등 · 공백 · 기호 무시)
//     · text — 품번이 없는 줄도 잡게: 품명 · 사양 글자에 이 글이 들어 있으면 (띄어쓰기 · 대소문자 무시)
//   저장: pm_settings 'order_pdf_skip' = { rules: [...] } — 모든 PC 공통. 저장된 값이 없으면 아래 기본값(영업 요청 3가지)
//   같은 PO 를 다시 올리면 빠진 줄은 「줄 빠짐」 → 취소 표시(이력 남음)로 정리된다 (saveOrder 의 removed)
import { supabase } from './supabase'
import { stripPrefix } from './custPrefix'

export const SKIP_KEY = 'order_pdf_skip'
export const DEFAULT_SKIP = [
  { id: 'd1', cust: 'ETC', name: '남일', pn: 'ED-NRE164305', memo: 'EARTH CABLE 2000MM ASSY (2026-11-04 영업 요청)' },
  { id: 'd2', cust: 'ETC', name: '남일', text: 'EARTH CABLE 2900MM ASSY HVM', memo: '품번 없음 (2026-11-04 영업 요청)' },
  { id: 'd3', cust: 'ETC', name: '남일', text: '현장 작업', memo: '현장 작업 인건비 (2026-11-04 영업 요청)' },
]

const s = (v) => (v == null ? '' : String(v))
const normPn = (v) => stripPrefix(s(v).trim()).toUpperCase().replace(/[^0-9A-Z]/g, '')
const normText = (v) => s(v).toUpperCase().replace(/\s+/g, '')
const normName = (v) => s(v).toLowerCase().replace(/[\s()㈜]|주식회사|\(주\)/g, '')

export async function fetchSkipRules() {
  const { data, error } = await supabase.from('pm_settings').select('value').eq('key', SKIP_KEY).maybeSingle()
  if (error) throw error
  const r = data?.value?.rules
  return Array.isArray(r) ? r : DEFAULT_SKIP
}
export async function saveSkipRules(rules) {
  const { error } = await supabase.from('pm_settings').upsert({ key: SKIP_KEY, value: { rules }, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw error
  return rules
}

// 이 발주서(po)에 해당하는 규칙
export function rulesFor(po, rules) {
  return (rules || []).filter((r) => r && r.cust === po?.customer
    && (r.cust !== 'ETC' || (normName(r.name) && normName(po.customer_name).startsWith(normName(r.name)))))
}
// 이 줄을 빼는 규칙 (없으면 null)
export function skipRuleOf(line, rules) {
  const pn = normPn(line?.pn), txt = normText(`${s(line?.desc)} ${s(line?.spec)}`)
  return (rules || []).find((r) => (r.pn && pn && normPn(r.pn) === pn) || (r.text && normText(r.text) && txt.includes(normText(r.text)))) || null
}
export const ruleLabel = (r) => (r.pn ? `품번 ${stripPrefix(r.pn)}` : `「${r.text}」 들어간 줄`)

// 줄에서 규칙 하나 만들기 — 품번이 있으면 품번, 없으면 품명
export function ruleFromLine(po, line, by) {
  const pn = s(line.pn).trim()
  const base = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), cust: po.customer, by: by || null, at: new Date().toISOString().slice(0, 10) }
  if (po.customer === 'ETC') base.name = s(po.customer_name).trim()
  return pn ? { ...base, pn, memo: s(line.desc).trim() || null } : { ...base, text: s(line.desc).trim() || s(line.spec).trim(), memo: '품번 없음' }
}
