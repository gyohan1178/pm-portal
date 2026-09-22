/*! FAI Navigator 핵심 로직 — v3.2 단일 HTML 에서 옮김
 *  © 2026 김교한 (Gyohan Kim), 진선테크 구매자재팀
 *
 *  원본: FAI-Navigator_v3.2_SOURCE (parseReport · category · nomfrKind · clsKey ·
 *        mpnMatch · evaluateAuto · evaluate · buildRows)
 *  ⚠ 판단 로직은 원본 그대로다. 바꾼 것은 전역 상태(REP·BUYIDX·MAN·SET)를
 *    인자로 받게 한 것뿐이다. 원본과 같은 결과가 나오는지 시험으로 대조했다.
 *  ⚠ 증빙 폴더·도면·PPT 는 아직 옮기지 않았다(다음 단계).
 */

// 품번 정규화: 앞뒤 공백, 대문자, AX- 접두 제거
export const normAx = (s) => String(s ?? '').trim().toUpperCase().replace(/^AX-/, '').replace(/\s+/g, '')
// 제조사품번 비교용: 영숫자만
export const normMpn = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
export const normMfr = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9가-힣]/g, '')

/* ================= Part Report 파싱 ================= */
// html: Part report(.htm) 원문. DOMParser 는 브라우저 것을 쓴다(시험 때는 jsdom 것을 넘긴다).
export function parseReport(html, DOMParserImpl = globalThis.DOMParser) {
  const doc = new DOMParserImpl().parseFromString(html, 'text/html')
  const h1 = doc.querySelector('h1')?.textContent || ''
  const desc = (doc.querySelector('h3')?.textContent || '').replace(/^Part description:\s*/i, '')
  const created = [...doc.querySelectorAll('h3')].map((x) => x.textContent).find((t) => /^Created by/i.test(t)) || ''
  const trs = doc.querySelectorAll('tbody > tr')
  if (!trs.length) throw new Error('표를 찾지 못했습니다. Part report(.htm)가 맞는지 확인하세요.')
  const parts = new Map()
  const stack = []
  let root = null
  // 원본에 깨진 특수문자(\uFFFD)가 섞여 있어 문맥으로 되살린다: 150\uFFFDC→°, manufacturer\uFFFDs→', 7.4\uFFFD→"
  const fixCh = (s) => s.replace(/\uFFFD(?=\s?[CF]\b)/g, '°').replace(/\uFFFD(?=s\b)/g, "'").replace(/(\d)\uFFFD/g, '$1"').replace(/\uFFFD/g, '-')
  const clean = (td) => (td ? fixCh(td.textContent.replace(/\s+/g, ' ').trim()) : '')
  for (const tr of trs) {
    const td = tr.children
    if (td.length < 8) continue
    const lvTxt = clean(td[0])
    const lv = parseInt(lvTxt.replace(/^\.+/, ''), 10)
    if (isNaN(lv)) continue
    const type = clean(td[1])
    if (type === 'Part') {
      const pn = clean(td[2])
      const isRef = /See above/i.test(clean(td[8]))
      const node = { pn, lv, qty: parseFloat(clean(td[4])) || 0, unit: clean(td[5]), kids: [], ref: isRef }
      while (stack.length && stack[stack.length - 1].lv >= lv) stack.pop()
      if (stack.length) stack[stack.length - 1].kids.push(node); else root = node
      stack.push(node)
      if (!parts.has(pn)) {
        parts.set(pn, {
          pn, name: clean(td[3]), rev: clean(td[6]), accept: '', cls: '', related: '', mfrs: [], hasKids: false, full: false,
          lvTxt, qty0: clean(td[4]), unit0: clean(td[5]), state: clean(td[7]),
        })
      }
      const P = parts.get(pn)
      if (!isRef && !P.full && td.length >= 14) {
        P.accept = clean(td[11]); P.cls = clean(td[12]); P.related = clean(td[13]); P.full = true
        P.lvTxt = lvTxt; P.qty0 = clean(td[4]); P.unit0 = clean(td[5]); P.state = clean(td[7])
      }
      node.P = P
    } else if (type === 'Document') {
      // 품목 바로 아래 도면 문서: '품번.DRW' 또는 품번과 같은 번호의 PDF (REF_ONLY 제외)
      const owner = stack[stack.length - 1]
      if (!owner || owner.lv !== lv - 1) continue
      const num = clean(td[2]), file = clean(td[8])
      if (!/\.pdf$/i.test(file) || /REF_?ONLY/i.test(file)) continue
      if (num !== owner.pn + '.DRW' && num !== owner.pn) continue
      // 품번.DRW = 도면, 품번과 같은 번호 = Commercial Part Specification
      const P = owner.P, key = num.endsWith('.DRW') ? 'dwgDocs' : 'cpsDocs'
      P[key] = P[key] || []
      if (!P[key].some((d) => d.file === file)) P[key].push({ file, ver: clean(td[6]), drw: num.endsWith('.DRW') })
    } else if (type === 'Mfr Part') {
      const owner = stack[stack.length - 1]
      if (!owner || owner.lv !== lv - 1) continue
      const raw = clean(td[2])
      let mpn = raw, status = ''
      // 괄호가 품번 안에도 있을 수 있어 「마지막 괄호」를 상태로 본다
      const m = raw.match(/^(.*)\s\(([^()]*)\)\s*$/)
      if (m) { mpn = m[1].trim(); status = m[2].trim() }
      else { const m2 = raw.match(/^(.*?)\s\((.*)$/); if (m2) { mpn = m2[1].trim(); status = m2[2].replace(/\)$/, '').trim() } }
      const P = owner.P
      if (!owner._mfrSeen) { owner._mfrSeen = true; if (P.mfrs.length) owner._skip = true }
      if (owner._skip) continue // 같은 품번이 여러 번 나오면 첫 목록만
      P.mfrs.push({ mpn, mfr: clean(td[3]), status, rohs: clean(td[20]), cert: clean(td[22]), raw, lv: lvTxt, ver: clean(td[6]), state: clean(td[7]) })
    }
  }
  if (!root) throw new Error('최상위 품번을 찾지 못했습니다.')
  // 하위가 있는 품번 표시 + See above 노드는 첫 전개 노드의 하위를 빌려 쓴다
  const firstFull = new Map()
  ;(function walk(n) { if (n.kids.length && !firstFull.has(n.pn)) firstFull.set(n.pn, n); n.kids.forEach(walk) })(root)
  for (const [pn] of firstFull) parts.get(pn).hasKids = true
  const topM = h1.match(/Part report for\s+(\S+)\s+(\S+)/i)
  return { top: { pn: root.pn, name: desc || root.P.name, rev: topM ? topM[2] : root.P.rev, created }, parts, root, firstFull }
}

