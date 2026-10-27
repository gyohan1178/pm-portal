// 수주대장 → 자재 요청 (v4.103.0)
//   단품으로 바로 납품하는 줄을 체크해 그대로 자재 요청을 만든다 (구매자재가 렉에 챙겨 둔다)
//   자재 요청 화면(pm_request_create)과 같은 함수 · 같은 칸으로 저장 → 자재 요청 목록 · 할 일 · 관제탑에 그대로 뜬다
import { supabase } from './supabase'
import { todayISO } from './utils'

// 어느 수주 줄에서 온 요청인지 — 요청 줄의 「사유」에 남긴다 (사람이 읽는 글 · 같은 줄 다시 요청 확인에도 씀)
export const mrTagOf = (l) => `수주 PO ${l.o?.po_no || ''} · ${l.line_no}/${l.del_line || '1'}`

// 체크한 수주 줄 → 요청 줄 초안 (남은 수량 = 수량 − 납품)
export function mrDraftOf(lines) {
  return (lines || []).map((l) => {
    const left = Math.max(0, (+l.qty || 0) - Math.min(+l.delivered_qty || 0, +l.qty || 0))
    return {
      key: l.id, tag: mrTagOf(l), po: l.o?.po_no || '', due: l.due_date || '', cust: l.o?.customer_code || '',
      item_id: l.item_id || null,
      std_code: l.items?.std_code || String(l.raw_pn || '').trim(),
      item_name: l.items?.name || String(l.raw_desc || '').trim(),
      qty: String(left || +l.qty || 1),
    }
  })
}

// 기본 머리 — 필요일 = 가장 빠른 납기 (지났으면 오늘) · 고객사 = 다 같으면 그 고객사
export function mrHeadOf(lines, meName) {
  const today = todayISO()
  const dues = (lines || []).map((l) => l.due_date).filter(Boolean).sort()
  const pos = [...new Set((lines || []).map((l) => l.o?.po_no).filter(Boolean))]
  const custs = [...new Set((lines || []).map((l) => l.o?.customer_code).filter(Boolean))]
  return {
    requester_name: meName || '', check_dept: '구매자재팀', req_kind: '', urgency: '보통',
    need_date: dues[0] ? (dues[0] < today ? today : dues[0]) : '',
    purpose: `수주 단품 납품 — PO ${pos[0] || ''}${pos.length > 1 ? ` 외 ${pos.length - 1}건` : ''}`,
    customer_code: custs.length === 1 ? custs[0] : '',
  }
}

// 같은 수주 줄로 이미 요청한 것 (반려 · 취소 빼고) — 두 번 요청하지 않게 알려만 준다
export async function fetchPrevMr(tags) {
  if (!tags?.length) return new Map()
  const { data, error } = await supabase.from('pm_material_request').select('req_no,status,reason,qty,created_at').in('reason', tags)
  if (error) return new Map()       // 못 읽어도 요청은 할 수 있게
  const m = new Map()
  ;(data || []).filter((r) => !['반려', '취소'].includes(r.status)).forEach((r) => { if (!m.has(r.reason)) m.set(r.reason, r) })
  return m
}

export async function createMrFromOrder(head, rows) {
  const valid = (rows || []).filter((r) => (r.std_code || r.item_name) && Number(r.qty) > 0)
  if (!valid.length) throw new Error('요청할 품목 · 수량이 없습니다')
  if (!String(head.requester_name || '').trim()) throw new Error('요청자를 적어 주세요')
  if (!String(head.purpose || '').trim()) throw new Error('사용 목적을 적어 주세요')
  if (!head.check_dept) throw new Error('확인부서를 고르세요')
  if (head.check_dept === '하네스팀' && !head.req_kind) throw new Error('하네스팀은 요청 종류(제작 · 자재)를 고르세요')
  const payload = valid.map((r) => ({
    urgency: head.urgency || '보통', purpose: head.purpose.trim(),
    requester_name: head.requester_name.trim(), check_dept: head.check_dept,
    customer_code: head.customer_code || '',
    req_kind: head.check_dept === '하네스팀' ? head.req_kind : null,
    product_code: '', product_name: '', unit_no: '', need_date: head.need_date || null,
    item_id: r.item_id, std_code: r.std_code, item_name: r.item_name, maker: '', maker_code: '',
    qty: Number(r.qty), unit: 'EA', reason: r.tag,
  }))
  const { data, error } = await supabase.rpc('pm_request_create', { p_rows: payload })
  if (error) throw error
  return Number(data) || valid.length
}
