// 이카운트 대조 — 판매(거래명세서) 자료 ↔ 수주대장 (v4.94.0)
//
//   ① 판매입력 파일 만들기: 수주대장에서 납품했는데 판매입력이 안 된 줄 → 이카운트 「판매입력」 업로드 양식(Template)
//        PO 하나 = 명세서 하나 → 같은 일자 · 같은 PO 줄은 같은 순번
//   ② 대조: 이카운트 판매현황(또는 같은 양식) 엑셀을 올리면 PO No. · 품목코드로 줄을 맞춘다
//        맞음 → 「판매입력 마감」(sales_done_at) + PO 에 명세서번호(일자-순번)가 비어 있으면 채움
//        수량 · 금액 다름 / 이카운트에만 있음 / 납품했는데 판매 없음 / 구두 발주 미마감 → 확인 목록
//   품목코드는 이카운트 코드(기준코드 JS-…)가 기본 — 포털 코드 · 고객사 품번으로도 맞춘다.
import { supabase } from './supabase'
import { logActivity } from './activityLog'
import { ORDER_CUSTOMERS, normKey, lineKey } from './orderIntake'
import { custOf, kindOf, ymd } from './orderEntry'

// 이카운트 판매입력 양식 머리글 — 받은 Template 그대로 (순서 · 글자)
export const SALES_HEAD = ['일자', '순번', '거래유형', '거래처코드', '거래처명', '통화', '환율', '담당자', '출하창고', '배송방법', '프로젝트', '메모', 'PO No.', '임시(구 메모)', '품목코드', '품목명', '규격', '수량', '단가', '단가(vat포함)', '외화공급가액', '공급가액', '부가세', '적요', '생산전표생성']

const s = (v) => (v == null ? '' : String(v).trim())
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[,₩$\s]/g, '')); return Number.isFinite(n) ? n : null }
const p2 = (n) => String(n).padStart(2, '0')
const isUsd = (o) => o?.currency === 'USD' || o?.ccn === 'B'

// 명세서번호 모양 맞추기 — 「2026/10/23 -4」 · 「20261023-4」 · 「2026-10-23-4」 → 2026/10/23-4
export function normSlip(v) {
  const t = s(v)
  if (!t) return ''
  const m = t.match(/(\d{4})\D?(\d{1,2})\D?(\d{1,2})\s*-\s*(\d+)/)
  return m ? `${m[1]}/${p2(m[2])}/${p2(m[3])}-${+m[4]}` : t.replace(/\s/g, '')
}

// 거래처명 → 고객사 (대조에서 PO 를 못 찾은 줄을 고객사로 거를 때)
export function custOfName(name) {
  const t = s(name).toUpperCase()
  if (/AXCELIS|엑셀리스|액셀리스/.test(t)) return 'AX'
  if (/EDWARDS|에드워드|에드워즈/.test(t)) return 'ED'
  if (/CSK|씨에스케이/.test(t)) return 'CSK'
  if (/\bVM\b|브이엠|VM\s*(INC|CO)|^VM/.test(t)) return 'VM'
  return custOf(name)
}

// 판매 자료 읽기 — 「품목코드」 · 「수량」 머리글이 있는 시트. 일자+순번 또는 일자-No. 한 칸
export function parseEcountSales(XLSX, wb) {
  let sheet = null, aoa = null, hi = -1
  for (const n of wb.SheetNames) {
    const a = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true })
    const i = a.findIndex((r) => r.some((c) => s(c).replace(/\s/g, '') === '품목코드') && r.some((c) => s(c).replace(/\s/g, '') === '수량'))
    if (i >= 0) { sheet = n; aoa = a; hi = i; break }
  }
  if (!aoa) throw new Error('「품목코드」 · 「수량」 머리글이 있는 시트를 못 찾았습니다 — 이카운트 판매현황(또는 판매입력 양식)을 올리세요')
  const H = aoa[hi].map((c) => s(c).replace(/\s/g, '').replace(/\.$/, '').toUpperCase())
  const col = (...names) => { for (const n of names) { const i = H.indexOf(n.replace(/\s/g, '').replace(/\.$/, '').toUpperCase()); if (i >= 0) return i } return -1 }
  const C = {
    date: col('일자'), seq: col('순번', 'NO'), dateNo: col('일자-NO', '일자-NO.', '전표번호'), cust: col('거래처명'), po: col('PO NO', 'PONO', 'PO번호', 'PO'),
    code: col('품목코드'), name: col('품목명'), spec: col('규격'), qty: col('수량'), price: col('단가'), fsup: col('외화공급가액'), sup: col('공급가액'), cur: col('통화'), memo: col('적요'),
  }
  const rows = []
  aoa.slice(hi + 1).forEach((r, k) => {
    const g = (i) => (i < 0 ? '' : r[i])
    const code = s(g(C.code)), qty = num(g(C.qty))
    if (!code && qty == null) return
    if (/^(합계|소계|total)/i.test(s(g(C.date))) || /^(합계|소계)/.test(code)) return
    let date = null, seq = null
    if (C.dateNo >= 0 && s(g(C.dateNo))) { const sl = normSlip(g(C.dateNo)); const m = sl.match(/^(\d{4})\/(\d{2})\/(\d{2})-(\d+)$/); if (m) { date = `${m[1]}-${m[2]}-${m[3]}`; seq = +m[4] } }
    if (!date) { date = ymd(g(C.date)); seq = num(g(C.seq)) }
    rows.push({
      row: hi + 2 + k, date, seq, slip: date && seq != null ? `${date.replace(/-/g, '/')}-${seq}` : '', cust_name: s(g(C.cust)), po_no: s(g(C.po)),
      code, name: s(g(C.name)), spec: s(g(C.spec)), qty: qty ?? 0, price: num(g(C.price)), supply: num(g(C.sup)), fsupply: num(g(C.fsup)), currency: s(g(C.cur)), memo: s(g(C.memo)),
    })
  })
  return { rows, sheet }
}

