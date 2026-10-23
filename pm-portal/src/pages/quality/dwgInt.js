// 🏢 사내 도면 배포 (pm_dwg_int · pm_dwg_int_rcpt) — 데이터 · 규칙 (v4.93.0)
//
//   흐름: 영업이 고객사에서 받은 새 Rev 도면을 생산기술에 「공유」 → 생산기술이 받을 부서를 골라 「사내 배포」
//         → 부서마다 「수령 확인」 → (Rev 가 바뀐 경우) 옛 Rev 도면 「반납」
//   설계변경(CN)이나 직접 배포는 공유 없이 바로 배포해도 된다.
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'

export const RCV_DEPTS = ['전장팀', '하네스팀', '품질팀', '생산기술팀', '구매자재팀']
export const REASONS = ['설계변경', '신규', '재발행']

// 내가 수령 확인할 수 있는 부서 — 팀장급 · 관리자는 모두. 제조는 전장 · 하네스
export function myRcvDepts(p) {
  if (!p) return []
  if (p.role === 'admin' || p.is_lead) return RCV_DEPTS
  return ({ 제조: ['전장팀', '하네스팀'], 품질: ['품질팀'], 생산기술: ['생산기술팀'], 구매자재: ['구매자재팀'] })[p.dept] || []
}

export async function fetchDwgInt() {
  const rows = await fetchAll(() => supabase.from('pm_dwg_int').select('*').order('created_at', { ascending: false }).order('id'))
  const rc = await fetchAll(() => supabase.from('pm_dwg_int_rcpt').select('*').order('dept').order('id'))
  const by = new Map(rows.map((r) => [r.id, { ...r, rcpts: [] }]))
  rc.forEach((x) => by.get(x.dist_id)?.rcpts.push(x))
  return [...by.values()]
}

// 한 줄의 상태 — 공유됨(배포 대기) · 수령 대기 · 반납 대기 · 끝 · 취소
export function stateOf(r) {
  if (r.status === '취소') return 'cancel'
  if (r.status === '공유됨') return 'shared'
  if (r.rcpts.some((x) => !x.received_at)) return 'unrcv'
  if (r.recall_old && r.rcpts.some((x) => !x.returned_at)) return 'unret'
  return 'done'
}
export const STATE_LABEL = { shared: '배포 대기 (영업 공유)', unrcv: '수령 확인 대기', unret: '옛 Rev 반납 대기', done: '끝', cancel: '취소' }
export const STATE_TONE = {
  shared: 'bg-violet-50 text-violet-700 border-violet-200', unrcv: 'bg-amber-50 text-amber-700 border-amber-200',
  unret: 'bg-red-50 text-red-600 border-red-200', done: 'bg-emerald-50 text-emerald-700 border-emerald-200', cancel: 'bg-white text-slate-400 border-slate-200',
}

const norm = (s) => String(s || '').trim().toUpperCase()
// 같은 도면번호의 마지막 사내 배포 Rev — 새 배포 때 「옛 Rev 회수」를 정하는 데 쓴다
export function lastRev(rows, drawingNo, exceptId) {
  const k = norm(drawingNo)
  const hit = rows.filter((r) => r.id !== exceptId && r.status === '배포' && norm(r.drawing_no) === k)
    .sort((a, b) => String(b.dist_at || b.created_at).localeCompare(String(a.dist_at || a.created_at)))[0]
  return hit?.rev || null
}

// 붙여넣기 — 도면번호 · 품명 · Rev
export function parseDwgPaste(text) {
  return String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    .map((s) => s.split(/\t|,|\s{2,}/).map((x) => x.trim()))
    .filter((c) => c[0] && !/^(도면|drawing|품번|p\/?n)/i.test(c[0]))
    .map((c) => ({ drawing_no: c[0], item_name: c[1] || '', rev: c[2] || '' }))
}

const now = () => new Date().toISOString()

