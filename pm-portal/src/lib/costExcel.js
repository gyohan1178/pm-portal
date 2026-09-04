import ExcelJS from 'exceljs'

// 원가 총괄을 바로 제출할 수 있는 상태로 뽑는다.
//   표지(요약) + 상위품번별 총괄 + 필요하면 세부.
//
//   ⚠️ 영업팀에 나가는 것은 매입단가·구매처를 뺀다.
//      협상 카드라 밖으로 돌면 곤란하다. 손으로 지우는 방식은
//      한 번만 깜빡해도 그대로 나가므로 만들 때부터 가른다.

const THIN = { style: 'thin', color: { argb: 'FFD0D0D0' } }
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN }
const NUM = '#,##0'
const PCT = '0.0"%"'

const NAVY = 'FF44546A'
const HEAD_TX = 'FFFFFFFF'
const SOFT = 'FFF2F5F9'
const SUM_FILL = 'FFE8EDF4'

const put = (ws, addr, v, o = {}) => {
  const c = ws.getCell(addr)
  c.value = v
  c.font = { name: '맑은 고딕', size: o.size || 10, bold: !!o.bold,
             color: { argb: o.color || 'FF1F2430' } }
  c.alignment = { horizontal: o.align || 'left', vertical: 'middle', wrapText: !!o.wrap }
  if (o.fmt) c.numFmt = o.fmt
  if (o.border) c.border = BOX
  if (o.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } }
  return c
}

const won = n => Math.round(Number(n) || 0)

/**
 * head : { csName, asOf, rowCount, sum:{part,mach,etc,total,rows,priced,noPrice}, cover }
 * rows : pm_cost_summary 결과
 * detail : { code, name, rows } 또는 null
 * withPrice : false 면 매입단가·구매처를 빼고 만든다 (영업팀용)
 */
