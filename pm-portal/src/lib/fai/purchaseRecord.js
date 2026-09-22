import { supabase } from '../supabase'
import { fetchAll } from '../paginate'
import { todayISO } from '../utils'

// 구매 명세표 (Purchase Record) — 초도품 PPT 의 「② 실제 사용 자재」 증빙
//
//   원래는 ERP 명세표 PDF 를 폴더에서 찾아 붙였다.
//   포털에는 발주·입고 기록이 이미 있으니 그걸로 명세표를 직접 그린다.
//
//   ⚠ 단가·금액은 조회부터 하지 않는다 (고객사로 나가는 자료).
//   ⚠ 같은 발주서의 다른 줄 중 Axcelis 품목(AX-)만 싣는다 — 다른 고객사 품번이 새지 않게.
//   ⚠ 제조사·제조사품번은 지금 기준코드 DB(items) 값이다. 발주 줄 제조사 칸이 생기면 바꾼다.

const CH = 100

// recs: [{ poId, doc(po_number), vendorId }] → Map(poId → 명세표 묶음)
export async function fetchPurchaseDocs(recs) {
  const want = recs.filter((r) => r && r.poId && r.doc)
  const out = new Map()
  if (!want.length) return out
  const numbers = [...new Set(want.map((r) => r.doc))]
  const lines = []
  for (let i = 0; i < numbers.length; i += CH) {
    const part = await fetchAll(() => supabase.from('purchase_orders')
      .select('id,po_number,order_date,qty_ordered,status,vendor_id,vendors(name),items(std_code,name,unit,manufacturer,manufacturer_code)')
      .eq('order_type', 'purchase').in('po_number', numbers.slice(i, i + CH))
      .order('id'))
    lines.push(...part)
  }
  const ids = lines.map((l) => l.id)
  const mv = []
  for (let i = 0; i < ids.length; i += CH * 2) {
    const part = await fetchAll(() => supabase.from('stock_movements')
      .select('id,po_id,qty,movement_date')
      .eq('movement_type', '입고').in('po_id', ids.slice(i, i + CH * 2))
      .order('id'))
    mv.push(...part)
  }
  const rcv = new Map()
  for (const m of mv) {
    const r = rcv.get(m.po_id) || { qty: 0, first: '', last: '', n: 0 }
    r.qty += Number(m.qty) || 0; r.n++
    const d = m.movement_date || ''
    if (d && (!r.first || d < r.first)) r.first = d
    if (d && d > r.last) r.last = d
    rcv.set(m.po_id, r)
  }
  // 발주번호 + 거래처 = 발주서 한 장
  const docs = new Map()
  for (const l of lines) {
    if (l.status === '취소') continue
    const key = l.po_number + '|' + (l.vendor_id || '')
    if (!docs.has(key)) docs.set(key, { no: l.po_number, vendor: l.vendors?.name || '', date: l.order_date || '', lines: [] })
    const d = docs.get(key)
    if (l.order_date && (!d.date || l.order_date < d.date)) d.date = l.order_date
    const it = l.items || {}
    if (!/^AX-/i.test(it.std_code || '')) continue
    const r = rcv.get(l.id)
    d.lines.push({
      poId: l.id, pn: String(it.std_code || '').replace(/^AX-/i, ''), name: it.name || '',
      mfr: it.manufacturer || '', mpn: it.manufacturer_code || '', unit: it.unit || 'EA',
      qty: l.qty_ordered, rcvQty: r ? r.qty : null, rcvDate: r ? (r.first && r.first !== r.last ? `${r.first} ~ ${r.last}` : r.last) : '',
    })
  }
  for (const d of docs.values()) d.lines.sort((a, b) => a.pn.localeCompare(b.pn))
  for (const l of lines) {
    const key = l.po_number + '|' + (l.vendor_id || '')
    if (docs.has(key)) out.set(l.id, docs.get(key))
  }
  return out
}

