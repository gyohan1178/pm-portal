// ecount 품목관계리스트 파서
//
// 두 파일을 함께 읽는다.
//   ① 품목관계리스트 (필수) — 기준코드(JS) ↔ 고객사코드 매핑, 1:N
//   ② 품목등록 (선택)       — 품목명·규격 보강. 없어도 매핑의 품명을 쓴다.

export const CS_PREFIX = {
  AX: 'ax', ED: 'ed', CS: 'csk', VM: 'vm',
}

// 고객사코드 → 접두. 하이픈 없는 형식(CSSCS0195…, VM6220017500)도 잡는다.
export function csPrefixOf(code) {
  const c = String(code || '').trim().toUpperCase()
  if (c.startsWith('AX-')) return 'AX'
  if (c.startsWith('ED-')) return 'ED'
  if (c.startsWith('CS-') || c.startsWith('CSS')) return 'CS'
  if (c.startsWith('VM')) return 'VM'
  return null
}

const JS_RE = /^JS-[A-Z]{2}\d+$/

const cell = (v) => String(v ?? '').trim()

/**
 * 품목관계리스트 시트 파싱
 * 헤더: 대표품목코드 | 대표품목명 | 대표품목단위 | 연결품목코드 | 연결품목명 | …
 */
function parseRelation(aoa) {
  const hi = aoa.findIndex((r) => r.some((c) => cell(c).replace(/\s/g, '') === '대표품목코드'))
  if (hi < 0) return null

  const H = aoa[hi].map((h) => cell(h).replace(/\s/g, ''))
  const at = (...names) => {
    for (const n of names) {
      const i = H.findIndex((h) => h === n)
      if (i >= 0) return i
    }
    return -1
  }
  const ix = {
    js: at('대표품목코드'), jsName: at('대표품목명'), jsUnit: at('대표품목단위'),
    cs: at('연결품목코드'), csName: at('연결품목명'), csUnit: at('연결품목단위'),
  }

  const rows = []
  const skipped = []
  const seen = new Set()

  for (let i = hi + 1; i < aoa.length; i++) {
    const js = cell(aoa[i][ix.js]).toUpperCase()
    const cs = cell(aoa[i][ix.cs])
    if (!js && !cs) continue

    // 'KS-CA0001' 오타, 맨 끝 출력시각 행 등을 걸러낸다
    if (!JS_RE.test(js)) { if (js) skipped.push({ js, cs, why: '기준코드 형식 아님' }); continue }
    if (!cs) { skipped.push({ js, cs: '', why: '고객사코드 없음' }); continue }
    if (seen.has(cs)) continue        // 같은 고객사코드 중복 행
    seen.add(cs)

    rows.push({
      js_code: js,
      customer_code: cs,
      js_name: cell(aoa[i][ix.jsName]),
      unit: cell(aoa[i][ix.jsUnit]) || 'EA',
      spec: '',
      cs_prefix_raw: csPrefixOf(cs),
    })
  }
  return { rows, skipped }
}

/**
 * 품목등록 시트 파싱 — 품목코드 기준 상세(품명·규격·단위)
 */
function parseItemMaster(aoa) {
  const hi = aoa.findIndex((r) => r.some((c) => cell(c).replace(/\s/g, '') === '품목코드'))
  if (hi < 0) return null
  const H = aoa[hi].map((h) => cell(h).replace(/\s/g, ''))
  const at = (n) => H.findIndex((h) => h === n)
  const ix = { code: at('품목코드'), name: at('품목명'), spec: at('규격명'), unit: at('단위') }
  if (ix.code < 0) return null

  const m = {}
  for (let i = hi + 1; i < aoa.length; i++) {
    const c = cell(aoa[i][ix.code])
    if (!c) continue
    m[c] = {
      name: cell(aoa[i][ix.name]),
      spec: cell(aoa[i][ix.spec]),
      unit: cell(aoa[i][ix.unit]) || 'EA',
    }
  }
  return m
}

/**
 * 워크북 하나를 읽어 종류를 판별한다.
 * @returns { kind:'relation'|'master', ... }
 */
export function parseCodeWorkbook(wb, XLSX) {
  for (const name of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' })

    const rel = parseRelation(aoa)
    if (rel) return { kind: 'relation', sheet: name, ...rel }

    const mst = parseItemMaster(aoa)
    if (mst) return { kind: 'master', sheet: name, detail: mst, count: Object.keys(mst).length }
  }
  return { kind: null }
}

/** 매핑에 품목 상세를 덧입힌다 */
export function mergeDetail(rows, detail) {
  if (!detail) return { rows, filled: 0 }
  let filled = 0
  const out = rows.map((r) => {
    const d = detail[r.customer_code]
    if (!d) return r
    filled += 1
    return {
      ...r,
      js_name: d.name || r.js_name,
      spec: d.spec || r.spec,
      unit: d.unit || r.unit,
    }
  })
  return { rows: out, filled }
}

export function summarizeCodes(rows) {
  const byPrefix = {}
  const byCategory = {}
  const jsSet = new Set()
  let noPrefix = 0

  for (const r of rows) {
    jsSet.add(r.js_code)
    const p = r.cs_prefix_raw || '(미분류)'
    byPrefix[p] = (byPrefix[p] || 0) + 1
    if (!r.cs_prefix_raw) noPrefix += 1
    const cat = r.js_code.slice(3, 5)
    if (!byCategory[cat]) byCategory[cat] = { count: 0, max: 0 }
    byCategory[cat].count += 1
    const n = parseInt(r.js_code.slice(5), 10)
    if (Number.isFinite(n) && n > byCategory[cat].max) byCategory[cat].max = n
  }
  return { total: rows.length, jsCount: jsSet.size, byPrefix, byCategory, noPrefix }
}
