// 고객사별 품번 접두 — 품목(items.std_code)은 고객사 접두를 붙여 저장한다 (BOM 올리기와 같은 규칙)
//   AXCELIS AX- · Edwards ED- · CSK CS- · VM VM-
//   ⚠ 예전엔 여러 화면이 AX- 로 고정돼 있어 Edwards · VM · CSK 품번이 AX-ED-… 처럼 붙거나 못 찾았다 (v4.57.0)
//   ⚠ Edwards 상위품번(ASML 9B 등)처럼 접두 없이 저장된 코드도 있다 → 찾을 때는 「접두 붙인 것 · 그대로」 둘 다 본다
export const CUST_PREFIX = { AX: 'AX-', ED: 'ED-', CSK: 'CS-', CS: 'CS-', VM: 'VM-' }
const ANY = /^(AX|ED|CS|VM)-/i
export const prefixOf = (cs) => CUST_PREFIX[String(cs || '').toUpperCase()] || ''
export const hasPrefix = (code) => ANY.test(String(code || '').trim())
export const stripPrefix = (code) => String(code ?? '').trim().replace(ANY, '')
// 찾을 후보 — 이미 접두가 있으면 그대로, 없으면 [고객사 접두+품번, 품번]
export function codeCandidates(pn, cs) {
  const v = String(pn ?? '').trim().replace(/\.0$/, '')
  if (!v) return []
  if (hasPrefix(v)) return [v]
  const pre = prefixOf(cs)
  return pre ? [pre + v, v] : [v]
}
// 저장할 코드 — 접두가 없으면 고객사 접두를 붙인다 (이미 있으면 그대로)
export const withCustPrefix = (pn, cs) => {
  const v = String(pn ?? '').trim().replace(/\.0$/, '')
  if (!v) return ''
  return hasPrefix(v) ? v : prefixOf(cs) + v
}
