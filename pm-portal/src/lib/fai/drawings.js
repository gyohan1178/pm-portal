import { normAx, normMpn } from './partReport'

// 도면 폴더 — FAI Navigator v3.2 의 도면 연결을 옮김
//
//   PC 의 도면 폴더(Windchill 에서 받은 PDF)를 연결하면 16·17번대 품목에 도면 1장을 붙인다.
//   파일은 서버에 올리지 않는다 (Supabase 저장공간 한도). 이 PC 브라우저가 폴더 위치만 기억한다.
//   파일명 예: 110041810_H_0_REL.pdf / 110211211_DRW_E_5_REL.pdf / 110041810_H_0_REL_converted.pdf

export const isDwgPart = (P) => /^1[67]/.test(P.pn) // 16번대(하네스)·17번대(가공품)만

const stripExt = (n) => String(n ?? '').normalize('NFC').trim().replace(/\.(pdf)$/i, '').toUpperCase()
const normName = (n) => stripExt(n).replace(/[\s_\-()[\].,#~+=·]+/g, '')
// 성적서·밀시트 같은 첨부는 도면으로 보지 않는다
const notDrawing = (extra) => /성적|검사|INSP|MILL|밀시트|COC|CERT/i.test(extra || '')

export function parseDwgName(name) {
  const u = stripExt(name).replace(/\s+/g, '_')
  const m = u.match(/^(.+?)_+(DRW_+)?([A-Z]{1,2}|-)_+(\d+)(?:_+(REL|RELEASED|INWORK|INW|UNDERREVIEW|RES|OBS))?(.*)$/)
  if (!m) return null
  const extra = m[6].replace(/^[_\s\-.()]+/, '').trim()
  return { pn: normAx(m[1]), drw: !!m[2], rev: m[3], iter: +m[4], state: m[5] || '', extra, base: normName(u.slice(0, u.length - m[6].length)) }
}
const revRank = (r) => (r === '-' ? 0 : r.length === 1 ? r.charCodeAt(0) - 64 : 26 + (r.charCodeAt(0) - 64) * 26 + (r.charCodeAt(1) - 64))

// files: [{ name, path, h(FileSystemFileHandle) | file(File) }]
export function indexDwg(files, name = '') {
  const idx = { name, count: 0, byPn: new Map(), byLead: new Map() }
  for (const f of files) {
    if (!/\.pdf$/i.test(f.name) || /REF_?ONLY/i.test(f.name)) continue
    idx.count++
    const d = parseDwgName(f.name)
    if (!d) { // 리비전 표기 없는 이름: 맨 앞 번호로 묶는다 (160022038.pdf, 160022038 도면.pdf)
      const lead = normAx((stripExt(f.name).match(/^[A-Z0-9-]+/) || [''])[0].replace(/-+$/, ''))
      if (lead) {
        if (!idx.byLead.has(lead)) idx.byLead.set(lead, [])
        idx.byLead.get(lead).push({ f, rev: '', iter: 0, extra: stripExt(f.name).slice(lead.length).replace(/^[_\s\-.()]+/, ''), base: normName(f.name) })
      }
      continue
    }
    if (!idx.byPn.has(d.pn)) idx.byPn.set(d.pn, [])
    idx.byPn.get(d.pn).push({ f, ...d })
  }
  return idx
}

// 품목에 붙일 도면 1개 — ① Part Report 에 적힌 파일명과 같은 것 → ② 같은 리비전 → ③ 다른 리비전(⚠)
//   같은 단계에서는 원본(_converted 같은 꼬리 없는 것) 우선, 높은 리비전·이터레이션 우선
export function pickDwg(P, idx) {
  if (!idx) return null
  let want = (P.dwgDocs || []).slice()
  if (!want.some((w) => w.drw)) want = want.concat(P.cpsDocs || []) // DRW 가 없으면 품번과 같은 번호의 PDF
  const wantBase = new Set(want.map((w) => normName(w.file)))
  const wantRev = want.length ? String(want[0].ver || '').split('.')[0] : ''
  let cands = (idx.byPn.get(normAx(P.pn)) || []).slice()
  const drw = cands.filter((c) => c.drw)
  if (drw.length) cands = drw
  if (!cands.length) cands = (idx.byLead.get(normAx(P.pn)) || []).filter((c) => !notDrawing(c.extra))
  if (!cands.length) return want.length ? { status: 'missing', want: want[0].ver, wantFile: want[0].file } : { status: 'none' }
  const tier = (c) => (wantBase.has(c.base) ? 0 : wantRev && c.rev === wantRev ? 1 : 2)
  cands.sort((a, b) => tier(a) - tier(b) || (!!a.extra - !!b.extra) || revRank(b.rev || '-') - revRank(a.rev || '-') || b.iter - a.iter)
  const c = cands[0], t = tier(c)
  return {
    file: c.f, got: c.rev ? `${c.rev}.${c.iter}` : '', want: want.length ? want[0].ver : '',
    status: !want.length ? 'nodoc' : t === 0 ? 'exact' : t === 1 ? 'rev' : 'mismatch',
  }
}

/* ---- 폴더 훑기 (하위 폴더 포함, 이름만) ---- */
export async function walkDir(dh, onProgress) {
  const out = []; let seen = 0, last = 0
  const walk = async (d, path) => {
    const subs = []
    for await (const [name, h] of d.entries()) {
      if (h.kind === 'file') { seen++; if (/\.pdf$/i.test(name)) out.push({ name, path: path + '/' + name, h }) }
      else subs.push(walk(h, path + '/' + name))
      if (seen - last >= 500) { last = seen; onProgress?.(seen, out.length) }
    }
    await Promise.all(subs)
  }
  await walk(dh, dh.name)
  return out
}

/* ---- 지난 폴더 기억 (IndexedDB — 폴더 위치만, 파일 내용은 저장 안 함) ---- */
const DB = 'pm_fai', ST = 'handles'
function idb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open(DB, 1)
    q.onupgradeneeded = () => q.result.createObjectStore(ST)
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error)
  })
}
export async function saveHandle(key, h) {
  const db = await idb()
  await new Promise((res, rej) => { const t = db.transaction(ST, 'readwrite'); t.objectStore(ST).put(h, key); t.oncomplete = res; t.onerror = () => rej(t.error) })
}
export async function loadHandle(key) {
  const db = await idb()
  return new Promise((res) => { const q = db.transaction(ST).objectStore(ST).get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null) })
}

