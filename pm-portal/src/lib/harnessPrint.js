import QRCode from 'qrcode'
import { supabase } from './supabase'

// 하네스 작업지시서 · 도면 출력 (v4.230.0) — 하네스 공정관리 「작업지시서 QR → AXCELIS」 를 포털로 옮김
//   공정관리(v7.28)와 같은 규칙:
//   · 작업지시서(OCR) 파일명 도번_REV.pdf (· 도번_PO_… 도 됨) — PO 의 SREV 와 같은 것을 먼저, PO 가 파일명에 있으면 그것
//   · 도면(Conversion) 파일명 도번_REV[_판] — REV 가 맞는 것, 없으면 최신판
//   · REV 가 PO · 지시서 · 도면 사이에 다르면 기본으로 빼 둔다
//   · 작업지시서에 공정 QR (오른쪽 위 · 높이 20%) · 도면은 A4 로 맞추고 회전만 바로 세움 (QR 없음)
//   · QR 글자 = DWG · CUST · PROJ · REV · UNIT · QTY · PO · OL · DL · DUE · OID — 현장 폰은 OID 로 건을 찾는다
//   · 만든 뒤 harness_orders 에 건 등록(없으면) + qr_printed · harness_qr_history 기록 (공정관리와 같은 칸)
//   폴더는 브라우저 폴더 접근(File System Access)으로 한 번 고르면 IndexedDB 에 기억 — 새 창에선 「허용」 한 번

export const MM2PT = 72 / 25.4
const A4_LONG = 297 * MM2PT, A4_SHORT = 210 * MM2PT
const BAND = 10 * MM2PT
const CCN_LEAD_DAYS = 7

let _pdfLib = null
async function pdfLib() { if (!_pdfLib) _pdfLib = await import('pdf-lib'); return _pdfLib }

// ── 파일명 → 도번 · REV ──
const DQ_FNAME = /^(\d{6,10})[_-]([A-Za-z]{1,2})(?:[_-](\d{1,2}))?$/
export function dwgKeysOf(stem) {
  const out = [], m = DQ_FNAME.exec(stem)
  if (m) { out.push({ dwg: m[1], rev: m[2].toUpperCase(), ed: parseInt(m[3] || '0', 10) }); return out }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{3,}$/.test(stem)) return out
  out.push({ dwg: stem, rev: '', ed: 0 })
  const g = /^(.+?)[_]([A-Za-z0-9]{1,3})(?:[_-](\d{1,2}))?$/.exec(stem)
  if (g && g[1].length >= 4) out.push({ dwg: g[1], rev: g[2].toUpperCase(), ed: parseInt(g[3] || '0', 10) })
  return out
}
export const revKey = (r) => { r = String(r || '').trim().toUpperCase(); return /^\d+$/.test(r) ? String(parseInt(r, 10)) : r }
function revRank(r) {
  r = String(r || '').trim().toUpperCase()
  if (/^\d+$/.test(r)) return parseInt(r, 10)
  let n = 0; for (let i = 0; i < r.length; i++) n = n * 26 + (r.charCodeAt(i) - 64); return n
}
const flat = (v) => String(v || '').replace(/[\s_-]/g, '').toUpperCase()

// ── 폴더 기억 (IndexedDB) ──
const DB = 'pm-harness-print', STORE = 'dirs'
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  })
}
export async function loadDir(key) {
  try { const d = await idb(); return await new Promise((res) => { const q = d.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null) }) } catch { return null }
}
export async function saveDir(key, h) {
  try { const d = await idb(); await new Promise((res) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(h, key); t.oncomplete = res; t.onerror = res }) } catch { /* 기억 못 해도 이번엔 쓴다 */ }
}
export const canPickDir = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window
export async function dirPermission(h, ask = false) {
  if (!h?.queryPermission) return 'denied'
  let s = await h.queryPermission({ mode: 'read' })
  if (s !== 'granted' && ask) s = await h.requestPermission({ mode: 'read' })
  return s
}
// 폴더 안 PDF 를 훑는다 (하위 폴더 3단까지)
export async function listPdfs(h, depth = 0, out = []) {
  for await (const [name, e] of h.entries()) {
    if (e.kind === 'directory') { if (depth < 3) await listPdfs(e, depth + 1, out) }
    else if (/\.pdf$/i.test(name) && !/^~\$/.test(name)) out.push({ name, get: () => e.getFile() })
  }
  return out
}
// <input webkitdirectory> 로 고른 파일 (폴더 접근이 안 되는 브라우저)
export const listFromInput = (files) => [...files].filter((f) => /\.pdf$/i.test(f.name) && !/^~\$/.test(f.name)).map((f) => ({ name: f.name, get: async () => f }))

