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

// 하네스가 합계에 들어가는지는 고객사마다 다르다.
//   틀리게 적으면 받는 쪽이 원가를 잘못 잡는다.
const HARNESS_NOTE = {
  AXCELIS: '하네스는 본 자료의 합계에 포함되어 있습니다.',
  Edwards: '하네스는 별도 상위품번으로 집계되어 있으며, 본 자료의 합계에는 포함되어 있지 않습니다.',
  CSK:     '하네스는 본 자료의 합계에 포함되어 있지 않습니다.',
  VM:      '하네스는 본 자료의 합계에 포함되어 있지 않습니다.',
}
const harnessNote = cs => HARNESS_NOTE[cs] || '하네스 포함 여부는 구매자재팀에 확인해 주세요.'

// 산출 기준 — 제출 문서에 쓰는 말투로 적는다
const basisLines = (csName, priced, total) => ([
  `매입단가가 등록된 품목만 합산했습니다 (${priced.toLocaleString('ko-KR')}종 / ${total.toLocaleString('ko-KR')}종).`,
  harnessNote(csName),
  '하네스 제작 작업비는 포함되어 있지 않습니다.',
  '사급 · 무상지급 등 견적 미대상 품목은 제외했습니다.',
  '하위 부품이 별도로 산정된 어셈블리는 중복 산정을 피하기 위해 제외했습니다.',
  '작업표준 · 도면 등 비구매 항목은 제외했습니다.',
])

/**
 * books : [{ csName, rows, sum, cover, detail }]  — 고객사 하나면 길이 1
 * withPrice : false 면 매입단가·구매처를 빼고 만든다 (영업팀용)
 */
