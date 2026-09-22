import { supabase } from './supabase'
import { todayISO } from './utils'

// 발주번호 JS-YYMMDD-NN — 발주일 기준(과거 날짜로 등록해도 그날 번호가 나온다).
//
// ⚠ 원래 발주·부족·요청BOM 세 화면에 같은 함수가 따로 있었다. 여기 하나로 모았다.
// ⚠ 조회가 실패하면 멈춘다. 전에는 실패해도 「그날 첫 번호(-01)」를 만들어 번호가 겹쳤다.
// ⚠ 남은 한계: 두 사람이 같은 순간에 누르면 같은 번호가 나올 수 있다
//   (DB 순번이 아니라 「조회 → +1」 이라서). 한 발주번호에 여러 줄이 묶이는 구조라
//   DB 에서 중복을 막을 수도 없다.
export async function genPoNumber(dateStr) {
  const ymd = /^\d{4}-\d{2}-\d{2}/.test(String(dateStr || '')) ? String(dateStr).slice(0, 10) : todayISO()
  const [y, m, d] = ymd.split('-')
  const prefix = `JS-${y.slice(2)}${m}${d}-`
  const { data, error } = await supabase.from('purchase_orders')
    .select('po_number').like('po_number', `${prefix}%`)
  if (error) throw new Error('발주번호 조회 실패 — ' + error.message)
  const nums = (data || []).map((r) => parseInt(String(r.po_number || '').replace(prefix, ''), 10) || 0)
  const seq = (nums.length ? Math.max(...nums) : 0) + 1
  return `${prefix}${String(seq).padStart(2, '0')}`
}
