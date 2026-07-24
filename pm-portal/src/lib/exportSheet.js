import ExcelJS from 'exceljs'

// 화면 목록을 그대로 엑셀로 내보낸다.
// 필터가 걸린 상태의 배열을 그대로 넘기면 보이는 것만 나간다.
//
// rows  : [{ 컬럼명: 값, ... }]  — 첫 행의 키가 헤더가 됨
// meta  : [[라벨, 값], ...]      — 상단에 붙는 조회 조건 (선택)
export async function downloadSheet({ rows, fileName, sheetName = 'Sheet1', title, meta = [] }) {
  if (!rows?.length) throw new Error('내보낼 데이터가 없습니다.')

  const wb = new ExcelJS.Workbook()
  wb.created = new Date()
  const ws = wb.addWorksheet(sheetName, {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  const keys = Object.keys(rows[0])
  let r = 1

  if (title) {
    ws.mergeCells(1, 1, 1, keys.length)
    const c = ws.getCell(1, 1)
    c.value = title
    c.font = { bold: true, size: 14 }
    c.alignment = { vertical: 'middle' }
    ws.getRow(1).height = 24
    r = 2
  }

  // 조회 조건 — 나중에 이 파일이 무슨 조건으로 뽑힌 건지 알 수 있게
  if (meta.length) {
    const txt = meta.map(([k, v]) => `${k}: ${v}`).join('   |   ')
    ws.mergeCells(r, 1, r, keys.length)
    const c = ws.getCell(r, 1)
    c.value = txt
    c.font = { size: 10, color: { argb: 'FF64748B' } }
    r += 1
  }
  if (title || meta.length) r += 1   // 한 줄 띄우기

  const headRow = r
  ws.getRow(headRow).values = keys
  const hr = ws.getRow(headRow)
  hr.font = { bold: true, size: 11 }
  hr.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  hr.height = 24
  hr.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
    c.border = {
      top: { style: 'thin', color: { argb: 'FF94A3B8' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    }
  })

  rows.forEach((row) => {
    const rr = ws.addRow(keys.map((k) => row[k] ?? ''))
    rr.font = { size: 10 }
    rr.eachCell((c) => {
      c.border = {
        top: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        left: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } },
        right: { style: 'hair', color: { argb: 'FFE2E8F0' } },
      }
      if (typeof c.value === 'number') c.numFmt = '#,##0.##'
    })
  })

  // 열 너비 — 내용 길이에 맞춰 자동
  keys.forEach((k, i) => {
    const lens = rows.map((x) => String(x[k] ?? '').length)
    const w = Math.max(String(k).length + 2, ...lens.map((l) => l + 2))
    ws.getColumn(i + 1).width = Math.min(42, Math.max(8, w))
  })

  ws.views = [{ state: 'frozen', ySplit: headRow }]
  ws.autoFilter = {
    from: { row: headRow, column: 1 },
    to: { row: headRow + rows.length, column: keys.length },
  }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
