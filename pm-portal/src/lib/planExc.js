// 고객사 PO 엑셀의 「Plan Exc Type」 칸 (AXCELIS) — 고객사가 그 줄에 붙인 요청 표시 (2026-10-02)
//   HOT  = 고객사 입장에서 급한 건
//   RSIN = 리스케줄 인 · RSOU = 리스케줄 아웃 (납기 조정 요청)
//   CAN  = 고객사 코드 그대로 보여 준다
//   purchase_orders.plan_exc 에 업로드 때마다 파일 값으로 맞춘다 (빈칸이면 지운다).
export const PLAN_EXC = {
  HOT:  { label: 'HOT',  title: 'HOT — 고객사 긴급 요청',            cls: 'bg-red-100 text-red-700' },
  RSIN: { label: 'RSIN', title: 'RSIN — 리스케줄 인 (납기 조정 요청)',  cls: 'bg-sky-100 text-sky-700' },
  RSOU: { label: 'RSOU', title: 'RSOU — 리스케줄 아웃 (납기 조정 요청)', cls: 'bg-slate-100 text-slate-600' },
  CAN:  { label: 'CAN',  title: 'CAN — 고객사 Plan Exc Type 값',      cls: 'bg-amber-100 text-amber-700' },
}
export const planExcOf = (v) => {
  const k = String(v || '').trim().toUpperCase()
  if (!k) return null
  return PLAN_EXC[k] || { label: k, title: `${k} — 고객사 Plan Exc Type 값`, cls: 'bg-slate-100 text-slate-600' }
}
export const isHot = (p) => String(p?.plan_exc || '').trim().toUpperCase() === 'HOT'
// 납기 갱신 필요 목록 정렬 — HOT 먼저, 그다음 약속일이 오래 지난 순
export const dueSort = (a, b) =>
  (isHot(b) - isHot(a)) || String(a.promise_date || '').localeCompare(String(b.promise_date || '')) || String(a.po_number || '').localeCompare(String(b.po_number || ''))

export async function planExcReady(supabase) {
  const { error } = await supabase.from('purchase_orders').select('plan_exc').limit(1)
  return !error
}
