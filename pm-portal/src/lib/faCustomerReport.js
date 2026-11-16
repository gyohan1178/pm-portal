import { faStage, faApproved, gateDone, gateSt, faClosed } from './faTemplate'

// 초도품 — 고객사 제출용 진행 보고 (영문 엑셀, 심플판)
//
//   고객사가 알고 싶은 것만: 무슨 품목(Item · SRev · BRev · PO · Description)이 지금 어디쯤(Status)이고
//   FA 를 언제 내는지(Target Date) · 냈는지(Submitted), 할 말(Remarks).
//
//   Status 는 6가지로만 — Material Prep · In Build · Inspection · Submitted · Approved · On Hold
//   (사내 9단계를 고객사 눈높이로 묶음)
//
//   ⚠ 사내 정보는 넣지 않는다 — 비고 · 이슈 기록 · 담당자 · 우선순위 · 세부 체크 · 가능일 메모(한글)
//     고객사에 보일 말은 건마다 「고객사 코멘트」(cust_note)에 영문으로 적은 것만 Remarks 로 나간다.

const STATUS = {
  g_po: 'Material Prep', g_dr: 'Material Prep', g_mat_in: 'Material Prep', g_issue: 'Material Prep',
  g_make_start: 'In Build', g_make_done: 'In Build',
  g_handover: 'Inspection', g_inspect: 'Inspection', g_report: 'Inspection', g_submit: 'Inspection',
  g_approve: 'Submitted',
}
// 순서 · 색 (엑셀 · 미리보기 같이 씀)
export const CUST_STATUS = [
  { s: 'Material Prep', fill: 'FFF1F5F9', font: 'FF334155', tw: 'bg-slate-100 text-slate-700' },
  { s: 'In Build', fill: 'FFE0E7FF', font: 'FF3730A3', tw: 'bg-indigo-100 text-indigo-800' },
  { s: 'Inspection', fill: 'FFEDE9FE', font: 'FF5B21B6', tw: 'bg-violet-100 text-violet-800' },
  { s: 'Submitted', fill: 'FFDBEAFE', font: 'FF1E40AF', tw: 'bg-sky-100 text-sky-800' },
  { s: 'Approved', fill: 'FFDCFCE7', font: 'FF166534', tw: 'bg-emerald-100 text-emerald-800' },
  { s: 'On Hold', fill: 'FFFEF3C7', font: 'FF92400E', tw: 'bg-amber-100 text-amber-800' },
]
const ORDER = Object.fromEntries(CUST_STATUS.map((x, i) => [x.s, i]))
export const custTone = (s) => CUST_STATUS.find((x) => x.s === s)

export const CUST_COLS = ['Item', 'SRev', 'BRev', 'PO No.', 'Description', 'Status', 'Target Date', 'Submitted', 'Remarks']

// 한 건 → 고객사 제출용 한 줄
export function customerRow(fa) {
  const v = (k) => fa.steps?.[k] || {}
  const approved = faApproved(fa)
  // 제출일이 있으면 앞 단계 입력이 비어 있어도 고객사 입장에선 「제출됨」
  const status = approved ? 'Approved' : fa.hold ? 'On Hold' : gateDone(v('g_submit')) ? 'Submitted'
    : (STATUS[faStage(fa).k] || 'Material Prep')
  return {
    Item: fa.item_code,
    SRev: fa.srev || '',
    BRev: fa.brev || '',
    'PO No.': fa.po_number,
    Description: fa.item_desc || '',
    Status: status,
    'Target Date': v('g_submit').p || fa.fa_ready_date || '',
    Submitted: v('g_submit').d || '',
    Remarks: fa.cust_note || (!approved && fa.inquiry_open ? 'Awaiting customer input' : ''),
  }
}

// 순서 — 상태(진행 → 제출 → 승인 → 보류) → FA 예정일 → 품번
export function customerRows(list) {
  const date = (r) => r.Submitted || r['Target Date'] || '9999'
  return list.map(customerRow).sort((a, b) =>
    (ORDER[a.Status] - ORDER[b.Status]) || date(a).localeCompare(date(b)) || String(a.Item).localeCompare(String(b.Item)))
}

// 맨 위 요약 — In Progress(자재·제작·검사) · Submitted · Approved · On Hold
export function customerSummary(rows) {
  const n = (f) => rows.filter(f).length
  return [
    ['Total', rows.length],
    ['In Progress', n((r) => ORDER[r.Status] <= 2)],
    ['Submitted', n((r) => r.Status === 'Submitted')],
    ['Approved', n((r) => r.Status === 'Approved')],
    ['On Hold', n((r) => r.Status === 'On Hold')],
  ]
}

