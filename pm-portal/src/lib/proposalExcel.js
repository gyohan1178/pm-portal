// 구매 품의서 엑셀.
//
//   값만 넣으면 표도 없고 숫자가 그냥 나열되어, 받는 쪽에서 다시 손봐야 했다.
//   테두리·천 단위 쉼표·열 너비·인쇄 설정까지 넣어 열자마자 쓸 수 있게 한다.

import { todayISO } from './utils'

const F = 8                                   // 글자 크기
const MONEY = '#,##0'
const QTY = '#,##0.##'
const THIN = { style: 'thin', color: { argb: 'FF999999' } }
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN }

function put(ws, addr, v, o = {}) {
  const c = ws.getCell(addr)
  c.value = v ?? ''
  c.font = { size: o.size || F, bold: !!o.bold }
  c.alignment = { vertical: 'middle', horizontal: o.align || 'left', wrapText: !!o.wrap }
  if (o.fmt) c.numFmt = o.fmt
  if (o.border !== false) c.border = BOX
  if (o.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } }
  return c
}

const HEAD_FILL = 'FFD9D9D9'
const TOTAL_FILL = 'FFF2F2F2'

/**
 * @param d.overview   개요 (여러 줄)
 * @param d.months     ['2026-08', ...]
 * @param d.pays       ['정기 결제', ...]
 * @param d.sum        { 결제방식: { 'YYYY-MM': 금액 } }
 * @param d.monthTotal (month) => 금액
 * @param d.rows       세부 품목
 * @param d.grand      총합
 */
