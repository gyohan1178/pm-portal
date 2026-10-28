// 자료 요청 (v4.98.0) — 도면 · BOM · 사양서를 영업에 요청 → 영업이 고객사에 받아서 올림 → 요청한 부서로 알림
//   진행 0 요청됨 → 1 고객사에 요청함 → 2 받음 → 3 요청 부서 확인. 영업은 한 칸 뒤로 되돌릴 수 있다 (잘못 눌렀을 때)
//   같은 품번 · 같은 자료 · 같은 고객사가 진행 중이면 새로 만들지 않고 「같이 기다리기」
//   SQL: 자료요청_반영_261025.sql (표 pm_doc_request · 함수 pm_doc_request_move / cancel / follow / autorecv)
import { supabase } from './supabase'
import { ORDER_CUSTOMERS } from './orderIntake'
import { todayISO } from './utils'

export const DOC_KINDS = ['도면', 'BOM', '사양서', '기타']
// 「직접 입력」 (v4.101.0) — 화면에서는 「직접 입력」, DB 에는 kind='기타' + kind_label(예: CN 내역)
export const KIND_SHOW = { 기타: '직접 입력' }
export const kindLabel = (r) => (r?.kind === '기타' ? (s(r.kind_label) || '기타') : r?.kind || '—')
export const DOC_LABEL_SQL_HINT = '「직접 입력」 칸이 아직 없습니다 — Supabase SQL Editor 에서 자료요청_직접입력_반영_261026.sql 을 먼저 실행해 주세요'
export const DOC_STEPS = ['요청됨', '고객사에 요청함', '받음', '확인 완료']
export const DOC_DEPTS = ['구매자재', '생산기술', '제조', '품질', '영업']
// 기타(ETC)는 수주대장에도 생겨 ORDER_CUSTOMERS 에 들어 있다 (v4.107.0) — 두 번 넣지 않게
export const DOC_CUSTOMERS = [...Object.entries(ORDER_CUSTOMERS).filter(([code]) => code !== 'ETC').map(([code, c]) => ({ code, name: c.name, badge: c.badge })), { code: 'ETC', name: '기타', badge: 'bg-slate-100 text-slate-600' }]
export const custName = (code) => DOC_CUSTOMERS.find((c) => c.code === code)?.name || code || '—'
export const custBadge = (code) => DOC_CUSTOMERS.find((c) => c.code === code)?.badge || 'bg-slate-100 text-slate-600'
export const KIND_BADGE = { 도면: 'bg-blue-50 text-blue-700', BOM: 'bg-violet-50 text-violet-700', 사양서: 'bg-emerald-50 text-emerald-700', 기타: 'bg-slate-100 text-slate-600' }

const s = (v) => (v == null ? '' : String(v).trim())
const missing = (e) => e && (e.code === '42P01' || e.code === 'PGRST205' || /pm_doc_request/.test(e.message || '') && /does not exist|not find/i.test(e.message || ''))
export const DOC_SQL_HINT = '자료 요청 표가 아직 없습니다 — 「자료요청_반영_261025.sql」 을 실행하세요'

// 품번 → 고객사 짐작 (포털 코드 접두)
export function guessCustomer(code) {
  const c = s(code).toUpperCase()
  if (c.startsWith('AX-') || /^\d{9}$/.test(c)) return 'AX'
  if (c.startsWith('ED-')) return 'ED'
  if (c.startsWith('VM-')) return 'VM'
  if (c.startsWith('CS')) return 'CSK'
  return ''
}

// 품번 입력 → 품목 찾기. 숫자만 넣으면 AX- 를 붙여 본다
export async function lookupItem(code) {
  const c = s(code).toUpperCase()
  if (!c) return null
  const tries = [c]
  if (/^\d{6,}$/.test(c)) tries.push('AX-' + c)
  for (const t of tries) {
    const { data } = await supabase.from('items').select('id,std_code,name').ilike('std_code', t).limit(1)
    if (data && data[0]) return data[0]
  }
  return null
}

// 필요일까지 남은 날 (음수 = 지남)
export function dLeft(need, today = todayISO()) {
  if (!need) return null
  return Math.round((new Date(String(need).slice(0, 10)) - new Date(today)) / 86400000)
}

