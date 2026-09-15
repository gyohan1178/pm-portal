import ExcelJS from 'exceljs'

// 로트 실사표.
//
//   ⚠ 지금 장부 수치 셋이 서로 맞지 않아 실물을 세야 한다.
//       입고 기록   대부분 0 (기존 관리대장에서 이관만 함)
//       로트 잔량   이관 당시 총량 그대로 — 그 뒤 쓴 것이 안 빠졌다
//       재고        손으로 맞춘 값 — 출고 뒤에 덮어쓴 흔적이 있다
//
//   ⚠ 자동필터·셀 들여쓰기는 쓰지 않는다.
//     엑셀이 "복구하겠습니까" 로 묻던 원인이었다.

const THIN = { style: 'thin', color: { argb: 'FFDDE1E8' } }
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN }
const NAVY = 'FF44546A'
const WHITE = 'FFFFFFFF'
const INPUT = 'FFFFF2CC'      // 적어 넣을 칸
const F = '맑은 고딕'

const cell = (ws, r, c, v, o = {}) => {
  const x = ws.getCell(r, c)
  if (v !== '' && v != null) x.value = v
  x.font = { name: F, size: o.size || 9, bold: !!o.bold,
             color: { argb: o.color || 'FF1F2430' } }
  x.alignment = { horizontal: o.align || 'left', vertical: 'middle', wrapText: !!o.wrap }
  if (o.fmt) x.numFmt = o.fmt
  x.border = BOX
  if (o.fill) x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } }
  return x
}

const head = (ws, cols, title, sub) => {
  cols.forEach(([, w], i) => { ws.getColumn(i + 1).width = w })
  ws.mergeCells(1, 1, 1, cols.length)
  cell(ws, 1, 1, title, { size: 14, bold: true })
  ws.getRow(1).height = 22
  ws.mergeCells(2, 1, 2, cols.length)
  cell(ws, 2, 1, sub, { size: 9, color: 'FF98A0B0' })
  cols.forEach(([h], i) =>
    cell(ws, 4, i + 1, h, { bold: true, color: WHITE, fill: NAVY, align: 'center', wrap: true }))
  ws.getRow(4).height = 24
  ws.views = [{ state: 'frozen', ySplit: 4 }]
}

/**
 * rows : pm_lot_audit_sheet 결과 (품목 × 로트)
 * outs : pm_lot_recent_out 결과
 */