export function indexFiles(list) {
  const idx = {}
  list.forEach((f) => {
    const stem = f.name.replace(/\.pdf$/i, '').trim()
    let ks = dwgKeysOf(stem)
    if (!ks.length) ks = [{ dwg: stem.split('_')[0], rev: '', ed: 0 }]
    const seen = {}
    ks.forEach((k) => { if (seen[k.dwg]) return; seen[k.dwg] = 1; (idx[k.dwg] ||= []).push({ ...f, stem, rev: k.rev, ed: k.ed }) })
  })
  return idx
}

// ── 한 건 맞추기 ──
export function findOcr(idx, o) {
  const c = idx?.[o.dwg_no] || []
  if (!c.length) return null
  const pr = String(o.rev || '').toUpperCase()
  let pool = pr ? c.filter((x) => revKey(x.rev) === revKey(pr)) : []
  if (!pool.length) pool = c
  return pool.find((x) => { const s = x.stem.split('_'); return s.length >= 2 && flat(s[1]) === flat(o.po) }) || pool[0]
}
export function findDwg(idx, o) {
  const c = idx?.[o.dwg_no] || []
  if (!c.length) return null
  const rv = String(o.rev || '').toUpperCase()
  if (rv) {
    const same = c.filter((x) => revKey(x.rev) === revKey(rv))
    if (same.length) return same.reduce((a, x) => (x.ed > a.ed ? x : a))
  }
  return c.reduce((a, x) => { const ra = revRank(a.rev), rx = revRank(x.rev); if (rx !== ra) return rx > ra ? x : a; return x.ed > a.ed ? x : a })
}
// PO · 작업지시서 · 도면 REV 대조 — 공정관리와 같은 판정
export function judge(o, ocr, dwg) {
  const pr = revKey(o.rev), wr = ocr ? revKey(ocr.rev) : '', dr = dwg ? revKey(dwg.rev) : ''
  let bad = false
  if (ocr) {
    if (pr) { if (wr && wr !== pr) bad = true; if (dr && dr !== pr) bad = true }
    else if (wr && dr && wr !== dr) bad = true
  }
  const status = !ocr ? 'noOcr' : bad ? 'rev' : 'ok'
  return { status, pr: o.rev || '', wr: ocr ? (ocr.rev || '?') : '', dr: dwg ? (dwg.rev || '?') : '' }
}

// ── QR 글자 (공정관리 woPayload 와 같은 순서) ──
export function woPayload(o) {
  const f = ['DWG:' + (o.dwg_no || '')]
  if (o.customer) f.push('CUST:' + o.customer)
  if (o.project) f.push('PROJ:' + o.project)
  if (o.rev) f.push('REV:' + o.rev)
  if (o.unit) f.push('UNIT:' + o.unit)
  f.push('QTY:' + (o.qty || 1))
  if (o.po) f.push('PO:' + o.po)
  if (o.ord_ln) f.push('OL:' + o.ord_ln)
  if (o.del_ln) f.push('DL:' + o.del_ln)
  if (o.due) f.push('DUE:' + o.due)
  if (o.id) f.push('OID:' + o.id)
  return f.join(' | ')
}
export const hsGenId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