/* ================= 분류 ================= */
export function category(P) {
  if (P.mfrs.length) return 'buy'
  if (P.hasKids) return 'assy'
  return 'nomfr'
}
export function nomfrKind(P) {
  const pn = P.pn, nm = P.name.toUpperCase()
  if (/^8[68]/.test(pn) || /\bSPEC\b|STANDARD|SPECIFICATION/.test(nm)) return '사양서'
  if (/^17[0-3]/.test(pn) && !/^LBL|LABEL/.test(nm)) return '판금·가공품'
  if (/^(19|90)/.test(pn) || /^LBL|LABEL/.test(nm)) return '라벨'
  if (/^(4[0-6]|44S)/.test(pn) || /SCREW|WASHER|NUT|WSHR/.test(nm)) return '체결류'
  return '제조사 미등록'
}
// 사양서·표준은 자재가 아니므로 목록에서 뺀다
export const isSpec = (P) => category(P) === 'nomfr' && nomfrKind(P) === '사양서'
export function clsKey(P) {
  const c = category(P)
  if (c === 'assy') return 'assy'
  if (c === 'nomfr') return 'nomfr'
  if (/^Generic/i.test(P.cls)) return 'generic'
  if (/^Limited/i.test(P.cls)) return 'limited'
  if (/^Sole/i.test(P.cls)) return 'sole'
  return 'uncls'
}
export const CLS_LABEL = { generic: 'Generic', limited: 'Limited', sole: 'Sole', uncls: '미분류', nomfr: '제조사미등록', assy: '조립품' }
export const CLS_BADGE = { generic: 'b-blue', limited: 'b-amber', sole: 'b-red', uncls: 'b-gray', nomfr: 'b-gray', assy: 'b-gray' }

