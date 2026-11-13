// 협력사 납기 회신 요청 (v4.184.0) — 구매발주에서 체크한 건을 업체별로 모아 메일에 붙일 표 · 엑셀로
//   발주번호는 넣지 않는다 (이카운트 발주번호와 안 맞는 경우가 많아 협력사가 헷갈림) — 품번 · 제조사품번으로 찾게
//   v4.184.1 — 첫 인사 문구는 빼고(메일에서 직접 쓰므로), 회신 칸 두 개 대신 「특이사항」 한 칸에 줄마다 요청 문구를 자동으로
// 받을 날 — 협력사 변경 납기 > 요청 납기 (구매발주 dueOf 와 같은 규칙)
const dueOf = (p) => String(p?.vendor_date || p?.promise_date || '').slice(0, 10)

const n = (v) => (v == null || v === '' ? null : Number(v))
export const remainOf = (p) => {
  const r = n(p.qty_remaining)
  if (r != null) return r
  return Math.max(0, (n(p.qty_ordered) || 0) - (n(p.qty_received) || 0))
}

export const DUE_COLS = [
  ['no', 'No'], ['code', '품번'], ['name', '품명'], ['maker', '제조사'], ['maker_pn', '제조사 품번'],
  ['order_date', '발주일'], ['qty', '발주 수량'], ['remain', '미입고'], ['req', '요청 납기'], ['promised', '변경 약속일'],
  ['note', '특이사항'],
]

const KDAY = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
const md = (d) => String(d || '').slice(5).replace('-', '/')
// 줄마다 특이사항 문구 — 받을 날(변경 약속일 > 요청 납기) 기준으로 지남 · 임박 · 예정, 일부 입고면 남은 수량
export function dueNote(r, today = KDAY()) {
  const part = r.remain > 0 && r.remain < r.qty ? ` (${r.qty.toLocaleString('ko-KR')}개 중 ${r.remain.toLocaleString('ko-KR')}개 미입고)` : ''
  if (r.promised) {
    const d = days(r.promised, today)
    if (d > 0) return `변경 약속일(${md(r.promised)}) ${d}일 지남${part} — 입고 가능일 재확인 부탁드립니다`
    if (d === 0) return `변경 약속일(${md(r.promised)}) 오늘${part} — 입고 여부 확인 부탁드립니다`
    return `변경 약속일 ${md(r.promised)} 입고 예정${part} — 일정 변동 없는지 확인 부탁드립니다`
  }
  if (!r.req) return `납기 미정${part} — 입고 가능일 회신 부탁드립니다`
  const d = days(r.req, today)
  if (d > 0) return `요청 납기 ${d}일 지남${part} — 입고 가능일 회신 부탁드립니다`
  if (d === 0) return `요청 납기 오늘${part} — 입고 가능 여부 회신 부탁드립니다`
  return `요청 납기 D-${-d}${part} — 납기 내 입고 가능 여부 회신 부탁드립니다`
}

// 체크한 발주 → [{ vendor, rows:[…] }] (업체 이름순 · 업체 안에서는 요청 납기순)
export function buildDueRequest(pos, vendors = []) {
  const by = new Map(), vm = new Map((vendors || []).map((v) => [v.id, v]))
  for (const p of pos || []) {
    const vendor = p.vendors?.name || vm.get(p.vendor_id)?.name || '(구매처 없음)'
    const g = by.get(vendor) || { vendor, rows: [] }
    g.rows.push({
      code: p.items?.std_code || '', name: p.items?.name || '', maker: p.items?.manufacturer || '', maker_pn: p.items?.manufacturer_code || '',
      order_date: String(p.order_date || '').slice(0, 10), qty: n(p.qty_ordered) || 0, remain: remainOf(p),
      req: String(p.promise_date || '').slice(0, 10), promised: String(p.vendor_date || '').slice(0, 10),
      late: !!(dueOf(p) && dueOf(p) < new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)),
    })
    by.set(vendor, g)
  }
  const out = [...by.values()].sort((a, b) => a.vendor.localeCompare(b.vendor, 'ko'))
  out.forEach((g) => {
    g.rows.sort((a, b) => (a.req || '9999').localeCompare(b.req || '9999') || a.code.localeCompare(b.code))
    g.rows.forEach((r, i) => { r.no = i + 1; r.key = `${g.vendor}|${r.code}|${r.req}|${i}`; r.note = dueNote(r) })
  })
  return out
}


const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtN = (v) => (v == null ? '' : Number(v).toLocaleString('ko-KR'))
const cellOf = (r, k) => (k === 'qty' || k === 'remain' ? fmtN(r[k]) : r[k] ?? '')

