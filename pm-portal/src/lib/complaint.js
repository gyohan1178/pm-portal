// 고객사 불만 접수 (RMA) — pm_customer_complaint (v4.181.0)
//   AXCELIS 는 「JINSUNTECH_RMA.xlsx」 대장 양식 그대로 적고, 엑셀도 같은 열 순서로 내려받는다.
import { supabase } from './supabase'
import { fetchAll } from './paginate'

export const COMPLAINT_SQL_HINT = '고객사 불만 접수 표가 아직 없습니다 — 「고객불만접수_반영」 SQL 을 먼저 실행하세요'
const noTable = (e) => /pm_customer_complaint/.test(e?.message || '') && /(does not exist|schema cache|Could not find)/i.test(e?.message || '')

// AXCELIS RMA 대장 열 — [키, 엑셀 머리글, 엑셀 너비]
export const AX_COLS = [
  ['yy', 'YY', 6], ['rma_date', 'DATE', 11], ['rma_no', 'RMA NO', 15], ['vendor_id', 'Vendor ID', 11],
  ['resp_site', 'CASE_RESP_SITE_NAME', 22], ['case_id', 'CASE_ID', 20], ['qty', 'CASE_PART_QTY', 13],
  ['part_number', 'PART_NUMBER', 14], ['description', 'DESCRIPTION', 40], ['case_type', 'CASE_TYPE_LVL2', 14],
  ['disposition', 'Disposition', 12], ['ccn', 'CCN', 7], ['reason', '사유', 16], ['note', '비고', 26],
]
export const AX_DEFAULTS = { vendor_id: '6105020', resp_site: 'JINSUNTECH CO LTD', case_type: 'INTR' }
export const DISPOSITIONS = ['Return', 'Scrap', 'Rework', 'Replacement']
export const CCNS = ['B', 'K']
export const REASONS = ['대체품 미승인', '제품 불량', '라벨 · 표기 누락', '수량 · 품목 오출하', '기타']

// RMA#JS260010 → '26'
export const yyOf = (r) => {
  const m = String(r?.rma_no || '').match(/JS(\d{2})/i)
  return m ? m[1] : (r?.rma_date ? String(r.rma_date).slice(2, 4) : '')
}

// 다음 RMA 번호 — 그 해(날짜 기준) 마지막 번호 + 1 · 4자리
export function nextRmaNo(rows, date) {
  const yy = String(date || new Date().toISOString()).slice(2, 4)
  let max = 0
  for (const r of rows || []) {
    const m = String(r.rma_no || '').match(new RegExp(`^RMA#JS${yy}(\\d{4})$`, 'i'))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `RMA#JS${yy}${String(max + 1).padStart(4, '0')}`
}

export async function fetchComplaints(cust = 'AX') {
  try {
    return await fetchAll(() => supabase.from('pm_customer_complaint').select('*')
      .eq('customer_code', cust).order('rma_date', { ascending: false, nullsFirst: false }).order('rma_no', { ascending: false }).order('created_at', { ascending: false }))
  } catch (e) {
    if (noTable(e)) return null      // 표가 없다 (SQL 전)
    throw e
  }
}

const FIELDS = ['rma_no', 'rma_date', 'vendor_id', 'resp_site', 'case_id', 'qty', 'part_number', 'description', 'case_type', 'disposition', 'ccn', 'reason', 'note']
export async function saveComplaint(row, { cust = 'AX', by } = {}) {
  const v = {}
  for (const k of FIELDS) { const t = String(row[k] ?? '').trim(); v[k] = t || null }
  if (v.part_number) v.part_number = v.part_number.replace(/^AX-/i, '')
  v.updated_at = new Date().toISOString()
  const q = row.id
    ? supabase.from('pm_customer_complaint').update(v).eq('id', row.id)
    : supabase.from('pm_customer_complaint').insert({ ...v, customer_code: cust, created_by: by || null })
  const { error } = await q
  if (error) {
    if (noTable(error)) throw new Error(COMPLAINT_SQL_HINT)
    if (/duplicate key|pm_customer_complaint_rma_uq/.test(error.message)) throw new Error(`RMA 번호 「${v.rma_no}」 가 이미 있습니다 — 번호를 바꿔 주세요`)
    throw new Error(error.message)
  }
}

export async function deleteComplaint(id) {
  const { error } = await supabase.from('pm_customer_complaint').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// 고객사 품번 → 포털 품목 (품명 자동) — 'AX-' 붙여서 찾는다
export async function lookupPart(pn) {
  const p = String(pn || '').trim().replace(/^AX-/i, '')
  if (!p) return null
  const { data, error } = await supabase.from('items').select('std_code,name').in('std_code', ['AX-' + p, p]).limit(2)
  if (error) return null
  return (data || [])[0] || null
}

// 엑셀 — RMA 대장 양식 그대로 (머리글 · 열 순서 · 날짜 형식)
export async function downloadComplaints(rows, { fileName = 'JINSUNTECH_RMA.xlsx' } = {}) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1', { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
  AX_COLS.forEach(([, , w], i) => { ws.getColumn(i + 1).width = w })
  const head = ws.getRow(2)
  AX_COLS.forEach(([, h], i) => {
    const c = head.getCell(i + 1)
    c.value = h
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
    c.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  const sorted = [...rows].sort((a, b) => String(a.rma_date || '').localeCompare(String(b.rma_date || '')) || String(a.rma_no || '').localeCompare(String(b.rma_no || '')))
  sorted.forEach((r, j) => {
    const row = ws.getRow(3 + j)
    AX_COLS.forEach(([k], i) => {
      const c = row.getCell(i + 1)
      if (k === 'yy') c.value = yyOf(r)
      else if (k === 'rma_date') { c.value = r.rma_date ? new Date(`${r.rma_date}T00:00:00`) : null; c.numFmt = 'yyyy-mm-dd' }
      else if (k === 'qty' || k === 'part_number' || k === 'vendor_id') { const t = r[k]; c.value = t != null && /^\d+$/.test(String(t)) ? Number(t) : (t ?? null) }
      else c.value = r[k] ?? null
      c.border = { bottom: { style: 'hair', color: { argb: 'FFBFBFBF' } } }
    })
  })
  ws.views = [{ state: 'frozen', ySplit: 2 }]
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2 + sorted.length, column: AX_COLS.length } }
  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a'); a.href = url; a.download = fileName; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
