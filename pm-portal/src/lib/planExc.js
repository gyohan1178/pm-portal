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

// v4.56.0 부터 PO 업로드 때 Plan Exc 가 바뀌면 그 줄 변경 이력(changes)에 field 'plan_exc' 로 남긴다.
//   → 지금 값(HOT 등)이 언제 붙었는지: 마지막 plan_exc 이력의 to 가 지금 값이면 그 날짜.
//     이력이 없으면 기록을 시작하기 전(PLAN_LOG_START 이전)부터 붙어 있던 것 — 처음 붙은 날은 모른다.
export const PLAN_LOG_START = '2026-10-14'
export function planSince(p) {
  const k = String(p?.plan_exc || '').trim().toUpperCase()
  if (!k) return null
  const hist = (Array.isArray(p?.changes) ? p.changes : []).filter(c => c && c.field === 'plan_exc')
  const last = hist[hist.length - 1]
  if (last && String(last.to || '').trim().toUpperCase() === k) {
    return { known: true, at: String(last.at || '').slice(0, 10), from: last.from && last.from !== '-' ? last.from : '', times: hist.length }
  }
  return { known: false, at: null, from: '', times: hist.length }
}
export const planSinceText = (s) => !s ? '' : s.known
  ? `${s.at.slice(5).replace('-', '/')}~`
  : '기록 전'
export const planSinceTitle = (p, s) => !s ? '' : s.known
  ? `${s.at} PO 업로드 때 ${s.from ? s.from + ' → ' : '빈칸 → '}${String(p.plan_exc).toUpperCase()}`
  : `${PLAN_LOG_START} 기록 시작 전부터 ${String(p.plan_exc).toUpperCase()} — 처음 붙은 날짜는 모릅니다 (이후 바뀌면 날짜가 남습니다)`

export async function planExcReady(supabase) {
  const { error } = await supabase.from('purchase_orders').select('plan_exc').limit(1)
  return !error
}

// Plan Exc 가 붙은 PO 만 변경 이력(changes)을 따로 받는다 — 「언제부터」 표시용 (v4.59.0)
//   모든 줄의 changes 를 받으면 무거워서, HOT 등이 붙은 줄만 받는다.
//   실패해도 화면은 그대로 (배지는 뜨고 「언제부터」만 빠진다).
export async function fetchPlanChanges(supabase, ids) {
  const out = {}
  const list = [...new Set((ids || []).filter(Boolean))]
  try {
    for (let i = 0; i < list.length; i += 200) {
      const { data, error } = await supabase.from('purchase_orders').select('id,changes').in('id', list.slice(i, i + 200))
      if (error) throw error
      ;(data || []).forEach(p => { out[p.id] = p.changes || [] })
    }
  } catch (e) { console.warn('Plan Exc 이력 조회 실패', e) }
  return out
}
// 생산 호기(po_id) → Plan Exc 붙이기 — purchase_orders.plan_exc 가 없으면(SQL 전) 조용히 빈 값
export async function fetchPlanByPo(supabase, poIds) {
  const out = {}
  const list = [...new Set((poIds || []).filter(Boolean))]
  try {
    for (let i = 0; i < list.length; i += 200) {
      const { data, error } = await supabase.from('purchase_orders').select('id,plan_exc').in('id', list.slice(i, i + 200)).not('plan_exc', 'is', null)
      if (error) throw error
      ;(data || []).forEach(p => { if (String(p.plan_exc || '').trim()) out[p.id] = p.plan_exc })
    }
  } catch (e) { console.warn('Plan Exc 조회 실패', e) }
  return out
}