const toDate = (s) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))) : s || '')

export async function exportFaCustomer(list, { asOf, supplier = 'Jinsuntech Co., Ltd.', customer = '', fileName } = {}) {
  const rows = customerRows(list)
  if (!rows.length) throw new Error('내보낼 건이 없습니다')

  const NAVY = 'FF1E293B'
  const LINE = { style: 'thin', color: { argb: 'FFE2E8F0' } }
  const heads = ['No.', ...CUST_COLS]
  const W = [5, 13, 6, 6, 13, 40, 14, 12, 12, 42]
  const cols = heads.length

  // exceljs(약 270kB)는 내려받기를 누를 때만 불러온다 — 화면 첫 진입이 가벼워진다

  const ExcelJS = (await import('exceljs')).default

  const wb = new ExcelJS.Workbook()
  wb.created = new Date()
  const ws = wb.addWorksheet('FA Status', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 } },
  })
  W.forEach((w, i) => { ws.getColumn(i + 1).width = w })

  // ── 머리 ──
  ws.mergeCells(1, 1, 1, cols)
  const t = ws.getCell(1, 1)
  t.value = 'First Article Status Report'
  t.font = { bold: true, size: 16, color: { argb: NAVY } }
  t.alignment = { vertical: 'middle' }
  ws.getRow(1).height = 30

  ws.mergeCells(2, 1, 2, cols)
  ws.getCell(2, 1).value = [`From: ${supplier}`, customer ? `To: ${customer}` : '', `As of: ${asOf}`].filter(Boolean).join('     ')
  ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF475569' } }
  ws.getRow(2).height = 18

  // 머리 아래 선
  for (let c = 1; c <= cols; c++) ws.getCell(2, c).border = { bottom: { style: 'medium', color: { argb: NAVY } } }

  // ── 요약 한 줄 ──
  ws.mergeCells(4, 1, 4, cols)
  const sum = customerSummary(rows)
  ws.getCell(4, 1).value = {
    richText: sum.flatMap(([k, n], i) => [
      ...(i ? [{ text: '      |      ', font: { size: 10, color: { argb: 'FFCBD5E1' } } }] : []),
      { text: `${k}  `, font: { size: 10, color: { argb: 'FF64748B' } } },
      { text: String(n), font: { size: 12, bold: true, color: { argb: NAVY } } },
    ]),
  }
  ws.getCell(4, 1).alignment = { vertical: 'middle' }
  ws.getRow(4).height = 22

  // ── 표 ──
  const head = 6
  ws.getRow(head).values = heads
  ws.getRow(head).height = 24
  ws.getRow(head).eachCell((c) => {
    c.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    c.alignment = { vertical: 'middle', horizontal: ['Description', 'Remarks', 'Item', 'PO No.'].includes(c.value) ? 'left' : 'center' }
  })

  rows.forEach((row, i) => {
    // 숫자만인 품번은 숫자로 (엑셀 「텍스트로 저장된 숫자」 초록 삼각형 안 뜨게) — 0 으로 시작하면 글자 그대로
    const cell = (k) => (k === 'Target Date' || k === 'Submitted' ? toDate(row[k])
      : k === 'Item' && /^[1-9]\d{0,14}$/.test(String(row[k])) ? Number(row[k]) : row[k] ?? '')
    const rr = ws.addRow([i + 1, ...CUST_COLS.map(cell)])
    rr.height = row.Description.length > 48 || row.Remarks.length > 50 ? 30 : 20
    rr.eachCell({ includeEmpty: true }, (c, col) => {
      const k = heads[col - 1]
      c.font = { size: 10, color: { argb: 'FF0F172A' } }
      c.border = { bottom: LINE }
      c.alignment = { vertical: 'middle', wrapText: k === 'Description' || k === 'Remarks',
        horizontal: ['No.', 'SRev', 'BRev', 'Status', 'Target Date', 'Submitted'].includes(k) ? 'center' : 'left' }
      if (k === 'Item') c.numFmt = '0'
      if (k === 'Target Date' || k === 'Submitted') c.numFmt = 'yyyy-mm-dd'
      if (k === 'No.') c.font = { size: 9, color: { argb: 'FF94A3B8' } }
      if (k === 'Item') c.font = { size: 10, bold: true, color: { argb: 'FF0F172A' } }
      if (k === 'Remarks') c.font = { size: 10, color: { argb: 'FF475569' } }
    })
    const tone = custTone(row.Status)
    const st = rr.getCell(heads.indexOf('Status') + 1)
    st.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tone.fill } }
    st.font = { size: 10, bold: true, color: { argb: tone.font } }
  })

  ws.views = [{ state: 'frozen', ySplit: head, showGridLines: false }]
  ws.autoFilter = { from: { row: head, column: 1 }, to: { row: head + rows.length, column: cols } }
  ws.pageSetup.printTitlesRow = `${head}:${head}`
  ws.headerFooter = { oddFooter: `&L&8${supplier}&C&8First Article Status Report — ${asOf}&R&8Page &P of &N` }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName || `FA_Status_Report_${asOf}.xlsx`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return rows.length
}