export async function downloadProposalExcel(d) {
  // exceljs(약 270kB)는 내려받기를 누를 때만 불러온다 — 화면 첫 진입이 가벼워진다
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('품의서', {
    pageSetup: {
      paperSize: 9, orientation: 'landscape',
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
    views: [{ showGridLines: false }],
  })

  // 단위는 EA·M 정도라 좁아도 된다. 품명·제조사품번이 넓어야 한다.
  ws.columns = [
    { width: 11 },  // A 발주일자
    { width: 11 },  // B 입고요청일
    { width: 16 },  // C 공급업체
    { width: 20 },  // D 품목코드
    { width: 14 },  // E 제조사
    { width: 22 },  // F 제조사품번
    { width: 8 },   // G 수량
    { width: 11 },  // H 발주금액
    { width: 5 },   // I 단위
    { width: 12 },  // J 합계금액
    { width: 10 },  // K 결제방식
    { width: 18 },  // L 프로젝트이력
    { width: 26 },  // M 비고 (발주 메모가 따라온다)
  ]

  let r = 1
  put(ws, `A${r}`, '구매 품의서', { size: 14, bold: true, align: 'center', border: false })
  ws.mergeCells(`A${r}:M${r}`)
  ws.getRow(r).height = 24
  r += 2

  // ── 1. 개요 ──
  put(ws, `A${r}`, '1. 개요', { bold: true, size: 10, border: false })
  r++
  const ovStart = r
  const ovLines = String(d.overview || '').split('\n')
  ovLines.forEach((line) => {
    put(ws, `A${r}`, line, { wrap: true })
    ws.mergeCells(`A${r}:M${r}`)
    r++
  })
  if (r === ovStart) { put(ws, `A${r}`, ''); ws.mergeCells(`A${r}:M${r}`); r++ }
  r++

  // ── 2. 월별 매입 합계 / 3. 세부 품목 — 수식으로 이어 둔다 (v4.83.0) ──
  //   세부 품목의 수량 · 단가 · 결제방식 · 날짜를 고치면 합계금액 · 월별 합계 · 총합이 바로 다시 계산된다.
  //   매입월(N열, 숨김) = 정기 결제는 입고요청일, 카드 · 선급 · 해외 송금은 발주일의 「YYYY-MM」 — 화면 계산과 같다.
  //   결제방식 칸은 목록에서 고른다 (오타가 나면 월별 합계에서 빠지므로).
  //   ⚠ 표에 없는 달로 날짜를 바꾸면 그 금액은 월별 표에 안 잡힌다 (총합 · 「계」 열은 맞음 → 차이로 보인다)
  const rows = d.rows || []
  const mHead = r + 1
  const payRow0 = mHead + 1
  const mTotRow = payRow0 + d.pays.length
  const dTitle = mTotRow + 2
  const headRow = dTitle + 1
  const bodyStart = headRow + 1
  const bodyEnd = bodyStart + Math.max(rows.length, 1) - 1
  const totRow = bodyEnd + 1
  const rng = (col) => `$${col}$${bodyStart}:$${col}$${bodyEnd}`
  const colL = (i) => ws.getColumn(i).letter
  const F_ = (formula, result) => ({ formula, result })
  // 화면 계산과 같은 값 — 엑셀이 다시 계산하기 전(미리 보기 등)에도 숫자가 보이게 결과를 같이 넣는다
  const lastCol = 2 + d.months.length   // 「계」 열
  // 매입월(계산용) 열 — 보통 N. 달이 12개를 넘어 월별 표가 N 까지 오면 그 오른쪽으로 민다
  const HC = Math.max(14, lastCol + 1), HL = colL(HC)

  put(ws, `A${r}`, '2. 월별 매입 합계', { bold: true, size: 10, border: false })
  put(ws, `A${mHead}`, '결제구분', { bold: true, align: 'center', fill: HEAD_FILL })
  d.months.forEach((m, i) => {
    put(ws, ws.getRow(mHead).getCell(2 + i).address, `${m.slice(5)}월`, { bold: true, align: 'center', fill: HEAD_FILL })
  })
  put(ws, ws.getRow(mHead).getCell(lastCol).address, '계', { bold: true, align: 'center', fill: HEAD_FILL })
  d.pays.forEach((pay, k) => {
    const rr = payRow0 + k
    put(ws, `A${rr}`, pay, { bold: true })
    let rowSum = 0
    d.months.forEach((m, i) => {
      const v = d.sum[pay]?.[m] || 0
      rowSum += v
      put(ws, ws.getRow(rr).getCell(2 + i).address,
        F_(`SUMIFS(${rng('J')},${rng('K')},$A${rr},${rng(HL)},"${m}")`, v), { align: 'right', fmt: MONEY })
    })
    const a = colL(2), b = colL(lastCol - 1)
    put(ws, ws.getRow(rr).getCell(lastCol).address,
      F_(d.months.length ? `SUM(${a}${rr}:${b}${rr})` : '0', rowSum), { bold: true, align: 'right', fmt: MONEY })
  })
  put(ws, `A${mTotRow}`, '합계', { bold: true, fill: TOTAL_FILL })
  let allSum = 0
  d.months.forEach((m, i) => {
    const c = colL(2 + i), v = d.monthTotal(m)
    allSum += v
    put(ws, `${c}${mTotRow}`, F_(`SUM(${c}${payRow0}:${c}${mTotRow - 1})`, v),
      { bold: true, align: 'right', fmt: MONEY, fill: TOTAL_FILL })
  })
  const cL = colL(lastCol)
  put(ws, `${cL}${mTotRow}`, F_(`SUM(${cL}${payRow0}:${cL}${mTotRow - 1})`, allSum),
    { bold: true, align: 'right', fmt: MONEY, fill: TOTAL_FILL })

  // ── 3. 세부 품목 ──
  put(ws, `A${dTitle}`, '3. 세부 품목', { bold: true, size: 10, border: false })
  const HEAD = ['발주일자', '입고요청일', '공급업체', '품목코드', '제조사', '제조사품번',
                '수량', '발주금액', '단위', '합계금액', '결제방식', '프로젝트이력', '비고']
  HEAD.forEach((h, i) => {
    put(ws, ws.getRow(headRow).getCell(1 + i).address, h,
      { bold: true, align: 'center', fill: HEAD_FILL, wrap: true })
  })
  put(ws, `${HL}${headRow}`, '매입월', { bold: true, align: 'center', fill: HEAD_FILL })
  ws.getRow(headRow).height = 20

  const BY_ORDER = ['카드 결제', '선급 결제', '해외 송금']
  const monthOf = (x) => {
    const dt = BY_ORDER.includes(x.pay) ? (x.order_date || x.promise_date) : (x.promise_date || x.order_date)
    return String(dt || '').slice(0, 7)
  }
  // 날짜를 엑셀에서 날짜로 다시 쳐도(숫자) 글자로 둬도 「YYYY-MM」 이 나오게
  const ym = (c) => `IF(ISNUMBER(${c}),TEXT(${c},"yyyy-mm"),LEFT(${c},7))`
  const payList = `"${d.pays.join(',')}"`
  rows.forEach((x, k) => {
    const rr = bodyStart + k
    const qty = Number(x.qty) || 0, price = Number(x.price) || 0
    const cells = [
      [x.order_date, 'center'], [x.promise_date, 'center'], [x.vendor, 'left'],
      [x.std_code, 'left'], [x.maker, 'left'], [x.maker_code, 'left'],
      [qty, 'right', QTY], [price, 'right', MONEY],
      [x.unit, 'center'], [F_(`ROUND(G${rr}*H${rr},0)`, Number(x.amount) || Math.round(qty * price)), 'right', MONEY],
      [x.pay, 'center'], [x.proj, 'left'], [x.note, 'left'],
    ]
    const helper = [F_(`IF(OR(${BY_ORDER.map(p => `K${rr}="${p}"`).join(',')}),IF(A${rr}<>"",${ym(`A${rr}`)},${ym(`B${rr}`)}),IF(B${rr}<>"",${ym(`B${rr}`)},${ym(`A${rr}`)}))`, monthOf(x)), 'center']
    cells.forEach(([v, align, fmt], i) => {
      put(ws, ws.getRow(rr).getCell(1 + i).address, v ?? '', { align, fmt })
    })
    put(ws, `${HL}${rr}`, helper[0], { align: 'center' })
    ws.getCell(`K${rr}`).dataValidation = {
      type: 'list', allowBlank: false, formulae: [payList],
      showErrorMessage: true, errorTitle: '결제방식', error: `${d.pays.join(' · ')} 중에서 고르세요`,
    }
  })

  // 합계 줄
  put(ws, `A${totRow}`, '합계', { bold: true, align: 'center', fill: TOTAL_FILL })
  for (let c = 2; c <= 9; c++) {
    put(ws, ws.getRow(totRow).getCell(c).address, '', { fill: TOTAL_FILL })
  }
  put(ws, `J${totRow}`, rows.length ? F_(`SUM(J${bodyStart}:J${bodyEnd})`, Number(d.grand) || 0) : 0,
    { bold: true, align: 'right', fmt: MONEY, fill: TOTAL_FILL })
  for (let c = 11; c <= 13; c++) {
    put(ws, ws.getRow(totRow).getCell(c).address, '', { fill: TOTAL_FILL })
  }
  // 매입월은 계산용 — 숨겨 둔다 (인쇄 폭도 그대로)
  put(ws, `${HL}${totRow}`, '', { fill: TOTAL_FILL })
  ws.getColumn(HC).width = 9
  ws.getColumn(HC).hidden = true
  // 열 때 다시 계산
  wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true }

  // 머리글은 고정해 두고 스크롤한다
  ws.views = [{ showGridLines: false, state: 'frozen', ySplit: headRow }]
  // 인쇄할 때 머리글이 쪽마다 나온다
  ws.pageSetup.printTitlesRow = `${headRow}:${headRow}`

  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `구매품의서_${todayISO()}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
