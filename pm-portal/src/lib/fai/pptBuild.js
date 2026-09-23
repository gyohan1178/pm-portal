import { LOGO_B64 } from '../poAssets'
import { todayISO } from '../utils'
import { qtyText, parentList } from './partReport'
import { fetchPurchaseDocs, drawPurchaseRecord, wrapLines } from './purchaseRecord'
import { isDwgPart, pickDwg, renderDrawing } from './drawings'

// 초도품 자재 확인 PPT — FAI Navigator v3.2 「품목별 PPT」 이식
//
//   한 품목 = 한 장.
//     ① PART REPORT REGISTRATION  Part Report 원본 표 모양 발췌 (이 품목 줄 = 노란 형광펜)
//     ② DRAWING                   16·17번대만 — 연결한 도면 폴더에서 1쪽 (품번 위치 형광)
//     ③ ACTUAL PART USED          구매전표 — 포털 발주·입고 기록으로 이카운트 양식을 그린다 (금액 칸 없음)
//   VERIFICATION ☐OK ☐NG · Remark 는 품질이 채우도록 비워 둔다.
//
//   ⚠ 원본과 다른 곳
//     · 증빙은 폴더의 명세표 스캔 대신, 포털 기록으로 그린 구매전표 (purchaseRecord.js)
//     · 사양서(CPS) 왼쪽 칸 옵션은 옮기지 않음
//     · 판정 수정이 아직 없어 체크 칸은 전부 빈칸

const XF = 'Calibri, Arial, "Malgun Gothic", "맑은 고딕", "Noto Sans CJK KR", sans-serif'
const C_RED = 'C02D23', C_INK = '2B3540', C_SUB = '5A6570', C_MUT = '667380', C_LINE = 'D8DDE1', C_CARD = 'F4F6F8'
const HF = 'Cambria', PF = 'Calibri'
const CLS_EN = { generic: 'Generic', limited: 'Limited', sole: 'Sole', uncls: 'Unclassified', nomfr: 'No MFR listed', assy: 'Assembly' }
const PNL = { y: 2.42, h: 4.45, lx: 0.45, rx: 6.78, w: 6.1, imgY: 3.34, imgH: 3.38 }

const tick = (ms) => new Promise((res) => setTimeout(res, ms || 0))
function contain(iw, ih, bx, by, bw, bh) { const s = Math.min(bw / iw, bh / ih); const w = iw * s, h = ih * s; return { x: bx + (bw - w) / 2, y: by + (bh - h) / 2, w, h } }

