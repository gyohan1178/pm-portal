// 수주대장 고객사 이름표 (v4.253.3) — orderIntake.js 에서 떼어 냄.
//   메뉴 · 문서 요청처럼 첫 화면에 뜨는 곳이 이것만 쓰려고 수주대장 코드 전체(약 70KB)를 받지 않게.
//   orderIntake.js 가 그대로 다시 내보내므로 기존 import 는 바꾸지 않아도 된다.
export const ORDER_CUSTOMERS = {
  AX:  { name: 'AXCELIS', prefix: 'AX-', color: '#8b5cf6', badge: 'bg-violet-50 text-violet-700' },
  ED:  { name: 'Edwards', prefix: 'ED-', color: '#3b82f6', badge: 'bg-blue-50 text-blue-700' },
  CSK: { name: 'CSK',     prefix: 'CS-', color: '#f59e0b', badge: 'bg-amber-50 text-amber-700' },
  VM:  { name: 'VM',      prefix: 'VM-', color: '#10b981', badge: 'bg-emerald-50 text-emerald-700' },
  // 기타 — 동원파츠 · 동신 · 두웰처럼 4개 고객사 밖의 업체. 직접 등록만 · 업체 이름은 pm_order.customer_name (v4.107.0)
  //   발주서 PDF · AX 엑셀 · 코드 정리(접두 규칙)에는 안 나온다 (manual)
  ETC: { name: '기타',    prefix: '',    color: '#64748b', badge: 'bg-slate-100 text-slate-700', manual: true },
}
