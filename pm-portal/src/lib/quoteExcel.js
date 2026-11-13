
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

// PDF 로 바로 보내도 되게 (v4.180.0) — 글꼴 하나로 · 줄바꿈 칸 높이 미리 계산 · 인쇄 영역 · 쪽 번호 · 내부 시트 숨김
let FONT = 'Arial'
const put = (ws, addr, value, opt = {}) => {
  const c = ws.getCell(addr)
  c.value = value
  c.font = { name: FONT, bold: !!opt.bold, size: opt.size || 11 }
  if (opt.align) c.alignment = { horizontal: opt.align, vertical: 'middle', wrapText: !!opt.wrap }
  else c.alignment = { vertical: 'middle', wrapText: !!opt.wrap }
  if (opt.fmt) c.numFmt = opt.fmt
  if (opt.border) c.border = BOX
  if (opt.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opt.fill } }
  return c
}

// 줄바꿈되는 글이 몇 줄이 되는지 — 열 너비(엑셀 글자 단위) 기준, 한글 · 한자는 2칸
//   엑셀은 병합 칸 높이를 스스로 맞추지 않아 PDF 에서 글이 잘린다 → 미리 높이를 잡아 둔다
export function wrapLines(text, width) {
  const w = Math.max(4, (Number(width) || 10) - 1)
  let n = 0
  for (const seg of String(text ?? '').split('\n')) {
    let len = 0
    for (const ch of seg) len += /[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 2 : 1.05
    n += Math.max(1, Math.ceil(len / w))
  }
  return n
}
const fitRow = (ws, r, parts, { min = 18, size = 10 } = {}) => {
  const lh = size <= 10 ? 13.5 : size <= 11 ? 15 : 17
  const lines = Math.max(1, ...parts.map(([t, w]) => wrapLines(t, w)))
  ws.getRow(r).height = Math.max(min, Math.ceil(lines * lh + 4))
}
const colW = (ws, from, to) => {
  let s = 0
  for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) s += ws.getColumn(String.fromCharCode(c)).width || 9
  return s
}
const PRINT_OPTS = (ko) => ({
  paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
  horizontalCentered: true, showGridLines: false,
  margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.25 },
})
const pageFooter = (ws, ko) => {
  ws.headerFooter = { oddFooter: `&L&8${ko ? '(주)진선테크' : 'Jinsun Tech Co., Ltd'}&C&8&P / &N` }
}

