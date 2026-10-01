// AXCELIS Part Report (HTM) 파서
// 고객사에서 받는 "Part report for 120212215 B.3 (REL)" 형식의 HTM을 읽어
// BOM 트리 + 제조사 정보를 뽑아낸다. DOM/네트워크 무관한 순수 함수.
//
// 리포트 행 구조
//   Type=Part       실제 BOM 품목       Level / Type / Number / Name / Qty / Unit / Version / State
//   Type=Mfr Part   바로 위 Part의 제조사 (Number=제조사품번, Name=제조사명), Level = 부모+1
//   Type=Document   첨부 도면/문서 — BOM 아님, 무시
//
//   Level 표기: '0', '.1', '..2', '...3'  → 점 개수가 깊이
//   Version    : 'B.3' → REV=B, 개정=3   ('##.41' 처럼 REV가 미부여인 경우도 있음)

// ── 등록 제외 품번 ──
//   품번 뒤에 VM 이 붙은 것(예: 5102060VM, 5102060-VM)은 BOM 에 올리지 않는다.
//   ⚠ 2026-09-23 결정 — 하위가 딸려 있어도 그 가지 전체를 뺀다.
export const isVmPn = (pn) => /[-_ ]?VM$/i.test(String(pn ?? '').trim())

// ── 품번 정규화 (AX- 접두) ──
export const AX = (s) => {
  const t = String(s ?? '').trim().replace(/^AX-/i, '')
  return t ? 'AX-' + t : ''
}