export async function downloadLotAudit({ rows, outs = [], fileName }) {
  const wb = new ExcelJS.Workbook()
  wb.creator = '진선테크 구매자재팀'
  wb.created = new Date()
  const ymd = new Date().toISOString().slice(0, 10)

  // 품목 단위로 묶는다 — 실사는 품목을 찾아가서 하는 일이다
  const byItem = new Map()
  rows.forEach(r => {
    const k = r.item_id
    if (!byItem.has(k)) byItem.set(k, { ...r, lots: [] })
    if (r.lot_id) byItem.get(k).lots.push(r)
  })
  const items = [...byItem.values()]

  // ── 실사표 ──
  const C = [
    ['품번', 18], ['품명', 32], ['위치', 12], ['제조사', 14],
    ['로트 (시리얼)', 16], ['제조', 11], ['입고일', 11], ['구매처', 12],
    ['장부\n로트잔량', 10], ['실물\n수량', 10], ['차이', 9], ['비고', 22],
  ]
  const ws = wb.addWorksheet('실사표', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true,
                 fitToWidth: 1, fitToHeight: 0,
                 margins: { left: .3, right: .3, top: .4, bottom: .4 } },
  })
  head(ws, C, '로트 실사표',
    `출력일 ${ymd} · 품목 ${items.length}종 · 로트 ${rows.filter(r => r.lot_id).length}건`
    + ' · 노란 칸에 실물 수량을 적어 주세요. 로트가 없는 실물이 있으면 아래 빈 줄에 적어 주세요.')

  let r = 5
  items.forEach(it => {
    // 품목 머리 — 장부 재고와 로트 합이 얼마나 벌어져 있는지 먼저 보인다
    ws.mergeCells(r, 1, r, 4)
    cell(ws, r, 1, `${it.std_code}  ${it.item_name || ''}`,
         { bold: true, fill: 'FFEFF3F9', color: 'FF2B4C8C' })
    ws.mergeCells(r, 5, r, 8)
    cell(ws, r, 5, `위치 ${it.location || '-'} · ${it.maker || ''}`,
         { size: 9, color: 'FF64748B', fill: 'FFEFF3F9' })
    cell(ws, r, 9, Number(it.stock_qty) || 0,
         { align: 'right', bold: true, fill: 'FFEFF3F9', fmt: '#,##0.###' })
    cell(ws, r, 10, null, { fill: 'FFEFF3F9' })
    cell(ws, r, 11, Number(it.gap) || 0,
         { align: 'right', bold: true, fill: 'FFEFF3F9', fmt: '#,##0.###',
           color: Number(it.gap) === 0 ? 'FF12A05F' : 'FFC00000' })
    cell(ws, r, 12, Number(it.gap) === 0 ? '장부 일치' : '장부 재고와 로트 합이 다름',
         { size: 8, color: 'FF98A0B0', fill: 'FFEFF3F9' })
    r++

    if (!it.lots.length) {
      cell(ws, r, 1, null); cell(ws, r, 2, '(등록된 로트 없음)', { color: 'FFC00000' })
      for (let c = 3; c <= 12; c++) cell(ws, r, c, null, { fill: c >= 10 && c <= 12 ? INPUT : undefined })
      r++
    }
    it.lots.forEach(l => {
      const vals = [null, null, null, null,
                    l.serial_no, l.made_ym, l.in_date, l.vendor_name,
                    Number(l.lot_qty_left) || 0, null, null, null]
      vals.forEach((v, j) => {
        const o = {}
        if (j === 4) { o.bold = true }
        if (j === 5 || j === 6) o.align = 'center'
        if (j === 8) { o.align = 'right'; o.fmt = '#,##0.###' }
        if (j >= 9) o.fill = INPUT          // 실물·차이·비고
        if (j === 9) { o.align = 'right' }
        cell(ws, r, j + 1, v, o)
      })
      r++
    })

    // 로트 없는 실물을 적을 빈 줄 둘
    for (let k = 0; k < 2; k++) {
      for (let c = 1; c <= 12; c++) {
        cell(ws, r, c, null, { fill: c >= 5 ? INPUT : undefined })
      }
      r++
    }
  })

  // ── 로트관리 이후 출고 ──
  if (outs.length) {
    const OC = [['품번', 18], ['품명', 32], ['출고일', 12], ['수량', 9], ['단위', 6],
                ['출고 내용', 40], ['어느 로트에서', 18], ['비고', 20]]
    const os = wb.addWorksheet('출고 — 로트 확인', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    })
    head(os, OC, '로트관리 시작 이후 출고',
      `${outs.length}건 · 어느 로트에서 나갔는지 기록이 없습니다.`
      + ' 아는 대로 「어느 로트에서」 칸에 시리얼을 적어 주세요. 사용이력으로 넣습니다.')
    outs.forEach((o, i) => {
      const rr = 5 + i
      const vals = [o.std_code, o.item_name, o.move_date, Number(o.qty) || 0,
                    o.unit || 'EA', o.memo, null, o.already ? '이미 기록됨' : null]
      vals.forEach((v, j) => {
        const opt = {}
        if (j === 0) opt.bold = true
        if (j === 2) opt.align = 'center'
        if (j === 3) { opt.align = 'right'; opt.fmt = '#,##0.###' }
        if (j === 4) opt.align = 'center'
        if (j === 6) opt.fill = INPUT
        if (j === 7 && o.already) { opt.color = 'FF12A05F'; opt.bold = true }
        else if (j === 7) opt.fill = INPUT
        cell(os, rr, j + 1, v, opt)
      })
    })
  }

  // ── 안내 ──
  const g = wb.addWorksheet('읽어주세요', { views: [{ showGridLines: false }] })
  g.getColumn('A').width = 3
  g.getColumn('B').width = 96
  const lines = [
    ['로트 실사 안내', 14, true],
    ['', 9, false],
    [`출력일 ${ymd} · 진선테크 구매자재팀`, 9, false],
    ['', 9, false],
    ['■ 왜 실사가 필요한가', 11, true],
    ['지금 장부에 있는 세 숫자가 서로 맞지 않습니다.', 9.5, false],
    ['  · 입고 기록 — 대부분 없습니다. 기존 관리대장에서 로트만 옮겨 적었습니다.', 9.5, false],
    ['  · 로트 잔량 — 이관 당시 총량 그대로입니다. 그 뒤 쓴 것이 빠지지 않았습니다.', 9.5, false],
    ['  · 재고 — 손으로 맞춘 값입니다. 출고 뒤에 덮어쓴 흔적이 있습니다.', 9.5, false],
    ['어느 쪽을 믿을지 정할 수 없어 실물을 세는 것이 가장 빠릅니다.', 9.5, false],
    ['', 9, false],
    ['■ 어떻게 적나', 11, true],
    ['1. 「실사표」 시트에서 위치를 찾아가 로트별로 실물을 셉니다.', 9.5, false],
    ['2. 노란 칸(실물 수량)에 센 수를 적습니다. 0이면 0이라고 적어 주세요.', 9.5, false],
    ['3. 장부에 없는 로트가 실물에 있으면 품목 아래 빈 줄에 적어 주세요.', 9.5, false],
    ['4. 「출고 — 로트 확인」 시트에서, 아는 출고는 어느 로트였는지 적어 주세요.', 9.5, false],
    ['', 9, false],
    ['■ 실사 뒤에는', 11, true],
    ['재고와 로트 잔량을 실물에 맞추고, 그다음부터는 출고할 때', 9.5, false],
    ['오래된 로트부터 자동으로 빠지도록 합니다. 그러면 다시 어긋나지 않습니다.', 9.5, false],
    ['', 9, false],
    ['문의 · 회신: 구매자재팀 (gyohan@jinsuntech.co.kr)', 9, false],
  ]
  lines.forEach(([t, sz, b], i) => {
    const c = g.getCell(i + 1, 2)
    if (t) c.value = t
    c.font = { name: F, size: sz, bold: b }
  })

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
