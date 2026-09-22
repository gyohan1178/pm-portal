import { supabase } from '../supabase'
import { fetchAll } from '../paginate'
import { todayISO } from '../utils'

// 구매전표 — 초도품 PPT 의 「실제 사용 자재」 증빙 (이카운트 「구 매 전 표」 양식)
//
//   원래는 ERP 명세표 PDF 를 폴더에서 찾아 붙였다.
//   포털에는 발주·입고 기록이 이미 있으니 그걸로 이카운트 구매전표 모양을 직접 그린다.
//   양식: 전표번호·DATE·구매처 / 일자·품목코드·품목명[규격]·수량(단위포함). 단가·공급가액·부가세 칸은 뺐다.
//
//   ⚠ 단가·금액은 조회부터 하지 않는다 (고객사로 나가는 자료).
//   ⚠ 같은 발주서의 다른 줄 중 Axcelis 품목(AX-)만 싣는다 — 다른 고객사 품번이 새지 않게.
//   제조사·제조사품번 = 발주 줄의 mfr·mfr_code. 비어 있으면 기준코드 DB(items) 값 (화면 판정과 같은 규칙).

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
      .select('id,po_number,order_date,qty_ordered,status,mfr,mfr_code,vendor_id,vendors(name),items(std_code,name,unit,manufacturer,manufacturer_code)')
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
    const onPo = !!(l.mfr || l.mfr_code)
    d.lines.push({
      poId: l.id, code: it.std_code || '', pn: String(it.std_code || '').replace(/^AX-/i, ''), name: it.name || '',
      mfr: (onPo ? l.mfr : it.manufacturer) || '', mpn: (onPo ? l.mfr_code : it.manufacturer_code) || '', unit: it.unit || 'EA',
      qty: l.qty_ordered, rcvQty: r ? r.qty : null, rcvDate: r ? r.last : '', orderDate: l.order_date || '',
    })
  }
  for (const d of docs.values()) d.lines.sort((a, b) => a.pn.localeCompare(b.pn))
  for (const l of lines) {
    const key = l.po_number + '|' + (l.vendor_id || '')
    if (docs.has(key)) out.set(l.id, docs.get(key))
  }
  return out
}

/* ================= 그리기 — 이카운트 구매전표 모양 ================= */
const XF = '"Malgun Gothic", "맑은 고딕", "Noto Sans CJK KR", "Apple SD Gothic Neo", Arial, sans-serif'
const COLS = [
  { t: '일자', w: 92, a: 'c' },
  { t: '품목코드', w: 170, b: 1 },
  { t: '품목명[규격]', w: 446, wrap: 1 },
  { t: '수량(단위포함)', w: 154, a: 'r' },
]
const MAXROWS = 14
const num = (v) => (v == null || v === '' ? '' : (Math.round(Number(v) * 1000) / 1000).toLocaleString('ko-KR'))
const mmdd = (d) => (d ? String(d).slice(5, 10).replace('-', '/') : '')
const unitOf = (u) => (/^(EA|EACH)$/i.test(u || '') || !u ? 'EA' : u)

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

// 보여 줄 줄 고르기 — 길면 해당 품목 앞뒤만 남기고 「… N줄」로 줄인다
export function windowLines(lines, poId, max = MAXROWS) {
  const at = Math.max(0, lines.findIndex((l) => l.poId === poId))
  if (lines.length <= max) return { list: lines.slice(), before: 0, after: 0 }
  let s = Math.max(0, at - Math.floor((max - 1) / 2))
  s = Math.min(s, lines.length - max)
  return { list: lines.slice(s, s + max), before: s, after: lines.length - s - max }
}

// 줄 한 개의 표시값 — 입고됐으면 입고일·입고수량, 아니면 발주일·발주수량
export function slipCells(l) {
  const got = l.rcvQty != null && l.rcvDate
  const spec = [l.mfr, l.mpn].filter(Boolean).join(' ')
  return [
    mmdd(got ? l.rcvDate : l.orderDate),
    l.code,
    l.name + (spec ? ` [${spec}]` : ''),
    num(got ? l.rcvQty : l.qty) + unitOf(l.unit),
  ]
}