// 업무 흐름 숫자 — 진행 중 요청만 가볍게
export const docCountsQuery = {
  queryKey: ['docRequests', 'counts'],
  queryFn: async () => {
    const { data, error } = await supabase.from('pm_doc_request').select('id,status,from_dept,also_depts,need_date')
      .eq('cancelled', false).lt('status', 3).limit(2000)
    if (error) return null
    return docCountsOf(data || [])
  },
  staleTime: 2 * 60 * 1000,
  refetchInterval: 5 * 60 * 1000,
}
export function docCountsOf(rows, today = todayISO()) {
  const out = { open: 0, late: 0, byDept: {} }
  const add = (dept, k) => { if (!dept) return; out.byDept[dept] = out.byDept[dept] || { wait: 0, recv: 0 }; out.byDept[dept][k]++ }
  for (const r of rows) {
    const depts = [r.from_dept, ...(r.also_depts || [])]
    if (r.status < 2) {
      out.open++
      if (r.need_date && String(r.need_date).slice(0, 10) < today) out.late++
      depts.forEach((d) => add(d, 'wait'))
    } else if (r.status === 2) depts.forEach((d) => add(d, 'recv'))
  }
  return out
}

export async function fetchDocRequests() {
  const { data, error } = await supabase.from('pm_doc_request').select('*').order('id', { ascending: false }).limit(2000)
  if (error) { if (missing(error)) { const e = new Error(DOC_SQL_HINT); e.missing = true; throw e } throw error }
  return data || []
}

// 진행 중 같은 자료가 있나
//   직접 입력은 이름(kind_label)까지 같아야 같은 요청 — 품번 없이 「CN 내역」만 요청해도 고객사 · 이름으로 묶인다
export async function findOpenSame({ part_no, kind, customer_code, kind_label }) {
  if (kind === '기타' && !s(kind_label)) return null
  const pn = s(part_no)
  const q0 = supabase.from('pm_doc_request').select('*')
  const q = (pn ? q0.ilike('part_no', pn) : q0.eq('part_no', '')).eq('kind', kind).eq('customer_code', customer_code).eq('cancelled', false).lt('status', 2).limit(20)
  const { data, error } = await q
  if (error) return null
  const want = s(kind_label).toUpperCase()
  return (data || []).find((r) => kind !== '기타' || s(r.kind_label).toUpperCase() === want) || null
}

// 요청 만들기 — 같은 자료가 진행 중이면 「같이 기다리기」로 붙인다. 반환 { row, followed }
export async function createDocRequest(f, me) {
  const part = s(f.part_no)
  if (!DOC_KINDS.includes(f.kind)) throw new Error('무엇이 필요한지 고르세요')
  const etc = f.kind === '기타'
  if (etc && !s(f.kind_label)) throw new Error('어떤 자료인지 적어 주세요 (예: CN 내역)')
  if (!part && !etc) throw new Error('품번을 넣으세요')
  if (!s(f.customer_code)) throw new Error('어느 고객사 자료인지 고르세요')
  if (!s(f.from_dept)) throw new Error('요청 부서를 고르세요')
  if (!f.need_date) throw new Error('필요일을 넣으세요')
  const same = await findOpenSame({ part_no: part, kind: f.kind, customer_code: f.customer_code, kind_label: f.kind_label })
  if (same) {
    if (same.from_dept === f.from_dept || (same.also_depts || []).includes(f.from_dept)) return { row: same, followed: false, already: true }
    const { data, error } = await supabase.rpc('pm_doc_request_follow', { p_id: same.id, p_dept: f.from_dept })
    if (error) throw error
    return { row: data, followed: true }
  }
  const row = {
    kind: f.kind, customer_code: f.customer_code, item_id: f.item_id || null, part_no: part, item_name: s(f.item_name) || null,
    rev: f.kind === '도면' ? s(f.rev) || null : null, need_date: f.need_date, reason: s(f.reason) || null, ref: s(f.ref) || null,
    source: f.source || 'direct', from_dept: f.from_dept, requester_name: me?.name || null,
    ...(etc ? { kind_label: s(f.kind_label) } : {}),   // 직접 입력일 때만 보낸다 — SQL 전에도 도면 · BOM · 사양서 요청은 그대로 됨
  }
  const { data, error } = await supabase.from('pm_doc_request').insert(row).select('*').single()
  if (error) {
    // 동시에 같은 요청이 들어온 경우 — 같이 기다리기로
    if (error.code === '23505') {
      const again = await findOpenSame(row)
      if (again) { const r2 = await supabase.rpc('pm_doc_request_follow', { p_id: again.id, p_dept: f.from_dept }); if (!r2.error) return { row: r2.data, followed: true } }
    }
    if (missing(error)) throw new Error(DOC_SQL_HINT)
    if (/kind_label/.test(error.message || '')) throw new Error(DOC_LABEL_SQL_HINT)
    throw error
  }
  return { row: data, followed: false }
}

