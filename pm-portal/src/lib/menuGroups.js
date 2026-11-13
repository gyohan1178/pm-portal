// 메뉴 묶음 (v4.187.0) — 비슷한 화면 둘을 사이드바에서는 한 줄로, 화면 위에는 탭으로
//   화면 주소는 그대로라 예전 즐겨찾기 · 링크 · 업무 흐름에서 넘어오는 길이 모두 그대로 동작한다
//   to 가 함수면 지금 고객사 코드로 주소를 만든다 (부족자재는 고객사별 화면)
export const MENU_GROUPS = [
  { id: 'fa', tabs: [
    { to: '/quality/fa-progress', label: '🚦 초도품 진행관리' },
    { to: '/quality/fai', label: '🧾 자재 매칭' },
  ] },
  { id: 'code', tabs: [
    { to: '/master/items', label: '🗂️ 기준코드 DB' },
    { to: '/master/codemap', label: '🔢 고객사 코드 매핑' },
  ] },
  { id: 'price', tabs: [
    { to: '/quote', label: '💲 단가 등록' },
    { to: '/master/price', label: '📈 단가 변동 이력' },
  ] },
  { id: 'short', tabs: [
    { to: (cs) => `/customer/${cs}/short`, match: /^\/customer\/([^/]+)\/short(\/|$)/, label: '🚨 부족자재 (발주 필요)' },
    { to: '/missing', label: '🧩 결품 현황 (호기별 미불출)' },
  ] },
]
const hit = (t, path) => (t.match ? t.match.test(path) : path === t.to || path.startsWith(t.to + '/'))
// 지금 주소가 속한 묶음 — { group, active(탭 번호), cs(주소에 든 고객사 코드) }
export function menuGroupOf(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/'
  for (const g of MENU_GROUPS) {
    const i = g.tabs.findIndex((t) => hit(t, path))
    if (i >= 0) { const m = g.tabs[i].match?.exec(path); return { group: g, active: i, cs: m ? m[1] : null } }
  }
  return null
}