// ── 품질팀 양식 (한글) — 「고객사 제출용」 시트와 같은 모양 (v4.202.0) ──
//   No. · Part Number · Description · 진행사항 · 입회 요청 일정 / 상위 품목만 (하위 구성품 제외) · 마감 건도 사유로 보임
export function koStatus(fa) {
  if (faClosed(fa)) return fa.close_reason === 'cancel' ? '발주취소' : fa.close_reason === 'prev_ok' ? '기존 FA승인 됨' : '입회 면제'
  const v = (k) => fa.steps?.[k]
  if (faApproved(fa)) return 'FA 승인'
  if (gateDone(v('g_submit'))) return '입회 완료'
  if (gateDone(v('g_report')) || gateSt(v('g_submit')) === 'doing') return '준비 완료'
  if (fa.hold) return '보류'
  if (['g_make_start', 'g_make_done', 'g_handover', 'g_inspect'].some((k) => gateDone(v(k)) || gateSt(v(k)) === 'doing')) return '제작 진행 중'
  return '일정 미확정'
}
export function koWitness(fa) {
  if (fa.close_reason === 'cancel') return fa.close_note || '발주 취소'
  if (fa.close_reason === 'prev_ok' || fa.close_reason === 'waived') return '해당 없음'
  return fa.steps?.g_submit?.p || fa.fa_ready_date || fa.fa_ready_text || '일정 미확정'
}
export function koRows(list) {
  return list.filter((f) => !f.parent_id).map((f) => ({ pn: f.item_code, desc: f.item_desc || '', st: koStatus(f), wit: koWitness(f) }))
}
export async function exportFaCustomerKo(list, { asOf, fileName } = {}) {
  const rows = koRows(list)
  if (!rows.length) throw new Error('내보낼 건이 없습니다')
  const ExcelJS = (await import('exceljs')).default
  const NAVY = 'FF1E293B'
  const LINE = { style: 'thin', color: { argb: 'FFCBD5E1' } }
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('고객사 제출용', { views: [{ showGridLines: false }], pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
  ;[6, 14, 46, 18, 26].forEach((w, i) => { ws.getColumn(i + 1).width = w })
  ws.mergeCells(1, 1, 1, 5)
  ws.getCell(1, 1).value = ' AXCELIS  |  OPEN FA INSPECTION STATUS'
  ws.getCell(1, 1).font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } }
  ws.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  ws.getRow(1).height = 30
  ws.mergeCells(3, 1, 3, 5)
  ws.getCell(3, 1).value = ` FA 입회검사 대상 품목별 현황   (기준일 ${asOf || ''})`
  ws.getCell(3, 1).font = { bold: true, size: 11, color: { argb: NAVY } }
  const head = 5
  ws.getRow(head).values = ['No.', 'Part Number', 'Description', '진행사항', '입회 요청 일정']
  ws.getRow(head).eachCell((c) => {
    c.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }
    c.alignment = { vertical: 'middle', horizontal: 'center' }
    c.border = { top: LINE, bottom: LINE, left: LINE, right: LINE }
  })
  const TONE = { '발주취소': 'FFFEE2E2', '기존 FA승인 됨': 'FFF1F5F9', '준비 완료': 'FFDCFCE7', '입회 완료': 'FFDBEAFE', 'FA 승인': 'FFDCFCE7', '제작 진행 중': 'FFE0E7FF', '보류': 'FFFEF3C7' }
  rows.forEach((r, i) => {
    const row = ws.getRow(head + 1 + i)
    row.values = [i + 1, /^[1-9]\d{0,14}$/.test(String(r.pn)) ? Number(r.pn) : r.pn, r.desc, r.st, r.wit]
    row.height = 20
    row.eachCell({ includeEmpty: true }, (c, n) => {
      c.font = { size: 10 }
      c.border = { top: LINE, bottom: LINE, left: LINE, right: LINE }
      c.alignment = { vertical: 'middle', horizontal: n === 3 ? 'left' : 'center' }
    })
    if (TONE[r.st]) row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TONE[r.st] } }
  })
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName || `Axcelis_FA_입회현황_${asOf || ''}.xlsx`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return rows.length
}
