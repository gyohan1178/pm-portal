// 구매 품의서 엑셀.
//
//   값만 넣으면 표도 없고 숫자가 그냥 나열되어, 받는 쪽에서 다시 손봐야 했다.
//   테두리·천 단위 쉼표·열 너비·인쇄 설정까지 넣어 열자마자 쓸 수 있게 한다.

import ExcelJS from 'exceljs'

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
    { width: 16 },  // M 비고
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

  // ── 2. 월별 매입 합계 ──
  put(ws, `A${r}`, '2. 월별 매입 합계', { bold: true, size: 10, border: false })
  r++
  const mHead = r
  put(ws, `A${r}`, '결제구분', { bold: true, align: 'center', fill: HEAD_FILL })
  d.months.forEach((m, i) => {
    put(ws, ws.getRow(r).getCell(2 + i).address, `${m.slice(5)}월`,
      { bold: true, align: 'center', fill: HEAD_FILL })
  })
  r++
  d.pays.forEach((pay) => {
    put(ws, `A${r}`, pay, { bold: true })
    d.months.forEach((m, i) => {
      put(ws, ws.getRow(r).getCell(2 + i).address, d.sum[pay]?.[m] || 0,
        { align: 'right', fmt: MONEY })
    })
    r++
  })
  put(ws, `A${r}`, '합계', { bold: true, fill: TOTAL_FILL })
  d.months.forEach((m, i) => {
    put(ws, ws.getRow(r).getCell(2 + i).address, d.monthTotal(m),
      { bold: true, align: 'right', fmt: MONEY, fill: TOTAL_FILL })
  })
  r += 2

  // ── 3. 세부 품목 ──
  put(ws, `A${r}`, '3. 세부 품목', { bold: true, size: 10, border: false })
  r++
  const HEAD = ['발주일자', '입고요청일', '공급업체', '품목코드', '제조사', '제조사품번',
                '수량', '발주금액', '단위', '합계금액', '결제방식', '프로젝트이력', '비고']
  const headRow = r
  HEAD.forEach((h, i) => {
    put(ws, ws.getRow(r).getCell(1 + i).address, h,
      { bold: true, align: 'center', fill: HEAD_FILL, wrap: true })
  })
  ws.getRow(r).height = 20
  r++

  const bodyStart = r
  d.rows.forEach((x) => {
    const cells = [
      [x.order_date, 'center'], [x.promise_date, 'center'], [x.vendor, 'left'],
      [x.std_code, 'left'], [x.maker, 'left'], [x.maker_code, 'left'],
      [Number(x.qty) || 0, 'right', QTY], [Number(x.price) || 0, 'right', MONEY],
      [x.unit, 'center'], [Number(x.amount) || 0, 'right', MONEY],
      [x.pay, 'center'], [x.proj, 'left'], [x.note, 'left'],
    ]
    cells.forEach(([v, align, fmt], i) => {
      put(ws, ws.getRow(r).getCell(1 + i).address, v ?? '', { align, fmt })
    })
    r++
  })

  // 합계 줄
  put(ws, `A${r}`, '합계', { bold: true, align: 'center', fill: TOTAL_FILL })
  for (let c = 2; c <= 9; c++) {
    put(ws, ws.getRow(r).getCell(c).address, '', { fill: TOTAL_FILL })
  }
  put(ws, `J${r}`, Number(d.grand) || 0, { bold: true, align: 'right', fmt: MONEY, fill: TOTAL_FILL })
  for (let c = 11; c <= 13; c++) {
    put(ws, ws.getRow(r).getCell(c).address, '', { fill: TOTAL_FILL })
  }

  // 머리글은 고정해 두고 스크롤한다
  ws.views = [{ showGridLines: false, state: 'frozen', ySplit: headRow }]
  // 인쇄할 때 머리글이 쪽마다 나온다
  ws.pageSetup.printTitlesRow = `${headRow}:${headRow}`

  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `구매품의서_${new Date().toISOString().split('T')[0]}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
  void bodyStart
}
