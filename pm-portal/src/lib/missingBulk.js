// 미불출 일괄 입력 · 해제 (v4.137.0)
//   같은 ASSY 여러 대를 불출하다 몇 품목이 모자랄 때, 고른 호기에 같은 품목을 한 번에 넣고 지운다.
//   미불출(production.missing_parts)은 저장 모양이 섞여 있다
//     · 출고 연동 {std_code, name, qty, item_id} · 호기 편집 {pn(접두 없음), name, maker, makerPn, qty, date} · CSV {pn, expectedDate}
//   → 같은 품목인지는 「접두를 뗀 품번」으로 본다. 새로 넣는 줄은 두 모양을 다 채운다
//     (std_code 가 있어야 나중에 출고 작업에서 전량 불출될 때 자동으로 풀린다)
import { stripPrefix } from './custPrefix'

const s = (v) => (v == null ? '' : String(v).trim())
export const missKey = (m) => stripPrefix(s(m?.std_code) || s(m?.pn)).toUpperCase()

// 붙여넣기 — 한 줄에 「품번  수량」 (탭 · 공백 · 쉼표). 수량이 없으면 1. 머리글 줄은 건너뛴다
export function parseMissingPaste(text) {
  const out = new Map()
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    // 엑셀 복사 = 탭 · 직접 칠 때 = 공백 (수량의 천 단위 쉼표는 살린다) · 공백 없으면 쉼표
    const cells = (line.includes('\t') ? line.split('\t') : /\s/.test(line) ? line.split(/\s+/) : line.split(','))
      .map((x) => x.trim().replace(/,$/, '')).filter(Boolean)
    const pn = s(cells[0]).replace(/\.0$/, '')
    if (!pn) continue
    const q = cells.length > 1 ? Number(String(cells[1]).replace(/,/g, '')) : 1
    if (cells.length > 1 && !Number.isFinite(q)) continue      // 「품번 수량」 같은 머리글
    const k = stripPrefix(pn).toUpperCase()
    const prev = out.get(k)
    out.set(k, { pn, qty: (prev ? prev.qty : 0) + (Number.isFinite(q) ? q : 1) })
  }
  return [...out.values()]
}

// 한 호기 목록에 품목들을 넣는다 — mode 'set' = 이미 있으면 수량 바꾸기, 'add' = 더하기
export function mergeMissing(list, parts, mode = 'set') {
  const next = (Array.isArray(list) ? list : []).filter(Boolean).map((m) => ({ ...m }))
  const added = [], updated = []
  for (const p of parts || []) {
    const k = missKey(p)
    if (!k || !(Number(p.qty) > 0)) continue
    const i = next.findIndex((m) => missKey(m) === k)
    const fill = { std_code: p.std_code || undefined, item_id: p.item_id || undefined, pn: p.pn, name: p.name, maker: p.maker, makerPn: p.makerPn }
    if (i >= 0) {
      const cur = next[i]
      const qty = mode === 'add' ? (Number(cur.qty) || 0) + Number(p.qty) : Number(p.qty)
      const m = { ...cur, qty }
      for (const [f, v] of Object.entries(fill)) if (v && !s(m[f])) m[f] = v   // 빈 칸만 채운다
      if (p.date) m.date = p.date
      next[i] = m
      updated.push(k)
    } else {
      const m = { pn: p.pn, name: p.name || '', maker: p.maker || '', makerPn: p.makerPn || '', qty: Number(p.qty), date: p.date || '' }
      if (p.std_code) m.std_code = p.std_code
      if (p.item_id) m.item_id = p.item_id
      next.push(m)
      added.push(k)
    }
  }
  return { next, added, updated }
}

// 고른 품목(접두 뗀 품번)을 지운다
export function clearMissing(list, keys) {
  const ks = new Set([...(keys || [])].map((k) => String(k).toUpperCase()))
  const arr = Array.isArray(list) ? list.filter(Boolean) : []
  const next = arr.filter((m) => !ks.has(missKey(m)))
  return { next, removed: arr.length - next.length }
}

// 고른 호기들에 걸린 미불출을 품목 기준으로 모은다 — 해제 탭 목록
export function collectMissing(rows) {
  const g = new Map()
  for (const r of rows || []) {
    for (const m of (Array.isArray(r.missing_parts) ? r.missing_parts : [])) {
      const k = missKey(m)
      if (!k) continue
      const e = g.get(k) || { key: k, pn: stripPrefix(s(m.std_code) || s(m.pn)), name: '', hogis: [], total: 0 }
      if (!e.name && s(m.name)) e.name = s(m.name)
      if (!e.hogis.includes(r.hogi || '-')) e.hogis.push(r.hogi || '-')
      e.total += Number(m.qty) || 0
      g.set(k, e)
    }
  }
  return [...g.values()].sort((a, b) => b.hogis.length - a.hogis.length || a.pn.localeCompare(b.pn))
}
