// 원가분석 순수 계산 코어 (DOM 무관). AXCELIS costanalysis 이식.
// PM-Portal 매핑: 매입가 = items.purchase_price (단일), 구매처 = vendors.name

export const DEFAULT_CFG = {
  buyRate: 1450,   // 기준매입환율 (수입품 달러원가 역산용)
  sellRate: 1250,  // 판매환율
  realRate: 0,     // 실환율 (0이면 미사용)
  laborMarg: 0.25, // 작업비 마진
  rebate: 0,       // 리베이트 %
}

// 구간 마진 (매입가 KRW 기준, 큰 구간부터)
export function tierMargin(buyKrw) {
  const v = Number(buyKrw) || 0
  if (v >= 1_000_000) return 0.20
  if (v >= 100_000) return 0.25
  if (v >= 10_000) return 0.35
  return 0.45
}

// 구매처명 → 수입/국내 자동 판정
export function autoOrigin(vendor) {
  const s = (vendor || '').trim()
  if (!s) return 'dom'
  const up = s.toUpperCase()
  if (/해외|수입|미국|사급|유로박스|\bRS\b/.test(s)) return 'imp'
  if (/국내|코리아|KOREA/i.test(s)) return 'dom'
  if (/\.(com|net)/i.test(up)) return 'imp'
  if (/[가-힣]/.test(s)) return 'dom'        // 한글 포함 → 국내
  if (/^[A-Z0-9\s.&-]+$/i.test(s)) return 'imp' // 영문/숫자만 → 수입
  return 'dom'
}

// 구매처 → origin (사용자 override 우선)
export function vendorOrigin(vendor, vendorMap = {}) {
  const key = (vendor || '').trim().toUpperCase()
  if (key && vendorMap[key]) return vendorMap[key]
  return autoOrigin(vendor)
}

// BOM 전개수량 계산 — 레벨 누적곱. rows는 level 순서대로.
// 입력 row: { level, qty_per_unit, ... }  → 출력에 expQty, excluded 추가
export function explodeBOM(rows) {
  const expByLevel = {}
  return rows.map((r, i) => {
    const lv = Number(r.level) || 0
    const raw = Number(r.qty_per_unit) || 0
    const shallower = Object.keys(expByLevel).map(Number).filter(l => l < lv)
    const parentExp = lv === 0 || shallower.length === 0 ? 1 : expByLevel[Math.max(...shallower)]
    const expQty = parentExp * raw
    expByLevel[lv] = expQty
    // 자기보다 깊은 레벨 캐시 무효화
    Object.keys(expByLevel).map(Number).filter(l => l > lv).forEach(l => { delete expByLevel[l] })
    return { ...r, uid: r.uid ?? i, expQty, excluded: r.excluded ?? (lv === 0) }
  })
}

// 원가 집계. items는 explodeBOM 결과 + 품목정보(purchase_price, vendor, registered).
export function computeCost(rows, cfg = DEFAULT_CFG, vendorMap = {}, laborKrw = 0) {
  const buyRate = Number(cfg.buyRate) || 1
  let impKrw = 0, impUsd = 0, domKrw = 0
  const items = rows.map(r => {
    const buyKrw = r.purchase_price == null ? null : Number(r.purchase_price)
    const origin = r.originOverride || vendorOrigin(r.vendor, vendorMap)
    const qty = Number(r.expQty) || 0
    const buyKrwTotal = buyKrw == null ? 0 : buyKrw * qty
    const status = !r.registered ? 'unreg' : buyKrw == null ? 'noprice' : 'ok'
    const counted = !r.excluded && status === 'ok'
    if (counted) {
      if (origin === 'imp') { impKrw += buyKrwTotal; impUsd += buyKrwTotal / buyRate }
      else domKrw += buyKrwTotal
    }
    return { ...r, buyKrw, origin, qty, buyKrwTotal, status, counted }
  })
  const labor = Number(laborKrw) || 0
  const totalBuyKrw = impKrw + domKrw + labor
  return { items, impKrw, impUsd, domKrw, laborKrw: labor, totalBuyKrw }
}

// 권장 판매가($) — 현재가·Target 둘 다 비었을 때. 구간마진으로 역산.
export function suggestPrice(items, cfg = DEFAULT_CFG, laborKrw = 0) {
  const sellRate = Number(cfg.sellRate) || 1
  let usd = 0
  for (const it of items) {
    if (!it.counted) continue
    const margin = it.marginOverride != null ? Number(it.marginOverride) : tierMargin(it.buyKrw)
    usd += it.buyKrw / (1 - margin) / sellRate * it.qty
  }
  const labor = Number(laborKrw) || 0
  if (labor > 0) usd += labor / (1 - (Number(cfg.laborMarg) || 0)) / sellRate
  return usd
}

// 매출/마진 계산 ($ 매출가 → KRW 마진). 환율 시나리오용 rate 주입 가능.
export function calcMargin({ sellUsd, totalBuyKrw, impUsd, sellRate, rebate = 0 }) {
  const revenueKrw = (Number(sellUsd) || 0) * (Number(sellRate) || 0)
  const rebateKrw = revenueKrw * (Number(rebate) || 0)
  const marginKrw = revenueKrw - totalBuyKrw - rebateKrw
  const marginPct = revenueKrw > 0 ? marginKrw / revenueKrw : 0
  return { revenueKrw, marginKrw, marginPct, rebateKrw }
}

// 환율 시나리오 — 판매환율 변동 시 마진 변화. 수입품은 impUsd(달러원가) 기준 재계산.
export function fxScenario({ sellUsd, domKrw, laborKrw, impUsd, baseBuyRate, sellRate, deltas = [0, -100, -200], rebate = 0 }) {
  return deltas.map(d => {
    const rate = sellRate + d
    // 수입 매입원가도 환율따라 변동(달러원가 × 해당환율), 국내·작업비는 KRW 고정
    const buyKrwAtRate = impUsd * rate + (Number(domKrw) || 0) + (Number(laborKrw) || 0)
    const m = calcMargin({ sellUsd, totalBuyKrw: buyKrwAtRate, impUsd, sellRate: rate, rebate })
    return { delta: d, rate, ...m }
  })
}
