// 현장 검색 · BOM 조회 내려받기 (v4.145.0) — 엑셀(레이아웃 갖춤) · CSV
//   엑셀: 제목(어셈블리 · Rev) · 조회 조건 줄 · 머리글 고정 · 자동 필터 · 레벨 들여쓰기(└) · 1레벨 줄 옅은 색 · 소요량 숫자 · 가로 A4 한 폭 · 머리글 장마다 반복
//   CSV : 같은 칸 · UTF-8 BOM (엑셀에서 열어도 한글이 안 깨지게)
import { compareRev, REV_STATE } from './revCompare'

const HEAD = ['No', 'LV', '기준코드', '품명', 'BOM REV', '도면 최신 REV', 'REV 대조', '구분', '부서', '제조사', '제조사품번', '단위', '소요량']
const WIDTH = [5, 5, 24, 42, 9, 11, 10, 12, 8, 18, 22, 6, 9]

export function bomExportRows(rows, dwMap = {}) {
  return (rows || []).map((r, i) => {
    const it = r.items || {}
    const lv = Number(r.level) || 0
    const dw = dwMap[it.std_code]
    const st = r.item_rev ? compareRev(r.item_rev, dw) : null
    return {
      no: i + 1, lv, code: it.std_code || '', indent: lv > 1 ? lv - 1 : 0, name: it.name || '',
      rev: r.item_rev || '', dwRev: dw?.rev || '', revState: st ? REV_STATE[st].label : '',
      cat: it.category || it.type || '', dept: it.dept || '', maker: it.manufacturer || '', makerPn: it.manufacturer_code || '',
      unit: it.unit || '', qty: r.qty_per_unit == null || r.qty_per_unit === '' ? '' : Number(r.qty_per_unit),
    }
  })
}
const cells = (x, indentCode) => [x.no, x.lv ? `L${x.lv}` : '', indentCode ? `${'    '.repeat(x.indent)}${x.indent ? '└ ' : ''}${x.code}` : x.code,
  x.name, x.rev, x.dwRev, x.revState, x.cat, x.dept, x.maker, x.makerPn, x.unit, x.qty]

export const bomFileBase = (asm) => `BOM_${String(asm?.code || 'BOM').replace(/[\\/:*?"<>|]/g, '_')}${asm?.rev ? `_Rev${asm.rev}` : ''}_${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)}`

function save(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function bomCsvText(rows, dwMap) {
  const q = (v) => { const t = String(v ?? ''); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
  return [HEAD, ...bomExportRows(rows, dwMap).map((x) => cells(x, false))].map((r) => r.map(q).join(',')).join('\r\n')
}
export function downloadBomCsv(asm, rows, dwMap) {
  save(new Blob(['﻿' + bomCsvText(rows, dwMap)], { type: 'text/csv;charset=utf-8' }), bomFileBase(asm) + '.csv')
}

export async function downloadBomExcel(asm, rows, dwMap) {
  const ExcelJS = (await import('exceljs')).default   // 누를 때만 불러온다
  const data = bomExportRows(rows, dwMap)
  const wb = new ExcelJS.Workbook()
  wb.created = new Date()
  const ws = wb.addWorksheet('BOM', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L${asm?.code || ''} BOM&R&P / &N` },
  })
  const n = HEAD.length
  WIDTH.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  // 제목 · 조회 조건
  ws.mergeCells(1, 1, 1, n)
  Object.assign(ws.getCell(1, 1), { value: `BOM 전개 — ${asm?.code || ''}${asm?.rev ? `  Rev ${asm.rev}` : ''}` })
  ws.getCell(1, 1).font = { bold: true, size: 15, color: { argb: 'FF1F2430' } }
  ws.getRow(1).height = 26
  ws.mergeCells(2, 1, 2, n)
  const lv1 = data.filter((x) => x.lv <= 1).length
  ws.getCell(2, 1).value = `조회일 ${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ')}   |   부품 ${data.length}줄 (1레벨 ${lv1})   |   진선테크 PM 포털 · 현장 검색`
  ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF64748B' } }
  // 머리글
  const H = 4
  ws.getRow(H).values = HEAD
  const hr = ws.getRow(H)
  hr.height = 22
  hr.eachCell((c) => {
    c.font = { bold: true, size: 10, color: { argb: 'FF4A5162' } }
    c.alignment = { vertical: 'middle', horizontal: 'center' }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEBFD' } }
    c.border = { top: { style: 'thin', color: { argb: 'FF6C5CE7' } }, bottom: { style: 'medium', color: { argb: 'FF6C5CE7' } } }
  })
  // 본문
  const REV_COLOR = { '일치': 'FF12A05F', '도면 요청': 'FFD97706', '구버전': 'FFD99400', '도면 없음': 'FFE0505F' }
  data.forEach((x) => {
    const r = ws.addRow(cells(x, true))
    r.height = 17
    r.eachCell({ includeEmpty: true }, (c, col) => {
      c.font = { size: 10, color: { argb: 'FF1F2430' } }
      c.alignment = { vertical: 'middle', horizontal: [1, 2, 5, 6, 7, 9, 12].includes(col) ? 'center' : col === 13 ? 'right' : 'left' }
      c.border = { bottom: { style: 'hair', color: { argb: 'FFD5D9E2' } } }
      if (x.lv <= 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F8FB' } }
    })
    r.getCell(3).font = { size: 10, name: 'Consolas', bold: x.lv <= 1, color: { argb: 'FF5B6EE8' } }
    r.getCell(11).font = { size: 10, name: 'Consolas', color: { argb: 'FF4A5162' } }
    if (x.revState) r.getCell(7).font = { size: 10, bold: true, color: { argb: REV_COLOR[x.revState] || 'FF4A5162' } }
    if (typeof x.qty === 'number') { r.getCell(13).numFmt = '#,##0.###'; r.getCell(13).font = { size: 10, bold: true } }
  })
  ws.views = [{ state: 'frozen', ySplit: H, xSplit: 3 }]
  ws.autoFilter = { from: { row: H, column: 1 }, to: { row: H + data.length, column: n } }
  ws.pageSetup.printTitlesRow = `${H}:${H}`
  const buf = await wb.xlsx.writeBuffer()
  save(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), bomFileBase(asm) + '.xlsx')
}