/* ================= 판정 ================= */
export const V = {
  OK: { t: '✅ 등록품 일치', b: 'b-green', grp: 'ok', ord: 6 },
  OBS: { t: '✅ 등록품(단종표기)', b: 'b-green', grp: 'ok', ord: 5 },
  APR_OK: { t: '✅ 승인이력 있음', b: 'b-green', grp: 'ok', ord: 4 },
  NOMFR_OK: { t: '✅ 구매확인', b: 'b-green', grp: 'ok', ord: 4 },
  GEN: { t: '🟦 Generic 자체판단', b: 'b-blue', grp: 'gen', ord: 3 },
  APR: { t: '⚠ 승인이력 필요', b: 'b-amber', grp: 'chk', ord: 1 },
  MFRONLY: { t: '⚠ 제조사만 일치', b: 'b-amber', grp: 'chk', ord: 1 },
  DNU: { t: '⛔ 사용금지 품번', b: 'b-red', grp: 'chk', ord: 0 },
  NOREC: { t: '⚪ 구매이력 없음', b: 'b-gray', grp: 'none', ord: 2 },
  NOMPN: { t: '⚪ 제조사품번 미기재', b: 'b-gray', grp: 'none', ord: 2 },
  NOMFR: { t: '📐 제조사 미등록', b: 'b-gray', grp: 'none', ord: 2 },
  ASSY: { t: '🛠 자체제작', b: 'b-pr', grp: 'assy', ord: 8 },
  OK_M: { t: '✅ 적합 (수동)', b: 'b-green', grp: 'ok', ord: 4 },
  GEN_M: { t: '🟦 Generic (수동)', b: 'b-blue', grp: 'gen', ord: 3 },
  APR_M: { t: '✅ 승인이력 (수동)', b: 'b-green', grp: 'ok', ord: 4 },
  NG_M: { t: '⛔ 부적합 (수동)', b: 'b-red', grp: 'chk', ord: 0 },
}

// 구매이력 → 품번별 목록 (최근 날짜 먼저). recs: [{ax, mfr, mpn, vendor, date, qty, doc, apr?, vo?, vr?}]
export function buildBuyIndex(recs) {
  const idx = new Map()
  for (const r of recs || []) {
    if (!r.ax) continue
    if (!idx.has(r.ax)) idx.set(r.ax, [])
    idx.get(r.ax).push(r)
  }
  for (const arr of idx.values()) arr.sort((a, b) => String(b.date).localeCompare(String(a.date)))
  return idx
}

export function mpnMatch(a, b) {
  const x = normMpn(a), y = normMpn(b)
  if (!x || !y) return false
  if (x === y) return true
  const s = x.length < y.length ? x : y, l = x.length < y.length ? y : x
  return s.length >= 5 && l.startsWith(s) // 포장단위 접미(-100 등) 허용
}

export const normVo = (t) => {
  t = String(t || '').trim(); if (!t) return ''
  if (/부적합|^NG|non.?conform|reject/i.test(t)) return 'NG_M'
  if (/generic/i.test(t)) return 'GEN_M'
  if (/승인|alternate|approv/i.test(t)) return 'APR_M'
  if (/적합|^OK|conform|accept/i.test(t)) return 'OK_M'
  return ''
}

// ctx: { buyIdx: Map, man: {pn: {...}}, uncls: 'limited' | 'generic' }
export function evaluateAuto(P, ctx) {
  const { buyIdx = new Map(), man: MAN = {}, uncls = 'limited' } = ctx || {}
  const cat = category(P)
  const key = normAx(P.pn)
  const recs = buyIdx.get(key) || []
  const man0 = MAN[P.pn] || {}
  const rec = recs[Math.min(man0.pick || 0, Math.max(recs.length - 1, 0))] || null
  // 엑셀로 다시 넣은 승인이력·판정 수정값도 쓰되, 이 화면에서 직접 입력한 값이 우선
  const man = Object.assign({}, rec ? { apr: rec.apr || '', vo: normVo(rec.vo), vr: rec.vr || '' } : {}, man0)
  const act = {
    mfr: man.mfr || (rec ? rec.mfr : ''),
    mpn: man.mpn || (rec ? rec.mpn : ''),
    vendor: man.vendor || (rec ? rec.vendor : ''),
    date: man.date || (rec ? rec.date : ''),
    doc: man.doc || (rec ? rec.doc : ''),
    src: (man.mfr || man.mpn) ? '수기' : (rec ? '이력' : ''),
  }
  const out = { act, recs, man, hit: null, v: null, note: '' }
  if (cat === 'assy') { out.v = 'ASSY'; return out }
  const has = act.mpn || act.mfr || act.vendor || act.date || act.doc
  if (cat === 'nomfr') { out.v = has ? 'NOMFR_OK' : 'NOMFR'; out.note = nomfrKind(P); return out }
  if (!act.mpn && !act.mfr) { out.v = has ? 'NOMPN' : 'NOREC'; return out }
  const hit = act.mpn ? P.mfrs.find((m) => mpnMatch(m.mpn, act.mpn)) : null
  if (hit) {
    out.hit = hit
    if (/Do Not Use/i.test(hit.status)) out.v = 'DNU'
    else if (/OBS/i.test(hit.status)) out.v = 'OBS'
    else out.v = 'OK'
    return out
  }
  const ck = clsKey(P)
  const genericLike = ck === 'generic' || (ck === 'uncls' && uncls === 'generic')
  if (genericLike) { out.v = 'GEN'; return out }
  if (man.apr) { out.v = 'APR_OK'; return out }
  const mfrHit = act.mfr && P.mfrs.find((m) => normMfr(m.mfr) && (normMfr(m.mfr) === normMfr(act.mfr)))
  out.v = (mfrHit && !act.mpn) ? 'MFRONLY' : 'APR'
  return out
}

