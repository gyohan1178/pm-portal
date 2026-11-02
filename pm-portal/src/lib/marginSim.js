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

// 견적 단가 끝자리 (v4.129.0 · 견적 작성 · 마진 시뮬레이션 공통)
//   원화: 100원 미만 절삭 (107,692 → 107,600) — 100원이 안 되는 단가는 원 단위로만 (55 → 55, 0 이 되지 않게)
//   달러: 소수 둘째 자리부터 버림 (19,564.86 → 19,564.8) — 1달러가 안 되는 단가는 센트까지 (0.057 → 0.05)
//   ⚠ 2.3 × 10 이 22.999999… 가 되어 한 칸 내려가는 부동소수 오차를 막으려고 아주 작은 값을 더한다
export const roundPrice = (v, currency) => {
  const x = num(v)
  if (x <= 0) return 0
  if (currency === 'KRW') return x >= 100 ? Math.floor(x / 100 + 1e-9) * 100 : Math.floor(x + 1e-9)
  return x >= 1 ? Math.floor(x * 10 + 1e-7) / 10 : Math.floor(x * 100 + 1e-7) / 100
}

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