/* ---- 도면 1쪽 그리기 (품번이 나오는 곳 형광) ---- */
let pdfjsP = null
async function pdfjs() {
  if (!pdfjsP) {
    pdfjsP = (async () => {
      const lib = await import('pdfjs-dist')
      const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      lib.GlobalWorkerOptions.workerSrc = worker
      return lib
    })()
  }
  return pdfjsP
}
// entry: indexDwg 의 f ({ name, h } 또는 { name, file }). 반환 { canvas, w, h } 또는 { err }
export async function renderDrawing(entry, tokens) {
  try {
    const lib = await pdfjs()
    const file = entry.file || await entry.h.getFile()
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise
    try {
      const pg = await doc.getPage(1)
      const base = pg.getViewport({ scale: 1 })
      const vp = pg.getViewport({ scale: Math.min(2, 1400 / Math.max(base.width, base.height)) })
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height)
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
      await pg.render({ canvasContext: ctx, viewport: vp }).promise
      const toks = (tokens || []).map(normMpn).filter((t) => t.length >= 4)
      if (toks.length) {
        const tc = await pg.getTextContent()
        for (const it of tc.items) {
          const n = normMpn(it.str)
          if (!n || !toks.some((t) => n.includes(t))) continue
          const fh = Math.hypot(it.transform[2], it.transform[3]) || 10
          const [x1, y1, x2, y2] = vp.convertToViewportRectangle([it.transform[4], it.transform[5] - fh * 0.25, it.transform[4] + it.width, it.transform[5] + fh * 0.95])
          const top = Math.min(y1, y2), hh = Math.abs(y2 - y1)
          ctx.fillStyle = 'rgba(255,230,0,.33)'; ctx.fillRect(0, top - 2, c.width, hh + 4)
          ctx.strokeStyle = '#e0505f'; ctx.lineWidth = 3
          ctx.strokeRect(Math.min(x1, x2) - 4, top - 4, Math.abs(x2 - x1) + 8, hh + 8)
        }
      }
      const out = { data: c.toDataURL('image/jpeg', 0.72), w: c.width, h: c.height }
      c.width = c.height = 0   // 캔버스 메모리 즉시 반납
      return out
    } finally { doc.destroy() }
  } catch (e) {
    return { err: e?.message || String(e) }
  }
}
