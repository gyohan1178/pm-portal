// 통합 검색 — 품번 여러 개 한 번에 (v4.193.0)
//   엑셀에서 품번 열을 복사해 검색칸에 붙이면 줄마다 찾는다 (메일로 받은 품번 목록 확인용)
//   기준코드(접두 있든 없든) 또는 제조사품번이 「똑같은」 것만 — 여러 개를 한 번에 볼 때 비슷한 품번이 섞이지 않게
import { CUST_PREFIX, hasPrefix } from './custPrefix'

export const MANY_MAX = 300
const PRE = [...new Set(Object.values(CUST_PREFIX))]
const up = (s) => String(s || '').trim().toUpperCase()
// 붙여넣은 글 → 품번 목록 (줄마다 첫 칸 · 중복 · 빈 줄 · 머리글 「품번」 제외)
export function parseTerms(text) {
  const out = [], seen = new Set()
  for (const raw of String(text || '').split(/\r?\n/)) {
    const t = raw.split('\t')[0].trim().replace(/\.0$/, '')
    if (!t || /^(품번|품목코드|기준코드|part\s*(no|number)?\.?|p\/n|item)$/i.test(t)) continue
    const k = up(t); if (seen.has(k)) continue
    seen.add(k); out.push(t)
    if (out.length >= MANY_MAX) break
  }
  return out
}
export const isMany = (q) => /\n/.test(String(q || ''))
// 찾을 기준코드 후보 — 접두가 없으면 고객사 접두를 다 붙여 본다
export const codeCands = (t) => (hasPrefix(t) ? [up(t)] : [up(t), ...PRE.map((p) => p + up(t))])
// 품목들 ↔ 입력 품번 — { found: Map(입력 → 품목[]) · missing: [입력] }
export function matchTerms(terms, items) {
  const byCode = new Map(), byMfr = new Map()
  for (const it of items || []) {
    byCode.set(up(it.std_code), it)
    const m = up(it.manufacturer_code); if (m) { if (!byMfr.has(m)) byMfr.set(m, []); byMfr.get(m).push(it) }
  }
  const found = new Map(), missing = []
  for (const t of terms) {
    const hit = new Map()
    codeCands(t).forEach((c) => { const it = byCode.get(c); if (it) hit.set(it.id, it) })
    ;(byMfr.get(up(t)) || []).forEach((it) => hit.set(it.id, it))
    if (hit.size) found.set(t, [...hit.values()]); else missing.push(t)
  }
  return { found, missing }
}