const codesOf = (l) => {
  const it = l.items || {}
  return new Set([it.js_code, it.std_code, String(it.std_code || '').replace(/^(AX|ED|VM|CS)-/i, ''), l.raw_pn].filter(Boolean).map(normKey))
}
const shipQty = (l) => (+l.delivered_qty > 0 ? +l.delivered_qty : +l.qty || 0)
const inMonth = (d, month) => !month || String(d || '').slice(0, 7) === month

// 대조 — rows: parseEcountSales().rows · orders: fetchOrders() · month 'YYYY-MM' · cust 'all' | 코드
export function matchEcount({ rows, orders, month, cust = 'all' }) {
  const byPo = new Map(), bySlip = new Map()
  orders.forEach((o) => {
    if (o.planned) return
    const k = normKey(o.po_no)
    if (k) { if (!byPo.has(k)) byPo.set(k, []); byPo.get(k).push(o) }
    if (o.slip_no) bySlip.set(normSlip(o.slip_no), o)
  })
  const used = new Set(), items = []
  const want = (c) => cust === 'all' || c === cust
  for (const r of rows.filter((x) => inMonth(x.date, month))) {
    const nameCust = custOfName(r.cust_name)
    const cand = byPo.get(normKey(r.po_no)) || []
    let o = cand.find((x) => x.customer_code === nameCust) || cand[0] || (r.slip ? bySlip.get(normSlip(r.slip)) : null) || null
    if (!want(o ? o.customer_code : nameCust)) continue
    if (!o) { items.push({ kind: 'only_ecount', r, cust: nameCust }); continue }
    const code = normKey(r.code)
    const ls = o.lines.filter((l) => !l.cancelled && !used.has(l.id) && codesOf(l).has(code))
    const l = ls.find((x) => shipQty(x) === +r.qty) || ls[0]
    if (!l) { items.push({ kind: 'diff', why: '품목 없음', r, o, cust: o.customer_code }); continue }
    used.add(l.id)
    const usd = isUsd(o)
    const want$ = Math.round((+r.qty || 0) * (+l.unit_price || 0) * (usd ? 100 : 1)) / (usd ? 100 : 1)
    const got$ = usd ? (r.fsupply ?? r.supply) : (r.supply ?? (r.price != null ? r.price * r.qty : null))
    const why = []
    if (+r.qty !== shipQty(l)) why.push(`수량 ${shipQty(l)} ↔ ${r.qty}`)
    if (got$ != null && +l.unit_price > 0 && Math.abs(got$ - want$) > (usd ? 0.01 : 1)) why.push('금액')
    if (r.price != null && +l.unit_price > 0 && Math.abs(r.price - +l.unit_price) > (usd ? 0.001 : 0.5)) why.push(`단가 ${l.unit_price} ↔ ${r.price}`)
    items.push({ kind: why.length ? 'diff' : 'ok', why: why.join(' · '), r, o, l, cust: o.customer_code, closed: !!l.sales_done_at, amount: got$ })
  }
  // 수주대장 쪽 — 이 달 납품했는데 이카운트 판매가 없음 · 구두 발주 미마감
  orders.forEach((o) => {
    if (o.planned || !want(o.customer_code)) return
    o.lines.forEach((l) => {
      if (l.cancelled || used.has(l.id)) return
      if (+l.delivered_qty > 0 && !l.sales_done_at && inMonth(l.delivered_at, month)) items.push({ kind: 'no_sale', o, l, cust: o.customer_code })
      else if (kindOf(o) === 'verbal' && o.slip_no && !l.sales_done_at && !(+l.delivered_qty > 0)) items.push({ kind: 'verbal_open', o, l, cust: o.customer_code })
    })
  })
  const counts = { ok: 0, diff: 0, only_ecount: 0, no_sale: 0, verbal_open: 0, closed: 0 }
  items.forEach((x) => { counts[x.kind]++; if (x.kind === 'ok' && x.closed) counts.closed++ })
  return { items, counts }
}