// 목록에서 다른 부서 요청에 「같이 기다리기」로 붙기 (v4.108.1)
export async function followDoc(id, dept) {
  const { data, error } = await supabase.rpc('pm_doc_request_follow', { p_id: id, p_dept: dept })
  if (error) throw error
  return data
}

export async function moveDoc(id, to, note) {
  const { data, error } = await supabase.rpc('pm_doc_request_move', { p_id: id, p_to: to, p_note: s(note) || null })
  if (error) throw error
  return data
}
export async function cancelDoc(id, note) {
  const { data, error } = await supabase.rpc('pm_doc_request_cancel', { p_id: id, p_note: s(note) || null })
  if (error) throw error
  return data
}
export async function autoRecv() {
  const { data, error } = await supabase.rpc('pm_doc_request_autorecv')
  if (error) return 0
  return Number(data) || 0
}

// 고객사에 보낼 한 통 — AXCELIS · Edwards 는 영어, 나머지는 한글
export function mailText(rows, cust) {
  const en = cust === 'AX' || cust === 'ED'
  const kindEn = { 도면: 'drawing', BOM: 'BOM', 사양서: 'spec sheet', 기타: 'document' }
  const pn = (r) => (cust === 'AX' ? s(r.part_no).replace(/^AX-/, '') : s(r.part_no))
  const what = (r) => (r.kind === '기타' && s(r.kind_label) ? s(r.kind_label) : en ? kindEn[r.kind] || 'document' : r.kind)
  const head = (r) => [pn(r) + (r.rev ? ' Rev ' + r.rev : ''), what(r)].filter(Boolean).join(' — ')
  const lines = rows.map((r, i) => en
    ? `${i + 1}) ${head(r)}${r.need_date ? ` (needed by ${String(r.need_date).slice(5, 10)})` : ''}`
    : `${i + 1}) ${head(r)}${r.need_date ? ` (${String(r.need_date).slice(5, 10)}까지)` : ''}`)
  return en
    ? `Hi,\n\nCould you please share the documents below?\n${lines.join('\n')}\n\nThank you.`
    : `안녕하세요, 진선테크입니다.\n아래 자료 공유 부탁드립니다.\n${lines.join('\n')}\n\n감사합니다.`
}

// 누가 무엇을 할 수 있나
//   영업(또는 관리자): 앞으로 0→1→2, 뒤로 2→1→0 · 요청 부서: 받음 확인 2→3, 확인 취소 3→2, 요청됨일 때 취소
export function docPerms(profile, row, canEdit) {
  const admin = profile?.role === 'admin'
  const sales = admin || profile?.dept === '영업'
  const mineDept = !!profile?.dept && (row.from_dept === profile.dept || (row.also_depts || []).includes(profile.dept))
  const req = admin || mineDept
  if (!canEdit || row.cancelled) return { next: false, prev: false, confirm: false, unconfirm: false, cancel: false }
  return {
    next: sales && row.status < 2,
    prev: sales && (row.status === 1 || row.status === 2),
    confirm: req && row.status === 2,
    unconfirm: req && row.status === 3,
    cancel: (sales && row.status < 2) || (req && row.status === 0),
  }
}
