// 자재 요청 목록 → 엑셀 (출력용 양식) — v4.74.0
//
//   화면에 걸린 조건(진행 중 · 완료 · 부서 · 내 요청만 · 처리자 · 요약 지표) 그대로 뽑는다.
//   진행 중이면 화면처럼 「지금 볼 것 → 이번 주 → 다음 주 이후 → 필요일 없음」 구간으로 나눈다.
//   한 요청(요청번호)은 머리 줄 하나 + 품목 줄들. 품목 줄 끝에 손으로 체크할 「확인」 칸.
//   A4 가로 · 폭 1장 맞춤 · 머리글 줄은 페이지마다 반복 · 쪽 번호.
import { cutLabel } from './requestCut'

const F = '맑은 고딕'
const THIN = { style: 'thin', color: { argb: 'FFB8BFCC' } }
const HAIR = { style: 'hair', color: { argb: 'FFD5DAE3' } }
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN }
const ITEM_BOX = { top: HAIR, left: THIN, bottom: HAIR, right: THIN }

export const REQ_COLS = [
  { key: 'no',     label: 'No',         width: 4.5,  align: 'center' },
  { key: 'loc',    label: '위치',       width: 10,   align: 'center' },
  { key: 'code',   label: '기준코드',   width: 15 },
  { key: 'name',   label: '품명',       width: 40,   wrap: true },
  { key: 'maker',  label: '제조사',     width: 12,   wrap: true },
  { key: 'mcode',  label: '제조사품번', width: 17,   wrap: true },
  { key: 'qty',    label: '수량',       width: 7,    align: 'right', fmt: '#,##0.##' },
  { key: 'unit',   label: '단위',       width: 5,    align: 'center' },
  { key: 'status', label: '상태',       width: 9,    align: 'center' },
  { key: 'ready',  label: '불출예정',   width: 9,    align: 'center' },
  { key: 'hdl',    label: '처리자',     width: 8,    align: 'center' },
  { key: 'chk',    label: '확인',       width: 6,    align: 'center' },
]

const SEC_FILL = { red: 'FFFDEEF0', amber: 'FFFEF8E7', blue: 'FFEEF4FF', gray: 'FFF3F4F6' }
const SEC_TEXT = { red: 'FFB4233A', amber: 'FF8A5F00', blue: 'FF2B4C8C', gray: 'FF4A5162' }

const md = (d) => (d ? String(d).slice(5, 10).replace('-', '/') : '')

// 요청 머리 한 줄 — 「R-261019-03  [긴급]  필요 10/21 (2일 지남) · 요청 홍길동 (하네스팀) · AX 110219638 #3 · 초도품」
export function reqHeadText(g) {
  const h = g.head || g.items?.[0] || {}
  const parts = []
  const need = h.need_date ? `필요 ${md(h.need_date)}${g.d == null ? '' : g.d < 0 ? ` (${-g.d}일 지남)` : g.d === 0 ? ' (오늘)' : ` (D-${g.d})`}` : '필요일 없음'
  parts.push(need)
  const who = [h.requester, h.check_dept ? `(${h.check_dept})` : ''].filter(Boolean).join(' ')
  if (who) parts.push(`요청 ${who}`)
  const prod = [h.customer_code ? String(h.customer_code).toUpperCase() : '', h.product_code, h.unit_no].filter(Boolean).join(' ')
  if (prod) parts.push(prod)
  if (h.purpose) parts.push(h.purpose)
  if (h.req_kind && h.req_kind !== '일반') parts.push(h.req_kind)
  if (h.req_date) parts.push(`요청일 ${md(h.req_date)}`)
  return { no: h.req_no || '', urgent: h.urgency === '긴급', text: parts.join('  ·  ') }
}

const statusText = (r) => {
  if (r.status === '완료' && r.handle_type) return `${r.handle_type} 완료`
  if (r.status === '처리중' && r.handle_type) return `${r.handle_type} 중`
  return r.status || ''
}

// 화면 상태 → 엑셀에 넣을 블록 목록 (시험하기 쉽게 따로 뗐다)
//   view: buildView 결과 · live: 진행 중 탭인지
export function requestBlocks(view, { live }) {
  const out = []
  const pushGroups = (gs) => gs.forEach((g) => out.push({ type: 'req', g }))
  if (live) {
    for (const sec of view.sections || []) {
      if (!sec.groups.length) continue
      out.push({ type: 'sec', label: sec.label, tone: sec.tone, count: sec.groups.length })
      pushGroups(sec.groups)
    }
  } else pushGroups(view.groups || [])
  return out
}