// 메일 본문에 붙이는 표 (Outlook · 메일플러그에서 표로 붙도록 인라인 스타일) — 인사 문구 없이 업체 이름 줄 + 표
export function dueHtml(g) {
  const th = 'border:1px solid #9ca3af;background:#eef2ff;padding:4px 8px;font-size:12px;white-space:nowrap'
  const td = 'border:1px solid #d1d5db;padding:4px 8px;font-size:12px'
  const head = DUE_COLS.map(([k, h]) => `<th style="${th}${k === 'note' ? ';background:#fef9c3' : ''}">${esc(h)}</th>`).join('')
  const body = g.rows.map((r) => `<tr>${DUE_COLS.map(([k]) => {
    const right = k === 'qty' || k === 'remain' || k === 'no'
    const red = k === 'req' && r.late && !r.promised
    const nowrap = k !== 'name' && k !== 'note'
    return `<td style="${td}${right ? ';text-align:right' : ''}${red ? ';color:#dc2626;font-weight:bold' : ''}${nowrap ? ';white-space:nowrap' : ''}${k === 'note' ? ';background:#fefce8' : ''}">${esc(cellOf(r, k))}</td>`
  }).join('')}</tr>`).join('')
  return `<div style="font-family:'맑은 고딕',Malgun Gothic,Arial,sans-serif"><div style="font-size:13px;margin:0 0 4px"><b>${esc(g.vendor)}</b> · ${g.rows.length}건</div>`
    + `<table style="border-collapse:collapse;font-family:'맑은 고딕',Malgun Gothic,Arial,sans-serif"><tr>${head}</tr>${body}</table></div>`
}
// 같은 내용의 글자판 (탭 구분 — 엑셀에 붙여도 칸이 나뉨)
export function dueText(g) {
  const rows = [DUE_COLS.map(([, h]) => h).join('\t'), ...g.rows.map((r) => DUE_COLS.map(([k]) => cellOf(r, k)).join('\t'))]
  return `${g.vendor} · ${g.rows.length}건\n${rows.join('\n')}`
}

// 클립보드에 표(HTML) + 글자판 같이 — 메일에는 표로, 메모장에는 탭 글자로 붙는다
export async function copyDue(g) {
  const html = dueHtml(g), text = dueText(g)
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new window.ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
      return true
    }
  } catch { /* 아래 예전 방식 */ }
  // 예전 방식 — 화면 밖에 표를 그려 선택해 복사
  const box = document.createElement('div')
  box.contentEditable = 'true'; box.style.position = 'fixed'; box.style.left = '-99999px'; box.innerHTML = html
  document.body.appendChild(box)
  const range = document.createRange(); range.selectNodeContents(box)
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range)
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  sel.removeAllRanges(); box.remove()
  return ok
}

// 엑셀 — 업체마다 시트 하나 · 특이사항(노란 칸) · 머리글 고정
export async function downloadDueExcel(groups, { title = '납기회신요청', custName = '' } = {}) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const used = new Set()
  const W = { no: 5, code: 16, name: 34, maker: 14, maker_pn: 20, order_date: 11, qty: 9, remain: 8, req: 11, promised: 11, note: 52 }
  for (const g of groups) {
    let nm = g.vendor.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || '업체'
    let k = 2; const base = nm
    while (used.has(nm)) nm = `${base.slice(0, 25)} (${k++})`
    used.add(nm)
    const ws = wb.addWorksheet(nm, { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }, views: [{ state: 'frozen', ySplit: 3 }] })
    DUE_COLS.forEach(([key], i) => { ws.getColumn(i + 1).width = W[key] || 12 })
    ws.getCell('A1').value = `${g.vendor} 납기 회신 요청${custName ? ` (${custName})` : ''}`
    ws.getCell('A1').font = { bold: true, size: 13 }
    ws.getCell('A2').value = `진선테크 구매자재팀 · ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)} · ${g.rows.length}건 — 특이사항 확인 후 회신 부탁드립니다`
    ws.getCell('A2').font = { size: 10, color: { argb: 'FF64748B' } }
    const head = ws.getRow(3)
    DUE_COLS.forEach(([key, h], i) => {
      const c = head.getCell(i + 1)
      c.value = h; c.font = { bold: true }; c.alignment = { horizontal: 'center', vertical: 'middle' }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: key === 'note' ? 'FFFEF08A' : 'FFE0E7FF' } }
      c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
    })
    g.rows.forEach((r, j) => {
      const row = ws.getRow(4 + j)
      DUE_COLS.forEach(([key], i) => {
        const c = row.getCell(i + 1)
        c.value = r[key] === '' || r[key] == null ? null : r[key]
        if (key === 'qty' || key === 'remain') c.numFmt = '#,##0'
        if (key === 'note') { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEFCE8' } }; c.alignment = { wrapText: true, vertical: 'top' } }
        if (key === 'req' && r.late && !r.promised) c.font = { bold: true, color: { argb: 'FFDC2626' } }
        c.border = { top: { style: 'hair' }, bottom: { style: 'hair' }, left: { style: 'hair' }, right: { style: 'hair' } }
      })
    })
  }
  const buf = await wb.xlsx.writeBuffer()
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '')
  const one = groups.length === 1 ? `_${groups[0].vendor.replace(/[\\/:*?"<>|]/g, '')}` : ''
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a'); a.href = url; a.download = `${title}${one}_${day}.xlsx`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
