
// 견적서_양식.xlsm 의 '견적서' 시트 레이아웃을 그대로 재현한다.
// 받는 쪽에서 손볼 필요 없이 바로 보낼 수 있는 상태로 만드는 게 목적.

const THIN = { style: 'thin', color: { argb: 'FF999999' } }
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN }
const num2 = '#,##0.00'
const num0 = '#,##0'

// 공급자(진선테크) 고정 정보 — 양식에서 가져옴
export const SUPPLIER = {
  company: 'Jinsun Tech Co., Ltd',
  bizNo: '312-86-59918',
  ceo: 'ChunSeok Hong, DongHo Kim',   // 공동대표 (v4.100.0)
  address: '98 Chadollo-ro, Dongnam-gu, Cheonan-si, Chungcheongnam-do, 2nd floor',
  bizType: 'Diode Transistors and Similar Semiconductor/Integrated Circuits',
  tel: '041-579-5845',
  fax: '041-579-5846',
  invoiceEmail: 'etax@jinsuntech.co.kr',
}
// 국문 견적서 공급자 (v4.100.0) — 사업자등록증 (2025-08-19 정정 발급) 기준
export const SUPPLIER_KO = {
  company: '(주)진선테크',
  bizNo: SUPPLIER.bizNo,
  ceo: '홍천석, 김동호 (공동대표)',
  address: '충청남도 천안시 동남구 차돌로 98(다가동, 2층)',
  bizType: '제조업, 도매 및 소매업',
  bizItem: '다이오드 · 트랜지스터 및 유사 반도체 / 전자집적회로, 전기용 기계 · 장비 도매',
  tel: SUPPLIER.tel,
  fax: SUPPLIER.fax,
  invoiceEmail: SUPPLIER.invoiceEmail,
}

const put = (ws, addr, value, opt = {}) => {
  const c = ws.getCell(addr)
  c.value = value
  if (opt.bold || opt.size) c.font = { bold: !!opt.bold, size: opt.size || 11 }
  if (opt.align) c.alignment = { horizontal: opt.align, vertical: 'middle', wrapText: !!opt.wrap }
  else c.alignment = { vertical: 'middle', wrapText: !!opt.wrap }
  if (opt.fmt) c.numFmt = opt.fmt
  if (opt.border) c.border = BOX
  if (opt.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opt.fill } }
  return c
}

/**
 * 견적서 워크북 생성 후 다운로드
 * head : { quoteNo, quoteDate, currency, issuedTo, attn, projectName, validityDays,
 *          validUntil, leadTime, deliveryNote, memo, contactName, contactPhone, contactEmail }
 * lines: [{ std_code, description, rev, unit, qty, unitPrice, alternative, remarks }]
 * extra: { detailRows, bomRows, infoRows }  — 내부 관리용 시트 (없으면 생략)
 */