// 이미지 파일을 받아 온다 — 없거나(404 · index.html 로 떨어짐) 실패하면 null
async function loadImage(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' })
    if (!r.ok || !/image\//.test(r.headers.get('content-type') || '')) return null
    return await r.arrayBuffer()
  } catch { return null }
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

  const ko = head.lang === 'ko'   // 국문 견적서 (v4.100.0)
  FONT = ko ? '맑은 고딕' : 'Arial'
  const ws = wb.addWorksheet('견적서', {
    pageSetup: PRINT_OPTS(ko),
    views: [{ showGridLines: false }],
  })
  pageFooter(ws, ko)

  // 열 너비 (양식 비율 유지, 11pt 기준으로 축소)
  const widths = { A: 2, B: 8, C: 20, D: 38, E: 14, F: 6, G: 6, H: 8, I: 16, J: 18, K: 28 }   // J = 금액 (v4.182.0 · 대체품 열 대신)
  Object.entries(widths).forEach(([col, w]) => { ws.getColumn(col).width = w })

  const cur = head.currency || 'USD'
  const money = cur === 'KRW' ? num0 : num2
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
  const supW = colW(ws, 'H', 'K')
  sup.forEach(([addr, v], i) => {
    ws.mergeCells(`${addr}:K${7 + i}`)
    put(ws, addr, v, { size: 10, wrap: true })
    fitRow(ws, 7 + i, [[v, supW]], { min: 16 })
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
  { const n = wrapLines(`${ko ? '건명' : 'Project Name'}: ${head.projectName || ''}`, colW(ws, 'B', 'E') / 1.25)
    if (n > 2) { ws.getRow(15).height = 9 * n + 4; ws.getRow(16).height = 9 * n + 4 } }
  put(ws, 'B17', `${ko ? '납품 일정' : 'Delivery Schedule'}: ${head.deliveryNote || ''}`, { size: 10 })

  // ── 품목 표 ──
  const HEAD_ROW = 20
  const cols = ko ? [
    ['B', '번호'], ['C', '품번'], ['D', '품명'], ['F', 'Rev'],
    ['G', '단위'], ['H', '수량'], ['I', `단가(${cur})`],
    ['J', `금액(${cur})`], ['K', '비고'],
  ] : [
    ['B', 'NO.'], ['C', 'Item no.'], ['D', 'Description'], ['F', 'REV'],
    ['G', 'Unit'], ['H', "Q'ty"], ['I', `Unit Price(${cur})`],
    ['J', `Amount(${cur})`], ['K', 'Remarks'],
  ]
  ws.mergeCells(`D${HEAD_ROW}:E${HEAD_ROW}`)
  cols.forEach(([c, label]) => {
    put(ws, `${c}${HEAD_ROW}`, label, { bold: true, size: 11, align: 'center', border: true, fill: 'FFF1F5F9', wrap: true })
  })
  ;['E'].forEach((c) => { ws.getCell(`${c}${HEAD_ROW}`).border = BOX })
  ws.getRow(HEAD_ROW).height = 30
  ws.pageSetup.printTitlesRow = `${HEAD_ROW}:${HEAD_ROW}`   // 품목이 길어 다음 쪽으로 넘어가면 머리줄 다시
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
    // 금액 = 수량 × 단가 (엑셀에서 고쳐도 다시 계산되게 식으로)
    put(ws, `J${r}`, l ? { formula: `H${r}*I${r}`, result: (Number(l.qty) || 0) * (Number(l.unitPrice) || 0) } : '', { align: 'right', border: true, size: 10, fmt: money })
    put(ws, `K${r}`, l?.remarks || '', { border: true, size: 10, wrap: true })
    fitRow(ws, r, [[l?.description || '', colW(ws, 'D', 'E')], [l?.remarks || '', widths.K], [l?.std_code || '', widths.C]], { min: 20 })
  }

  // ── 합계 · 조건 ──
  const endRow = HEAD_ROW + bodyCount
  const condRow = endRow + 2

  ws.mergeCells(`B${condRow}:D${condRow}`)
  put(ws, `B${condRow}`, ko ? '견적 조건' : 'Quotation Conditions', { bold: true, size: 11 })

  ws.mergeCells(`G${condRow}:I${condRow + 1}`)
  put(ws, `G${condRow}`, ko ? '합계 (부가세 별도)' : 'Total (Excluding VAT)', { bold: true, size: 13, align: 'center', border: true, fill: 'FFF1F5F9' })
  ws.mergeCells(`J${condRow}:K${condRow + 1}`)
  put(ws, `J${condRow}`, { formula: `SUM(J${HEAD_ROW + 1}:J${endRow})`, result: Number(totals?.amount) || 0 },
    { bold: true, size: 14, align: 'right', border: true, fmt: money })

  const conds = [
    `- ${head.leadTime || 'L/T 8W'}`,
    ko ? `- 견적 유효기간 : ${head.validityDays || 15}일 (${head.validUntil || ''}까지)` : `- Quotation Validity : ${head.validityDays || 15} days (${head.validUntil || ''})`,
    ...(head.memo ? [`- ${head.memo}`] : []),
  ]
  conds.forEach((t, i) => {
    const r = condRow + 1 + i
    ws.mergeCells(`B${r}:D${r}`)
    put(ws, `B${r}`, t, { size: 10, wrap: true })
    if (i > 0) fitRow(ws, r, [[t, colW(ws, 'B', 'D')]], { min: 16 })
  })
  ws.pageSetup.printArea = `B2:K${Math.max(condRow + conds.length, condRow + 1)}`
  // 품목이 많지 않으면 한 장에 — 합계 · 조건이 다음 쪽으로 혼자 넘어가지 않게
  if (lines.length <= 22) ws.pageSetup.fitToHeight = 1
  // ── 로고 · 직인 (v4.181.0) — public/logo.png · public/seal.png. 파일이 없으면 그냥 넘어간다
  if (head.brand) {
    const logo = await loadImage('/logo.png')
    if (logo) ws.addImage(wb.addImage({ buffer: logo, extension: 'png' }), { tl: { col: 1.05, row: 1.05 }, ext: { width: 92, height: 50 } })
    const seal = await loadImage('/seal.png')
    if (seal) ws.addImage(wb.addImage({ buffer: seal, extension: 'png' }), { tl: { col: ko ? 9.55 : 9.75, row: 5.8 }, ext: { width: 58, height: 58 } })   // 상호 줄 글 끝 오른쪽 빈 자리 (글자를 가리지 않게)
  }

  // ── 세부견적서 (v4.138.0) — 고객 제출용. 어셈블리마다 부품별 판매가 · 조립비 · 합계(= 견적 단가) ──
  const cd = extra.customerDetail
  if (cd?.details?.length) addDetailSheet(wb, cd, { ko, money, cur, head })

  // ── 내부 관리용 시트 (고객 제출 시 삭제해도 무방) ──
  //   PDF 로 「전체 통합 문서」를 저장해도 안 나가게 숨겨 둔다 — 보려면 시트 탭 우클릭 → 숨기기 취소 (v4.180.0)
  const addPlain = (name, rows) => {
    if (!rows?.length) return
    const s = wb.addWorksheet(name, { state: 'hidden' })
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
  addPlain(cd?.details?.length ? '원가내역(내부)' : '세부견적', extra.detailRows)   // 고객용 「세부견적서」와 헷갈리지 않게
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

// 세부견적서 시트 — 어셈블리 블록을 위에서 아래로 (블록 사이 두 줄 띄움)
function addDetailSheet(wb, cd, { ko, money, cur, head }) {
  const ws = wb.addWorksheet(ko ? '세부견적서' : 'Detail', {
    pageSetup: PRINT_OPTS(ko),
    views: [{ showGridLines: false }],
  })
  pageFooter(ws, ko)
  const mk = !!cd.showMaker
  // 열 — 마지막에 「특이사항」(v4.182.0 · 구매자재 사유 · 견적 특이사항 · 단가 없는 부품의 사유)
  //   amt = 금액 열(합계 줄 금액이 들어가는 곳), lab = 「1 식」 칸
  const C = [
    { k: 'no', h: 'No', w: 5, al: 'center' },
    { k: 'std_code', h: ko ? '품번' : 'Part no.', w: 18, wrap: true },
    { k: 'name', h: ko ? '품명' : 'Description', w: mk ? 38 : 44, wrap: true },
    ...(mk ? [{ k: 'maker', h: ko ? '제조사' : 'Maker', w: 14, wrap: true }, { k: 'makerPn', h: ko ? '제조사 품번' : 'Maker P/N', w: 18, wrap: true }] : []),
    { k: 'qty', h: ko ? '대당 수량' : "Q'ty/Unit", w: 9, al: 'right' },
    { k: 'unit', h: ko ? '단위' : 'Unit', w: 6, al: 'center' },
    { k: 'price', h: `${ko ? '단가' : 'Unit Price'}(${cur})`, w: 14, al: 'right', fmt: money },
    { k: 'amount', h: `${ko ? '금액' : 'Amount'}(${cur})`, w: 15, al: 'right', fmt: money },
    { k: 'note', h: ko ? '특이사항' : 'Remarks', w: 30, wrap: true },
  ]
  C.forEach((c, i) => { ws.getColumn(i + 1).width = c.w })
  const L = (i) => String.fromCharCode(65 + i)
  const ci = (k) => C.findIndex((c) => c.k === k)
  const last = L(C.length - 1)
  const AMT = L(ci('amount')), PRC = L(ci('price')), UNI = L(ci('unit')), QTY = L(ci('qty'))
  const LBL = L(ci('amount') - 1)                       // 합계 줄 글은 A ~ 단가 열까지 병합
  let r = 1
  ws.mergeCells(`A${r}:${last}${r}`)
  put(ws, `A${r}`, ko ? '세 부 견 적 서' : 'DETAILED QUOTATION', { bold: true, size: 22, align: 'center' }); ws.getRow(r).height = 34; r++
  ws.mergeCells(`A${r}:${last}${r}`)
  put(ws, `A${r}`, `${ko ? '견적번호' : 'NO'} : ${head.quoteNo || ''} · ${head.quoteDate || ''} · ${ko ? '수신' : 'To'} : ${head.issuedTo || ''}${head.projectName ? ` · ${ko ? '건명' : 'Project'} : ${head.projectName}` : ''}`, { size: 10, align: 'center' })
  r += 2
  const sumRow = (label, value, opt = {}) => {
    ws.mergeCells(`A${r}:${LBL}${r}`)
    put(ws, `A${r}`, label, { bold: opt.bold !== false, size: opt.size || 10, align: 'right', border: true, fill: opt.fill })
    put(ws, `${AMT}${r}`, value, { bold: opt.bold !== false, size: opt.size || 10, align: 'right', border: true, fmt: money, fill: opt.fill })
    put(ws, `${last}${r}`, '', { size: 10, border: true, fill: opt.fill })
    r++
  }
  for (const { line: l, detail: d, idx } of cd.details) {
    ws.mergeCells(`A${r}:${last}${r}`)
    put(ws, `A${r}`, `${idx + 1}. ${l.std_code || ''}${l.rev ? ` Rev.${l.rev}` : ''}  ${l.description || ''}  —  ${ko ? '견적 단가' : 'Unit Price'} ${cur} ${Number(l.unitPrice || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} / ${l.unit || 'EA'} (${ko ? '수량' : "Q'ty"} ${Number(l.qty) || 0})`,
      { bold: true, size: 11, fill: 'FFEEF2FF', wrap: true })
    ws.getRow(r).height = 22; r++
    C.forEach((c, i) => put(ws, `${L(i)}${r}`, c.h, { bold: true, size: 10, align: 'center', border: true, fill: 'FFF1F5F9' }))
    if (!ws.pageSetup.printTitlesRow) ws.pageSetup.printTitlesRow = `${r}:${r}`   // 부품이 많아 쪽이 넘어가도 열 이름이 다시 (블록마다 열 이름은 같다)
    r++
    for (const x of d.rows) {
      C.forEach((c, i) => {
        let v = x[c.k]
        if ((c.k === 'price' || c.k === 'amount') && v == null) v = '—'      // 단가 없는 부품 (사급 · 사양 미확정 …)
        put(ws, `${L(i)}${r}`, v ?? '', { size: 10, border: true, align: v === '—' ? 'center' : c.al, fmt: typeof v === 'number' ? c.fmt : undefined, wrap: !!c.wrap })
      })
      if (x.nopr) ws.getCell(`${last}${r}`).font = { name: FONT, size: 10, color: { argb: 'FFB91C1C' } }
      fitRow(ws, r, C.filter((c) => c.wrap).map((c) => [x[c.k] || '', c.w]), { min: 18 })
      r++
    }
    sumRow(ko ? '자재 소계' : 'Material Subtotal', d.partsSum)
    if (d.labor > 0) {
      const t = ko ? '조립 · 배선 · 검사비' : 'Assembly, Wiring & Test'
      put(ws, `A${r}`, d.rows.length + 1, { size: 10, border: true, align: 'center' })
      ws.mergeCells(`B${r}:${L(ci('qty') - 1)}${r}`)
      put(ws, `B${r}`, t, { size: 10, border: true })
      put(ws, `${QTY}${r}`, 1, { size: 10, border: true, align: 'right' })
      put(ws, `${UNI}${r}`, ko ? '식' : 'Lot', { size: 10, border: true, align: 'center' })
      put(ws, `${PRC}${r}`, d.labor, { size: 10, border: true, align: 'right', fmt: money })
      put(ws, `${AMT}${r}`, d.labor, { size: 10, border: true, align: 'right', fmt: money })
      put(ws, `${last}${r}`, '', { size: 10, border: true }); r++
    }
    // 끝자리 절삭은 합계에서 한 번 — 소계 → 단수 절삭(−) → 합계 (v4.139.0)
    if (d.adjust) {
      sumRow(ko ? '소계' : 'Subtotal', d.subtotal)
      sumRow(d.adjust < 0 ? (ko ? '단수 절삭' : 'Rounding discount') : (ko ? '단수 조정' : 'Rounding adjustment'), d.adjust, { bold: false })
    }
    sumRow(ko ? `${l.std_code || ''} 1${l.unit || 'EA'} 합계 (= 견적 단가)` : `Total per ${l.unit || 'EA'} (= quoted unit price)`, d.total, { size: 11, fill: 'FFF1F5F9' })
    r += 2
  }
  ws.pageSetup.printArea = `A1:${last}${Math.max(1, r - 2)}`
}