// 워크북 만들기 — ExcelJS 를 받아서 (화면에서는 내려받기 때 불러오고, 시험에서는 그대로 넘긴다)
//   cond: 조건 글 · locOf: Map(item_id → 위치)
export function buildRequestWorkbook(ExcelJS, { view, live, cond = '', locOf = new Map(), now = new Date() }) {
  const blocks = requestBlocks(view, { live })
  const reqs = blocks.filter((b) => b.type === 'req')
  if (!reqs.length) throw new Error('내보낼 요청이 없습니다')
  const itemCount = reqs.reduce((a, b) => a + b.g.items.length, 0)

  const wb = new ExcelJS.Workbook()
  wb.created = now
  const N = REQ_COLS.length
  const ws = wb.addWorksheet('자재요청', {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.3, right: 0.3, top: 0.45, bottom: 0.5, header: 0.2, footer: 0.25 },
    },
    headerFooter: { oddFooter: '&L&8진선테크 자재 요청&C&8&P / &N&R&8출력 &D &T' },
  })
  REQ_COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c.width })

  const put = (r, c, v, o = {}) => {
    const x = ws.getCell(r, c)
    if (v !== '' && v != null) x.value = v
    x.font = { name: F, size: o.size || 9, bold: !!o.bold, color: { argb: o.color || 'FF1F2430' } }
    x.alignment = { horizontal: o.align || 'left', vertical: 'middle', wrapText: !!o.wrap }
    if (o.fmt) x.numFmt = o.fmt
    if (o.border) x.border = o.border
    if (o.fill) x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } }
    return x
  }
  const band = (r, v, o) => { ws.mergeCells(r, 1, r, N); put(r, 1, v, o); for (let c = 2; c <= N; c++) put(r, c, null, { ...o, border: o.border }) }

  // 제목 · 조건
  ws.mergeCells(1, 1, 1, 8); put(1, 1, '자재 요청 목록', { size: 16, bold: true })
  ws.mergeCells(1, 9, 1, N)
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  put(1, 9, `출력 ${stamp}`, { align: 'right', color: 'FF6B7385' })
  ws.getRow(1).height = 26
  ws.mergeCells(2, 1, 2, N)
  put(2, 1, `${cond ? `조건: ${cond}   |   ` : ''}요청 ${reqs.length.toLocaleString('ko-KR')}건 · 품목 ${itemCount.toLocaleString('ko-KR')}줄`, { color: 'FF4A5162' })
  ws.getRow(2).height = 18

  // 머리글 (페이지마다 반복)
  const HR = 4
  REQ_COLS.forEach((c, i) => put(HR, i + 1, c.label, { bold: true, align: 'center', fill: 'FFEEEBFD', border: BOX, color: 'FF3D3399' }))
  ws.getRow(HR).height = 20
  ws.pageSetup.printTitlesRow = `${HR}:${HR}`

  let r = HR + 1, no = 0
  for (const b of blocks) {
    if (b.type === 'sec') {
      band(r, `■ ${b.label}  ${b.count.toLocaleString('ko-KR')}건`, { bold: true, size: 10, fill: SEC_FILL[b.tone] || SEC_FILL.gray, color: SEC_TEXT[b.tone] || SEC_TEXT.gray, border: BOX })
      ws.getRow(r).height = 20
      r++
      continue
    }
    const g = b.g, h = reqHeadText(g)
    // 요청 머리 — 요청번호 · 긴급 · 필요일 · 요청자 · 제품 · 목적
    ws.mergeCells(r, 1, r, 3)
    put(r, 1, h.no + (h.urgent ? '  [긴급]' : ''), { bold: true, size: 9.5, fill: 'FFF3F4F8', border: BOX, color: h.urgent ? 'FFC0262D' : 'FF1F2430' })
    for (let c = 2; c <= 3; c++) put(r, c, null, { fill: 'FFF3F4F8', border: BOX })
    ws.mergeCells(r, 4, r, N)
    put(r, 4, h.text, { size: 9, fill: 'FFF3F4F8', border: BOX, color: 'FF4A5162' })
    for (let c = 5; c <= N; c++) put(r, c, null, { fill: 'FFF3F4F8', border: BOX })
    ws.getRow(r).height = 18
    r++
    for (const it of g.items) {
      no++
      const cut = cutLabel(it, { icon: false })
      const asm = !it.item_id && it.unit === '대분'
      const name = [it.item_name || '', cut ? `[절단 ${cut}]` : '', asm ? '[ASSY 자재 일체 — BOM 보고 불출]' : '', it.reason ? `사유: ${it.reason}` : ''].filter(Boolean).join('\n')
      const vals = {
        no, loc: (it.item_id && locOf.get(it.item_id)) || '', code: it.std_code || '', name,
        maker: it.maker || '', mcode: it.maker_code || '', qty: Number(it.qty) || 0, unit: it.unit || '',
        status: statusText(it), ready: md(it.ready_date), hdl: it.handler || '', chk: '',
      }
      REQ_COLS.forEach((c, i) => put(r, i + 1, vals[c.key], {
        align: c.align, wrap: c.wrap, fmt: c.fmt, border: ITEM_BOX,
        bold: c.key === 'qty' || c.key === 'code',
        color: c.key === 'loc' && !vals.loc ? 'FF98A0B0' : c.key === 'status' && it.status === '반려' ? 'FFB4233A' : undefined,
      }))
      // 줄 높이 — 품명 칸(폭 40)에 한 줄 약 44자로 보고 넘치면 늘린다 (엑셀은 병합 · 줄바꿈 높이를 스스로 안 맞춘다)
      const lines = name.split('\n').reduce((a, ln) => a + Math.max(1, Math.ceil(ln.length / 44)), 0)
      ws.getRow(r).height = Math.max(17, 12.5 * lines + 4)
      r++
    }
  }
  // 맨 아래 선 마감
  for (let c = 1; c <= N; c++) { const x = ws.getCell(r - 1, c); x.border = { ...(x.border || {}), bottom: THIN } }
  return wb
}

export async function downloadRequestExcel(opts, fileName) {
  const ExcelJS = (await import('exceljs')).default
  const wb = buildRequestWorkbook(ExcelJS, opts)
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = fileName
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