/* ① Part Report 원본 표 모양 발췌 */
const EX_COLS = [
  { t: 'Level', w: 56 }, { t: 'Type', w: 80 }, { t: 'Number', w: 150, wrap: 1 }, { t: 'Name', w: 206, wrap: 1 }, { t: 'Qty', w: 44 },
  { t: 'Unit', w: 56 }, { t: 'Version', w: 66 }, { t: 'State', w: 76 }, { t: 'Mfr Classification', w: 136, wrap: 1 },
]
function fitTxt(ctx, t, w) { t = String(t ?? ''); if (ctx.measureText(t).width <= w) return t; while (t.length > 1 && ctx.measureText('…' + t).width > w) t = t.slice(1); return '…' + t }
export function excerptCanvas(rep, P) {
  const W = EX_COLS.reduce((t, c) => t + c.w, 0) + 2, FS = 16, LH = 20, PAD = 6
  const c = document.createElement('canvas'), ctx = c.getContext('2d')
  const rows = [
    { cells: EX_COLS.map((x) => x.t), head: true },
    { cells: [P.lvTxt, 'Part', P.pn, P.name, P.qty0, P.unit0, P.rev, P.state, P.cls], part: true },
  ]
  if (P.accept) rows.push({ span: 'Acceptance Criteria:  ' + P.accept, part: true })
  if (P.related) rows.push({ span: 'Related Axcelis Parts:  ' + P.related, part: true })
  P.mfrs.forEach((m) => rows.push({ cells: [m.lv, 'Mfr Part', m.raw, m.mfr, '', '', m.ver, m.state, [m.rohs && 'RoHS ' + m.rohs, m.cert].filter(Boolean).join(' · ')], dnu: /Do Not Use/i.test(m.status) }))
  rows.forEach((r) => {
    ctx.font = (r.head ? 'bold ' : '') + `${FS}px ${XF}`
    if (r.span) { ctx.font = `${FS - 1}px ${XF}`; r.lines = [wrapLines(ctx, r.span, W - PAD * 2 - 60)] }
    else r.lines = r.cells.map((v, i) => (EX_COLS[i].wrap || r.head ? wrapLines(ctx, v, EX_COLS[i].w - PAD * 2) : [String(v ?? '')]))
    r.h = Math.max(...r.lines.map((l) => l.length)) * LH + PAD * 2
  })
  const TITLE = 34, H = TITLE + rows.reduce((t, r) => t + r.h, 0) + 2
  c.width = W; c.height = H
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#000'; ctx.font = `bold 17px ${XF}`
  ctx.fillText(`Part report for ${rep.top.pn} ${rep.top.rev} (REL)`, 2, 7)
  ctx.fillStyle = '#666'; ctx.font = `13px ${XF}`
  const src = rep.fileName || ''
  ctx.fillText(fitTxt(ctx, src, W / 2), W - Math.min(ctx.measureText(src).width, W / 2) - 4, 10)
  let y = TITLE
  rows.forEach((r) => {
    ctx.fillStyle = r.head ? '#e7e6e6' : r.part ? (r.span ? '#fff9a8' : '#fff200') : '#fff'
    ctx.fillRect(1, y, W - 2, r.h)
    ctx.strokeStyle = '#8c8c8c'; ctx.lineWidth = 1
    if (r.span) {
      ctx.fillStyle = '#000'; ctx.font = `${FS - 1}px ${XF}`
      r.lines[0].forEach((l, k) => ctx.fillText(l, 60 + PAD, y + PAD + k * LH))
      ctx.strokeRect(1.5, y + 0.5, W - 3, r.h)
      ctx.beginPath(); ctx.moveTo(57.5, y); ctx.lineTo(57.5, y + r.h); ctx.stroke()
    } else {
      let x = 1
      r.lines.forEach((ls, i) => {
        ctx.fillStyle = r.dnu ? '#c00000' : '#000'
        ctx.font = (r.head || (r.part && (i === 2 || i === 3)) ? 'bold ' : '') + `${FS}px ${XF}`
        ls.forEach((l, k) => ctx.fillText(l, x + PAD, y + PAD + k * LH))
        x += EX_COLS[i].w
      })
      ctx.strokeRect(1.5, y + 0.5, W - 3, r.h)
      x = 1; EX_COLS.slice(0, -1).forEach((col) => { x += col.w; ctx.beginPath(); ctx.moveTo(x + 0.5, y); ctx.lineTo(x + 0.5, y + r.h); ctx.stroke() })
    }
    y += r.h
  })
  return { canvas: c, w: W, h: H }
}

