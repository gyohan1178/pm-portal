// 고객사 표준 목록 (기존 7곳 하드코딩 통합용)
export const CUSTOMERS = [
  { id: 'ax',  name: 'AXCELIS', color: '#8b5cf6' },
  { id: 'ed',  name: 'Edwards', color: '#3b82f6' },
  { id: 'vm',  name: 'VM',      color: '#10b981' },
  { id: 'csk', name: 'CSK',     color: '#f59e0b' },
]

const byId = Object.fromEntries(CUSTOMERS.map(c => [c.id, c]))

// 개인 순서(customer_order 배열) 반영한 고객사 목록. 없으면 primary_customer 먼저, 그것도 없으면 기본.
export const orderedCustomers = (profile) => {
  const order = Array.isArray(profile?.customer_order) ? profile.customer_order : null
  if (order && order.length) {
    const ordered = order.map(id => byId[id]).filter(Boolean)
    const missing = CUSTOMERS.filter(c => !order.includes(c.id))
    return [...ordered, ...missing]
  }
  const p = profile?.primary_customer
  if (p && byId[p]) return [byId[p], ...CUSTOMERS.filter(c => c.id !== p)]
  return CUSTOMERS
}

// 1순위(기본) 고객사 코드
export const primaryCsCode = (profile) => orderedCustomers(profile)[0]?.id || 'ax'

// 기타 고객사 붙이기 (v4.177.0) — 주요 4곳 뒤에 DB customers 의 나머지(한화컨버전스 hc 등)를 붙인다
//   all = useCustomers() 결과 [{id, code, name}]. 붙인 것은 etc: true (고르는 칸에서 「기타 고객사」 묶음으로)
export const ETC_COLOR = '#94a3b8'
export const withEtcCustomers = (main, all = []) => {
  const has = new Set(main.map((c) => c.id))
  const etc = (all || [])
    .map((c) => ({ id: String(c.code || '').toLowerCase(), name: c.name || String(c.code || '').toUpperCase(), color: ETC_COLOR, etc: true }))
    .filter((c) => c.id && !has.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  return [...main, ...etc]
}
