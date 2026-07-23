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

    parts.push({
      level,
      rawPn: String(c[2] || '').trim(),
      code: AX(c[2]),
      name: String(c[3] || '').trim(),
      qty: parseQty(c[4]),
      qtyRaw: String(c[4] || '').trim(),
      unit: String(c[5] || '').trim() || 'EA',
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
  // bom 테이블은 "부모 1건 = project 1건 + 직계 자식 행들" 구조.
  // 트리를 부모-직계자식 쌍으로 분해한다.
  const groups = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    const children = []
    for (let j = i + 1; j < parts.length; j++) {
      if (parts[j].level <= p.level) break
      if (parts[j].level === p.level + 1) children.push(parts[j])
    }
    if (children.length) {
      groups.push({ parentCode: p.code, parentName: p.name, parentRev: p.rev, children })
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
      maxLevel: parts.reduce((a, p) => Math.max(a, p.level), 0),
      assemblies: groups.length,
    },
    codes,
  }
}