// ── 0을 살리는 수량 파싱 ──
// parseFloat(x) || 1 패턴은 'as needed'(0.0) 품목을 1로 둔갑시킨다.
export function parseQty(v) {
  if (v == null) return 0
  const s = String(v).trim()
  if (!s) return 0
  const n = parseFloat(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

// ── 피트 → 미터 환산 ──
// 고객사 리포트는 케이블·튜브류를 Foot 단위로 준다.
// 사내 기준은 미터라 여기서 바꿔둔다.
//   소수 둘째 자리에서 올림 → 첫째 자리까지 (모자라면 안 되므로 반올림이 아닌 올림)
//   예) 1.6 ft = 0.48768 m → 0.5 / 0.2 ft = 0.06096 m → 0.1
const FT_TO_M = 0.3048
const isFeet = (u) => /^(foot|feet|ft\.?)$/i.test(String(u ?? '').trim())

export function feetToMeter(qtyFt) {
  const m = Number(qtyFt) * FT_TO_M
  if (!Number.isFinite(m)) return 0
  // toFixed 로 부동소수점 오차를 먼저 털어낸 뒤 올림 (0.3 이 2.9999→3 이 되는 것 방지)
  return Math.ceil(Number((m * 10).toFixed(9))) / 10
}

const stripTags = (s) => s.replace(/<[^>]+>/g, '')

const decode = (s) =>
  s.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .trim()

const levelOf = (s) => {
  const t = String(s ?? '').trim()
  if (!t) return 0
  if (t === '0') return 0
  return (t.match(/\./g) || []).length
}

/**
 * HTM 원문 → { header, parts, groups, stats }
 *   parts  : [{ level, code, rawPn, name, qty, unit, rev, edition, state, mfr, mfrPn, alternates[] }]
 *   groups : [{ parentCode, parentName, children:[part] }]  — 어셈블리 단위 (bom 테이블 구조와 동일)
 */
export function parseAxcelisReport(text) {
  const raw = String(text || '')

  // ── 헤더 ──
  const h1 = /<h1[^>]*>(.*?)<\/h1>/is.exec(raw)
  const title = h1 ? decode(stripTags(h1[1])) : ''
  const m = /Part report for\s+([\w.-]+)\s+([\w#]+)\.(\d+)\s*\(([^)]+)\)/i.exec(title)
  const descM = /Part description:\s*(.*?)<\/h3>/is.exec(raw)
  const byM = /Created by\s+(.*?)\s*\(/is.exec(raw)
  const atM = /\sat\s+([\d-]+\s[\d:]+)/i.exec(raw)

  const header = {
    title,
    rootPn: m ? m[1] : '',
    rootCode: m ? AX(m[1]) : '',
    rev: m ? m[2] : '',
    edition: m ? Number(m[3]) : 0,
    state: m ? m[4] : '',
    description: descM ? decode(stripTags(descM[1])) : '',
    createdBy: byM ? decode(stripTags(byM[1])) : '',
    createdAt: atM ? atM[1] : '',
  }

  // ── 행 추출 ──
  const rows = []
  for (const tr of raw.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []) {
    const tds = []
    for (const td of tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []) {
      tds.push(decode(stripTags(td.replace(/^<td[^>]*>/i, '').replace(/<\/td>$/i, ''))))
    }
    if (tds.length > 3) rows.push(tds)
  }

  // ── Part + 제조사 ──
  const parts = []
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i]
    if (c[1] !== 'Part') continue
    const level = levelOf(c[0])

    // 제조사: 다음 품목이 나오기 전까지, 정확히 level+1 인 Mfr Part 만.
    // (범위를 안 끊으면 상위 품목이 하위의 제조사까지 통째로 흡수한다)
    const mfrs = []
    for (let j = i + 1; j < rows.length; j++) {
      const d = rows[j]
      const dl = levelOf(d[0])
      if (d[1] === 'Part' || dl <= level) break
      if (d[1] === 'Mfr Part' && dl === level + 1) {
        mfrs.push({
          mfrPn: String(d[2] || '').replace(/\s*\(Approved\)\s*$/i, '').trim(),
          mfr: String(d[3] || '').trim(),
        })
      }
    }

    const ver = String(c[6] || '')
    const dot = ver.indexOf('.')
    const revRaw = dot >= 0 ? ver.slice(0, dot) : ver
    const edRaw = dot >= 0 ? ver.slice(dot + 1) : ''

    const unitRaw = String(c[5] || '').trim()
    const qtyRawNum = parseQty(c[4])
    const feet = isFeet(unitRaw)

    parts.push({
      level,
      isVM: isVmPn(c[2]),
      rawPn: String(c[2] || '').trim(),
      code: AX(c[2]),
      name: String(c[3] || '').trim(),
      // 환산 후 값이 실제 등록에 쓰인다
      qty: feet ? feetToMeter(qtyRawNum) : qtyRawNum,
      unit: feet ? 'M' : (unitRaw || 'EA'),
      // 원본 보존 — 화면에서 "0.2 Foot → 0.1 M" 으로 확인할 수 있게
      converted: feet,
      qtyOrig: qtyRawNum,
      unitOrig: unitRaw,
      qtyRaw: String(c[4] || '').trim(),
      rev: /^[A-Z]{1,2}$/i.test(revRaw) ? revRaw.toUpperCase() : '',
      revRaw,
      edition: /^\d+$/.test(edRaw) ? Number(edRaw) : 0,
      state: String(c[7] || '').trim(),
      mfr: mfrs[0]?.mfr || '',
      mfrPn: mfrs[0]?.mfrPn || '',
      alternates: mfrs.slice(1),
    })
  }

  return buildParsed(header, parts)
}

// 품목 목록 → 어셈블리 묶음 · 통계 (HTM · 엑셀 공통)
function buildParsed(header, parts, source = 'htm') {
  // ── 어셈블리 단위로 묶기 ──
  // children     : 직계 자식만
  // descendants  : 하위 전체 (relLevel = 부모 기준 상대 깊이)
  //   최상위 어셈블리의 BOM 에는 서브어셈블리 안쪽까지 전부 펼쳐 넣기 위함.
  //   예) 120212215 → 160208903(rel 1) + 그 부품 10개(rel 2)
  const groups = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.isVM) continue                       // VM 품번은 어셈블리로도 잡지 않는다
    const children = []
    const descendants = []
    let skipLevel = null                       // VM 품번 아래 가지는 통째로 건너뛴다
    for (let j = i + 1; j < parts.length; j++) {
      if (parts[j].level <= p.level) break
      if (skipLevel != null && parts[j].level > skipLevel) continue
      skipLevel = null
      if (parts[j].isVM) { skipLevel = parts[j].level; continue }
      const rel = parts[j].level - p.level
      descendants.push({ ...parts[j], relLevel: rel })
      if (rel === 1) children.push(parts[j])
    }
    if (children.length) {
      groups.push({
        parentCode: p.code, parentName: p.name, parentRev: p.rev,
        isRoot: p.level === 0, children, descendants,
      })
    }
  }

  const codes = [...new Set(parts.map((p) => p.code).filter(Boolean))]
  return {
    source,
    header,
    parts,
    groups,
    stats: {
      total: parts.length,
      uniqueCodes: codes.length,
      withMfr: parts.filter((p) => p.mfr).length,
      zeroQty: parts.filter((p) => p.level > 0 && p.qty === 0).length,
      vmSkipped: parts.filter((p) => p.isVM).length,
      converted: parts.filter((p) => p.converted).length,
      maxLevel: parts.reduce((a, p) => Math.max(a, p.level), 0),
      assemblies: groups.length,
    },
    codes,
  }
}

// ── AXCELIS BOM 엑셀 (2026-10-01) ─────────────────────────────────────
//   고객사가 HTM 대신 주는 엑셀. 한 줄 = 품목 하나 (HTM 의 Part 행과 같은 내용).
//     Structure Level · Number(들여쓰기) · Organization ID · Version('G.2 (Design)') · Name ·
//     Line Number · Find Number · Quantity('1 Each' · '0 as needed' · '1.9 Foot' · '1 REF') · State · Reference Designator
//   ⚠ 제조사(Mfr Part) 줄이 없다 — 이미 등록된 품목의 제조사는 그대로, 새 품번은 제조사 없이 등록된다.
//   나머지(VM 품번 제외 · Foot→M 환산 · as needed = 0 · 어셈블리 묶기)는 HTM 과 똑같이 처리한다.
const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

// 머리줄 위치 — 없으면 -1
export function findAxcelisBomHeader(grid) {
  for (let i = 0; i < Math.min((grid || []).length, 20); i++) {
    const r = (grid[i] || []).map(norm)
    if (r.includes('structure level') && r.includes('number') && r.includes('quantity')) return i
  }
  return -1
}
export const isAxcelisBomSheet = (grid) => findAxcelisBomHeader(grid) >= 0

export function parseAxcelisBomSheet(grid) {
  const hi = findAxcelisBomHeader(grid)
  if (hi < 0) throw new Error("AXCELIS BOM 엑셀 머리줄(Structure Level · Number · Quantity)을 찾지 못했습니다")
  const h = grid[hi].map(norm)
  const col = (n) => h.indexOf(n)
  const cL = col('structure level'), cN = col('number'), cV = col('version'), cNm = col('name'),
        cQ = col('quantity'), cS = col('state')
  const parts = []
  for (let i = hi + 1; i < grid.length; i++) {
    const r = grid[i] || []
    const pn = String(r[cN] ?? '').trim()
    const lvRaw = String(r[cL] ?? '').trim()
    if (!pn || !/^\d+$/.test(lvRaw)) continue
    const level = Number(lvRaw)
    // '1 Each' · '0 as needed' · '1.9 Foot' · '1 REF' — 숫자와 단위를 나눈다 (HTM 의 Qty · Unit 칸)
    const q = String(r[cQ] ?? '').trim()
    const m = /^([\d.,]+)\s*(.*)$/.exec(q)
    const qtyRawNum = m ? parseQty(m[1]) : 0
    const unitRaw = m ? m[2].trim() : q
    const feet = isFeet(unitRaw)
    const ver = String(r[cV] ?? '').replace(/\s*\(.*?\)\s*$/, '').trim()      // 'G.2 (Design)' → 'G.2'
    const dot = ver.indexOf('.')
    const revRaw = dot >= 0 ? ver.slice(0, dot) : ver
    const edRaw = dot >= 0 ? ver.slice(dot + 1) : ''
    parts.push({
      level,
      isVM: isVmPn(pn),
      rawPn: pn,
      code: AX(pn),
      name: String(r[cNm] ?? '').trim(),
      qty: feet ? feetToMeter(qtyRawNum) : qtyRawNum,
      unit: feet ? 'M' : (unitRaw || 'EA'),
      converted: feet,
      qtyOrig: qtyRawNum,
      unitOrig: unitRaw,
      qtyRaw: q,
      rev: /^[A-Z]{1,2}$/i.test(revRaw) ? revRaw.toUpperCase() : '',
      revRaw,
      edition: /^\d+$/.test(edRaw) ? Number(edRaw) : 0,
      state: cS >= 0 ? String(r[cS] ?? '').trim() : '',
      mfr: '', mfrPn: '', alternates: [],
    })
  }
  const root = parts.find(p => p.level === 0) || parts[0] || {}
  const header = {
    title: `AXCELIS BOM ${root.rawPn || ''} ${root.revRaw || ''}.${root.edition || 0} (엑셀)`,
    rootPn: root.rawPn || '', rootCode: root.code || '',
    rev: root.revRaw || '', edition: root.edition || 0, state: root.state || '',
    description: root.name || '', createdBy: '', createdAt: '',
  }
  return buildParsed(header, parts, 'xlsx')
}

// ── 새 BOM 과 지금 등록된 BOM 비교 (버전 갱신 확인용) ─────────────────
//   품번별 소요 합계로 견준다 (같은 품번이 여러 자리에 있으면 더함).
//   cur / next : [{ code, qty }]
export function diffBom(cur, next) {
  const sum = (list) => {
    const m = new Map()
    for (const r of list || []) { if (!r.code) continue; m.set(r.code, Math.round(((m.get(r.code) || 0) + (Number(r.qty) || 0)) * 1000) / 1000) }
    return m
  }
  const a = sum(cur), b = sum(next)
  const added = [], removed = [], changed = []
  for (const [code, q] of b) { if (!a.has(code)) added.push({ code, qty: q }); else if (a.get(code) !== q) changed.push({ code, from: a.get(code), to: q }) }
  for (const [code, q] of a) if (!b.has(code)) removed.push({ code, qty: q })
  const by = (x, y) => x.code.localeCompare(y.code)
  return { added: added.sort(by), removed: removed.sort(by), changed: changed.sort(by), same: [...b.keys()].filter(c => a.has(c) && a.get(c) === b.get(c)).length }
}