export async function downloadQuoteExcel({ head, lines, totals, extra = {}, fileName }) {
  // exceljs(약 270kB)는 내려받기를 누를 때만 불러온다 — 화면 첫 진입이 가벼워진다
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = SUPPLIER.company
  wb.created = new Date()

  const ws = wb.addWorksheet('견적서', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  })

  // 열 너비 (양식 비율 유지, 11pt 기준으로 축소)
  const widths = { A: 3, B: 13, C: 20, D: 42, E: 16, F: 8, G: 8, H: 10, I: 16, J: 13, K: 26 }
  Object.entries(widths).forEach(([col, w]) => { ws.getColumn(col).width = w })

  const cur = head.currency || 'USD'
  const money = cur === 'KRW' ? num0 : num2
  const ko = head.lang === 'ko'   // 국문 견적서 (v4.100.0)
  const S = ko ? SUPPLIER_KO : SUPPLIER

  // ── 제목 ──
  ws.mergeCells('B2:K2')
  put(ws, 'B2', ko ? '견 적 서' : 'QUOTE', { bold: true, size: 28, align: 'center' })
  ws.getRow(2).height = 38

  put(ws, 'B3', `${ko ? '견적번호' : 'NO'} : ${head.quoteNo || ''}`, { bold: true, size: 12 })
  put(ws, 'B4', head.quoteDate || '', { bold: true, size: 11 })

  // ── Issued by / Supplier ──
  put(ws, 'B6', ko ? '수신' : 'Issued by', { bold: true, size: 14 })
  put(ws, 'H6', ko ? '공급자' : 'Supplier', { bold: true, size: 14 })

  ws.mergeCells('B7:D8')
  put(ws, 'B7', head.issuedTo ? `${head.issuedTo}${ko ? ' 귀중' : ''}` : '', { bold: true, size: 13, align: 'left' })
  put(ws, 'B9', head.attn ? `${ko ? '참조' : 'Attn'} : ${head.attn}` : '', { bold: true, size: 11 })

  const sup = ko ? [
    ['H7', `상호 : ${S.company}`],
    ['H8', `등록번호 : ${S.bizNo}`],
    ['H9', `대표 : ${S.ceo}`],
    ['H10', `주소 : ${S.address}`],
    ['H11', `업태 : ${S.bizType} / 종목 : ${S.bizItem}`],
    ['H12', `담당 : ${head.contactName || ''}${head.contactPhone ? ` (${head.contactPhone})` : ''}`],
    ['H13', `전화 : ${S.tel}   팩스 : ${S.fax}`],
  ] : [
    ['H7', `Company : ${SUPPLIER.company}`],
    ['H8', `Business registration number : ${SUPPLIER.bizNo}`],
    ['H9', `CEO : ${SUPPLIER.ceo}`],
    ['H10', `Adress : ${SUPPLIER.address}`],
    ['H11', `Business Type : ${SUPPLIER.bizType}`],
    ['H12', `Contact : ${head.contactName || ''}${head.contactPhone ? ` (${head.contactPhone})` : ''}`],
    ['H13', `Tel : ${SUPPLIER.tel}   Fax : ${SUPPLIER.fax}`],
  ]
  sup.forEach(([addr, v], i) => {
    ws.mergeCells(`${addr}:K${7 + i}`)
    put(ws, addr, v, { size: 10, wrap: true })
  })
  put(ws, 'H14', ko ? '이메일 :' : 'E-Mail :', { bold: true, size: 10 })
  ws.mergeCells('I14:K14')
  put(ws, 'I14', head.contactEmail || '', { size: 10 })
  ws.mergeCells('I15:K15')
  put(ws, 'I15', `${SUPPLIER.invoiceEmail} (${ko ? '계산서' : 'Invoice'})`, { size: 10 })

  // ── 안내 문구 ──
  put(ws, 'B12', ko ? '아래와 같이 견적합니다.' : 'We hereby provide the following quotation:', { bold: true, size: 11 })
  put(ws, 'B13', ko ? `견적 유효기간 : 견적일로부터 ${head.validityDays || 15}일` : `Quotation Validity: ${head.validityDays || 15} days from the date of the quotation`, { size: 10 })
  ws.mergeCells('B15:E16')
  put(ws, 'B15', `${ko ? '건명' : 'Project Name'}: ${head.projectName || ''}`, { bold: true, size: 13, wrap: true })
  put(ws, 'B17', `${ko ? '납품 일정' : 'Delivery Schedule'}: ${head.deliveryNote || ''}`, { size: 10 })

  // ── 품목 표 ──
  const HEAD_ROW = 20
  const cols = ko ? [
    ['B', '번호'], ['C', '품번'], ['D', '품명'], ['F', 'Rev'],
    ['G', '단위'], ['H', '수량'], ['I', `단가(${cur})`],
    ['J', '대체품\n(O)'], ['K', '비고'],
  ] : [
    ['B', 'NO.'], ['C', 'Item no.'], ['D', 'Description'], ['F', 'REV'],
    ['G', 'Unit'], ['H', 'Quantity'], ['I', `Unit Price(${cur})`],
    ['J', 'alternative\n(O)'], ['K', 'Remarks'],
  ]
  ws.mergeCells(`D${HEAD_ROW}:E${HEAD_ROW}`)
  cols.forEach(([c, label]) => {
    put(ws, `${c}${HEAD_ROW}`, label, { bold: true, size: 11, align: 'center', border: true, fill: 'FFF1F5F9', wrap: true })
  })
  ;['E'].forEach((c) => { ws.getCell(`${c}${HEAD_ROW}`).border = BOX })
  ws.getRow(HEAD_ROW).height = 30

  const MIN_ROWS = 9
  const bodyCount = Math.max(lines.length, MIN_ROWS)
  for (let i = 0; i < bodyCount; i++) {
    const r = HEAD_ROW + 1 + i
    const l = lines[i]
    ws.mergeCells(`D${r}:E${r}`)
    put(ws, `B${r}`, l ? i + 1 : '', { align: 'center', border: true, size: 10 })
    put(ws, `C${r}`, l?.std_code || '', { border: true, size: 10 })
    put(ws, `D${r}`, l?.description || '', { border: true, size: 10, wrap: true })
    ws.getCell(`E${r}`).border = BOX
    put(ws, `F${r}`, l?.rev || '', { align: 'center', border: true, size: 10 })
    put(ws, `G${r}`, l?.unit || (l ? 'EA' : ''), { align: 'center', border: true, size: 10 })
    put(ws, `H${r}`, l ? Number(l.qty) || 0 : '', { align: 'center', border: true, size: 10, fmt: num0 })
    put(ws, `I${r}`, l ? Number(l.unitPrice) || 0 : '', { align: 'right', border: true, size: 10, fmt: money })
    put(ws, `J${r}`, l?.alternative || '', { align: 'center', border: true, size: 10 })
    put(ws, `K${r}`, l?.remarks || '', { border: true, size: 10, wrap: true })
    ws.getRow(r).height = 20
  }

  // ── 합계 · 조건 ──
  const endRow = HEAD_ROW + bodyCount
  const condRow = endRow + 2

  ws.mergeCells(`B${condRow}:D${condRow}`)
  put(ws, `B${condRow}`, ko ? '견적 조건' : 'Quotation Conditions', { bold: true, size: 11 })

  ws.mergeCells(`G${condRow}:I${condRow + 1}`)
  put(ws, `G${condRow}`, ko ? '합계 (부가세 별도)' : 'Total (Excluding VAT)', { bold: true, size: 13, align: 'center', border: true, fill: 'FFF1F5F9' })
  ws.mergeCells(`K${condRow}:K${condRow + 1}`)
  put(ws, `K${condRow}`, Number(totals?.amount) || 0,
    { bold: true, size: 14, align: 'right', border: true, fmt: money })
  ws.getCell(`J${condRow}`).border = BOX
  ws.getCell(`J${condRow + 1}`).border = BOX

  const conds = [
    `- ${head.leadTime || 'L/T 8W'}`,
    ko ? `- 견적 유효기간 : ${head.validityDays || 15}일 (${head.validUntil || ''}까지)` : `- Quotation Validity : ${head.validityDays || 15} days (${head.validUntil || ''})`,
    ...(head.memo ? [`- ${head.memo}`] : []),
  ]
  conds.forEach((t, i) => {
    const r = condRow + 1 + i
    ws.mergeCells(`B${r}:D${r}`)
    put(ws, `B${r}`, t, { size: 10 })
  })

  // ── 내부 관리용 시트 (고객 제출 시 삭제해도 무방) ──
  const addPlain = (name, rows) => {
    if (!rows?.length) return
    const s = wb.addWorksheet(name)
    const keys = Object.keys(rows[0])
    s.addRow(keys)
    s.getRow(1).font = { bold: true }
    s.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
    rows.forEach((r) => s.addRow(keys.map((k) => r[k])))
    keys.forEach((k, i) => {
      const len = Math.max(String(k).length, ...rows.map((r) => String(r[k] ?? '').length))
      s.getColumn(i + 1).width = Math.min(40, Math.max(9, len + 2))
    })
    s.views = [{ state: 'frozen', ySplit: 1 }]
  }
  addPlain('세부견적', extra.detailRows)
  addPlain('부품명세', extra.bomRows)
  addPlain('견적정보', extra.infoRows)

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