// doc: fetchPurchaseDocs 의 묶음, poId: 이 품목의 발주 줄
export function drawPurchaseRecord(doc, poId) {
  const W = COLS.reduce((t, c) => t + c.w, 0) + 2, FS = 19, LH = 24, PAD = 7
  const c = document.createElement('canvas'), ctx = c.getContext('2d')
  const win = windowLines(doc.lines, poId)
  const rows = [{ cells: COLS.map((x) => x.t), head: true }]
  if (win.before) rows.push({ gap: `… 위 ${win.before}줄` })
  win.list.forEach((l) => rows.push({ cells: slipCells(l), hit: l.poId === poId }))
  if (win.after) rows.push({ gap: `… 아래 ${win.after}줄` })
  rows.forEach((r) => {
    if (r.gap) { r.h = LH + PAD; return }
    ctx.font = `${r.head || r.hit ? 'bold ' : ''}${FS}px ${XF}`
    r.lines = r.cells.map((v, i) => (COLS[i].wrap || r.head ? wrapLines(ctx, v, COLS[i].w - PAD * 2) : [String(v ?? '')]))
    r.h = Math.max(...r.lines.map((l) => l.length)) * LH + PAD * 2
  })
  const TOP = 168, FOOT = 38
  const H = TOP + rows.reduce((t, r) => t + r.h, 0) + FOOT
  c.width = W; c.height = H
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'top'
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1
  // 제목
  ctx.fillStyle = '#000'; ctx.font = `bold 34px ${XF}`
  const title = '구 매 전 표', tw = ctx.measureText(title).width
  ctx.fillText(title, (W - tw) / 2, 8)
  ctx.beginPath(); ctx.moveTo((W - tw) / 2, 50.5); ctx.lineTo((W + tw) / 2, 50.5); ctx.stroke()
  // 머리 칸 — 왼쪽 전표번호·DATE / 오른쪽 구매처·구매자
  const box = (x, y, rowsKV, kw, bw) => {
    rowsKV.forEach(([k, v], i) => {
      const yy = y + i * 34
      ctx.strokeRect(x + 0.5, yy + 0.5, kw, 34); ctx.strokeRect(x + kw + 0.5, yy + 0.5, bw - kw, 34)
      ctx.fillStyle = '#000'; ctx.font = `bold 17px ${XF}`
      const kt = ctx.measureText(k).width; ctx.fillText(k, x + (kw - kt) / 2, yy + 8)
      ctx.font = `17px ${XF}`; ctx.fillText(fit(ctx, v, bw - kw - 12), x + kw + 8, yy + 8)
    })
  }
  const lw = Math.round(W * 0.5), rw = Math.round(W * 0.42)
  box(1, 66, [['전표번호', `${doc.no}  [ 1 / 1 ]`], ['DATE', (doc.date || '').replace(/-/g, '/')]], 104, lw)
  box(W - rw - 2, 66, [['구매처', doc.vendor || '—'], ['구매자', '진선테크 구매자재팀']], 90, rw)
  // 표
  let y = TOP
  rows.forEach((r) => {
    if (r.gap) {
      ctx.strokeStyle = '#000'; ctx.strokeRect(1.5, y + 0.5, W - 3, r.h)
      ctx.fillStyle = '#777'; ctx.font = `15px ${XF}`; ctx.fillText(r.gap, COLS[0].w + PAD + 2, y + PAD / 2 + 4)
      y += r.h; return
    }
    ctx.fillStyle = r.head ? '#f2f2f2' : r.hit ? '#fff200' : '#fff'
    ctx.fillRect(1, y, W - 2, r.h)
    let x = 1
    r.lines.forEach((ls, i) => {
      const col = COLS[i]
      ctx.fillStyle = '#000'
      ctx.font = `${r.head || (r.hit && (i === 1 || i === 2)) ? 'bold ' : ''}${FS}px ${XF}`
      ls.forEach((l, k) => {
        const w0 = ctx.measureText(l).width
        const tx = r.head || col.a === 'c' ? x + (col.w - w0) / 2 : col.a === 'r' ? x + col.w - PAD - w0 : x + PAD
        ctx.fillText(l, tx, y + PAD + k * LH)
      })
      x += col.w
    })
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1
    ctx.strokeRect(1.5, y + 0.5, W - 3, r.h)
    x = 1; COLS.slice(0, -1).forEach((col) => { x += col.w; ctx.beginPath(); ctx.moveTo(x + 0.5, y); ctx.lineTo(x + 0.5, y + r.h); ctx.stroke() })
    if (r.hit) { // 품목코드·품목명 빨간 네모
      ctx.strokeStyle = '#e0505f'; ctx.lineWidth = 3
      const x1 = 1 + COLS[0].w
      ctx.strokeRect(x1 + 2, y + 2, COLS[1].w + COLS[2].w - 4, r.h - 4)
      ctx.lineWidth = 1
    }
    y += r.h
  })
  ctx.fillStyle = '#888'; ctx.font = `14px ${XF}`
  ctx.fillText(`진선테크 PM Portal 발주·입고 기록 · 출력 ${todayISO()}`, 4, y + 10)
  const n = `Axcelis 품목 ${doc.lines.length}줄`
  ctx.fillText(n, W - ctx.measureText(n).width - 4, y + 10)
  return { canvas: c, w: W, h: H }
}

function fit(ctx, t, w) {
  t = String(t ?? '')
  if (ctx.measureText(t).width <= w) return t
  while (t.length > 1 && ctx.measureText(t + '…').width > w) t = t.slice(0, -1)
  return t + '…'
}
