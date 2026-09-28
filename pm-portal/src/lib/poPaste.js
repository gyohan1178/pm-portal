// 구매발주 — 엑셀 붙여넣기 읽기
//
//   두 가지 모양을 받는다.
//   ① 간단형     기준코드 · 수량 · 단가(선택)                (예전부터 쓰던 것)
//   ② 발주서형   발주일자 · 입고요청일자 · 공급업체 · 품목코드 · 수량 · 발주금액 · 메모
//                (이카운트 발주서 열 순서. 머리줄이 있으면 열 순서가 달라도 이름으로 찾는다)
//                ⚠ 「발주금액」은 단가로 본다 — 합계는 「합계금액」 열이 따로 있다.
//
//   발주서형은 줄을 합치지 않는다 — 같은 품목이라도 입고요청일·메모가 다르면 따로 발주된다.

const num = (s) => {
  const t = String(s ?? '').replace(/[,\s₩원]/g, '')
  if (t === '' || t === '-') return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}
// 2026-09-28 · 2026.9.28 · 2026/09/28 → 2026-09-28
export function normDate(s) {
  const m = String(s ?? '').trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}
const isDate = (s) => !!normDate(s)
const H = (s) => String(s ?? '').replace(/\s/g, '')

// 머리줄 이름 → 칸
const HEAD = [
  ['orderDate',   /발주일/],
  ['promiseDate', /입고요청|납기|요청일/],
  ['vendor',      /공급업체|구매처|거래처|업체/],
  ['code',        /품목코드|기준코드|품번|코드/],
  ['qty',         /수량/],
  ['price',       /단가|발주금액/],
  ['memo',        /메모|비고|적요/],
]
const ECOUNT_ORDER = ['orderDate', 'promiseDate', 'vendor', 'code', 'qty', 'price', 'memo']

export function parsePoPaste(text) {
  const raw = String(text || '').split(/\r?\n/).filter(l => l.trim())
  // 탭이 있으면 탭으로만 나눈다 — 80,000 처럼 쉼표가 든 숫자가 깨지지 않게
  const cells = raw.map(l => (l.includes('\t') ? l.split('\t') : l.split(',')).map(x => x.trim()))
  if (!cells.length) return { mode: null, rows: [], bad: [] }

  // 머리줄 찾기
  const first = cells[0].map(H)
  const hasHead = first.some(h => /품목코드|기준코드|입고요청|공급업체|발주일자/.test(h))
  let col = null
  if (hasHead) {
    col = {}
    first.forEach((h, i) => {
      if (/합계/.test(h)) return                      // 합계금액은 단가가 아니다
      const hit = HEAD.find(([k, re]) => col[k] === undefined && re.test(h))
      if (hit) col[hit[0]] = i
    })
  } else if (cells[0].length >= 5 && isDate(cells[0][0])) {
    col = Object.fromEntries(ECOUNT_ORDER.map((k, i) => [k, i]))
  }

  // ① 간단형
  if (!col) {
    const rows = cells.map((c, i) => ({ line: i + 1, code: c[0], qty: num(c[1]), price: num(c[2]) })).filter(r => r.code)
    return { mode: 'simple', rows, bad: [] }
  }

  // ② 발주서형
  const body = hasHead ? cells.slice(1) : cells
  const rows = [], bad = []
  body.forEach((c, i) => {
    const g = (k) => (col[k] === undefined ? '' : (c[col[k]] ?? ''))
    const r = {
      line: i + 1 + (hasHead ? 1 : 0),
      code: g('code').trim(),
      qty: num(g('qty')),
      price: num(g('price')),
      orderDate: normDate(g('orderDate')),
      promiseDate: normDate(g('promiseDate')),
      vendorName: g('vendor').trim(),
      memo: g('memo').trim(),
    }
    if (!r.code) return
    if (!(r.qty > 0)) { bad.push(`${r.line}줄 ${r.code} — 수량 없음`); return }
    if (g('promiseDate').trim() && !r.promiseDate) bad.push(`${r.line}줄 ${r.code} — 입고요청일 「${g('promiseDate')}」를 못 읽음 (비워 둠)`)
    rows.push(r)
  })
  return { mode: 'ecount', rows, bad }
}

// 업체 이름 맞추기 — 쓰는 방식이 달라도 같은 업체면 같은 것으로 본다.
//   (주)·㈜·주식회사·(유)·유한회사·(株)·Co.,Ltd·띄어쓰기·점·하이픈·괄호·대소문자는 무시.
//   「세봉」「(주)세봉」「㈜ 세봉」「세봉 」 → 전부 같은 업체.
//   똑같은 게 없으면 시트의 짧은 이름이 등록된 이름 안에 든 경우만, 그것도 한 곳만 걸릴 때 그것.
//   (거꾸로는 안 된다 — 「세봉전자」가 「세봉」으로 붙으면 다른 업체로 발주된다)
export const vkey = (s) => String(s || '')
  .replace(/[（(]\s*(주|유|株|사)\s*[)）]|㈜|㈲|주식회사|유한회사/g, '')
  .replace(/co\.?\s*,?\s*ltd\.?|inc\.?|corp\.?/gi, '')
  .replace(/[\s.\-_,·()（）]/g, '')
  .toLowerCase()
export function matchVendor(name, vendors) {
  const k = vkey(name)
  if (!k) return null
  const exact = vendors.filter(v => vkey(v.name) === k || (v.ecount_code && vkey(v.ecount_code) === k))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null            // 같은 이름이 둘 — 사람이 고른다
  const part = vendors.filter(v => vkey(v.name).includes(k))
  return part.length === 1 ? part[0] : null
}