/* ================= 그리기 ================= */
const XF = 'Calibri, Arial, "Malgun Gothic", "맑은 고딕", "Noto Sans CJK KR", sans-serif'
const COLS = [
  { t: 'No', w: 40, a: 'c' },
  { t: 'Part No', w: 124, b: 1 },
  { t: 'Description', w: 206, wrap: 1 },
  { t: 'Manufacturer', w: 150, wrap: 1 },
  { t: 'MFR P/N', w: 224, wrap: 1, b: 1 },
  { t: 'PO Qty', w: 72, a: 'r' },
  { t: 'Received', w: 122, a: 'c', wrap: 1 },
  { t: 'Rcv Qty', w: 76, a: 'r' },
]
const MAXROWS = 8
const num = (v) => (v == null || v === '' ? '' : (Math.round(Number(v) * 1000) / 1000).toLocaleString('en-US'))

export function wrapLines(ctx, text, w) {
  const out = []
  String(text ?? '').split('\n').forEach((para) => {
    const words = para.split(/(\s+)/); let cur = ''
    for (const wd of words) {
      const t = cur + wd
      if (ctx.measureText(t).width <= w || !cur.trim()) {
        if (ctx.measureText(t).width > w && !cur.trim()) { // 긴 단어는 글자 단위로 자른다
          let piece = ''
          for (const ch of t) { if (ctx.measureText(piece + ch).width > w) { out.push(piece); piece = ch } else piece += ch }
          cur = piece
        } else cur = t
      } else { out.push(cur.trimEnd()); cur = wd.trimStart() }
    }
    out.push(cur.trimEnd())
  })
  return out.length ? out : ['']
}

// 보여 줄 줄 고르기 — 길면 해당 품목 앞뒤만 남기고 「… N줄 더」로 줄인다
export function windowLines(lines, poId, max = MAXROWS) {
  const at = Math.max(0, lines.findIndex((l) => l.poId === poId))
  if (lines.length <= max) return { list: lines.map((l, i) => ({ ...l, no: i + 1 })), before: 0, after: 0 }
  let s = Math.max(0, at - Math.floor((max - 1) / 2))
  s = Math.min(s, lines.length - max)
  return {
    list: lines.slice(s, s + max).map((l, i) => ({ ...l, no: s + i + 1 })),
    before: s, after: lines.length - s - max,
  }
}

