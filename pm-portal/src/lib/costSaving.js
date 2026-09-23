// 원가절감 계산 — 입고 기록에서 단가 변화를 금액으로 바꾼다.
//
//   기준단가 = 그 입고 직전 12개월의 「가중평균 매입가」 (같은 품목, 입고수량으로 가중)
//   절감액   = (기준단가 − 이번 입고단가) × 이번 입고수량   ← 실제 입고수량 기준
//
//   ⚠ 이 숫자는 시장가가 내려서 생긴 것도 섞여 있다. 그래서 이건 「후보」이고,
//     실적으로 인정할 것만 대장(pm_cost_saving)에 등록한다.
//   ⚠ 단가가 없는 입고(발주 외 입고 등)는 계산에서 뺀다.

const MONTH = (d) => String(d || '').slice(0, 7)
const num = (v) => Number(v) || 0

// 12개월 전 날짜 (YYYY-MM-DD) — 글자만 바꾼다.
//   ⚠ new Date 로 계산하면 시간대 때문에 하루가 밀린다 (한국 시간 브라우저에서 실제로 밀렸다)
export function minus12m(ymd) {
  const t = String(ymd || '').slice(0, 10)
  const y = Number(t.slice(0, 4))
  return `${y - 1}${t.slice(4)}`
}

/**
 * rows: 입고 기록 [{ id, item_id, qty, unit_price, movement_date, po_number, vendor, std_code, name }]
 *       (날짜 오름차순일 필요 없음 — 안에서 정렬한다)
 * opt : { minPct: 3, minAmount: 30000 }  후보로 띄울 최소 조건
 * 반환: { rows: [...계산된 입고], months: [{ ym, buy, save, loss }], cand: [...후보] }
 */
export function computeSaving(rows, opt = {}) {
  const minPct = opt.minPct ?? 3, minAmount = opt.minAmount ?? 30000
  const use = (rows || [])
    .filter((r) => r.movement_date && num(r.qty) > 0 && num(r.unit_price) > 0)
    .sort((a, b) => String(a.movement_date).localeCompare(String(b.movement_date)))

  const hist = new Map()   // item_id → [{ date, qty, price }]
  const out = []
  for (const r of use) {
    const key = r.item_id
    const past = hist.get(key) || []
    const from = minus12m(r.movement_date)
    let q = 0, amt = 0
    for (const h of past) {
      if (h.date < from) continue          // 12개월보다 오래된 것은 뺀다
      q += h.qty; amt += h.qty * h.price
    }
    const base = q > 0 ? amt / q : null     // 직전 12개월 가중평균
    const price = num(r.unit_price), qty = num(r.qty)
    const diff = base == null ? 0 : (base - price) * qty
    const pct = base ? ((base - price) / base) * 100 : 0
    out.push({ ...r, base, price, qty, buy: price * qty, diff, pct, first: base == null })
    past.push({ date: r.movement_date, qty, price })
    hist.set(key, past)
  }

  // 월별 집계
  const mm = new Map()
  for (const r of out) {
    const ym = MONTH(r.movement_date)
    const m = mm.get(ym) || { ym, buy: 0, save: 0, loss: 0, n: 0 }
    m.buy += r.buy; m.n++
    if (r.diff > 0) m.save += r.diff; else m.loss += -r.diff
    mm.set(ym, m)
  }
  const months = [...mm.values()].sort((a, b) => a.ym.localeCompare(b.ym))

  // 후보 — 기준단가가 있고, 내려갔고, 비율·금액이 기준 이상
  const cand = out
    .filter((r) => !r.first && r.diff >= minAmount && r.pct >= minPct)
    .sort((a, b) => b.diff - a.diff)

  return { rows: out, months, cand }
}

// 후보 한 건의 식별자 — 같은 건을 두 번 띄우지 않으려고 쓴다
export const candKey = (r) => `${r.item_id}|${r.movement_date}|${Math.round(num(r.unit_price) * 100)}`

// 품목별 묶음 (Top 표)
export function byItem(rows) {
  const m = new Map()
  for (const r of rows) {
    const k = r.item_id
    const x = m.get(k) || { item_id: k, std_code: r.std_code, name: r.name, buy: 0, diff: 0, qty: 0, n: 0, last: '' }
    x.buy += r.buy; x.diff += r.diff; x.qty += r.qty; x.n++
    if (String(r.movement_date) > x.last) x.last = r.movement_date
    m.set(k, x)
  }
  return [...m.values()]
}

// 거래처별 묶음
export function byVendor(rows) {
  const m = new Map()
  for (const r of rows) {
    const k = r.vendor || '미지정'
    const x = m.get(k) || { vendor: k, buy: 0, diff: 0, n: 0 }
    x.buy += r.buy; x.diff += r.diff; x.n++
    m.set(k, x)
  }
  return [...m.values()].sort((a, b) => b.buy - a.buy)
}

export const SAVING_KINDS = ['단가인하', '업체변경', '대체품', '사양변경', '발주통합', '물류', '클레임', '기타']