// 머릿말 · 꼬리말 글자 — 공정관리와 같은 꼬리표
function ccnDue(o) {
  const iso = o.due || ''
  if (!iso || String(o.ccn || '').trim().toUpperCase() !== 'B') return iso
  const d = new Date(iso + 'T00:00:00'); if (isNaN(d)) return iso
  d.setDate(d.getDate() - CCN_LEAD_DAYS)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function fillTokens(t, o, pg, total) {
  return String(t || '')
    .replace(/\{프로젝트\}/g, o.project || '').replace(/\{도번\}/g, o.dwg_no || '').replace(/\{REV\}/gi, o.rev || '')
    .replace(/\{고객사\}/g, o.customer || '').replace(/\{불출일\}/g, o.release_date || '').replace(/\{PO\}/gi, o.po || '')
    .replace(/\{오더라인\}/g, o.ord_ln || '').replace(/\{납품라인\}/g, o.del_ln || '').replace(/\{호기\}/g, o.unit || '')
    .replace(/\{수량\}/g, o.qty != null ? o.qty : '').replace(/\{CCN\}/gi, o.ccn || '').replace(/\{납기일?\}/g, ccnDue(o))
    .replace(/\{페이지\}/g, pg == null ? '' : pg).replace(/\{전체\}/g, total == null ? '' : total)
    .replace(/\s+/g, ' ').trim()
}
// 한글이 들어가므로 글자를 그림으로 그려 넣는다 (공정관리와 같은 방식)
function bandPng(parts, pw) {
  const S = 3, W = Math.round(pw * S), H = Math.round(BAND * S)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const ctx = cv.getContext('2d')
  ctx.fillStyle = 'rgba(255,255,255,0.94)'; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#111827'; ctx.textBaseline = 'middle'
  ctx.font = `700 ${Math.round(H * 0.42)}px 'Malgun Gothic','Noto Sans KR',sans-serif`
  const pad = Math.round(8 * MM2PT * S)
  if (parts.l) { ctx.textAlign = 'left'; ctx.fillText(parts.l, pad, H / 2) }
  if (parts.c) { ctx.textAlign = 'center'; ctx.fillText(parts.c, W / 2, H / 2) }
  if (parts.r) { ctx.textAlign = 'right'; ctx.fillText(parts.r, W - pad, H / 2) }
  return cv.toDataURL('image/png')
}
const dataBytes = (url) => Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0))
const hfParts = (hf, o, pg, total) => ({ l: fillTokens(hf.l, o, pg, total), c: fillTokens(hf.c, o, pg, total), r: fillTokens(hf.r, o, pg, total) })
const hfAny = (p) => !!(p.l || p.c || p.r)

async function drawBands(out, pg, o, no, total, hf) {
  const pw = pg.getWidth(), ph = pg.getHeight()
  for (const [k, top] of [['header', true], ['footer', false]]) {
    const h = hf[k]; if (!h?.on) continue
    const p = hfParts(h, o, no, total); if (!hfAny(p)) continue
    const img = await out.embedPng(dataBytes(bandPng(p, pw)))
    pg.drawImage(img, { x: 0, y: top ? ph - BAND : 0, width: pw, height: BAND })
  }
}

// 작업지시서 — 쪽마다 공정 QR (오른쪽 위, 높이의 20%)
async function addWo(out, bytes, o, qrPng, from, total, hf) {
  const { PDFDocument } = await pdfLib()
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const pages = await out.copyPages(src, src.getPageIndices())
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i]; out.addPage(pg)
    const pw = pg.getWidth(), ph = pg.getHeight(), qs = ph * 0.20
    pg.drawImage(qrPng, { x: pw * 0.850 - qs / 2, y: ph * 0.281 - qs / 2 + ph * 0.01, width: qs, height: qs })
    await drawBands(out, pg, o, from + i, total, hf)
  }
  return pages.length
}
// 도면 — A4 로 맞추고, 회전 속성(/Rotate)을 살려 바로 세움 · 위아래 띠 자리를 뺀 곳에 비율 그대로
async function addDwg(out, bytes, o, from, total, hf) {
  const { PDFDocument, degrees } = await pdfLib()
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const topB = hf.header?.on ? BAND : 0, botB = hf.footer?.on ? BAND : 0
  const idxs = src.getPageIndices()
  for (let i = 0; i < idxs.length; i++) {
    const sp = src.getPage(idxs[i])
    const sw = sp.getWidth(), sh = sp.getHeight()
    let rot = 0; try { rot = ((sp.getRotation().angle % 360) + 360) % 360 } catch { /* 회전 없음 */ }
    const turned = rot === 90 || rot === 270
    const vw = turned ? sh : sw, vh = turned ? sw : sh
    const emb = await out.embedPage(sp)
    const land = vw >= vh, pw = land ? A4_LONG : A4_SHORT, ph = land ? A4_SHORT : A4_LONG
    const pg = out.addPage([pw, ph])
    const padX = 3 * MM2PT, boxW = Math.max(1, pw - padX * 2), boxH = Math.max(1, ph - topB - botB)
    const sc = Math.min(boxW / vw, boxH / vh), dw = vw * sc, dh = vh * sc
    const dx = (pw - dw) / 2, dy = botB + (boxH - dh) / 2
    if (rot === 90) pg.drawPage(emb, { x: dx, y: dy + dh, xScale: sc, yScale: sc, rotate: degrees(-90) })
    else if (rot === 180) pg.drawPage(emb, { x: dx + dw, y: dy + dh, xScale: sc, yScale: sc, rotate: degrees(180) })
    else if (rot === 270) pg.drawPage(emb, { x: dx + dw, y: dy, xScale: sc, yScale: sc, rotate: degrees(90) })
    else pg.drawPage(emb, { x: dx, y: dy, xScale: sc, yScale: sc })
    await drawBands(out, pg, o, from + i, total, hf)
  }
  return idxs.length
}

