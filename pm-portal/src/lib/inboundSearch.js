// 구매입고 검색 — 무엇으로 찾을 수 있는가 (2026-10-07)
//   비고(메모)까지 찾는다. 세트 단위로 묶어 낸 발주는 비고에 세트 이름을 적어 두므로
//   그 이름으로 한꺼번에 불러 볼 수 있어야 한다. 발주번호로도 찾는다.
const low = (a) => a.filter(Boolean).join(' ').toLowerCase()

// 미입고 발주 한 줄
export const pendingHay = (po) => {
  const it = po?.items || {}
  return low([it.std_code, it.name, it.manufacturer, it.manufacturer_code, po?.mfr, po?.mfr_code, po?.memo, po?.po_number])
}
// 입고현황 한 줄 — 입고 비고(memo · note)와 발주 비고(purchase_orders.memo) 둘 다
export const histHay = (r) => {
  const it = r?.items || {}, po = r?.purchase_orders || {}
  return low([it.std_code, it.name, it.manufacturer, it.manufacturer_code, po.mfr, po.mfr_code, r?.memo, r?.note, po.memo, po.po_number])
}
// 입고현황 비고 칸 — 입고 비고가 먼저, 없으면 발주 비고
export const histMemo = (r) => r?.memo || r?.note || (r?.purchase_orders?.memo ? `발주: ${r.purchase_orders.memo}` : '')