/* ---- 슬라이드 공통 (원본 Drawing Change Request 양식) ---- */
function pptHeader(s, rep, r, no) {
  const P = r.P
  s.addText('FIRST ARTICLE MATERIAL VERIFICATION', { x: 0.45, y: 0.3, w: 9, h: 0.26, fontFace: PF, fontSize: 11.5, bold: true, color: C_RED, charSpacing: 2, margin: 0 })
  s.addText(`P/N ${P.pn}  |  ${P.name}`, { x: 0.45, y: 0.56, w: 10.9, h: 0.5, fontFace: HF, fontSize: 24, bold: true, color: C_INK, margin: 0, fit: 'shrink' })
  s.addImage({ data: LOGO_B64, x: 11.95, y: 0.3, w: 0.95, h: 0.5, sizing: { type: 'contain', w: 0.95, h: 0.5 } })
  const pars = parentList(r, rep.top.pn)
  const parTxt = pars.length ? pars.slice(0, 2).join(', ') + (pars.length > 2 ? ` +${pars.length - 2}` : '') : rep.top.pn
  const cols = [['No', 0.5], ['Part No', 1.3], ['Description', 3.55], ['Qty', 0.95], ['Class', 1.65], ['Version', 0.8], ['Parent Assy', 2.08], ['Result', 1.6]]
  const head = cols.map(([t]) => ({ text: t, options: { bold: true, color: C_SUB, fill: { color: 'EEF1F3' }, fontSize: 10 } }))
  const vals = [String(no), P.pn, P.name, qtyText(r), P.cls || CLS_EN[r.ck], P.rev, parTxt, '']
    .map((t, i) => ({ text: t, options: i === 1 ? { bold: true } : i === 6 ? { color: '3563C9' } : {} }))
  s.addTable([head, vals], { x: 0.45, y: 1.18, w: 12.43, colW: cols.map((c) => c[1]), rowH: [0.28, 0.34], fontFace: PF, fontSize: 11, color: C_INK, border: { type: 'solid', pt: 0.75, color: C_LINE }, valign: 'middle', margin: [0, 0.07, 0, 0.07] })
}
function pptPanel(pptx, s, x, y, w, h, num, title, sub) {
  s.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: C_CARD }, line: { color: C_LINE, width: 0.75 } })
  s.addShape(pptx.ShapeType.ellipse, { x: x + 0.22, y: y + 0.17, w: 0.3, h: 0.3, fill: { color: C_RED }, line: { color: C_RED } })
  s.addText(String(num), { x: x + 0.22, y: y + 0.17, w: 0.3, h: 0.3, fontFace: PF, fontSize: 12.5, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0 })
  s.addText(title, { x: x + 0.64, y: y + 0.17, w: w - 0.9, h: 0.3, fontFace: PF, fontSize: 13, bold: true, color: C_SUB, charSpacing: 1, valign: 'middle', margin: 0 })
  if (sub) s.addText(sub, { x: x + 0.25, y: y + 0.55, w: w - 0.5, h: 0.32, fontFace: PF, fontSize: 11.5, color: C_INK, valign: 'middle', margin: 0 })
}
// 그림 한 장 = 글자로 바꾼 뒤 캔버스는 바로 버린다 (400장 만들 때 메모리가 터지지 않게)
export function toData(im, jpg, q) {
  const d = jpg ? im.canvas.toDataURL('image/jpeg', q || 0.75) : im.canvas.toDataURL('image/png')
  im.canvas.width = im.canvas.height = 0   // 캔버스 메모리 즉시 반납
  return { data: d, w: im.w, h: im.h }
}
function pptImage(pptx, s, im, x, y, w, h, jpg) {
  s.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: 'FFFFFF' }, line: { color: C_LINE, width: 0.5 } })
  const g = im.data ? im : toData(im, jpg)
  const p = contain(g.w, g.h, x + 0.06, y + 0.06, w - 0.12, h - 0.12)
  // 표 그림은 위에 붙이고(PNG), 도면은 가운데(JPG — 파일이 작다)
  s.addImage({ data: g.data, x: p.x, y: jpg ? p.y : y + 0.06, w: p.w, h: p.h })
}
const DW_EN = { exact: 'matches Part Report', rev: 'same revision', mismatch: 'Part Report: Rev ' }
function emptyBox(pptx, s, x, y, w, h, text) {
  s.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: 'FFFFFF' }, line: { color: C_LINE, width: 0.5, dashType: 'dash' } })
  s.addText(text, { x, y, w, h, fontFace: PF, fontSize: 14, color: 'B0B7C3', align: 'center', valign: 'middle' })
}