// targets: [{ order, ocr, dwg }] · rec: { wo, dwg, first } · hf: { header, footer }
//   한 건 = [작업지시서 × 부수] + [도면 × 부수] — 쪽번호는 건마다 1부터
export async function buildPdf(targets, rec, hf, onStep) {
  const { PDFDocument } = await pdfLib()
  const out = await PDFDocument.create()
  let pages = 0
  for (let ti = 0; ti < targets.length; ti++) {
    const t = targets[ti]
    onStep?.(ti, targets.length)
    const woBytes = t.ocr && rec.wo > 0 ? new Uint8Array(await (await t.ocr.get()).arrayBuffer()) : null
    const dwBytes = t.dwg && rec.dwg > 0 ? new Uint8Array(await (await t.dwg.get()).arrayBuffer()) : null
    const cnt = async (b) => (await PDFDocument.load(b, { ignoreEncryption: true })).getPageCount()
    const woN = woBytes ? await cnt(woBytes) : 0, dwN = dwBytes ? await cnt(dwBytes) : 0
    const total = woN * (woBytes ? rec.wo : 0) + dwN * (dwBytes ? rec.dwg : 0)
    const qrPng = woBytes ? await out.embedPng(dataBytes(await QRCode.toDataURL(woPayload(t.order), { errorCorrectionLevel: 'M', margin: 2, width: 500 }))) : null
    let no = 1
    const woPart = async () => { if (woBytes) for (let c = 0; c < rec.wo; c++) no += await addWo(out, woBytes, t.order, qrPng, no, total, hf) }
    const dwPart = async () => { if (dwBytes) for (let c = 0; c < rec.dwg; c++) no += await addDwg(out, dwBytes, t.order, no, total, hf) }
    if (rec.first === 'dwg') { await dwPart(); await woPart() } else { await woPart(); await dwPart() }
    t.pages = no - 1; pages += t.pages
  }
  const bytes = await out.save()
  return { blob: new Blob([bytes], { type: 'application/pdf' }), pages }
}