export async function downloadCostExcel({ head, rows, detail = null, withPrice = true, fileName }) {
  const wb = new ExcelJS.Workbook()
  wb.creator = '진선테크 구매자재팀'
  wb.created = new Date()

  // ─────────────────────────────────────────
  // 표지
  // ─────────────────────────────────────────
  const cv = wb.addWorksheet('표지', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.6, right: 0.6, top: 0.7, bottom: 0.6, header: 0.3, footer: 0.3 } },
    views: [{ showGridLines: false }],
  })
  ;[['A', 3], ['B', 20], ['C', 18], ['D', 18], ['E', 18], ['F', 14]]
    .forEach(([c, w]) => { cv.getColumn(c).width = w })

  put(cv, 'B2', '진선테크 · 지원본부 구매자재팀', { size: 9, color: 'FF98A0B0' })
  cv.mergeCells('B3:F3')
  put(cv, 'B3', '원자재 원가 총괄', { size: 24, bold: true })
  cv.getRow(3).height = 34
  cv.mergeCells('B4:F4')
  put(cv, 'B4', `${head.csName} · 기준일 ${head.asOf}`, { size: 11, color: 'FF4A5162' })

  // 총액
  cv.mergeCells('B6:F6')
  put(cv, 'B6', '원자재 매입 합계', { size: 10, bold: true, color: 'FF98A0B0' })
  cv.mergeCells('B7:F7')
  put(cv, 'B7', won(head.sum.total), { size: 26, bold: true, fmt: '#,##0"원"' })
  cv.getRow(7).height = 34
  cv.mergeCells('B8:F8')
  put(cv, 'B8',
    `상위품번 ${head.rowCount.toLocaleString('ko-KR')}개 · BOM ${head.sum.rows.toLocaleString('ko-KR')}행`,
    { size: 10, color: 'FF98A0B0' })

  // 분류별
  const t = head.sum.total || 1
  const cat = [
    ['파트',   head.sum.part, '전장 · 커넥터 · 케이블 · 하드웨어'],
    ['가공물', head.sum.mach, '판금 · 브라켓 · 외주 가공'],
    ['기타',   head.sum.etc,  '사 오는 어셈블리 · 미분류'],
  ]
  put(cv, 'B10', '분류', { bold: true, fill: NAVY, color: HEAD_TX, border: true, align: 'center' })
  put(cv, 'C10', '금액', { bold: true, fill: NAVY, color: HEAD_TX, border: true, align: 'center' })
  put(cv, 'D10', '비중', { bold: true, fill: NAVY, color: HEAD_TX, border: true, align: 'center' })
  cv.mergeCells('E10:F10')
  put(cv, 'E10', '무엇이 들어가나', { bold: true, fill: NAVY, color: HEAD_TX, border: true, align: 'center' })
  cv.getRow(10).height = 20
  cat.forEach(([nm, v, desc], i) => {
    const r = 11 + i
    put(cv, `B${r}`, nm, { bold: true, border: true })
    put(cv, `C${r}`, won(v), { fmt: NUM, align: 'right', border: true })
    put(cv, `D${r}`, (Number(v) || 0) / t * 100, { fmt: PCT, align: 'right', border: true })
    cv.mergeCells(`E${r}:F${r}`)
    put(cv, `E${r}`, desc, { size: 9, color: 'FF98A0B0', border: true })
  })
  const rSum = 11 + cat.length
  put(cv, `B${rSum}`, '합계', { bold: true, border: true, fill: SUM_FILL })
  put(cv, `C${rSum}`, won(head.sum.total), { fmt: NUM, align: 'right', bold: true, border: true, fill: SUM_FILL })
  put(cv, `D${rSum}`, 100, { fmt: PCT, align: 'right', bold: true, border: true, fill: SUM_FILL })
  cv.mergeCells(`E${rSum}:F${rSum}`)
  put(cv, `E${rSum}`, '', { border: true, fill: SUM_FILL })

  // 숫자를 얼마나 믿을 수 있나 — 표지에만 둔다
  let r = rSum + 2
  const cover = head.cover
  cv.mergeCells(`B${r}:F${r}`)
  put(cv, `B${r}`, '이 숫자를 얼마나 믿을 수 있나', { bold: true, size: 11 })
  r++
  cv.mergeCells(`B${r}:F${r}`)
  put(cv, `B${r}`,
    cover == null
      ? '단가 등록 현황을 셀 수 없습니다.'
      : `매입단가 반영률 ${(cover * 100).toFixed(1)}%  (등록 ${head.sum.priced.toLocaleString('ko-KR')}종 · 미등록 ${head.sum.noPrice.toLocaleString('ko-KR')}종)`,
    { size: 10, bold: true, color: cover != null && cover >= 0.9 ? 'FF12A05F' : 'FFE0505F' })
  r++
  cv.mergeCells(`B${r}:F${r}`)
  put(cv, `B${r}`,
    cover != null && cover < 0.9
      ? `⚠ 매입단가가 등록되지 않은 품목이 ${head.sum.noPrice.toLocaleString('ko-KR')}종 있습니다. 위 합계는 실제 원가보다 적으므로 견적 근거로 쓰실 때 감안해 주세요.`
      : '원가 대상 품목의 매입단가가 대부분 등록되어 있습니다.',
    { size: 9, color: 'FF4A5162', wrap: true })
  cv.getRow(r).height = 26

  r += 2
  cv.mergeCells(`B${r}:F${r}`)
  put(cv, `B${r}`, '계산에서 제외한 것', { bold: true, size: 11 })
  ;[
    '하네스 — 우리가 만드는 것이라 매입원가가 아닙니다. 제조원가는 따로 봅니다.',
    '견적 미대상 — 사급 · 무상지급 · 견적에 넣지 않기로 한 품목입니다.',
    '하위 부품이 이미 계산된 어셈블리 — 두 번 세지 않기 위해 뺍니다.',
    '작업표준 · 도면 — 사는 물건이 아닙니다.',
  ].forEach((s, i) => {
    const rr = r + 1 + i
    cv.mergeCells(`B${rr}:F${rr}`)
    put(cv, `B${rr}`, '· ' + s, { size: 9, color: 'FF4A5162' })
  })
  r += 6
  cv.mergeCells(`B${r}:F${r}`)
  put(cv, `B${r}`,
    withPrice ? '※ 매입단가·구매처가 포함된 내부용입니다. 사외 반출 금지.'
              : '※ 매입단가·구매처는 포함되어 있지 않습니다.',
    { size: 9, bold: true, color: withPrice ? 'FFE0505F' : 'FF98A0B0' })
  r++
  cv.mergeCells(`B${r}:F${r}`)
  put(cv, `B${r}`, '작성 구매자재팀 · 문의 gyohan@jinsuntech.co.kr', { size: 9, color: 'FF98A0B0' })

  // ─────────────────────────────────────────
  // 총괄표
  // ─────────────────────────────────────────
  const ws = wb.addWorksheet('원가 총괄', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    views: [{ state: 'frozen', ySplit: 4 }],
  })
  const cols = [
    ['상위품번', 20], ['어셈블리명', 44], ['BOM행', 9], ['품목종수', 10],
    ['파트', 15], ['가공물', 15], ['기타', 13], ['원자재 합계', 17], ['하네스', 10],
  ]
  cols.forEach(([, w], i) => { ws.getColumn(i + 1).width = w })

  ws.mergeCells(1, 1, 1, cols.length)
  put(ws, 'A1', `원자재 원가 총괄 — ${head.csName}`, { size: 15, bold: true })
  ws.getRow(1).height = 24
  ws.mergeCells(2, 1, 2, cols.length)
  put(ws, 'A2', `기준일 ${head.asOf} · 상위품번 ${head.rowCount.toLocaleString('ko-KR')}개 · 단위 원`,
      { size: 9, color: 'FF98A0B0' })

  cols.forEach(([h], i) => {
    const c = ws.getCell(4, i + 1)
    c.value = h
    c.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: HEAD_TX } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
    c.border = BOX
  })
  ws.getRow(4).height = 22

  rows.forEach((x, i) => {
    const rr = 5 + i
    const vals = [
      x.project_code, x.project_name || '', Number(x.bom_rows), Number(x.item_kinds),
      won(x.part_krw), won(x.mach_krw), won(x.etc_krw), won(x.total_krw),
      Number(x.harness_kinds) > 0 ? Number(x.harness_kinds) : '',
    ]
    vals.forEach((v, j) => {
      const c = ws.getCell(rr, j + 1)
      c.value = v
      c.font = { name: '맑은 고딕', size: 10, bold: j === 7 }
      c.alignment = { horizontal: j >= 2 ? 'right' : 'left', vertical: 'middle' }
      if (j >= 2) c.numFmt = NUM
      c.border = BOX
      if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } }
    })
  })

  const rr = 5 + rows.length
  const tot = ['합계', `${rows.length}개 상위품번`, head.sum.rows, '',
               won(head.sum.part), won(head.sum.mach), won(head.sum.etc), won(head.sum.total), '']
  tot.forEach((v, j) => {
    const c = ws.getCell(rr, j + 1)
    c.value = v
    c.font = { name: '맑은 고딕', size: 10, bold: true }
    c.alignment = { horizontal: j >= 2 ? 'right' : 'left', vertical: 'middle' }
    if (j >= 2 && v !== '') c.numFmt = NUM
    c.border = BOX
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUM_FILL } }
  })
  ws.getRow(rr).height = 20
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: rr - 1, column: cols.length } }

  // ─────────────────────────────────────────
  // 세부 (열어 둔 상위품번이 있을 때만)
  // ─────────────────────────────────────────
  if (detail?.rows?.length) {
    const dcols = withPrice
      ? [['분류', 10], ['품번', 18], ['품명', 34], ['제조사', 16], ['제조사품번', 18],
         ['소요', 9], ['단위', 7], ['매입단가', 13], ['금액', 15], ['구매처', 16], ['합산 제외 사유', 30]]
      : [['분류', 10], ['품번', 18], ['품명', 34], ['제조사', 16], ['제조사품번', 18],
         ['소요', 9], ['단위', 7], ['합산 제외 사유', 30]]

    const ds = wb.addWorksheet(`세부_${String(detail.code).slice(0, 20)}`, {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      views: [{ state: 'frozen', ySplit: 4 }],
    })
    dcols.forEach(([, w], i) => { ds.getColumn(i + 1).width = w })

    ds.mergeCells(1, 1, 1, dcols.length)
    put(ds, 'A1', `세부 내역 — ${detail.code}${detail.name ? ` · ${detail.name}` : ''}`,
        { size: 14, bold: true })
    ds.mergeCells(2, 1, 2, dcols.length)
    put(ds, 'A2', `${head.csName} · 기준일 ${head.asOf} · ${detail.rows.length.toLocaleString('ko-KR')}행`,
        { size: 9, color: 'FF98A0B0' })

    dcols.forEach(([h], i) => {
      const c = ds.getCell(4, i + 1)
      c.value = h
      c.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: HEAD_TX } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
      c.alignment = { horizontal: 'center', vertical: 'middle' }
      c.border = BOX
    })
    ds.getRow(4).height = 22

    detail.rows.forEach((d, i) => {
      const r2 = 5 + i
      const base = [d.grp, d.std_code, d.item_name, d.manufacturer || '', d.maker_code || '',
                    Number(d.qty), d.unit]
      const vals = withPrice
        ? [...base,
           d.price == null || Number(d.price) === 0 ? '' : won(d.price),
           d.counted ? won(d.amount) : '',
           d.vendor || '', d.reason || '']
        : [...base, d.reason || '']
      vals.forEach((v, j) => {
        const c = ds.getCell(r2, j + 1)
        c.value = v
        c.font = { name: '맑은 고딕', size: 9,
                   color: { argb: d.counted ? 'FF1F2430' : 'FF98A0B0' } }
        const rightCols = withPrice ? [5, 7, 8] : [5]
        c.alignment = { horizontal: rightCols.includes(j) ? 'right' : 'left', vertical: 'middle' }
        if (rightCols.includes(j) && v !== '') c.numFmt = NUM
        c.border = BOX
        if (!d.counted) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } }
      })
    })
    ds.autoFilter = { from: { row: 4, column: 1 },
                      to: { row: 4 + detail.rows.length, column: dcols.length } }
  }

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
