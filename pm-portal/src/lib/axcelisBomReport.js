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

  // ── 어셈블리 단위로 묶기 ──
  // children     : 직계 자식만
  // descendants  : 하위 전체 (relLevel = 부모 기준 상대 깊이)
  //   최상위 어셈블리의 BOM 에는 서브어셈블리 안쪽까지 전부 펼쳐 넣기 위함.
  //   예) 120212215 → 160208903(rel 1) + 그 부품 10개(rel 2)
  const groups = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    const children = []
    const descendants = []
    for (let j = i + 1; j < parts.length; j++) {
      if (parts[j].level <= p.level) break
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
    header,
    parts,
    groups,
    stats: {
      total: parts.length,
      uniqueCodes: codes.length,
      withMfr: parts.filter((p) => p.mfr).length,
      zeroQty: parts.filter((p) => p.level > 0 && p.qty === 0).length,
      converted: parts.filter((p) => p.converted).length,
      maxLevel: parts.reduce((a, p) => Math.max(a, p.level), 0),
      assemblies: groups.length,
    },
    codes,
  }
}