// 영업 → 생산기술 공유
export async function shareDwg(d, meName) {
  const { data, error } = await supabase.from('pm_dwg_int').insert({
    status: '공유됨', customer_code: d.customer_code || null, drawing_no: d.drawing_no.trim(), item_name: d.item_name || null,
    rev: d.rev || null, prev_rev: d.prev_rev || null, reason: '설계변경', share_name: meName || null, shared_at: now(),
    share_memo: d.share_memo || null, file_ref: d.file_ref || null, created_name: meName || null, updated_at: now(),
  }).select('*').single()
  if (error) throw error
  return data
}

// 사내 배포 — 공유된 줄을 배포로 바꾸거나(id) 새로 만든다. 부서마다 수령 줄을 만든다
export async function distribute({ id, head, depts, meName }) {
  const t = now()
  const patch = { ...head, status: '배포', dist_name: meName || null, dist_at: t, updated_at: t }
  let row
  if (id) {
    const { data, error } = await supabase.from('pm_dwg_int').update(patch).eq('id', id).select('*')
    if (error) throw error
    row = (Array.isArray(data) ? data[0] : data) || { id }
    if (!row.id) row = { ...row, id }
  } else {
    const { data, error } = await supabase.from('pm_dwg_int').insert({ ...patch, created_name: meName || null }).select('*').single()
    if (error) throw error
    row = data
  }
  if (depts.length) {
    const { error } = await supabase.from('pm_dwg_int_rcpt').insert(depts.map((d) => ({ dist_id: row.id, dept: d.dept, copies: Number(d.copies) || 1 })))
    if (error) throw error
  }
  return row
}

export async function markRcpt(ids, field, meName) {
  const patch = field === 'recv' ? { received_name: meName || null, received_at: now() } : { returned_name: meName || null, returned_at: now() }
  const { error } = await supabase.from('pm_dwg_int_rcpt').update(patch).in('id', ids)
  if (error) throw error
}

export async function cancelDwg(id) {
  const { error } = await supabase.from('pm_dwg_int').update({ status: '취소', updated_at: now() }).eq('id', id)
  if (error) throw error
}

// 도면별 현황 — 사내 배포 + 외주 배포(pm_drawing_dist)를 Rev 별로 모은다
export async function fetchExtDist(drawingNo) {
  const { data, error } = await supabase.from('pm_drawing_dist')
    .select('id, dist_date, vendor_name, contact_name, drawing_no, item_name, issue_no, status, scrap_notified_at')
    .ilike('drawing_no', String(drawingNo || '').trim())
  if (error) throw error
  return data || []
}
export function revMap(intRows, extRows, drawingNo) {
  const k = norm(drawingNo)
  const ints = intRows.filter((r) => r.status === '배포' && norm(r.drawing_no) === k)
  const cur = ints.sort((a, b) => String(b.dist_at).localeCompare(String(a.dist_at)))[0]?.rev
    || extRows.slice().sort((a, b) => String(b.dist_date).localeCompare(String(a.dist_date)))[0]?.issue_no || null
  const revs = new Map()
  const at = (rev) => { const key = norm(rev) || '—'; if (!revs.has(key)) revs.set(key, { rev: key, int: [], ext: [] }); return revs.get(key) }
  ints.forEach((r) => r.rcpts.forEach((x) => at(r.rev).int.push({ dept: x.dept, received_at: x.received_at, returned_at: x.returned_at, recall: false, distAt: r.dist_at })))
  extRows.forEach((e) => at(e.issue_no).ext.push(e))
  const list = [...revs.values()].map((v) => ({ ...v, current: !!cur && v.rev === norm(cur) }))
  // 옛 Rev 가 남은 곳 — 사내: 받았는데 반납 안 함 · 외주: 폐기통보 안 함
  list.forEach((v) => { if (!v.current) { v.leftInt = v.int.filter((x) => !x.returned_at); v.leftExt = v.ext.filter((x) => !x.scrap_notified_at) } else { v.leftInt = []; v.leftExt = [] } })
  return { cur: cur ? norm(cur) : null, list: list.sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || b.rev.localeCompare(a.rev)) }
}
