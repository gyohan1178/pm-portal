import ExcelJS from 'exceljs'

// 구매이력 (밀시트 대체) — 초도품 승인용.
//
//   ⚠ 단가는 넣지 않는다. 고객사로 나가는 자료다.
//
//   시트 셋
//     구매이력       BOM 순서 그대로. 레벨을 들여쓰기와 색으로 구분
//     이력 없음      사유를 채워 넣을 칸을 비워 둔다
//     요약           레벨·분류별 건수와 이력 비율

const THIN = { style: 'thin', color: { argb: 'FFDDE1E8' } }
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN }
const NAVY = 'FF44546A'
const WHITE = 'FFFFFFFF'

// 레벨 색 — 깊어질수록 옅게. 계층이 한눈에 잡힌다.
const LV_FILL = ['FFE8EDF7', 'FFEFF3F9', 'FFF5F7FB', 'FFF9FAFC', 'FFFCFDFE', 'FFFFFFFF']
const LV_TEXT = ['FF2B4C8C', 'FF3C5A96', 'FF5B7099', 'FF7A8AA6', 'FF98A0B0', 'FF98A0B0']
const lvFill = lv => LV_FILL[Math.min(Math.max((lv || 1) - 1, 0), 5)]
const lvText = lv => LV_TEXT[Math.min(Math.max((lv || 1) - 1, 0), 5)]

const GRP_COLOR = {
  '파트':     'FF2E7FB8',
  '가공물':   'FFB8791F',
  '어셈블리': 'FF7C5CD6',
  '미분류':   'FFC2566A',
}

const F = '맑은 고딕'

// ⚠ alignment 의 indent 는 쓰지 않는다.
//   엑셀이 "내용에 문제가 있습니다" 로 복구를 물어보던 원인이었다.
//   계층은 품번 앞 공백으로 표현한다.
const pad = lv => '　'.repeat(Math.max(0, (lv || 1) - 1))

const cell = (ws, r, c, v, o = {}) => {
  const x = ws.getCell(r, c)
  // 빈 문자열 대신 값을 넣지 않는다. 빈 문자열은 공유문자열에 빈 항목을 만든다.
  if (v !== '' && v != null) x.value = v
  x.font = { name: F, size: o.size || 9, bold: !!o.bold,
             color: { argb: o.color || 'FF1F2430' } }
  x.alignment = { horizontal: o.align || 'left', vertical: 'middle', wrapText: !!o.wrap }
  if (o.fmt) x.numFmt = o.fmt
  x.border = BOX
  if (o.fill) x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } }
  return x
}

const COLS = [
  ['No', 6], ['LV', 5], ['품번', 18], ['품명', 38], ['분류', 9],
  ['제조사', 16], ['제조사품번', 20], ['소요', 8], ['단위', 6],
  ['구매처', 20], ['발주번호', 15], ['발주일', 12], ['입고일', 12],
  ['입고수량', 10], ['비고', 22],
]

function header(ws, cols, title, sub) {
  cols.forEach(([, w], i) => { ws.getColumn(i + 1).width = w })
  ws.mergeCells(1, 1, 1, cols.length)
  cell(ws, 1, 1, title, { size: 14, bold: true })
  ws.getRow(1).height = 22
  ws.mergeCells(2, 1, 2, cols.length)
  cell(ws, 2, 1, sub, { size: 9, color: 'FF98A0B0' })
  cols.forEach(([h], i) => {
    cell(ws, 4, i + 1, h, { bold: true, color: WHITE, fill: NAVY, align: 'center' })
  })
  ws.getRow(4).height = 20
  ws.views = [{ state: 'frozen', ySplit: 4 }]
}

/**
 * asm  : { code, name, rev }
 * rows : pm_purchase_history 결과
 */