export async function downloadCostExcel({ books, asOf, withPrice = true, fileName }) {
  const wb = new ExcelJS.Workbook()
  wb.creator = '진선테크 구매자재팀'
  wb.created = new Date()

  const all = books.reduce((a, b) => ({
    rows:  a.rows  + (b.sum.rows || 0),
    part:  a.part  + (b.sum.part || 0),
    mach:  a.mach  + (b.sum.mach || 0),
    etc:   a.etc   + (b.sum.etc || 0),
    total: a.total + (b.sum.total || 0),
    priced: a.priced + (b.sum.priced || 0),
    noPrice: a.noPrice + (b.sum.noPrice || 0),
    codes: a.codes + b.rows.length,
    kinds: a.kinds + b.rows.reduce((x, r) => x + Number(r.item_kinds || 0), 0),
  }), { rows: 0, part: 0, mach: 0, etc: 0, total: 0, priced: 0, noPrice: 0, codes: 0, kinds: 0 })

  const multi = books.length > 1
  const title = multi ? '전 고객사' : books[0].csName

  // ─────────────────────────────────────────
  // 표지
  // ─────────────────────────────────────────
  const cv = wb.addWorksheet('표지', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.6, right: 0.6, top: 0.7, bottom: 0.6, header: 0.3, footer: 0.3 } },
    views: [{ showGridLines: false }],
  })
  ;[['A', 3], ['B', 16], ['C', 16], ['D', 16], ['E', 16], ['F', 16]]
    .forEach(([c, w]) => { cv.getColumn(c).width = w })

  put(cv, 'B2', '진선테크 · 지원본부 구매자재팀', { size: 9, color: 'FF98A0B0' })
  cv.mergeCells('B3:F3')
  put(cv, 'B3', '원자재 원가 총괄', { size: 24, bold: true })
  cv.getRow(3).height = 34
  cv.mergeCells('B4:F4')
  put(cv, 'B4', `${title} · 기준일 ${asOf}`, { size: 11, color: 'FF4A5162' })

  // 규모 — 총액보다 이쪽을 앞세운다
  const scale = [
    ['상위품번', all.codes, '개'],
    ['BOM',      all.rows,  '행'],
    ['품목',     all.kinds, '종'],
  ]
  scale.forEach(([nm, v, u], i) => {
    const col = ['B', 'C', 'D'][i]
    put(cv, `${col}6`, nm, { size: 9, bold: true, color: 'FF98A0B0' })
    put(cv, `${col}7`, `${v.toLocaleString('ko-KR')}${u}`, { size: 17, bold: true })
  })
  cv.getRow(7).height = 24

  // 분류별 금액
  let r = 9
  if (multi) {
    // 고객사별 요약
    const hd = ['고객사', '상위품번', 'BOM행', '파트', '가공물', '기타', '합계']
    hd.forEach((h, i) => put(cv, `${'BCDEFGH'[i]}${r}`, h,
      { bold: true, fill: NAVY, color: HEAD_TX, border: true, align: 'center' }))
    cv.getColumn('G').width = 16; cv.getColumn('H').width = 18
    cv.getRow(r).height = 20
    books.forEach((b, i) => {
      const rr = r + 1 + i
      const vals = [b.csName, b.rows.length, b.sum.rows,
                    won(b.sum.part), won(b.sum.mach), won(b.sum.etc), won(b.sum.total)]
      vals.forEach((v, j) => put(cv, `${'BCDEFGH'[j]}${rr}`, v,
        { border: true, align: j === 0 ? 'left' : 'right',
          fmt: j === 0 ? undefined : NUM, bold: j === 6 }))
    })
    const rs = r + 1 + books.length
    const tv = ['합계', all.codes, all.rows, won(all.part), won(all.mach), won(all.etc), won(all.total)]
    tv.forEach((v, j) => put(cv, `${'BCDEFGH'[j]}${rs}`, v,
      { border: true, bold: true, fill: SUM_FILL, align: j === 0 ? 'left' : 'right',
        fmt: j === 0 ? undefined : NUM }))
    r = rs + 2
  } else {
    const t = all.total || 1
    const cat = [['파트', all.part], ['가공물', all.mach], ['기타', all.etc]]
    ;['분류', '금액', '비중'].forEach((h, i) =>
      put(cv, `${'BCD'[i]}${r}`, h, { bold: true, fill: NAVY, color: HEAD_TX, border: true, align: 'center' }))
    cv.getRow(r).height = 20
    cat.forEach(([nm, v], i) => {
      const rr = r + 1 + i
      put(cv, `B${rr}`, nm, { bold: true, border: true })
      put(cv, `C${rr}`, won(v), { fmt: NUM, align: 'right', border: true })
      put(cv, `D${rr}`, (Number(v) || 0) / t * 100, { fmt: PCT, align: 'right', border: true })
    })
    const rs = r + 1 + cat.length
    put(cv, `B${rs}`, '합계', { bold: true, border: true, fill: SUM_FILL })
    put(cv, `C${rs}`, won(all.total), { fmt: NUM, align: 'right', bold: true, border: true, fill: SUM_FILL })
    put(cv, `D${rs}`, 100, { fmt: PCT, align: 'right', bold: true, border: true, fill: SUM_FILL })
    r = rs + 2
  }

  // 산출 기준
  cv.mergeCells(`B${r}:F${r}`)
  put(cv, `B${r}`, '산출 기준', { bold: true, size: 11 })
  r++
  const lines = multi
    ? [`매입단가가 등록된 품목만 합산했습니다 (${all.priced.toLocaleString('ko-KR')}종 / ${(all.priced + all.noPrice).toLocaleString('ko-KR')}종).`,
       ...books.map(b => `${b.csName} — ${harnessNote(b.csName)}`),
       '하네스 제작 작업비는 포함되어 있지 않습니다.',
       '사급 · 무상지급 등 견적 미대상 품목은 제외했습니다.',
       '하위 부품이 별도로 산정된 어셈블리는 중복 산정을 피하기 위해 제외했습니다.',
       '작업표준 · 도면 등 비구매 항목은 제외했습니다.']
    : basisLines(books[0].csName, all.priced, all.priced + all.noPrice)
  lines.forEach((s2, i) => {
    const rr = r + i
    cv.mergeCells(`B${rr}:F${rr}`)
    put(cv, `B${rr}`, '· ' + s2, { size: 9.5, color: 'FF4A5162', wrap: true })
  })
  r += lines.length + 1

  cv.mergeCells(`B${r}:F${r}`)
  put(cv, `B${r}`,
    withPrice ? '본 자료에는 매입단가와 구매처가 포함되어 있습니다. 사내 한정으로 취급해 주십시오.'
              : '본 자료에는 매입단가와 구매처가 포함되어 있지 않습니다.',
    { size: 9, bold: true, color: withPrice ? 'FFC00000' : 'FF98A0B0', wrap: true })
  r++
  cv.mergeCells(`B${r}:F${r}`)
  put(cv, `B${r}`, '작성 구매자재팀 · 문의 gyohan@jinsuntech.co.kr', { size: 9, color: 'FF98A0B0' })

  // ─────────────────────────────────────────
  // 고객사별 총괄 시트
  // ─────────────────────────────────────────
  for (const bk of books) {
    const ws = wb.addWorksheet(bk.csName, {
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
    put(ws, 'A1', `원자재 원가 총괄 — ${bk.csName}`, { size: 15, bold: true })
    ws.getRow(1).height = 24
    ws.mergeCells(2, 1, 2, cols.length)
    put(ws, 'A2', `기준일 ${asOf} · 상위품번 ${bk.rows.length.toLocaleString('ko-KR')}개 · 단위 원 · ${harnessNote(bk.csName)}`,
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

    bk.rows.forEach((x, i) => {
      const rr2 = 5 + i
      const vals = [
        x.project_code, x.project_name || '', Number(x.bom_rows), Number(x.item_kinds),
        won(x.part_krw), won(x.mach_krw), won(x.etc_krw), won(x.total_krw),
        Number(x.harness_kinds) > 0 ? Number(x.harness_kinds) : '',
      ]
      vals.forEach((v, j) => {
        const c = ws.getCell(rr2, j + 1)
        c.value = v
        c.font = { name: '맑은 고딕', size: 10, bold: j === 7 }
        c.alignment = { horizontal: j >= 2 ? 'right' : 'left', vertical: 'middle' }
        if (j >= 2) c.numFmt = NUM
        c.border = BOX
        if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } }
      })
    })

    const rr3 = 5 + bk.rows.length
    const tot = ['합계', `${bk.rows.length}개 상위품번`, bk.sum.rows, '',
                 won(bk.sum.part), won(bk.sum.mach), won(bk.sum.etc), won(bk.sum.total), '']
    tot.forEach((v, j) => {
      const c = ws.getCell(rr3, j + 1)
      c.value = v
      c.font = { name: '맑은 고딕', size: 10, bold: true }
      c.alignment = { horizontal: j >= 2 ? 'right' : 'left', vertical: 'middle' }
      if (j >= 2 && v !== '') c.numFmt = NUM
      c.border = BOX
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUM_FILL } }
    })
    ws.getRow(rr3).height = 20
    if (bk.rows.length > 0) {
      ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: rr3 - 1, column: cols.length } }
    }

    // 세부 (열어 둔 상위품번이 있을 때만)
    const detail = bk.detail
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
      put(ds, 'A2', `${bk.csName} · 기준일 ${asOf} · ${detail.rows.length.toLocaleString('ko-KR')}행`,
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