// 이 품목의 판정에 쓰인 발주 줄 (화면의 「실제 사용」과 같은 줄)
export function recOf(r) {
  const a = r.e.act, recs = r.e.recs || []
  return recs.find((x) => x.doc === a.doc && x.date === a.date) || recs[0] || null
}

/**
 * rep  : parseReport 결과 (+ fileName)
 * rows : 만들 품목 (화면 순서)
 * noOf : (r, i) => 표지 번호
 * onProgress(i, total, pn), askStop(i) → 'save' | 'cancel' | null(계속)
 * dwgIdx : 연결한 도면 폴더 (drawings.indexDwg) — 없으면 도면 칸에 「폴더 미연결」
 * 반환: { blob, size, slides, done, stopped, noRec, dwg: { n, ok, miss } }
 */
export async function buildFaiPpt({ rep, rows, noOf, onProgress, askStop, dwgIdx }) {
  const { default: PptxGenJS } = await import('pptxgenjs')
  onProgress?.(0, rows.length, '발주·입고 기록 불러오는 중')
  const docs = await fetchPurchaseDocs(rows.filter((r) => r.e.v !== 'ASSY').map(recOf).filter(Boolean))

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.title = `First Article Material Verification ${rep.top.pn}`
  pptx.company = 'Jinsuntech'; pptx.author = 'Jinsuntech Purchasing Team'
  const cv = pptx.addSlide() // 표지는 다 만든 뒤 채운다 — 중간에 멈추면 만든 건수만 적히게

  let done = rows.length, stopped = false, noRec = 0
  const dwg = { n: 0, ok: 0, miss: 0 }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], P = r.P, a = r.e.act, isAssy = r.e.v === 'ASSY'
    onProgress?.(i, rows.length, P.pn)
    await tick(i % 25 === 24 ? 60 : 0)   // 가끔 길게 쉬어 브라우저가 메모리를 정리할 틈을 준다
    const st = askStop ? await askStop(i) : null
    if (st === 'save') { done = i; stopped = true; break }
    if (st === 'cancel') { const e = new Error('cancel'); e.cancel = true; throw e }

    const s = pptx.addSlide()
    pptHeader(s, rep, r, noOf(r, i))
    // VERIFICATION — 품질 검토용 빈칸
    s.addShape(pptx.ShapeType.roundRect, { x: 0.45, y: 1.9, w: 12.43, h: 0.4, rectRadius: 0.06, fill: { color: C_CARD }, line: { color: C_LINE, width: 0.5 } })
    s.addText('VERIFICATION', { x: 0.6, y: 1.9, w: 1.25, h: 0.4, fontFace: PF, fontSize: 10, bold: true, color: C_SUB, charSpacing: 1, valign: 'middle', margin: 0 })
    let cx = 2.1
    for (const t of ['OK', 'NG']) {
      s.addText([{ text: '☐ ', options: { fontFace: 'Segoe UI Symbol', fontSize: 15, color: '98A0B0' } },
        { text: t, options: { fontSize: 13, bold: true, color: C_INK } }],
      { x: cx, y: 1.9, w: 1.2, h: 0.4, fontFace: PF, valign: 'middle', margin: 0 })
      cx += 1.2
    }
    // 16·17번대는 도면 칸을 둔다 — 왼쪽 위 ① 발췌, 왼쪽 아래 ② 도면, 오른쪽 ③ 실제 사용
    const hasDwg = isDwgPart(P)
    const L = hasDwg ? { x: 0.45, w: 7.25 } : { x: PNL.lx, w: PNL.w }
    const R = hasDwg ? { x: 7.93, w: 4.95 } : { x: PNL.rx, w: PNL.w }
    const TOP = PNL.y, BOT = PNL.y + PNL.h
    const ex = excerptCanvas(rep, P)
    if (hasDwg) {
      dwg.n++
      const need = (L.w - 0.5) * ex.h / ex.w
      const h1 = Math.min(2.6, Math.max(1.3, need + 0.7))
      pptPanel(pptx, s, L.x, TOP, L.w, h1, 1, 'PART REPORT REGISTRATION', null)
      pptImage(pptx, s, ex, L.x + 0.25, TOP + 0.55, L.w - 0.5, h1 - 0.67)
      const y2 = TOP + h1 + 0.12, h2 = BOT - y2
      pptPanel(pptx, s, L.x, y2, L.w, h2, 2, 'DRAWING', null)
      const pk = dwgIdx ? pickDwg(P, dwgIdx) : null
      if (pk && pk.file) {
        const info = pk.got ? `  —  Rev ${pk.got}` + (pk.status === 'mismatch' ? `  (${DW_EN.mismatch}${pk.want})` : pk.want ? `  (${DW_EN[pk.status] || ''})` : '') : ''
        s.addText(`${pk.file.name}${info}  · sheet 1`, { x: L.x + 2.2, y: y2 + 0.17, w: L.w - 2.45, h: 0.3, fontFace: PF, fontSize: 9.5, color: pk.status === 'mismatch' ? C_RED : C_MUT, align: 'right', valign: 'middle', margin: 0 })
        const im = await renderDrawing(pk.file, [P.pn])
        if (im.data) { dwg.ok++; pptImage(pptx, s, im, L.x + 0.25, y2 + 0.55, L.w - 0.5, h2 - 0.67, true) }
        else { dwg.miss++; emptyBox(pptx, s, L.x + 0.25, y2 + 0.55, L.w - 0.5, h2 - 0.67, 'Drawing could not be opened') }
      } else {
        dwg.miss++
        emptyBox(pptx, s, L.x + 0.25, y2 + 0.55, L.w - 0.5, h2 - 0.67,
          !dwgIdx ? 'Drawing folder not connected' : pk && pk.wantFile ? `Drawing not found — ${pk.wantFile}` : 'Drawing not found')
      }
    } else {
      pptPanel(pptx, s, L.x, TOP, L.w, PNL.h, 1, 'PART REPORT REGISTRATION', `Original excerpt — Part report ${rep.top.pn} ${rep.top.rev}`)
      pptImage(pptx, s, ex, L.x + 0.25, PNL.imgY, L.w - 0.5, PNL.imgH)
    }
    // 실제 사용 — 구매전표 (도면 칸이 있으면 ③, 없으면 ②)
    const sub = isAssy ? 'In-house assembly — see sub-components'
      : `Manufacturer:  ${a.mfr || '—'}      MFR P/N:  ${a.mpn || '—'}`
    pptPanel(pptx, s, R.x, TOP, R.w, PNL.h, hasDwg ? 3 : 2, 'ACTUAL PART USED', sub)
    const rec = isAssy ? null : recOf(r)
    const doc = rec && docs.get(rec.poId)
    if (doc) pptImage(pptx, s, drawPurchaseRecord(doc, rec.poId), R.x + 0.25, PNL.imgY, R.w - 0.5, PNL.imgH)
    else {
      if (!isAssy) noRec++
      emptyBox(pptx, s, R.x + 0.25, PNL.imgY, R.w - 0.5, PNL.imgH, isAssy ? 'In-house assembly' : 'No purchase record')
    }
    // Remark — 품질이 적도록 비워 둔다
    s.addText([{ text: 'Remark  ', options: { bold: true, color: C_SUB } }, { text: ' ', options: { color: C_INK } }],
      { x: 0.45, y: 6.97, w: 12.43, h: 0.32, fontFace: PF, fontSize: 11, valign: 'middle', margin: 0 })
    s.addShape(pptx.ShapeType.line, { x: 1.2, y: 7.24, w: 11.68, h: 0, line: { color: C_LINE, width: 0.75 } })
  }

  // 표지
  cv.addImage({ data: LOGO_B64, x: 11.6, y: 0.45, w: 1.3, h: 0.68, sizing: { type: 'contain', w: 1.3, h: 0.68 } })
  cv.addText('FIRST ARTICLE MATERIAL VERIFICATION', { x: 0.8, y: 1.9, w: 11, h: 0.35, fontFace: PF, fontSize: 14, bold: true, color: C_RED, charSpacing: 2, margin: 0 })
  cv.addText(`P/N ${rep.top.pn}  Rev ${rep.top.rev}`, { x: 0.8, y: 2.3, w: 11.5, h: 0.7, fontFace: HF, fontSize: 36, bold: true, color: C_INK, margin: 0 })
  cv.addText(rep.top.name || '', { x: 0.8, y: 3.05, w: 11.5, h: 0.45, fontFace: PF, fontSize: 18, color: C_MUT, margin: 0 })
  cv.addTable([
    ['Reviewed by (Quality)', 'Date'].map((t) => ({ text: t, options: { bold: true, color: C_SUB, fill: { color: 'EEF1F3' }, fontSize: 10.5 } })),
    ['', ''].map((t) => ({ text: t })),
  ], { x: 8.2, y: 4.05, w: 4.3, colW: [2.6, 1.7], rowH: [0.4, 0.75], fontFace: PF, align: 'center', valign: 'middle', border: { type: 'solid', pt: 0.75, color: C_LINE } })
  const created = String(rep.top.created || '').replace(/^Created by\s*/i, '').replace(/\s*\(.*?\)/, '')
  cv.addText([
    { text: `Items: ${done}`, options: { bold: true, breakLine: true } },
    { text: `Source: Axcelis Part Report ${rep.top.pn} ${rep.top.rev}${created ? ` (${created})` : ''}`, options: { breakLine: true } },
    { text: `Jinsuntech Co., Ltd. · ${todayISO()}` },
  ], { x: 0.8, y: 4.05, w: 7.1, h: 1.15, fontFace: PF, fontSize: 12, color: C_SUB, valign: 'top', margin: 0 })
  cv.addText('Each page: ① Part Report registration (highlighted row = this part)  ·  ② Drawing (16x/17x parts, sheet 1)  ·  ③ Actual part used (purchase slip, highlighted row = this part)  ·  Verification to be completed by Quality.',
    { x: 0.8, y: 6.55, w: 11.7, h: 0.35, fontFace: PF, fontSize: 10, color: C_MUT, margin: 0 })

  onProgress?.(done, rows.length, 'PPT 파일로 묶는 중')
  await tick()
  const blob = await pptx.write({ outputType: 'blob' })
  return { blob, size: blob.size, slides: done + 1, done, stopped, noRec, dwg }
}

export const pptName = (rep) => `FAI_Material_Verification_${rep.top.pn}_Rev${rep.top.rev}_${todayISO().replace(/-/g, '')}.pptx`
const PPT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

// 저장 위치 고르기 — 버튼을 누른 그 순간에 불러야 한다(브라우저 규칙). 만들기 전에 먼저 묻는다.
//   반환: FileSystemFileHandle | 'download'(고르기 창이 없는 브라우저) | null(취소)
export async function pickSaveTarget(name) {
  if (typeof window === 'undefined' || typeof window.showSaveFilePicker !== 'function') return 'download'
  try {
    return await window.showSaveFilePicker({
      suggestedName: name, id: 'pm-fai-ppt', startIn: 'documents',
      types: [{ description: 'PowerPoint', accept: { [PPT_TYPE]: ['.pptx'] } }],
    })
  } catch (e) {
    if (e && e.name === 'AbortError') return null
    return 'download'
  }
}
export async function saveBytes(target, blob, name) {
  if (target && target !== 'download') {
    const w = await target.createWritable()
    await w.write(blob)
    await w.close()
    return target.name || name
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name; document.body.appendChild(a); a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 4000)
  return name
}