export async function downloadPurchaseHistory({ asm, rows, fileName }) {
  const wb = new ExcelJS.Workbook()
  wb.creator = '진선테크 구매자재팀'
  wb.created = new Date()
  const ymd = new Date().toISOString().slice(0, 10)

  const has = rows.filter(r => r.recv_date)
  const none = rows.filter(r => !r.recv_date && r.note === '구매 이력 없음')
  const etc = rows.filter(r => !r.recv_date && r.note !== '구매 이력 없음')

  // ── 구매이력 ──
  const ws = wb.addWorksheet('구매이력', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true,
                 fitToWidth: 1, fitToHeight: 0, margins: { left: .3, right: .3, top: .4, bottom: .4 } },
  })
  header(ws, COLS, `구매 이력 — ${asm.code}`,
    `${asm.name || ''}${asm.rev ? ` · REV ${asm.rev}` : ''} · 출력일 ${ymd}`
    + ` · ${rows.length}행 (이력 ${has.length} · 없음 ${none.length})`
    + ' · 단가는 포함되어 있지 않습니다')

  rows.forEach((r, i) => {
    const rr = 5 + i
    const lv = Number(r.lv) || 1
    const bg = lvFill(lv)
    const noHist = !r.recv_date && r.note === '구매 이력 없음'
    const vals = [
      i + 1, lv, pad(lv) + r.std_code, r.item_name, r.grp,
      r.manufacturer, r.maker_code,
      Number(r.bom_qty) || 0, r.unit || 'EA',
      r.vendor, r.po_number, r.order_date, r.recv_date,
      r.recv_qty == null ? null : Number(r.recv_qty), r.note,
    ]
    vals.forEach((v, j) => {
      const o = { fill: noHist ? 'FFFDF3F3' : bg }
      if (j === 0) { o.align = 'center'; o.color = 'FF98A0B0' }
      if (j === 1) { o.align = 'center'; o.bold = true; o.color = lvText(lv) }
      // 레벨만큼 들여써서 계층이 보이게 한다
      if (j === 2) { o.bold = lv <= 2; o.color = lvText(lv) }
      if (j === 4) { o.align = 'center'; o.bold = true; o.color = GRP_COLOR[r.grp] || 'FF98A0B0' }
      if (j === 7) { o.align = 'right'; o.fmt = '#,##0.0' }        // 소요는 소수 한 자리
      if (j === 13) { o.align = 'right'; o.fmt = '#,##0.###' }
      if (j === 8) o.align = 'center'
      if (j === 11 || j === 12) o.align = 'center'
      if (j === 14 && noHist) { o.color = 'FFC00000'; o.bold = true }
      cell(ws, rr, j + 1, v, o)
    })
  })
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: COLS.length } }

  // ── 이력 없음 ──
  //   ⚠ 같은 품번이 여러 레벨에 나오므로 품번으로 묶는다.
  //     행마다 증빙할 필요가 없고, 435줄이 243품번으로 줄어 보기 쉽다.
  //     소요는 합계, 쓰인 곳 수를 함께 내 어디에 들어가는지 알 수 있게 한다.
  if (none.length) {
    const byPn = new Map()
    none.forEach(r => {
      const k = r.std_code
      const cur = byPn.get(k)
      if (cur) {
        cur.qty += Number(r.bom_qty) || 0
        cur.cnt += 1
        cur.lv = Math.min(cur.lv, Number(r.lv) || 1)
      } else {
        byPn.set(k, {
          std_code: k, item_name: r.item_name, grp: r.grp,
          manufacturer: r.manufacturer, maker_code: r.maker_code, unit: r.unit,
          qty: Number(r.bom_qty) || 0, cnt: 1, lv: Number(r.lv) || 1,
        })
      }
    })
    const uniq = [...byPn.values()].sort((a, b) =>
      a.lv - b.lv || a.std_code.localeCompare(b.std_code))

    const NC = [['No', 6], ['LV', 5], ['품번', 18], ['품명', 38], ['분류', 9],
                ['제조사', 16], ['제조사품번', 20], ['소요 합계', 10], ['단위', 6],
                ['쓰인 곳', 8], ['사유', 26], ['비고', 26]]
    const ns = wb.addWorksheet('이력 없음', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    })
    header(ns, NC, `구매 이력이 확인되지 않은 품목 — ${asm.code}`,
      `${uniq.length}품번 (BOM ${none.length}줄) · 사급·지급자재이거나 시스템 도입 전에 매입한 품목일 수 있습니다.`
      + ' 노란 칸에 사유를 적어 주세요.')
    uniq.forEach((r, i) => {
      const rr = 5 + i
      const vals = [i + 1, r.lv, r.std_code, r.item_name, r.grp,
                    r.manufacturer, r.maker_code,
                    r.qty, r.unit || 'EA', r.cnt, null, null]
      vals.forEach((v, j) => {
        const o = {}
        if (j === 0) { o.align = 'center'; o.color = 'FF98A0B0' }
        if (j === 1) { o.align = 'center'; o.bold = true; o.color = lvText(r.lv) }
        if (j === 2) { o.bold = true }
        if (j === 4) { o.align = 'center'; o.bold = true; o.color = GRP_COLOR[r.grp] || 'FF98A0B0' }
        if (j === 7) { o.align = 'right'; o.fmt = '#,##0.0' }
        if (j === 8) o.align = 'center'
        // 여러 곳에 쓰이면 눈에 띄게 — 어디에 들어가는지가 사유 판단에 도움이 된다
        if (j === 9) { o.align = 'center'; o.color = r.cnt > 1 ? 'FF7C5CD6' : 'FF98A0B0'
                       o.bold = r.cnt > 1 }
        if (j >= 10) o.fill = 'FFFFF2CC'     // 채워 넣을 칸
        cell(ns, rr, j + 1, v, o)
      })
    })
    ns.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + uniq.length, column: NC.length } }
  }

  // ── 요약 ──
  const sm = wb.addWorksheet('요약', { views: [{ showGridLines: false }] })
  ;[['A', 3], ['B', 14], ['C', 12], ['D', 12], ['E', 12], ['F', 12]]
    .forEach(([c, w]) => { sm.getColumn(c).width = w })

  cell(sm, 2, 2, '진선테크 · 지원본부 구매자재팀', { size: 9, color: 'FF98A0B0' })
  sm.mergeCells('B3:F3')
  cell(sm, 3, 2, `구매 이력 요약 — ${asm.code}`, { size: 16, bold: true })
  sm.getRow(3).height = 24
  sm.mergeCells('B4:F4')
  cell(sm, 4, 2, `${asm.name || ''} · 출력일 ${ymd}`, { size: 9, color: 'FF98A0B0' })

  const box = (r, label, v, sub, color) => {
    cell(sm, r, 2, label, { bold: true })
    cell(sm, r, 3, v, { bold: true, align: 'right', color, fmt: '#,##0' })
    sm.mergeCells(r, 4, r, 6)
    cell(sm, r, 4, sub, { size: 9, color: 'FF98A0B0' })
  }
  cell(sm, 6, 2, '구분', { bold: true, color: WHITE, fill: NAVY, align: 'center' })
  cell(sm, 6, 3, '건수', { bold: true, color: WHITE, fill: NAVY, align: 'center' })
  sm.mergeCells(6, 4, 6, 6)
  cell(sm, 6, 4, '설명', { bold: true, color: WHITE, fill: NAVY, align: 'center' })
  box(7, '전체', rows.length, 'BOM 하위품목 중 매입 대상', 'FF1F2430')
  box(8, '이력 확인', has.length,
      rows.length ? `${Math.round(has.length / rows.length * 100)}%` : '', 'FF12A05F')
  box(9, '이력 없음', none.length,
      `${new Set(none.map(r => r.std_code)).size}품번 · 사급·지급자재이거나 시스템 도입 전 매입`,
      'FFC00000')
  box(10, '해당 없음', etc.length, '하위 부품으로 구성되는 어셈블리 등', 'FF98A0B0')

  // 레벨별
  let r0 = 12
  cell(sm, r0, 2, '레벨', { bold: true, color: WHITE, fill: NAVY, align: 'center' })
  cell(sm, r0, 3, '건수', { bold: true, color: WHITE, fill: NAVY, align: 'center' })
  cell(sm, r0, 4, '이력', { bold: true, color: WHITE, fill: NAVY, align: 'center' })
  cell(sm, r0, 5, '없음', { bold: true, color: WHITE, fill: NAVY, align: 'center' })
  sm.mergeCells(r0, 6, r0, 6)
  cell(sm, r0, 6, '비율', { bold: true, color: WHITE, fill: NAVY, align: 'center' })
  const lvs = [...new Set(rows.map(r => Number(r.lv) || 1))].sort((a, b) => a - b)
  lvs.forEach((lv, i) => {
    const rr = r0 + 1 + i
    const g = rows.filter(r => (Number(r.lv) || 1) === lv)
    const gh = g.filter(r => r.recv_date).length
    cell(sm, rr, 2, `L${lv}`, { bold: true, color: lvText(lv), fill: lvFill(lv), align: 'center' })
    cell(sm, rr, 3, g.length, { align: 'right', fmt: '#,##0' })
    cell(sm, rr, 4, gh, { align: 'right', fmt: '#,##0', color: 'FF12A05F' })
    cell(sm, rr, 5, g.length - gh, { align: 'right', fmt: '#,##0', color: 'FFC00000' })
    cell(sm, rr, 6, g.length ? gh / g.length : 0, { align: 'right', fmt: '0%' })
  })

  // 분류별
  r0 = r0 + lvs.length + 3
  cell(sm, r0, 2, '분류', { bold: true, color: WHITE, fill: NAVY, align: 'center' })
  cell(sm, r0, 3, '건수', { bold: true, color: WHITE, fill: NAVY, align: 'center' })
  cell(sm, r0, 4, '이력', { bold: true, color: WHITE, fill: NAVY, align: 'center' })
  cell(sm, r0, 5, '없음', { bold: true, color: WHITE, fill: NAVY, align: 'center' })
  cell(sm, r0, 6, '비율', { bold: true, color: WHITE, fill: NAVY, align: 'center' })
  const grps = [...new Set(rows.map(r => r.grp))].filter(Boolean)
  grps.forEach((g0, i) => {
    const rr = r0 + 1 + i
    const g = rows.filter(r => r.grp === g0)
    const gh = g.filter(r => r.recv_date).length
    cell(sm, rr, 2, g0, { bold: true, color: GRP_COLOR[g0] || 'FF98A0B0', align: 'center' })
    cell(sm, rr, 3, g.length, { align: 'right', fmt: '#,##0' })
    cell(sm, rr, 4, gh, { align: 'right', fmt: '#,##0', color: 'FF12A05F' })
    cell(sm, rr, 5, g.length - gh, { align: 'right', fmt: '#,##0', color: 'FFC00000' })
    cell(sm, rr, 6, g.length ? gh / g.length : 0, { align: 'right', fmt: '0%' })
  })

  r0 = r0 + grps.length + 3
  sm.mergeCells(r0, 2, r0, 6)
  cell(sm, r0, 2, '※ 본 자료에는 매입단가가 포함되어 있지 않습니다.', { size: 9, bold: true, color: 'FF98A0B0' })
  sm.mergeCells(r0 + 1, 2, r0 + 1, 6)
  cell(sm, r0 + 1, 2, '작성 구매자재팀 · 문의 gyohan@jinsuntech.co.kr', { size: 9, color: 'FF98A0B0' })

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