// 맞은 줄 마감 — sales_done_at + PO 명세서번호(비어 있으면). PO 마다 이력 한 줄
export async function applyEcount(okItems, meName) {
  const todo = okItems.filter((x) => x.kind === 'ok' && x.l && !x.l.sales_done_at)
  if (!todo.length) throw new Error('새로 마감할 줄이 없습니다')
  const t = new Date().toISOString()
  const ids = todo.map((x) => x.l.id)
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from('pm_order_line').update({ sales_done_at: t, updated_at: t }).in('id', ids.slice(i, i + 200))
    if (error) throw error
  }
  const byOrder = new Map()
  todo.forEach((x) => { if (!byOrder.has(x.o.id)) byOrder.set(x.o.id, { o: x.o, slip: x.r.slip, n: 0 }); byOrder.get(x.o.id).n++ })
  const heads = []
  for (const { o, slip } of byOrder.values()) {
    if (!o.slip_no && slip) {
      const { error } = await supabase.from('pm_order').update({ slip_no: slip, updated_at: t }).eq('id', o.id)
      if (error && !/slip_no/.test(error.message || '')) throw error
      if (!error) heads.push({ id: o.id, slip_no: slip })
    }
  }
  const logs = [...byOrder.values()].map(({ o, slip, n }) => ({ order_id: o.id, line_key: null, field: 'sales_done', before_val: null, after_val: `이카운트 대조 ${n}품목 마감${slip ? ` · 명세서 ${slip}` : ''}`, source: 'manual', changed_name: meName || null }))
  const { error: e2 } = await supabase.from('pm_order_change').insert(logs)
  if (e2) throw e2
  logActivity('update', 'pm_order', `${byOrder.size}건`, `이카운트 대조 마감 ${todo.length}품목`, null, null)
  return { ids, at: t, heads }
}

// 판매입력 파일 — 고른 줄(납품 · 판매입력 전) → 이카운트 판매입력 업로드 양식
//   custCodes: { AX: '거래처코드', ... } (이카운트 거래처코드 — 비우면 거래처명만)
export function salesInputRows(lines, custCodes = {}) {
  const sorted = [...lines].sort((a, b) => String(a.delivered_at || '').localeCompare(String(b.delivered_at || '')) || String(a.o.po_no).localeCompare(String(b.o.po_no)) || (+a.line_no - +b.line_no))
  const seqOf = new Map(), nextSeq = new Map()
  return sorted.map((l) => {
    const o = l.o, date = String(l.delivered_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    const k = `${date}|${o.id}`
    if (!seqOf.has(k)) { const n = (nextSeq.get(date) || 0) + 1; nextSeq.set(date, n); seqOf.set(k, n) }
    const q = shipQty(l), price = +l.unit_price || 0, usd = isUsd(o)
    const amt = Math.round(q * price * (usd ? 100 : 1)) / (usd ? 100 : 1)
    const row = {
      일자: date.replace(/-/g, ''), 순번: seqOf.get(k), 거래유형: '', 거래처코드: custCodes[o.customer_code] || '', 거래처명: ORDER_CUSTOMERS[o.customer_code]?.name || o.customer_code,
      통화: usd ? 'USD' : '', 환율: '', 담당자: '', 출하창고: '', 배송방법: '', 프로젝트: '', 메모: '', 'PO No.': o.po_no, '임시(구 메모)': '',
      품목코드: l.items?.js_code || l.items?.std_code || l.raw_pn || '', 품목명: l.items?.name || l.raw_desc || '', 규격: l.spec || '',
      수량: q, 단가: price || '', '단가(vat포함)': '', 외화공급가액: usd ? amt : '', 공급가액: usd ? '' : amt, 부가세: '', 적요: `${o.po_no} ${lineKey(l)}`, 생산전표생성: '',
    }
    return SALES_HEAD.map((h) => row[h])
  })
}
export function salesInputWorkbook(XLSX, lines, custCodes) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([SALES_HEAD, ...salesInputRows(lines, custCodes)])
  ws['!cols'] = SALES_HEAD.map((h) => ({ wch: Math.max(8, h.length * 2 + 2) }))
  XLSX.utils.book_append_sheet(wb, ws, '판매입력')
  return wb
}
