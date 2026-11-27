import { supabase } from './supabase'
import { genPoNumber } from './poNumber'
import { logActivity } from './activityLog'
import { fillProcRevs } from './bomProc'

// 구매발주 만들기 — 발주를 만드는 화면은 전부 여기를 거친다.
//   (구매발주 · 부족자재 · 월별 부족 · 소요예측 · 소요량 역산 · 발주 담기함)
//
//   예전엔 화면마다 purchase_orders 에 직접 넣어서, 규칙 하나를 더하려면 여섯 곳을 고쳐야 했다.
//   이제 규칙은 여기 한 곳에 둔다:
//     · 고정값  order_type='purchase' · status='진행중' · qty_received=0
//     · 확인    고객사·품목이 있어야 하고, 수량이 0 이하인 줄은 넣지 않는다 (몇 줄 뺐는지 돌려준다)
//     · 발주번호 opt.poNumber = 'auto' 면 새로 딴다 (한 번 호출 = 발주서 한 장)
//
//   rows : purchase_orders 에 들어갈 칸들 — customer_id · item_id · qty_ordered 는 필수,
//          나머지(vendor_id · type · unit_price · order_date · promise_date · po_number · memo · 외화 칸…)는
//          화면이 채운 그대로 넣는다.
//   opt  : { poNumber: 'auto' | '문자열' | null, orderDate, log: '기록에 남길 설명', customerName }
//   반환 : { made: [{ id, item_id, po_number, customer_id }], skipped: 수량 없어 뺀 줄 수 }
export async function createPurchaseOrders(rows, opt = {}) {
  const list = (rows || []).filter(Boolean)
  const noKey = list.filter(r => !r.customer_id || !r.item_id)
  if (noKey.length) throw new Error(`고객사·품목이 없는 줄이 ${noKey.length}개 있습니다`)
  const ok = list.filter(r => Number(r.qty_ordered) > 0)
  const skipped = list.length - ok.length
  if (!ok.length) throw new Error('발주 수량이 있는 줄이 없습니다')

  let po = null
  if (opt.poNumber === 'auto') po = await genPoNumber(opt.orderDate)
  else if (typeof opt.poNumber === 'string' && opt.poNumber.trim()) po = opt.poNumber.trim()

  // 가공물 줄에 BOM 최신 REV 저장 — 발주서 · 발주 목록에 「제조사품번_REV」로 나온다 (v4.251.0)
  //   REV 를 못 찾아도 발주는 그대로 만든다
  try { await fillProcRevs(ok) } catch (e) { console.warn('BOM REV 채우기 실패', e) }
  const payload = ok.map(r => ({
    ...r,
    ...(po && !r.po_number ? { po_number: po } : {}),
    qty_ordered: Number(r.qty_ordered),
    order_type: 'purchase',
    status: '진행중',
    qty_received: 0,
  }))
  const { data, error } = await supabase.from('purchase_orders')
    .insert(payload).select('id,item_id,po_number,customer_id')
  if (error) throw error
  if (opt.log) logActivity('create', 'purchase_orders', po, `${opt.log} ${payload.length}건`, null, opt.customerName || null)
  return { made: data || [], skipped }
}

// 만든 발주를 구매발주 화면에서 바로 보는 주소 — 방금 만든 줄만 골라져 있다
export function purchaseLink(csCode, made) {
  const ids = (made || []).map(m => m.id).filter(Boolean).slice(0, 200)
  return `/customer/${String(csCode || 'ax').toLowerCase()}/purchase?made=${ids.join(',')}`
}

// 붙여넣기로 담은 줄에 발주번호를 매긴다 — 업체·발주일·입고요청일이 같으면 한 발주서.
//   · 같은 조합의 발주서가 이미 있으면 그 번호를 그대로 쓴다 (구매발주 한 건 등록과 같은 규칙)
//   · 없으면 발주일마다 다음 번호를 딴다 (한 번에 여러 장이면 01, 02 … 이어서)
//   · 이미 번호가 있거나 _autoPo 가 아닌 줄은 건드리지 않는다
export const poGroupKey = (r) => `${r.vendor_id || ''}|${r.order_date || ''}|${r.promise_date || ''}`
export async function assignPoNumbers(rows) {
  // v4.253.0 — 발주번호는 이카운트 번호. 붙여넣기 발주에도 번호를 매기지 않는다 (보낼 때 이카운트가 줌)
  return rows.map(r => ({ ...r }))
}
