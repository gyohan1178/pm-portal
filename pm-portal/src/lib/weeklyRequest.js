// 주간보고 — 그 주 자재요청 대응 집계 (v4.68.0)
//   pm_material_request 에서 그 주에 처리한 줄을 읽어 「불출 N품목 · 발주 M품목」으로 묶는다.
//     불출: handle_type='불출' · status='완료' (자재요청 화면에서 「불출」 → pm_request_issue 가 이렇게 남긴다)
//     발주: handle_type='발주' (재고가 없어 발주로 넘긴 것 — 나중에 불출되면 그 주의 불출로 옮겨 간다)
//   기준 시각은 handled_at (처리한 때). 2026-10-16 DB 확인: 주별 불출 줄 수가 출고 기록의 「자재요청 …」 메모 줄 수와 8주 모두 같았다.
//   품목 = 요청 품목 줄 수, 건 = 요청번호 수.

const CS_OF_CODE = { ax: 'AXCELIS', axcelis: 'AXCELIS', ed: 'Edwards', edwards: 'Edwards', vm: 'VM', csk: 'CSK' }
export const csOfCode = (code) => CS_OF_CODE[String(code || '').trim().toLowerCase()] || '기타'

// 한국 시간 그 주 월요일 0시 ~ 일요일 끝
export const weekBoundsKST = (from, to) => ({ gte: `${from}T00:00:00+09:00`, lte: `${to}T23:59:59.999+09:00` })

export async function fetchWeekRequests(supabase, from, to) {
  const b = weekBoundsKST(from, to)
  const { data, error } = await supabase.from('pm_material_request')
    .select('id,req_no,item_id,std_code,customer_code,check_dept,handle_type,status,handled_at')
    .in('handle_type', ['불출', '발주'])
    .gte('handled_at', b.gte).lte('handled_at', b.lte)
    .limit(5000)
  if (error) throw error
  return data || []
}

const blank = () => ({ items: 0, reqs: new Set() })
export function summarizeRequests(rows) {
  const tot = { 불출: blank(), 발주: blank() }
  const byCs = {}
  const byDept = {}
  for (const r of rows || []) {
    const kind = r.handle_type === '불출' ? (r.status === '완료' ? '불출' : null) : r.handle_type === '발주' ? '발주' : null
    if (!kind) continue
    const cs = csOfCode(r.customer_code)
    byCs[cs] = byCs[cs] || { 불출: blank(), 발주: blank() }
    const dept = String(r.check_dept || '').trim() || '부서 없음'
    byDept[dept] = byDept[dept] || blank()
    for (const t of [tot[kind], byCs[cs][kind], byDept[dept]]) { t.items++; if (r.req_no) t.reqs.add(r.req_no) }
  }
  const fin = (t) => ({ items: t.items, reqs: t.reqs.size })
  return {
    issue: fin(tot.불출), po: fin(tot.발주),
    byCs: Object.fromEntries(Object.entries(byCs).map(([k, v]) => [k, { issue: fin(v.불출), po: fin(v.발주) }])),
    byDept: Object.entries(byDept).map(([k, v]) => ({ dept: k, ...fin(v) })).sort((a, b) => b.items - a.items),
  }
}