// 판정 수동 변경: 자동 판정 위에 덮어쓴다 (e.auto 에 원래 자동 판정을 남김)
export function evaluate(P, ctx) {
  const out = evaluateAuto(P, ctx)
  const vo = out.man.vo
  if (vo && V[vo]) { out.auto = out.v; out.v = vo }
  return out
}

/* ================= 행 만들기 ================= */
// opt: { mode: 'uniq' | 'tree', incAssy: true }
//   고유 품번(uniq): 소요량 = 상위 수량 곱 누적 합산, 모품목 = 바로 위 조립품 집합
export function buildRows(rep, opt, ctx) {
  if (!rep) return []
  const { mode = 'uniq', incAssy = true } = opt || {}
  const rows = []
  const mkRow = (key, P, no, qty, unit, lv, occ) => ({ key, P, no, qty, unit, lv, occ, e: evaluate(P, ctx), ck: clsKey(P) })
  const kidsOf = (n) => (n.ref && rep.firstFull.get(n.pn)) ? rep.firstFull.get(n.pn).kids : n.kids
  if (mode === 'tree') {
    let seq = 0
    const walk = (n, mult, path) => {
      for (const k of kidsOf(n)) {
        if (/^REF$/i.test(k.unit)) continue
        if (path.includes(k.pn)) continue
        const ext = k.qty * mult
        const P = k.P, cat = category(P)
        if (isSpec(P)) continue
        seq++
        const tr = mkRow('t' + seq, P, seq, ext, k.unit, k.lv, 1); tr.parents = [n.pn]; rows.push(tr)
        if (cat === 'assy') walk(k, ext || mult, path.concat(k.pn))
      }
    }
    walk(rep.root, 1, [rep.root.pn])
  } else {
    const agg = new Map(); let seq = 0
    const walk = (n, mult, path) => {
      for (const k of kidsOf(n)) {
        if (/^REF$/i.test(k.unit)) continue
        if (path.includes(k.pn)) continue
        const ext = k.qty * mult
        const P = k.P
        if (category(P) === 'assy') {
          if (incAssy) {
            if (!agg.has(P.pn)) agg.set(P.pn, { P, seq: ++seq, qty: 0, unit: k.unit, occ: 0, asNeeded: false, par: new Set() })
            const a0 = agg.get(P.pn); a0.qty += ext; a0.occ++; a0.par.add(n.pn)
          }
          walk(k, ext || mult, path.concat(k.pn)); continue
        }
        if (isSpec(P)) continue
        if (!agg.has(P.pn)) agg.set(P.pn, { P, seq: ++seq, qty: 0, unit: k.unit, occ: 0, asNeeded: false, par: new Set() })
        const a = agg.get(P.pn)
        a.qty += ext; a.occ++; a.par.add(n.pn)
        if (/as needed/i.test(k.unit)) a.asNeeded = true; else if (/as needed/i.test(a.unit)) a.unit = k.unit
      }
    }
    walk(rep.root, 1, [rep.root.pn])
    for (const a of agg.values()) {
      const ur = mkRow('u' + a.P.pn, a.P, a.seq, a.qty, a.asNeeded && !a.qty ? 'as needed' : a.unit, 1, a.occ)
      ur.parents = [...a.par]; rows.push(ur)
    }
  }
  return rows
}

// 모품목 표시 — 최상위 모델은 뺀다 (원본 parentTxt 와 같은 규칙)
export function parentList(r, topPn) {
  return (r.parents || []).filter((p) => p !== topPn)
}

// 소요량 표기 (원본 qtyTxt — HTML 이스케이프만 뺐다)
const fmtQ = (n) => (Math.round(n * 1000) / 1000).toLocaleString('ko-KR')
export function qtyText(r) {
  if (/as needed/i.test(r.unit) && !r.qty) return 'A/R'
  const u = /foot/i.test(r.unit) ? 'ft' : /each/i.test(r.unit) ? 'EA' : /as needed/i.test(r.unit) ? 'A/R' : r.unit
  return `${fmtQ(r.qty)} ${u}`
}