// doc: fetchPurchaseDocs 의 묶음, poId: 이 품목의 발주 줄. logo: 불러온 Image (없어도 됨)
export function drawPurchaseRecord(doc, poId, logo) {
  const W = COLS.reduce((t, c) => t + c.w, 0) + 2, FS = 20, LH = 25, PAD = 7
  const c = document.createElement('canvas'), ctx = c.getContext('2d')
  const win = windowLines(doc.lines, poId)
  const rows = [{ cells: COLS.map((x) => x.t), head: true }]
  if (win.before) rows.push({ gap: `… ${win.before} more line(s) above` })
  win.list.forEach((l) => rows.push({
    cells: [l.no, l.pn, l.name, l.mfr, l.mpn, num(l.qty), l.rcvDate || '—', num(l.rcvQty)],
    hit: l.poId === poId,
  }))
  if (win.after) rows.push({ gap: `… ${win.after} more line(s) below` })
  rows.forEach((r) => {
    if (r.gap) { r.h = LH + PAD; return }
    ctx.font = `${r.head || r.hit ? 'bold ' : ''}${FS}px ${XF}`
    r.lines = r.cells.map((v, i) => (COLS[i].wrap ? wrapLines(ctx, v, COLS[i].w - PAD * 2) : [String(v ?? '')]))
    r.h = Math.max(...r.lines.map((l) => l.length)) * LH + PAD * 2
  })
  const TOP = 150, FOOT = 40
  const H = TOP + rows.reduce((t, r) => t + r.h, 0) + FOOT
  c.width = W; c.height = H
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'top'
  // 머리 — 제목 · 로고
  ctx.fillStyle = '#1f2430'; ctx.font = `bold 32px ${XF}`
  ctx.fillText('PURCHASE RECORD', 4, 8)
  const tw = ctx.measureText('PURCHASE RECORD').width
  ctx.fillStyle = '#667380'; ctx.font = `20px ${XF}`
  ctx.fillText('구매 명세표', tw + 16, 18)
  if (logo && logo.width) {
    const lh = 48, lw = logo.width * lh / logo.height
    ctx.drawImage(logo, W - lw - 4, 4, lw, lh)
  }
  // 발주 정보 칸
  const info = [['PO No.', doc.no], ['PO Date', doc.date || '—'], ['Supplier', doc.vendor || '—'], ['Buyer', 'Jinsuntech Co., Ltd.']]
  const iy = 62, ih = 74, iw = (W - 2) / info.length
  info.forEach(([k, v], i) => {
    const x = 1 + i * iw
    ctx.fillStyle = '#eef1f3'; ctx.fillRect(x, iy, iw, 28)
    ctx.strokeStyle = '#8c8c8c'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, iy + 0.5, iw - 1, ih - 1)
    ctx.beginPath(); ctx.moveTo(x, iy + 28.5); ctx.lineTo(x + iw, iy + 28.5); ctx.stroke()
    ctx.fillStyle = '#5a6570'; ctx.font = `bold 17px ${XF}`; ctx.fillText(k, x + PAD, iy + 5)
    ctx.fillStyle = '#1f2430'; ctx.font = `${i === 0 ? 'bold ' : ''}21px ${XF}`
    ctx.fillText(fit(ctx, v, iw - PAD * 2), x + PAD, iy + 38)
  })
  // 표
  let y = TOP
  rows.forEach((r) => {
    if (r.gap) {
      ctx.fillStyle = '#f7f8fa'; ctx.fillRect(1, y, W - 2, r.h)
      ctx.strokeStyle = '#8c8c8c'; ctx.strokeRect(1.5, y + 0.5, W - 3, r.h)
      ctx.fillStyle = '#98a0b0'; ctx.font = `italic 17px ${XF}`; ctx.fillText(r.gap, PAD + 40, y + PAD / 2 + 3)
      y += r.h; return
    }
    ctx.fillStyle = r.head ? '#e7e6e6' : r.hit ? '#fff200' : '#fff'
    ctx.fillRect(1, y, W - 2, r.h)
    let x = 1
    r.lines.forEach((ls, i) => {
      const col = COLS[i]
      ctx.fillStyle = '#000'
      ctx.font = `${r.head || (r.hit && col.b) ? 'bold ' : ''}${FS}px ${XF}`
      ls.forEach((l, k) => {
        const lw = ctx.measureText(l).width
        const tx = col.a === 'r' && !r.head ? x + col.w - PAD - lw : col.a === 'c' || r.head ? x + (col.w - lw) / 2 : x + PAD
        ctx.fillText(l, tx, y + PAD + k * LH)
      })
      x += col.w
    })
    ctx.strokeStyle = '#8c8c8c'; ctx.lineWidth = 1
    ctx.strokeRect(1.5, y + 0.5, W - 3, r.h)
    x = 1; COLS.slice(0, -1).forEach((col) => { x += col.w; ctx.beginPath(); ctx.moveTo(x + 0.5, y); ctx.lineTo(x + 0.5, y + r.h); ctx.stroke() })
    if (r.hit) { // 품번·제조사품번 빨간 네모 (원래 증빙 PDF 표시와 같게)
      ctx.strokeStyle = '#e0505f'; ctx.lineWidth = 3
      const x1 = 1 + COLS[0].w, x4 = 1 + COLS.slice(0, 4).reduce((t, cc) => t + cc.w, 0)
      ctx.strokeRect(x1 + 2, y + 2, COLS[1].w - 4, r.h - 4)
      ctx.strokeRect(x4 + 2, y + 2, COLS[4].w - 4, r.h - 4)
    }
    y += r.h
  })
  ctx.fillStyle = '#98a0b0'; ctx.font = `16px ${XF}`
  ctx.fillText(`Generated from Jinsuntech purchasing / receiving records · ${todayISO()}`, 4, y + 10)
  const n = `${doc.lines.length} Axcelis line(s)`
  ctx.fillText(n, W - ctx.measureText(n).width - 4, y + 10)
  return { canvas: c, w: W, h: H }
}

function fit(ctx, t, w) {
  t = String(t ?? '')
  if (ctx.measureText(t).width <= w) return t
  while (t.length > 1 && ctx.measureText(t + '…').width > w) t = t.slice(0, -1)
  return t + '…'
}
