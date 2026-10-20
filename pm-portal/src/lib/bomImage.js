// BOM → 도면에 붙일 흑백 이미지 (v4.75.0)
//   화면 캡처는 연한 회색 글씨 · 파스텔 배지라 도면(흑백 출력)에 넣으면 잘 안 보였다.
//   흰 바탕 · 검은 글씨 · 진한 실선만으로 캔버스에 직접 그린다. 3배 촘촘하게 그려 확대해도 안 깨진다.

export const DWG_COLS = [
  { key: 'no',    label: 'No',         align: 'center' },
  { key: 'lv',    label: 'LV',         align: 'center' },
  { key: 'code',  label: '품번',       mono: true },
  { key: 'name',  label: '품명',       wrap: true },
  { key: 'maker', label: '제조사' },
  { key: 'mcode', label: '제조사품번', mono: true },
  { key: 'qty',   label: '수량',       align: 'right', bold: true },
  { key: 'unit',  label: '단위',       align: 'center' },
  { key: 'rev',   label: 'REV',        align: 'center' },
  { key: 'cat',   label: '구분',       align: 'center' },
]
export const DWG_DEFAULT = ['no', 'lv', 'code', 'name', 'maker', 'mcode', 'qty', 'unit']
export const DWG_SIZES = { 작게: 11, 보통: 13, 크게: 15 }

const blank = (v) => { const s = String(v ?? '').trim(); return !s || s === '-' }
const cmpTxt = (a, b) => {
  // 빈 값은 맨 뒤 · 대소문자 무시 · 숫자는 숫자 크기대로
  if (blank(a) && blank(b)) return 0
  if (blank(a)) return 1
  if (blank(b)) return -1
  return String(a).trim().localeCompare(String(b).trim(), 'en', { numeric: true, sensitivity: 'base' })
}
const fmtQty = (q) => {
  const n = Number(q)
  if (!Number.isFinite(n)) return ''
  return Number.isInteger(n) ? n.toLocaleString('en-US') : String(Math.round(n * 1000) / 1000)
}

// BOM 줄 → 그릴 줄
//   order: 'maker' = 제조사 → 제조사품번 오름차순 (빈 칸은 맨 뒤) · 'bom' = BOM 순서 그대로(계층 들여쓰기)
//   dropZero: 수량 0(참조용) 줄 빼기
export function bomImageRows(rows, { order = 'maker', dropZero = false } = {}) {
  let list = (rows || []).map((b, i) => ({
    i, lv: Number(b.level) || 1,
    code: b.items?.std_code || '', name: b.items?.name || '',
    maker: b.items?.manufacturer || '', mcode: b.items?.manufacturer_code || '',
    qtyN: Number(b.qty_per_unit) || 0, unit: b.items?.unit || '',
    rev: b.item_rev || '', cat: b.items?.category || b.items?.type || '',
  }))
  if (dropZero) list = list.filter((r) => r.qtyN !== 0)
  if (order === 'maker') {
    list = [...list].sort((a, b) => cmpTxt(a.maker, b.maker) || cmpTxt(a.mcode, b.mcode) || cmpTxt(a.code, b.code) || a.i - b.i)
  }
  return list.map((r, k) => ({ ...r, no: String(k + 1), qty: fmtQty(r.qtyN), lvTxt: String(r.lv), indent: order === 'bom' ? r.lv - 1 : 0 }))
}

const cellText = (r, key) => key === 'lv' ? r.lvTxt : key === 'maker' || key === 'mcode' ? (blank(r[key]) ? '-' : r[key]) : String(r[key] ?? '')

// 글을 폭에 맞춰 여러 줄로 (단어 단위, 너무 긴 단어는 글자 단위)
function wrapText(ctx, text, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []; let cur = ''
  const push = (w) => {
    if (ctx.measureText(w).width <= maxW) return w
    let part = ''
    for (const ch of w) {
      if (ctx.measureText(part + ch).width > maxW && part) { lines.push(part); part = ch } else part += ch
    }
    return part
  }
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w
    if (ctx.measureText(t).width <= maxW) { cur = t; continue }
    if (cur) lines.push(cur)
    cur = push(w)
  }
  if (cur || !lines.length) lines.push(cur)
  return lines
}