// ── 공정관리에 기록 ──
//   있는 건(도번 + PO + 오더라인 + 납품라인)은 그 건을 쓰고 출력 표시만, 없으면 새로 등록
export function existingOrder(horders, o) {
  return (horders || []).find((h) => (h.dwg_no || '') === o.dwg_no && (h.po || '') === o.po
    && (h.ord_ln || '') === o.ord_ln && (h.del_ln || '') === o.del_ln) || null
}
export async function recordPrinted(targets, me, fileName) {
  const now = new Date().toISOString()
  const who = me?.name || me?.username || '', mail = me?.email || ''
  const fresh = targets.filter((t) => t.isNew).map((t) => ({
    id: t.order.id, dwg_no: t.order.dwg_no, customer: t.order.customer, project: t.order.project || null, unit: t.order.unit || null,
    qty: t.order.qty || 1, created_at: now, po: t.order.po || null, ord_ln: t.order.ord_ln || null, del_ln: t.order.del_ln || null,
    due: t.order.due || null, step_type: 'A', manually_done: false, qr_printed: true, qr_printed_at: now, rev: t.order.rev || null,
    item_name: t.order.item_name || null, release_date: t.order.release_date || null, ccn: t.order.ccn || null,
    created_by: who || null, created_by_email: mail || null, created_via: 'JS포털 출력',
  }))
  for (let i = 0; i < fresh.length; i += 200) {
    const { error } = await supabase.from('harness_orders').insert(fresh.slice(i, i + 200))
    if (error) throw new Error('공정관리 건 등록 실패: ' + error.message)
  }
  const old = targets.filter((t) => !t.isNew).map((t) => t.order.id)
  for (let i = 0; i < old.length; i += 200) {
    const { error } = await supabase.from('harness_orders').update({ qr_printed: true, qr_printed_at: now }).in('id', old.slice(i, i + 200))
    if (error) throw new Error('공정관리 출력 표시 실패: ' + error.message)
  }
  const hist = targets.map((t, i) => ({
    id: `qrh_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`, ts: now,
    dwg_no: t.order.dwg_no, customer: t.order.customer, project: t.order.project || '', unit: t.order.unit || '',
    po: t.order.po || '', qty: t.order.qty || 1, qr_size: 0, file_name: fileName,
    ord_ln: t.order.ord_ln || '', del_ln: t.order.del_ln || '', rev: t.order.rev || '', pages: t.pages || null,
    issued_by: who, issued_email: mail, kind: '도면 출도', customer_tab: 'AXCELIS (JS포털)', deleted: false,
  }))
  const { error: he } = await supabase.from('harness_qr_history').insert(hist)
  if (he) throw new Error('출력 이력 기록 실패: ' + he.message)
  return { added: fresh.length, marked: old.length }
}

// ── Edwards — 도면만 (v4.231.0) ──
//   도면 조회와 같은 자료(pm_drawings · 스캐너가 NAS 를 읽어 실은 것)로 파일 경로를 안다 → 폴더를 훑지 않고 그 경로만 연다
//   ⚠ 지금은 PDF 만 — 실제 담당자가 따로 출도하고 있어 공정관리 기록 · QR 은 확인 뒤 켠다
export async function fetchDwgRecords(codes) {
  const out = []
  for (let i = 0; i < codes.length; i += 150) {
    const { data, error } = await supabase.from('pm_drawings')
      .select('std_code, rev, edition, rev_order, file_name, file_path, is_latest, missing_since, is_conv')
      .in('std_code', codes.slice(i, i + 150)).is('missing_since', null)
    if (error) throw new Error('도면 목록 읽기 실패: ' + error.message)
    out.push(...(data || []))
  }
  return out
}
// 한 품번에 쓸 도면 — PO REV 와 같은 것 우선, 없으면 최신. 컨버팅(사내 작업용)이 있으면 그것
export function pickDwgRecord(recs, rev) {
  if (!recs?.length) return null
  const rv = revKey(rev)
  const pool = (rv && recs.filter((r) => revKey(r.rev) === rv).length) ? recs.filter((r) => revKey(r.rev) === rv) : recs.filter((r) => r.is_latest).length ? recs.filter((r) => r.is_latest) : recs
  return [...pool].sort((a, b) => (b.is_conv ? 1 : 0) - (a.is_conv ? 1 : 0) || (b.rev_order || 0) - (a.rev_order || 0))[0]
}
// 경로들의 공통 앞부분 — 「이 폴더를 연결하세요」 안내용
export function commonDir(paths) {
  const segs = paths.filter(Boolean).map((p) => String(p).split('\\').slice(0, -1))
  if (!segs.length) return ''
  const first = segs[0]; let n = first.length
  segs.forEach((s) => { let i = 0; while (i < n && i < s.length && s[i] === first[i]) i++; n = i })
  return first.slice(0, n).join('\\')
}
// 연결한 폴더(root) 안에서 NAS 경로의 파일을 찾는다 — 경로에서 root 이름이 나오는 곳 뒤부터 따라 내려간다
export async function fileByPath(root, path) {
  const seg = String(path || '').split('\\').filter(Boolean)
  const at = seg.lastIndexOf(root.name)
  if (at < 0) return null
  let h = root
  try {
    for (const d of seg.slice(at + 1, -1)) h = await h.getDirectoryHandle(d)
    const fh = await h.getFileHandle(seg[seg.length - 1])
    return { name: seg[seg.length - 1], get: () => fh.getFile() }
  } catch { return null }
}
