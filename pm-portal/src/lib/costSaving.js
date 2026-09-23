// 원가절감 계산 — 입고 기록을 기준단가와 견줘 금액으로 바꾼다.
//
//   기준단가 ① 표준단가(pm_std_price) — 엑셀에서 쓰던 DB단가. 있으면 이것을 쓴다.
//            ② 없으면 그 입고 직전 12개월의 「가중평균 매입가」
//   절감액   = (기준단가 − 이번 입고단가) × 이번 입고수량   ← 실제 입고수량 기준
//
//   ⚠ 표준단가 기준(①)이 팀이 대표 보고에 쓰던 방식이다. 지표의 「절감율」도
//     엑셀과 같게 표준단가 기준 금액(= 표준단가 × 수량)으로 나눈다.
//   ⚠ ②로 계산한 것은 시장가 하락도 섞이므로 「후보」로만 본다.
//   ⚠ 단가가 없는 입고(발주 외 입고 등)는 계산에서 뺀다.

const MONTH = (d) => String(d || '').slice(0, 7)
const num = (v) => Number(v) || 0
const ODD = 5   // 표준단가와 이만큼 넘게 벌어지면 「의심」

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
 * opt : { minPct: 3, minAmount: 30000, stdOf: Map(item_id|std_code → 표준단가) }
 * 반환: { rows: [...계산된 입고], months: [{ ym, buy, save, loss }], cand: [...후보] }
 */
export function computeSaving(rows, opt = {}) {
  const minPct = opt.minPct ?? 3, minAmount = opt.minAmount ?? 30000
  const stdOf = opt.stdOf || new Map()
  const stdPrice = (r) => num(stdOf.get(r.item_id) ?? stdOf.get(r.std_code)) || null
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
    const avg = q > 0 ? amt / q : null      // 직전 12개월 가중평균
    const std = stdPrice(r)                  // 표준단가(DB단가)
    const price = num(r.unit_price), qty = num(r.qty)
    // 표준단가와 입고단가가 5배 넘게 벌어지면 단위·환율·품번이 어긋난 것으로 본다.
    //   그대로 두면 지표가 통째로 망가지므로 「의심」으로 빼고 따로 보여 준다.
    const odd = !!std && (price > std * ODD || price < std / ODD)
    const base = (std && !odd) ? std : avg
    const basis = (std && !odd) ? 'std' : odd ? 'susp' : avg != null ? 'avg' : ''
    const diff = base == null ? 0 : (base - price) * qty
    const pct = base ? ((base - price) / base) * 100 : 0
    out.push({ ...r, base, basis, std, avg, odd, price, qty, buy: price * qty, baseBuy: (base ?? price) * qty, diff, pct, first: base == null })
    past.push({ date: r.movement_date, qty, price })
    hist.set(key, past)
  }

  // 월별 집계
  const mm = new Map()
  for (const r of out) {
    const ym = MONTH(r.movement_date)
    const m = mm.get(ym) || { ym, buy: 0, save: 0, loss: 0, n: 0, stdBuy: 0, stdDiff: 0 }
    m.buy += r.buy; m.n++
    if (r.basis === 'std') { m.stdBuy += r.baseBuy; m.stdDiff += r.diff }
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
    const x = m.get(k) || { item_id: k, std_code: r.std_code, name: r.name, buy: 0, diff: 0, qty: 0, n: 0, last: '', std: null, price: 0 }
    x.buy += r.buy; x.diff += r.diff; x.qty += r.qty; x.n++
    x.std = r.std ?? x.std; x.price = r.price
    if (String(r.movement_date) > x.last) x.last = r.movement_date
    m.set(k, x)
  }
  return [...m.values()]
}

/* ---- 묶어 보기 (고객사별 · 구매처별) ----
   절감율은 지표 전체와 같은 계산이다 — 표준단가로 잰 줄(basis==='std')만 모아
   (절감 − 상승) ÷ (표준단가 × 수량). 12개월 평균으로 잰 줄은 절감율에 안 넣는다. */
function group(rows, keyOf) {
  const m = new Map()
  for (const r of rows) {
    const k = keyOf(r) || '미지정'
    const x = m.get(k) || { key: k, buy: 0, diff: 0, qty: 0, n: 0, stdN: 0, stdBuy: 0, stdBase: 0, save: 0, loss: 0 }
    x.buy += r.buy; x.diff += r.diff; x.qty += r.qty; x.n++
    if (r.basis === 'std') {
      x.stdN++; x.stdBuy += r.buy; x.stdBase += r.baseBuy
      if (r.diff > 0) x.save += r.diff; else x.loss += -r.diff
    }
    m.set(k, x)
  }
  return [...m.values()]
    .map((x) => ({
      ...x, net: x.save - x.loss,
      pct: x.stdBase ? ((x.save - x.loss) / x.stdBase) * 100 : null,   // 표준단가가 하나도 없으면 null (— 로 보여 준다)
      cover: x.buy ? (x.stdBuy / x.buy) * 100 : 0,                     // 표준단가로 잰 구매액 비중
    }))
    .sort((a, b) => b.buy - a.buy)
}

// 고객사 — 기준코드 앞자리로 가른다 (AX-5001239 → AX)
export const custOf = (code) => (/^([A-Z]+)-/.exec(String(code || '')) || [, '기타'])[1]
export const CUST_NAME = { AX: 'AXCELIS', ED: '에드워드', VM: 'VM', CS: 'CSK', 기타: '기타' }

export const byCustomer = (rows) => group(rows, (r) => custOf(r.std_code))
export const byVendor = (rows) => group(rows, (r) => r.vendor)
// 기준이 언제 자료냐로 가르기 — 「26년 상반기 기준은 −0.5%, 25년 기준은 −12%(작년 대비 인상분)」을 보려고
export const byBase = (rows) => group(rows, (r) => r.stdLabel || '기준 없음')

// 표준단가와 너무 벌어져 지표에서 뺀 줄 (단위·환율·품번 확인용)
export function suspects(rows) {
  return rows.filter((r) => r.basis === 'susp')
    .sort((a, b) => Math.abs(b.std - b.price) * b.qty - Math.abs(a.std - a.price) * a.qty)
}

// 표준단가로 잰 것만 모아 합계 (엑셀 절감율과 같은 계산)
export function stdTotals(rows) {
  let save = 0, loss = 0, baseBuy = 0, buy = 0, n = 0
  for (const r of rows) {
    if (r.basis !== 'std') continue
    n++; baseBuy += r.baseBuy; buy += r.buy
    if (r.diff > 0) save += r.diff; else loss += -r.diff
  }
  return { save, loss, net: save - loss, baseBuy, buy, n, pct: baseBuy ? ((save - loss) / baseBuy) * 100 : 0 }
}

export const SAVING_KINDS = ['단가인하', '업체변경', '대체품', '사양변경', '발주통합', '물류', '클레임', '기타']