// 캔버스에 그린다 — canvas: document.createElement('canvas')
//   title: 위 한 줄 (없으면 안 그림) · date: 오른쪽 위
export function drawBomImage(canvas, { rows, cols = DWG_DEFAULT, size = 13, title = '', date = '', scale = 3, nameMax = 46 }) {
  const C = DWG_COLS.filter((c) => cols.includes(c.key))
  const F = `'Arial','Malgun Gothic','Apple SD Gothic Neo',sans-serif`
  const M = `'Consolas','D2Coding','Courier New','Malgun Gothic',monospace`
  const font = (c, head) => `${head || c.bold ? 'bold ' : ''}${size}px ${c.mono && !head ? M : F}`
  const pad = Math.round(size * 0.55), lineH = Math.round(size * 1.45), indentW = Math.round(size * 1.1)
  const ctx0 = canvas.getContext('2d')
  // 품명 칸 최대 폭 — 글자 nameMax 개 정도 (넘으면 줄바꿈)
  ctx0.font = font({}, false)
  const nameMaxW = ctx0.measureText('M'.repeat(Math.round(nameMax * 0.62))).width
  // 열 폭
  const widths = C.map((c) => {
    ctx0.font = font(c, true); let w = ctx0.measureText(c.label).width
    ctx0.font = font(c, false)
    for (const r of rows) {
      const t = cellText(r, c.key)
      let tw = ctx0.measureText(t).width + (c.key === 'name' ? r.indent * indentW : 0)
      if (c.wrap) tw = Math.min(tw, nameMaxW)
      if (tw > w) w = tw
    }
    return Math.ceil(w + pad * 2)
  })
  // 줄 높이 (품명 줄바꿈)
  const nameIdx = C.findIndex((c) => c.key === 'name')
  const lay = rows.map((r) => {
    let lines = null
    if (nameIdx >= 0) {
      ctx0.font = font(C[nameIdx], false)
      lines = wrapText(ctx0, r.name, widths[nameIdx] - pad * 2 - r.indent * indentW)
    }
    return { lines, h: Math.max(1, lines ? lines.length : 1) * lineH + Math.round(pad * 0.9) }
  })
  const headH = lineH + Math.round(pad * 1.2)
  const titleH = title ? Math.round(size * 1.9) : 0
  const margin = Math.round(size * 0.9)
  const W = widths.reduce((a, b) => a + b, 0) + margin * 2
  const H = margin * 2 + titleH + headH + lay.reduce((a, b) => a + b.h, 0)

  canvas.width = Math.ceil(W * scale); canvas.height = Math.ceil(H * scale)
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#000000'; ctx.strokeStyle = '#000000'; ctx.textBaseline = 'middle'
  let y = margin
  if (title) {
    ctx.font = `bold ${Math.round(size * 1.1)}px ${F}`; ctx.textAlign = 'left'
    ctx.fillText(title, margin, y + titleH / 2 - 2)
    if (date) { ctx.font = `${Math.round(size * 0.85)}px ${F}`; ctx.textAlign = 'right'; ctx.fillText(date, W - margin, y + titleH / 2 - 2) }
    y += titleH
  }
  const x0 = margin, tableW = W - margin * 2
  const xs = []; widths.reduce((x, w) => { xs.push(x); return x + w }, x0)
  const text = (c, t, x, w, yMid) => {
    ctx.textAlign = c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left'
    const tx = c.align === 'right' ? x + w - pad : c.align === 'center' ? x + w / 2 : x + pad
    ctx.fillText(t, tx, yMid)
  }
  // 머리글
  C.forEach((c, j) => { ctx.font = font(c, true); text({ align: 'center' }, c.label, xs[j], widths[j], y + headH / 2) })
  const top = y
  y += headH
  const headBottom = y
  // 본문
  const rowYs = []
  rows.forEach((r, i) => {
    const { lines, h } = lay[i]
    rowYs.push(y)
    C.forEach((c, j) => {
      ctx.font = font(c, false)
      if (c.key === 'name' && lines) {
        const startY = y + (h - lines.length * lineH) / 2 + lineH / 2
        lines.forEach((ln, k) => text(c, ln, xs[j] + r.indent * indentW, widths[j] - r.indent * indentW, startY + k * lineH))
      } else text(c, cellText(r, c.key), xs[j], widths[j], y + h / 2)
    })
    y += h
  })
  const bottom = y
  // 선 — 가로(얇게) · 머리글 아래(굵게) · 세로 · 바깥(굵게)
  ctx.lineWidth = 1
  rowYs.slice(1).forEach((ry) => { ctx.beginPath(); ctx.moveTo(x0, ry); ctx.lineTo(x0 + tableW, ry); ctx.stroke() })
  xs.slice(1).forEach((x) => { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke() })
  ctx.lineWidth = 2.2
  ctx.beginPath(); ctx.moveTo(x0, headBottom); ctx.lineTo(x0 + tableW, headBottom); ctx.stroke()
  ctx.lineWidth = 1.8
  ctx.strokeRect(x0, top, tableW, bottom - top)
  return { width: W, height: H }
}

export const canvasToBlob = (canvas) => new Promise((res, rej) =>
  canvas.toBlob((b) => (b ? res(b) : rej(new Error('이미지를 만들지 못했습니다'))), 'image/png'))
