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
//     GEN  기타 업체 발주서 (v4.109.0) — 두웰 · 남일인스트루먼트처럼 4개 고객사 밖 업체. 정해진 양식이 없어
//          「수량 · 단가」 머리글이 있는 표를 찾아 칸 내용으로 읽는다 (수량 × 단가 = 금액 인 세 숫자).
//          고객사는 「기타」 + 발행 회사 이름. 적요 · Remarks 칸 → 줄 메모, 참고 사항 · 사용처 · 전달 사항 → 특이사항 메모
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
      // y · 칸마다 시작 x 도 같이 둔다 — 줄 사이에 낀 「적요」 같은 칸을 어느 품목 줄 것인지 위치로 정할 때 (v4.109.0)
      let t = '', end = null
      const xs = []
      r.its.forEach((i) => {
        const gap = end == null ? null : i.x - end
        if (gap != null) t += gap > 6 ? ' | ' : gap > 1 ? ' ' : ''
        if (gap == null || gap > 6) xs.push(Math.round(i.x))
        t += i.s; end = i.x + i.w
      })
      out.push({ p, t: t.trim(), y: Math.round(r.y * 10) / 10, xs })
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
  if (/발 ?주 ?서|purchase ?order/i.test(all) && genHead(L) >= 0) return 'GEN'     // 기타 업체 (v4.109.0)
  return null
}
export const FORMAT_LABEL = { AX: 'AXCELIS 발주서', SAP: 'SAP 발주서', LN: '일반 발주서', JIT: 'JIT 발주서', VM: 'VM 구매발주서', GEN: '기타 업체 발주서' }

// 사업자등록번호 → 고객사 코드 (수주대장 · 판매입력 거래처와 같은 기준)
export const BIZ_NO = { '312-81-12960': 'ED', '129-81-23036': 'CSK' }
export function customerOf(L, kind) {
  if (kind === 'AX') return 'AX'
  if (kind === 'VM') return 'VM'
  const all = L.map((l) => l.t).join('\n')
  const hit = Object.keys(BIZ_NO).filter((b) => all.includes(b))
  if (kind === 'GEN') return hit.length === 1 ? BIZ_NO[hit[0]] : 'ETC'     // 기타 업체 양식이어도 Edwards · CSK 사업자번호가 있으면 그 고객사
  return hit.length === 1 ? BIZ_NO[hit[0]] : null
}

// 납품처 — 발주서의 「납품처 · Deliver to · SHIP-TO · 납품장소」 칸 근처에서 사업장 이름을 찾는다 (v4.89.0)
//   Edwards · CSK 는 사업장이 여러 곳이다 (아산 공장 · 안성 7401 · 평택 등). 우리 주소(천안)와 고객사 본사(용인 · 화성)는 빼고 본다.
// 납품처는 지역으로 짧게 — Edwards · CSK 는 아산(아산 공장) / 안성(물류창고 · plant 7401 · 7035) / 평택 (v4.90.0)
const SITES = [
  [/MFK/, '평택 MFK'], [/아산/, '아산'], [/(?<!천)안성|Plant 7401|plant 7035/i, '안성'], [/평택|Pyeongtaek/i, '평택'],
  [/호법|이천/, '이천 호법창고'], [/BEVERLY/i, '미국 Beverly'],
]
export function shipToOf(L) {
  const t = L.map((l) => l.t)
  const i = t.findIndex((x) => /납품처|Deliver to|SHIP-TO SEQ|납품장소/i.test(x))
  if (i < 0) return null
  const block = t.slice(i, i + 12).join(' ')
  const hit = SITES.find(([re]) => re.test(block))
  if (hit) return hit[1]
  const m = block.match(/납품장소:\s*([^|]+)/)
  return m ? m[1].trim().slice(0, 40) : null
}

// AXCELIS 구분 — PO 파일 업로드와 같은 규칙 (11 = 전장, 16 = 하네스, 그 밖 = 구매품)
export const axDivision = (pn) => (String(pn).startsWith('16') ? '하네스' : String(pn).startsWith('11') ? '전장' : '구매품')

// ── 양식별 읽기 ──────────────────────────────────────────────
//   공통 줄 모양: { line_no, del_line, pn, rev, desc, spec, qty, unit, price, due, division, delivered, note }

