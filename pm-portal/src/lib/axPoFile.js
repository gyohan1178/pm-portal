// AXCELIS PO 엑셀 → 수주대장 줄 (v4.90.5)
//
//   「고객사 PO」 탭에 올리는 그 PO 관리 엑셀을 수주대장에서 바로 읽는다.
//     · Current Data 시트 = 진행 중 줄
//     · Received 시트     = 납품 줄 (「현황」 칸: 납품 완료 · 발송 완료 → 납품 / 발주 취소 → 취소 / 그 밖 → 진행 중)
//   같은 PO · 라인 · 분할이 두 시트에 다 있으면 Current Data 가 우선 (아직 진행 중인 줄)
//   Received 는 몇 년치가 쌓여 있어 올해 납기 이후만 쓴다 (매출 집계와 같은 기준)
//   열 이름 찾기 · 날짜 읽기 · 구분(16=하네스 · 11=전장 · 그 밖=구매품)은 「고객사 PO」 업로드와 같은 규칙
// Received 「현황」 판정 — 고객사 PO 업로드(CustomerPOUpload.rcvStateOf)와 같은 규칙
const rcvStateOf = (v) => {
  const t = String(v ?? '').trim().replace(/\s/g, '')
  if (/취소|cancel/i.test(t)) return 'cancel'
  if (/(납품|발송)완료/.test(t)) return 'done'
  return 'unknown'
}

const pick = (row, keys) => {
  for (const k of Object.keys(row)) {
    const kn = k.replace(/\s/g, '').toLowerCase()
    if (keys.some((t) => kn.includes(t))) return row[k]
  }
  return undefined
}
const pickExact = (row, keys) => {
  for (const k of Object.keys(row)) {
    const kn = k.replace(/\s/g, '').toLowerCase()
    if (keys.some((t) => kn === t)) return row[k]
  }
  return undefined
}
const s = (v) => (v == null ? '' : String(v).trim())
const n0 = (v) => s(v).replace(/\.0$/, '')
const num = (v) => { const x = parseFloat(s(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(x) ? x : 0 }
export const dnorm = (v) => {
  if (v == null || v === '') return null
  if (v instanceof Date) {
    if (isNaN(v)) return null
    const d = new Date(v.getTime() + 12 * 3600 * 1000)      // 정오 보정 (고객사 PO 업로드와 같음)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  if (typeof v === 'number' || /^\d{4,6}$/.test(s(v))) {
    const serial = Number(v)
    if (serial > 20000 && serial < 80000) {
      const d = new Date(Math.round((serial - 25569) * 86400 * 1000))
      if (!isNaN(d)) return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    }
  }
  const m = s(v).match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null
}
export const divisionOf = (pn) => (pn.startsWith('16') ? '하네스' : pn.startsWith('11') ? '전장' : '구매품')
const keyOf = (r) => `${r.po_number}|${r.order_line || '1'}|${r.del_line || '1'}`

// wb: XLSX.read 결과 · XLSX: xlsx 모듈 · from: 이 날짜 이후 Received 만 (기본 올해 1월 1일)
export function parseAxPoWorkbook(XLSX, wb, from = `${new Date().getFullYear()}-01-01`) {
  const curName = wb.SheetNames.find((x) => /current\s*data/i.test(x))
  const rcvName = wb.SheetNames.find((x) => /received|receive/i.test(x))
  if (!curName) throw new Error('「Current Data」 시트가 없습니다 — AXCELIS PO 관리 엑셀이 맞는지 확인하세요')
  const rowsOf = (name) => (name ? XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' }) : [])

  const cur = rowsOf(curName).map((r) => {
    const pn = n0(pick(r, ['item', '품번', 'partno', '품목코드']))
    return {
      src: 'cur', pn, po_number: s(pick(r, ['ordernumber', 'order number', 'po', '오더번호', '발주번호'])),
      order_line: n0(pick(r, ['orderlines', 'order lines', '오더라인'])), del_line: n0(pick(r, ['delline', 'del line', '납품라인'])),
      ccn: s(pick(r, ['ccn'])), item_rev: s(pickExact(r, ['srev']) ?? pick(r, ['srev', 'rev', '리비전'])),
      desc: s(pick(r, ['itemdesc', 'item desc', '품명'])),
      qty: num(pick(r, ['quantity', '수량', 'qty', '발주량'])), unit_price: num(pick(r, ['unit price', 'unitprice', '단가'])) || null,
      promise_date: dnorm(pick(r, ['promisedate', 'promise date', '약속일', '납기'])), status: '진행중', stText: '',
      order_date: dnorm(pick(r, ['orderdate', 'order date', '발주일'])),
    }
  }).filter((r) => r.pn && r.po_number)
    // 같은 PO · 라인 · 분할이 두 번 나오면 앞 줄만 (insert 가 unique 에 걸리지 않게, v4.90.6)
    .filter((r, i, a) => a.findIndex((x) => keyOf(x) === keyOf(r)) === i)

  const curKeys = new Set(cur.map(keyOf))
  const st = { cur: cur.length, rcv: 0, rcvDone: 0, rcvCancel: 0, rcvOther: 0, rcvOld: 0, rcvDup: 0, rcvSheet: !!rcvName }
  const seen = new Set()
  const rcv = []
  for (const r of rowsOf(rcvName)) {
    const pn = n0(pick(r, ['item', '품번']))
    const po = s(pick(r, ['order number', 'ordernumber', 'po']))
    if (!pn || !po) continue
    const row = {
      src: 'rcv', pn, po_number: po, order_line: n0(pick(r, ['order lines', 'orderlines'])), del_line: n0(pick(r, ['del line', 'delline'])),
      ccn: s(pick(r, ['ccn'])), item_rev: '', desc: s(pick(r, ['itemdesc', 'item desc', '품명'])),
      qty: num(pick(r, ['quantity', '수량', 'qty', '발주량', 'received', 'rcv qty'])), unit_price: num(pick(r, ['unit price', 'unitprice', '단가'])) || null,
      promise_date: dnorm(pick(r, ['promisedate', 'promise date'])),
    }
    const k = keyOf(row)
    if (curKeys.has(k)) continue                       // 진행 중 시트에 있는 줄은 그쪽이 우선
    if (!row.promise_date || row.promise_date < from) { st.rcvOld++; continue }
    if (seen.has(k)) { st.rcvDup++; continue }
    seen.add(k)
    const stRaw = pickExact(r, ['현황'])
    const state = stRaw === undefined ? 'done' : rcvStateOf(stRaw)   // 현황 칸이 없는 옛 양식은 Received = 납품
    row.stText = s(stRaw)
    row.status = state === 'done' ? '완료' : state === 'cancel' ? '취소' : '진행중'
    st.rcv++; if (state === 'done') st.rcvDone++; else if (state === 'cancel') st.rcvCancel++; else st.rcvOther++
    rcv.push(row)
  }
  return { rows: [...cur, ...rcv], stats: st, sheets: { cur: curName, rcv: rcvName || null } }
}
