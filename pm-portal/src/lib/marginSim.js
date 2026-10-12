// 매출견적 마진 시뮬레이터 계산 (2026-10-12)
//   원가(원)는 고정, 제출 단가 · 판매 환율만 바꿔 본다. 매입 환율은 반영하지 않는다(수입 비중이 작음).
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// 원화 매출 = 단가 × 환율 (원화 견적이면 단가 그대로)
export const revenueKrw = (price, rate, currency) =>
  currency === 'KRW' ? num(price) : num(price) * num(rate)

export function simMargin({ price, rate, cost, currency }) {
  const rev = revenueKrw(price, rate, currency)
  const margin = rev - num(cost)
  return { rev, margin, pct: rev > 0 ? margin / rev : null }
}

// 이 마진율이 나오는 단가 (pct 0 = 손익분기)
export function priceForMargin({ cost, rate, currency, pct }) {
  const p = num(pct)
  if (p >= 1) return null
  const krw = num(cost) / (1 - p)
  if (currency === 'KRW') return Math.ceil(krw)
  const r = num(rate)
  return r > 0 ? Math.ceil((krw / r) * 100 - 1e-7) / 100 : null
}

// 단가 반올림 — 견적 규칙과 같게 (달러는 센트 올림, 원화는 원 단위)
export const roundPrice = (v, currency) =>
  currency === 'KRW' ? Math.round(num(v)) : Math.round(num(v) * 100) / 100

// 단가 × 환율 마진표
export function marginGrid({ price, rate, cost, currency,
  priceSteps = [0.05, 0, -0.05, -0.1, -0.15], rateSteps = [-100, -50, 0, 50, 100] }) {
  const rates = currency === 'KRW' ? [num(rate)] : rateSteps.map(d => num(rate) + d)
  return priceSteps.map(s => {
    const p = roundPrice(num(price) * (1 + s), currency)
    return { step: s, price: p, cells: rates.map(r => ({ rate: r, ...simMargin({ price: p, rate: r, cost, currency }) })) }
  })
}

// 마진 → 색 구분
export const marginTone = (pct, target) =>
  pct == null ? 'none' : pct < 0 ? 'loss' : pct < num(target) ? 'low' : 'ok'
