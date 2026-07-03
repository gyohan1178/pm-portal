import * as XLSX from 'xlsx'

// 표준 엑셀 추출 — 페이지마다 제각각인 XLSX 코드를 이 함수로 통일.
// rows: 객체 배열, filename: 확장자 제외, sheetName: 시트명
export function exportXlsx(rows, filename, sheetName = 'Sheet1') {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows || [])
  // 열 너비 자동(대략) — 헤더/값 길이 기준
  if (rows && rows.length) {
    const keys = Object.keys(rows[0])
    ws['!cols'] = keys.map(k => {
      const maxLen = Math.max(String(k).length, ...rows.map(r => String(r[k] ?? '').length))
      return { wch: Math.min(40, Math.max(8, maxLen + 2)) }
    })
  }
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const date = new Date().toISOString().split('T')[0]
  XLSX.writeFile(wb, `${filename}_${date}.xlsx`)
}

// 여러 시트를 한 파일로
export function exportXlsxMulti(sheets, filename) {
  const wb = XLSX.utils.book_new()
  sheets.forEach(({ name, rows }) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows || []), name)
  })
  const date = new Date().toISOString().split('T')[0]
  XLSX.writeFile(wb, `${filename}_${date}.xlsx`)
}
