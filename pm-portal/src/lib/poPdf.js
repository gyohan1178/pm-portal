// 고객 발주서 PDF 읽기 (수주대장 · v4.87.0)
//
//   PDF 글자를 줄로 모아(같은 높이 = 한 줄, 칸 사이가 넓으면 ' | ') 양식별 규칙으로 품목 줄을 뽑는다.
//   스캔본(글자 없는 그림 PDF)은 못 읽는다 → 「모르는 양식」 알림.
//
//   양식 5가지 (2026-10 실제 발주서 13개로 확인)
//     AX   AXCELIS Purchase Order (원화 CCN K · 달러 CCN B) — 라인 · 분할 납기(SEQ) · Rev
//     SAP  Atlas Copco SAP 발주서 (Edwards · CSK 같이 씀) — Material Number · Drawing/Material Revision
//     LN   Atlas Copco Lasernet 발주서 (Edwards · CSK) — Non-inventory Item 이면 품번 없음
//     JIT  Edwards JIT(Kanban) 발주서
//     VM   브이엠 구매발주서 — 품번_Rev.N
//
//   고객사는 양식이 아니라 발행 회사 사업자등록번호로 정한다 (Edwards · CSK 는 양식도 담당 메일도 섞여 있다).

const num = (s) => {
  if (s == null || s === '') return null
  const v = Number(String(s).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(v) && /\d/.test(String(s)) ? v : null
}
const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 }
const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y < 100 ? 2000 + +y : y}-${pad(m)}-${pad(d)}` : null)
const dUS = (s) => { const m = String(s ?? '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); return m ? iso(+m[3], +m[1], +m[2]) : null }   // 12/30/2026
const dEU = (s) => { const m = String(s ?? '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/); return m ? iso(+m[3], +m[2], +m[1]) : null }    // 24.11.2026
const dMON = (s) => { const m = String(s ?? '').match(/(\d{1,2})-([A-Z]{3})-(\d{2,4})/i); return m ? iso(+m[3], MON[m[2].toUpperCase()], +m[1]) : null } // 13-OCT-26
const dYMD = (s) => { const m = String(s ?? '').match(/(20\d{2})(\d{2})(\d{2})/); return m ? iso(+m[1], +m[2], +m[3]) : null }         // 20261029
const cells = (t) => t.split(' | ').map((c) => c.trim())
const lastCell = (t) => (t ? t.split(' | ').pop().trim() : '')

// ── PDF → 줄 ────────────────────────────────────────────────
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

// doc(pdfjs 문서) → [{ p: 쪽, t: '칸 | 칸 | …' }]
export async function linesOfDoc(doc) {
  const out = []
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent()
    const rows = []
    tc.items.filter((i) => i.str && i.str.trim()).forEach((i) => {
      const y = i.transform[5], x = i.transform[4]
      let r = rows.find((r) => Math.abs(r.y - y) < 2.5)
      if (!r) rows.push((r = { y, its: [] }))
      r.its.push({ x, s: i.str, w: i.width })
    })
    rows.sort((a, b) => b.y - a.y).forEach((r) => {
      r.its.sort((a, b) => a.x - b.x)
      let t = '', end = null
      r.its.forEach((i) => { if (end != null) t += i.x - end > 6 ? ' | ' : i.x - end > 1 ? ' ' : ''; t += i.s; end = i.x + i.w })
      out.push({ p, t: t.trim() })
    })
  }
  return out
}

export async function pdfLines(file) {
  const lib = await pdfjs()
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await lib.getDocument({ data, verbosity: 0 }).promise
  try { return await linesOfDoc(doc) } finally { doc.destroy?.() }
}

// ── 양식 · 고객사 판별 ───────────────────────────────────────
export function detect(L) {
  const all = L.map((l) => l.t).join('\n')
  if (/AXCELIS TECHNOLOGIES/i.test(all)) return 'AX'
  if (/구 ?매 ?발 ?주 ?서/.test(all) && /PO\d{10}/.test(all)) return 'VM'
  if (/JIT order/.test(all)) return 'JIT'
  if (/Line No\. \| Material Number/.test(all)) return 'SAP'
  if (/일련번호 \| 품목번호 \| 품명/.test(all)) return 'LN'
  return null
}
export const FORMAT_LABEL = { AX: 'AXCELIS 발주서', SAP: 'SAP 발주서', LN: '일반 발주서', JIT: 'JIT 발주서', VM: 'VM 구매발주서' }

// 사업자등록번호 → 고객사 코드 (수주대장 · 판매입력 거래처와 같은 기준)
export const BIZ_NO = { '312-81-12960': 'ED', '129-81-23036': 'CSK' }
export function customerOf(L, kind) {
  if (kind === 'AX') return 'AX'
  if (kind === 'VM') return 'VM'
  const all = L.map((l) => l.t).join('\n')
  const hit = Object.keys(BIZ_NO).filter((b) => all.includes(b))
  return hit.length === 1 ? BIZ_NO[hit[0]] : null
}

// AXCELIS 구분 — PO 파일 업로드와 같은 규칙 (11 = 전장, 16 = 하네스, 그 밖 = 구매품)
export const axDivision = (pn) => (String(pn).startsWith('16') ? '하네스' : String(pn).startsWith('11') ? '전장' : '구매품')

// ── 양식별 읽기 ──────────────────────────────────────────────
//   공통 줄 모양: { line_no, del_line, pn, rev, desc, spec, qty, unit, price, due, division, delivered, note }

function parseAX(L) {
  const t = L.map((l) => l.t)
  const po_no = lastCell(t[t.findIndex((x) => /PURCHASE ORDER NO\./.test(x)) + 1])
  const ccn = (t.find((x) => /PAGE 1 of/.test(x)) || '').match(/\| ([A-Z]) \|/)?.[1] || null
  const order_date = dUS(t[t.findIndex((x) => /^ORDER DATE/.test(x)) + 1] || '')
  const items = []
  let cur = null, head = false
  t.forEach((x) => {
    if (/^po \(REV/.test(x)) { head = true; return }                 // 쪽 끝 — 다음 쪽 머리글은 건너뛴다 (줄은 이어짐)
    if (head) { if (/^V \| X \| SEQ/.test(x)) head = false; return }
    const c = cells(x).filter((v) => v !== '.')
    if (/^\d{4}$/.test(c[0]) && c[3] && /^[A-Z]{2}$/.test(c[3])) {
      const hasRev = /^[A-Z]{1,2}$/.test(c[5] || '') && c.length >= 8
      const ext = hasRev ? c[7] : c[6]
      cur = { line_no: c[0], pn: c[4], rev: hasRev ? c[5] : null, desc: '', qty: num(c[1]), open: num(c[2]), unit: c[3], price: num(hasRev ? c[6] : c[5]), usd: /^\$/.test(ext || ''), splits: [] }
      items.push(cur); return
    }
    if (!cur) return
    if (/^\d{3}$/.test(c[0]) && dUS(c[1] || '')) { cur.splits.push({ seq: +c[0], due: dUS(c[1]), qty: num(c[2]), open: num(c[3]) }); return }
    if (c.length === 1 && /[A-Z]{3,}/.test(c[0]) && !/^(REFER|CCN|PAGE)/i.test(c[0]) && !cur.desc && !cur.splits.length) cur.desc = c[0]
  })
  // 분할(SEQ)마다 한 줄 — PO 파일의 Del Line 과 같은 번호. 이미 납품된 수량 = 주문 − 잔량
  const lines = []
  items.forEach((it) => {
    const sp = it.splits.length ? it.splits : [{ seq: 1, due: null, qty: it.qty, open: it.open }]
    sp.forEach((s) => lines.push({
      line_no: String(+it.line_no), del_line: String(s.seq), pn: it.pn, rev: it.rev, desc: it.desc, spec: '',
      qty: s.qty, unit: it.unit, price: it.price, due: s.due, division: axDivision(it.pn),
      delivered: s.qty != null && s.open != null ? Math.max(0, s.qty - s.open) : 0, note: '',
    }))
  })
  const splitWarn = items.filter((it) => it.splits.length && Math.abs(it.splits.reduce((a, b) => a + (b.qty || 0), 0) - (it.qty || 0)) > 0.001)
    .map((it) => `줄 ${it.line_no}: 분할 수량 합 ≠ 주문 ${it.qty}`)
  return { po_no, order_date, ccn, currency: items.some((i) => i.usd) ? 'USD' : 'KRW', total: null, lines, extraWarn: splitWarn }
}

function parseSAP(L) {
  const t = L.map((l) => l.t)
  const po_no = lastCell(t.find((x) => /발주번호 \|/.test(x)))
  const order_date = dEU(lastCell(t.find((x) => /발주일자 \|/.test(x))))
  const lines = []
  let cur = null
  t.forEach((x) => {
    const c = cells(x)
    if (/^\d{5}$/.test(c[0]) && dEU(c[5] || '')) {
      cur = { line_no: c[0], del_line: '1', pn: c[1], rev: null, desc: c[2], spec: '', qty: num(c[3]), unit: c[4], due: dEU(c[5]), price: num(c[6]), delivered: 0, note: '' }
      lines.push(cur); return
    }
    const mr = x.match(/^Material Revision:\s*(\S+)/)
    if (mr && cur) { cur.rev = mr[1]; return }
    const ms = x.match(/^Specifications?:\s*(.+)$/)
    if (ms && cur) { cur.spec = ms[1].trim(); return }
    const m = x.match(/^Drawing:\s*([^/]*)\/\s*([A-Z0-9]*)\s*\//)
    if (m && cur) { cur.rev = m[2] || null; if (m[1].trim() && m[1].trim() !== cur.pn) cur.note = `도면번호 ${m[1].trim()}` }
  })
  const tot = lastCell(t.find((x) => /^Total \/ 합계/.test(x)))
  const dueChanged = t.some((x) => /Due Date has been changed/.test(x))
  return { po_no, order_date, currency: 'KRW', total: num(tot), lines, dueChanged }
}

function parseLN(L) {
  const t = L.map((l) => l.t)
  const po_no = lastCell(t.find((x) => /(^|\| )발주번호 \|/.test(x)))
  const order_date = dMON(lastCell(t.find((x) => /발주일자 \|/.test(x))))
  const lines = []
  let cur = null
  t.forEach((x) => {
    const c = cells(x)
    if (/^\d{5}$/.test(c[0]) && dMON(c[5] || '')) {
      cur = { line_no: c[0], del_line: '1', pn: c[1] === 'Non-inventory Item' ? null : c[1], rev: null, desc: c[2], spec: '', qty: num(c[3]), unit: c[4], due: dMON(c[5]), price: num(c[6]), delivered: 0, note: '' }
      lines.push(cur); return
    }
    if (cur && c.length === 1 && /^[A-Z0-9][A-Z0-9-]{5,}$/i.test(c[0])) { cur.spec = c[0]; cur = null }
    if (/^=+$/.test(x)) cur = null
  })
  const tot = lastCell(t.find((x) => /TOTAL EXCLUDING TAX/.test(x)))
  return { po_no, order_date, currency: 'KRW', total: num(tot), lines }
}

function parseJIT(L) {
  const t = L.map((l) => l.t)
  const po_no = lastCell(t.find((x) => /JIT order number/.test(x)))
  const order_date = dEU(lastCell(t.find((x) => /Order Date/.test(x))))
  const due = dEU(lastCell(t.find((x) => /^Due Date/.test(x))))
  const lines = []
  let cur = null
  t.forEach((x) => {
    const c = cells(x)
    if (/^\d{4}$/.test(c[0]) && c[1] && /^[A-Z]{2,}\d/.test(c[1])) {
      cur = { line_no: c[0], del_line: '1', pn: c[1], rev: null, desc: '', spec: c[2] || '', qty: null, unit: '', price: null, due, delivered: 0, note: '' }
      lines.push(cur); return
    }
    if (cur && !cur.desc && c.length >= 5) {     // 품명 | ____ | Kanban 수량 | 단위 | 단가 | 기준수량 | 단위
      const iq = c.findIndex((v) => /^[\d,]+\.\d{3}$/.test(v))
      if (iq > 0) { cur.desc = c[0]; cur.qty = num(c[iq]); cur.unit = c[iq + 1]; const per = num(c[iq + 3]) || 1; const p = num(c[iq + 2]); cur.price = p == null ? null : p / per }
      return
    }
    const m = x.match(/^Drawing:\s*([^/]*)\/\s*([A-Z0-9]*)\s*\//)
    if (m && cur) { cur.rev = m[2] || null; cur = null }
  })
  const tot = (t.find((x) => /Total value/.test(x)) || '').match(/Total value \| ([\d,.]+)/)
  return { po_no, order_date, currency: 'KRW', total: tot ? num(tot[1]) : null, lines }
}

function parseVM(L) {
  const t = L.map((l) => l.t)
  const po_no = (t.join('\n').match(/PO\d{10}/) || [])[0] || null
  const due = dYMD(t.find((x) => /납품일자/.test(x)) || '')
  const lines = []
  t.forEach((x) => {
    const c = cells(x)
    if (/^\d{1,2}$/.test(c[0]) && c.length >= 5) {
      const m = (c[1] || '').match(/^(\S+?)_Rev\.?(\S+)\s+(.*)$/)
      const iQty = c.findIndex((v, i) => i >= 2 && /^[\d,]+$/.test(v))
      if (iQty < 0) return
      lines.push({
        line_no: c[0], del_line: '1', pn: m ? m[1] : c[1], rev: m ? m[2] : null, desc: m ? m[3] : '', spec: iQty > 2 ? c.slice(2, iQty).join(' ') : '',
        qty: num(c[iQty]), unit: '', price: num(c[iQty + 1]), due, delivered: 0, note: c.slice(iQty + 3).filter(Boolean).join(' · '),
      })
    }
  })
  const tot = lastCell(t.find((x) => /계 \( ?부가세별도\)/.test(x)))
  return { po_no, order_date: null, currency: 'KRW', total: num(tot), lines }
}

const PARSERS = { AX: parseAX, SAP: parseSAP, LN: parseLN, JIT: parseJIT, VM: parseVM }

// 줄 → 발주서 한 장 { kind, customer, po_no, order_date, currency, ccn, total, lines, dueChanged, warns }
export function parsePO(L) {
  const kind = detect(L)
  const P = PARSERS[kind]
  if (!P) { const r = { kind: null, customer: null, po_no: null, lines: [] }; return { ...r, warns: checkPO(r) } }
  const { extraWarn = [], ...r } = P(L)
  const out = { kind, ...r, customer: customerOf(L, kind) }
  out.warns = [...checkPO(out), ...extraWarn]
  return out
}

// 점검 — 하나라도 걸리면 「양식 확인 필요」
export function checkPO(r) {
  const w = []
  if (!r.kind) w.push('모르는 양식 — 등록된 발주서 양식과 맞지 않음 (스캔본이면 글자를 못 읽음)')
  else if (!r.lines.length) w.push(`${FORMAT_LABEL[r.kind]}으로 보이나 품목 줄을 하나도 못 읽음 — 양식이 바뀌었을 수 있음`)
  if (r.kind && !r.po_no) w.push('PO번호를 못 읽음')
  if (r.kind && !r.customer) w.push('고객사를 못 정함 — 사업자등록번호가 없거나 둘 다 찍힘')
  ;(r.lines || []).forEach((l) => {
    const miss = [!l.pn && !l.spec && !l.desc && '품번', !(l.qty > 0) && '수량', !(l.price > 0) && '단가', !l.due && '납기'].filter(Boolean)
    if (miss.length) w.push(`줄 ${l.line_no}${l.del_line && l.del_line !== '1' ? `/${l.del_line}` : ''}: ${miss.join('·')} 없음`)
  })
  if (r.total != null && r.lines?.length) {
    const s = r.lines.reduce((a, l) => a + (l.qty || 0) * (l.price || 0), 0)
    if (Math.abs(s - r.total) > 1) w.push(`합계 불일치 — 읽은 줄 합 ${Math.round(s).toLocaleString()} ≠ 발주서 합계 ${r.total.toLocaleString()} (빠진 줄이 있을 수 있음)`)
  }
  return w
}