function parseAX(L) {
  const t = L.map((l) => l.t)
  // 머리글을 못 찾으면 첫 줄을 PO번호로 읽던 것 — 못 찾으면 비워 두고 「PO번호를 못 읽음」 경고로 (v4.90.6)
  const iPo = t.findIndex((x) => /PURCHASE ORDER NO\./.test(x))
  const po_no = iPo >= 0 ? lastCell(t[iPo + 1]) || null : null
  const ccn = (t.find((x) => /PAGE 1 of/.test(x)) || '').match(/\| ([A-Z]) \|/)?.[1] || null
  const iDate = t.findIndex((x) => /^ORDER DATE/.test(x))
  const order_date = iDate >= 0 ? dUS(t[iDate + 1] || '') : null
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

// 줄 아래 글 속 7~10자리 숫자 — CSK 「발주 예정」의 Plnd order number · Prod order number 를 찾을 때 쓴다 (v4.90.0)
//   알려진 발주 예정 번호와 같은 것만 짝지으므로 전화번호 같은 엉뚱한 숫자는 걸리지 않는다
export function refNums(x, poNo) {
  return (String(x).match(/(?<![\d.,-])\d{7,10}(?![\d.,-])/g) || []).filter((n) => n !== String(poNo || ''))
}

function parseSAP(L) {
  const t = L.map((l) => l.t)
  const po_no = lastCell(t.find((x) => /발주번호 \|/.test(x)))
  const order_date = dEU(lastCell(t.find((x) => /발주일자 \|/.test(x))))
  const lines = []
  let cur = null
  // 프로젝트 줄 (v4.102.0) — 표 머리(Your Material Number · 귀사품번) 바로 아래 첫 줄 = 프로젝트 · 호기 (예: Gen2 Plus_SS H2D #10 (NKB973)),
  //   그다음 줄 = 비고 (예: Harness 정한납품 4/14). 다음 페이지 머리 아래에 없으면 앞 프로젝트를 그대로 쓴다.
  //   품목 메모 끝에 「PROJECT …」로 붙인다 — 엑셀로 옮긴 Edwards 줄과 같은 모양 → 생산관리 프로젝트 · 호기와 연결
  //   ⚠ 마지막 페이지 머리 아래의 꼬리 문구(납품서 안내 등)를 잡지 않게, 그 아래에 품목 줄이 이어질 때만 프로젝트로 본다
  let underHead = false, project = null, remark = null
  let pending = []
  const plain = (x, c) => c.length === 1 && !/:/.test(x) && !/^(The Due Date|CONTINUED|TOTAL|Total)/i.test(x.trim())
  t.forEach((x) => {
    const c = cells(x)
    if (/^(Your Material Number|귀사품번) \|/.test(x)) { if (!underHead) pending = []; underHead = true; return }
    if (/^\d{5}$/.test(c[0]) && dEU(c[5] || '')) {
      if (underHead && pending.length) { project = pending[0]; if (remark == null) remark = pending.slice(1, 3).join(' / ') || null }
      underHead = false; pending = []
      cur = { line_no: c[0], del_line: '1', pn: c[1], rev: null, desc: c[2], spec: '', qty: num(c[3]), unit: c[4], due: dEU(c[5]), price: num(c[6]), delivered: 0, note: '', refs: refNums(x, po_no), project }
      lines.push(cur); return
    }
    if (underHead && plain(x, c)) { pending.push(x.trim()); return }
    if (cur) cur.refs.push(...refNums(x, po_no))
    const mr = x.match(/^Material Revision:\s*(\S+)/)
    if (mr && cur) { cur.rev = mr[1]; return }
    const ms = x.match(/^Specifications?:\s*(.+)$/)
    if (ms && cur) { cur.spec = ms[1].trim(); return }
    const m = x.match(/^Drawing:\s*([^/]*)\/\s*([A-Z0-9]*)\s*\//)
    if (m && cur) { cur.rev = m[2] || null; if (m[1].trim() && m[1].trim() !== cur.pn) cur.note = `도면번호 ${m[1].trim()}` }
  })
  const tot = lastCell(t.find((x) => /^Total \/ 합계/.test(x)))
  const dueChanged = t.some((x) => /Due Date has been changed/.test(x))
  lines.forEach((l) => { if (l.project) l.note = [l.note, `PROJECT ${l.project}`].filter(Boolean).join(' · ') })
  const proj = lines.find((l) => l.project)?.project || null
  return { po_no, order_date, currency: 'KRW', total: num(tot), lines, dueChanged, project: proj, remark: proj ? remark : null }
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
      cur = { line_no: c[0], del_line: '1', pn: c[1] === 'Non-inventory Item' ? null : c[1], rev: null, desc: c[2], spec: '', qty: num(c[3]), unit: c[4], due: dMON(c[5]), price: num(c[6]), delivered: 0, note: '', refs: refNums(x, po_no) }
      lines.push(cur); return
    }
    if (cur) cur.refs.push(...refNums(x, po_no))
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

// ── 기타 업체 발주서 (v4.109.0) ─────────────────────────────────
//   업체마다 양식이 다르다 (이카운트 발주서 · 엑셀로 만든 Purchase order …). 칸 순서 대신 「무엇이 들어 있나」로 읽는다.
//     머리글: 수량(Q'ty) · 단가(Price) 가 같이 있는 줄 → 그 아래 첫 칸이 번호인 줄 = 품목 줄, 합계 · Total 줄에서 끝
//     품목 줄: 수량 × 단가 = 금액 인 세 숫자 · 코드 모양(IE0501600 · NKB929035) = 품번 · [ ] 안 = 품명 · 날짜 = 줄 납기
//     적요 · Remarks 칸(머리글 x 위치 오른쪽)의 글 → 줄 메모. 줄 사이에 낀 두 줄 적요는 높이(y)가 가까운 품목 줄로
const dAny = (s) => { const m = String(s ?? '').match(/(20\d{2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})/); return m ? iso(+m[1], +m[2], +m[3]) : null }
const NUMC = /^[₩￦$]?\s*[\d,]+(\.\d+)?$/
const UNIT_RE = /^(EA|SET|PCS|PC|M|KG|ROLL|BOX|개|롤|대|식)$/i
const CODE_RE = /^[A-Z]{1,6}-?\d{4,}[-A-Z0-9.]*$/i
const QTY_H = /^(수\s*량|Q'?TY|QUANTITY)$/i
const PRICE_H = /^(단\s*가|PRICE|UNIT\s*PRICE)$/i
export function genHead(L) {
  return L.findIndex((l) => { const c = cells(l.t); return c.some((v) => QTY_H.test(v)) && c.some((v) => PRICE_H.test(v)) })
}
// 이름표 옆 값 — 같은 칸(「납기일자 : 2026/11/03」) · 바로 오른쪽 칸 · 바로 아래 줄의 같은 x 칸 순서로 찾는다
function labelValue(L, re, ok = () => true, from = 0, to = L.length) {
  for (let i = from; i < to; i++) {
    const c = cells(L[i].t)
    for (let k = 0; k < c.length; k++) {
      const inl = c[k].match(/^([^:：]+?)\s*[:：]\s*(.+)$/)
      if (inl && re.test(inl[1].trim()) && ok(inl[2].trim())) return inl[2].trim()
      if (!re.test(c[k])) continue
      if (c[k + 1] && ok(c[k + 1])) return c[k + 1]
      const nx = L[i + 1]
      if (nx) {
        const nc = cells(nx.t), x = L[i].xs?.[k]
        let j = k
        if (x != null && nx.xs?.length === nc.length) {
          j = nc.reduce((b, _, q) => (Math.abs(nx.xs[q] - x) < Math.abs(nx.xs[b] - x) ? q : b), 0)
          if (Math.abs(nx.xs[j] - x) > 45) j = -1
        }
        if (j >= 0 && nc[j] && ok(nc[j]) && !re.test(nc[j])) return nc[j]
      }
    }
  }
  return null
}
const ME = /진선\s*테크|jinsun/i
const cleanCo = (s) => String(s || '').replace(/주식회사|유한회사|㈜|\(주\)|\(유\)|co\.,?\s*ltd\.?|inc\.?/gi, '').replace(/\s+/g, ' ').trim()
// 발행 회사 — 「회사명 · 상호」 이름표, 없으면 ㈜ · 주식회사가 붙은 글 (우리 회사 진선테크는 뺀다)
function companyOf(L) {
  const v = labelValue(L, /^(회사명\s*\/\s*대표|회사명|상\s*호|업체명|공급받는자|발주처)$/, (x) => !ME.test(x))
  if (v) return cleanCo(v.split('/')[0]) || null
  for (const l of L) {
    for (const c of cells(l.t)) {
      if (ME.test(c) || !/㈜|\(주\)|주식회사/.test(c)) continue
      const m = c.match(/(?:㈜|\(주\)|주식회사)\s*([^\s|/,]+)|([^\s|/,]+)\s*(?:㈜|\(주\)|주식회사)/)
      const name = cleanCo(m ? (m[1] || m[2]) : c)
      if (name && name.length <= 20) return name
    }
  }
  return null
}
function parseGEN(L) {
  const iH = genHead(L)
  const hc = cells(L[iH].t), hx = L[iH].xs?.length === hc.length ? L[iH].xs : null
  const colX = (re) => { const k = hc.findIndex((c) => re.test(c)); return k >= 0 && hx ? hx[k] : null }
  // 적요 칸 왼쪽 끝 — 머리글은 가운데 정렬이라 실제 글은 더 왼쪽에서 시작한다 (두웰: 머리글 519 · 글 495). 앞 머리글보다는 오른쪽
  const iRem = hc.findIndex((c) => /^(적\s*요|REMARKS?|비\s*고)$/i.test(c))
  const remX = iRem >= 0 && hx ? Math.max(iRem > 0 ? hx[iRem - 1] + 20 : 0, hx[iRem] - 30) : null
  const projX = colX(/^(PROJECT|프로젝트)$/i)
  const before = L.slice(0, iH)
  const po_no = labelValue(before, /^(발주\s*번호|PO\s*NO\.?|ORDER\s*NO\.?|P\/O\s*NO\.?)$/i, (v) => /[A-Z0-9]/i.test(v) && /\d{3,}/.test(v) && !dAny(v))
  const order_date = dAny(labelValue(before, /^(발주\s*일자|발주일|ORDER\s*DATE|PO\s*DATE|작성일자?)$/i, dAny)) || dAny(before.find((l) => /^20\d{2}[./-]\d{1,2}[./-]\d{1,2}$/.test(l.t))?.t)
  const dueAll = dAny(labelValue(before, /^(납기\s*일자|납기일|납\s*기|요청\s*납기|DUE\s*DATE|DELIVERY\s*DATE)$/i, dAny))
  const isEnd = (c) => /^(총\s*합\s*계|합\s*계|소\s*계|TOTAL|SUB\s*TOTAL|NOTES?)/i.test(c[0] || '')
  const rows = [], loose = []
  let iEnd = L.length
  for (let i = iH + 1; i < L.length; i++) {
    const l = L[i], c = cells(l.t), xs = l.xs?.length === c.length ? l.xs : null
    if (isEnd(c)) { iEnd = i; break }
    if (!/^\d{1,3}$/.test(c[0]) || c.length < 3) { loose.push({ l, c, xs }); continue }
    const at = (k) => (xs ? xs[k] : null)
    const used = new Set([0])
    // 수량 × 단가 = 금액 인 세 숫자
    const nums = c.map((v, k) => ({ k, v: NUMC.test(v) ? num(v) : null })).filter((n) => n.k > 0 && n.v != null)
    let q = null, pr = null, am = null
    for (let a = 0; a < nums.length && !q; a++) for (let b = a + 1; b < nums.length && !q; b++) for (let d = b + 1; d < nums.length; d++) {
      if (nums[a].v > 0 && Math.abs(nums[a].v * nums[b].v - nums[d].v) <= 1) { q = nums[a]; pr = nums[b]; am = nums[d]; break }
    }
    if (!q && nums.length >= 2) { q = nums[0]; pr = nums[1] }
    ;[q, pr, am].forEach((n) => n && used.add(n.k))
    if (am) nums.filter((n) => n.k === am.k + 1).forEach((n) => used.add(n.k))     // 금액 바로 뒤 = 부가세
    const row = { line_no: c[0], del_line: '1', pn: null, rev: null, desc: '', spec: '', qty: q?.v ?? null, unit: '', price: pr?.v ?? null, due: null, delivered: 0, note: '', y: l.y ?? null, project: null }
    const notes = [], descs = []
    c.forEach((v, k) => {
      if (used.has(k)) return
      const x = at(k)
      if (dAny(v) && /^\D{0,3}20\d{2}[./-]/.test(v)) { row.due = row.due || dAny(v); return }
      if (UNIT_RE.test(v)) { row.unit = v.toUpperCase(); return }
      if (remX != null && x != null && x >= remX) { notes.push(v); return }
      if (projX != null && x != null && Math.abs(x - projX) <= 40 && !CODE_RE.test(v)) { row.project = v; return }
      if (NUMC.test(v)) return
      const br = v.match(/^([A-Z0-9][A-Z0-9-_.]{3,})\s*\[(.*)\]$/i)                 // IE0501600 [GAS CAL ANALOG CABLE1]
      if (br && !row.pn) { row.pn = br[1]; descs.push(br[2].trim()); return }
      if (CODE_RE.test(v) && /\d/.test(v) && !row.pn) { row.pn = v; return }
      descs.push(v)
    })
    row.desc = descs.join(' ')
    row.note = notes.join(' ')
    rows.push(row)
  }
  // 줄 사이에 낀 적요(두 줄로 넘친 칸) → 높이가 가장 가까운 품목 줄 · 품목 표 아래 프로젝트 칸 → 모든 줄
  let projAll = null
  loose.forEach(({ l, c, xs }) => {
    if (!xs || !rows.length) return
    if (remX != null && xs[0] >= remX) {
      const r = l.y != null && rows[0].y != null ? rows.reduce((b, r) => (Math.abs(r.y - l.y) < Math.abs(b.y - l.y) ? r : b)) : rows.filter((r) => true).slice(-1)[0]
      r.note = [r.note, c.join(' ')].filter(Boolean).join(' ')
      return
    }
    if (projX != null && c.length === 1 && Math.abs(xs[0] - projX) <= 60 && !NUMC.test(c[0])) projAll = projAll || c[0]
  })
  const lines = rows.map(({ y, project, ...r }) => ({ ...r, due: r.due || dueAll, note: r.note ? `적요: ${r.note}` : '', project: project || projAll }))
  // 합계 — 표 아래에서 「공급가액」(부가세 빼고) 먼저, 없으면 Total
  const after = L.slice(iEnd)
  const tot = num(labelValue(after, /^(공급\s*가액|공급가|SUB\s*TOTAL)$/i, (v) => NUMC.test(v)) || labelValue(after, /^(TOTAL|합계\s*금액)$/i, (v) => NUMC.test(v)))
  // 특이사항 — 참고 사항 · 사용처 · 전달 사항 · 특이 사항 (배송 · 마감 안내 같은 정해진 문구는 안 넣는다)
  const remark = [labelValue(L, /^(참고\s*사항|사\s*용\s*처|전달\s*사항|특이\s*사항|요청\s*사항)$/, (v) => v.length > 1 && !/^(결제|비고)/.test(v), iEnd)]
    .concat(labelValue(L.slice(0, iH), /^(참고\s*사항|사\s*용\s*처|전달\s*사항|특이\s*사항|요청\s*사항)$/, (v) => v.length > 1))
    .filter(Boolean)
  const project = lines.find((l) => l.project)?.project || null
  lines.forEach((l) => { delete l.project })
  const customer_name = companyOf(L)
  const extraWarn = customer_name ? [] : ['발주한 업체 이름을 못 읽음 — 위 「업체 이름」 칸에 적어 주세요']
  return { po_no, order_date, currency: 'KRW', total: tot, lines, project, headNote: [...new Set(remark)].join(' / ') || null, customer_name, extraWarn }
}

const PARSERS = { AX: parseAX, SAP: parseSAP, LN: parseLN, JIT: parseJIT, VM: parseVM, GEN: parseGEN }

// 줄 → 발주서 한 장 { kind, customer, po_no, order_date, currency, ccn, total, lines, dueChanged, warns }
export function parsePO(L) {
  const kind = detect(L)
  const P = PARSERS[kind]
  if (!P) { const r = { kind: null, customer: null, po_no: null, lines: [], scan: !L.some((l) => String(l.t || '').trim()) }; return { ...r, warns: checkPO(r) } }
  const { extraWarn = [], ...r } = P(L)
  const out = { kind, ...r, customer: customerOf(L, kind), ship_to: shipToOf(L), refs: [...new Set(L.flatMap((l) => refNums(l.t, r.po_no)))] }
  out.warns = [...checkPO(out), ...extraWarn]
  return out
}

// 점검 — 하나라도 걸리면 「양식 확인 필요」
export function checkPO(r) {
  const w = []
  if (!r.kind && r.scan) w.push('스캔본(글자 없는 그림 PDF) — 글자를 읽을 수 없습니다. 수주대장 「＋ 직접 등록」으로 넣어 주세요')
  else if (!r.kind) w.push('모르는 양식 — 등록된 발주서 양식과 맞지 않음 (스캔본이면 글자를 못 읽음)')
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
