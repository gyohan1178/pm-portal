// Edwards 소요량 매칭 — 불출 예정 순으로 BOM 을 재고에서 차례로 빼 본다.
//
//   작업자 도구 「재고 파악」 탭을 옮긴 것. 그 도구는 재고 · BOM · 발주 엑셀을 따로 올렸지만
//   여기서는 PM 포털의 BOM(projects/bom) · 재고(inventory) · 구매발주(purchase_orders) 를 쓴다.
//
//   ① 불출 건 = 생산관리 Edwards 진행 줄 × (하네스 · 전장) 중 아직 불출 안 한 것
//      이미 불출했는데 미불출 자재가 적혀 있으면 → 그 자재만 (「미불출」 건)
//   ② 불출 예정일 순으로 줄 세워, 재고에서 BOM 소요를 차례로 뺀다
//      그 불출일까지 들어올 발주(입고요청일 오늘~불출일)는 먼저 더한다
//      입고요청일이 지난 미입고 발주는 더하지 않고 「입고 지연」으로 알린다 (작업자 도구와 같음)
//   ③ 품목별로 「언제부터 얼마나 모자라고 언제 풀리는지」를 따로 모은다
import { kindOf, issueDueOf, KINDS } from './edForecast'

const truthy = (v) => v === true || (typeof v === 'string' && v.trim() && v !== 'false')

// ── BOM 연결 키 ──────────────────────────────────────────────────────
//   작업자 도구 ITEM_BOMDB 와 같은 묶음: EUV · H2D-LH 는 NKB 기종별, H2D-HPD 는 하나
export function bomGroupOf(r) {
  const k = kindOf(r)
  if (!k) return null
  if (k === 'H2D-HPD') return '*'
  const cands = [r.fc_item, r.part3, r.part2].map(v => String(v || '').toUpperCase())
  for (const c of cands) { const m = /^(NKB\d{3})/.exec(c); if (m) return m[1] }
  return '?'
}
export const bomKey = (kind, group, which) => `${kind}|${group}|${which}`
export const WHICH_LABEL = { harn: '하네스', elec: '전장' }

// 프로젝트 이름으로 BOM 을 짐작한다 (설정에 없을 때만). 못 찾으면 null.
//   작업자 도구 이름: NKB943_EUV · NKB943_하네스 · H2D-LH · H2D-LH_하네스(NKB973) · H2D-HPD · H2D-HPD_하네스
//   NKB973 의 EUV · EUV 하네스는 NKB943 것을 같이 쓴다 (작업자 도구 그대로).
const norm = (s) => String(s || '').toLowerCase().replace(/[\s_\-()]/g, '')
export function guessBom(projects, kind, group, which) {
  const has = (p, ...t) => { const s = norm(p.code) + '|' + norm(p.name); return t.every(x => s.includes(norm(x))) }
  const harn = (p) => has(p, '하네스') || has(p, 'harness') || has(p, 'hns')
  const pick = (fn) => (projects || []).filter(fn).sort((a, b) => String(a.code).length - String(b.code).length)[0] || null
  if (kind === 'EUV') {
    const g = group === 'NKB973' ? 'NKB943' : group
    if (!/^NKB/.test(g || '')) return null
    return which === 'harn'
      ? pick(p => has(p, g) && harn(p) && !has(p, 'h2d'))
      : pick(p => has(p, g) && has(p, 'euv') && !harn(p))
  }
  const sub = kind === 'H2D-LH' ? 'lh' : 'hpd'
  if (which === 'elec') return pick(p => has(p, 'h2d', sub) && !harn(p))
  return (/^NKB/.test(group || '') && pick(p => has(p, 'h2d', sub, group) && harn(p))) || pick(p => has(p, 'h2d', sub) && harn(p))
}
// 설정값 → 없으면 짐작
export function bomProjectFor(rules, projects, kind, group, which) {
  const code = rules?.bom?.[bomKey(kind, group, which)]
  if (code === '') return null                           // 「연결 안 함」으로 정한 것
  if (code) return (projects || []).find(p => p.code === code) || null
  return guessBom(projects, kind, group, which)
}

// ── 불출 건 ─────────────────────────────────────────────────────────
export function buildEvents(rows, rules, projects) {
  const ev = []
  for (const r of rows || []) {
    if (r.status === '완료') continue
    const kind = kindOf(r)
    if (!kind) continue
    const group = bomGroupOf(r)
    const mp = (Array.isArray(r.missing_parts) ? r.missing_parts : []).filter(m => String(m.pn || '').trim())
    let issuedDue = null
    for (const which of ['harn', 'elec']) {
      const done = truthy(which === 'harn' ? r.harness_recv : r.part_issue)
      const due = issueDueOf(r, rules, which)
      if (done) { if (due && (!issuedDue || due < issuedDue)) issuedDue = due; continue }
      const proj = bomProjectFor(rules, projects, kind, group, which)
      ev.push({ row: r, kind, group, which, due, proj, key: `${r.id}|${which}` })
    }
    // 불출은 했는데 빠진 자재가 있다 → 그 자재만
    if (mp.length && (truthy(r.harness_recv) || truthy(r.part_issue))) {
      ev.push({ row: r, kind, group, which: 'miss', due: issuedDue, missing: mp, key: `${r.id}|miss` })
    }
  }
  // 불출 예정일 순 (날짜 없으면 맨 뒤)
  ev.sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(a.key).localeCompare(String(b.key)))
  return ev
}

/**
 * @param events    buildEvents()
 * @param bom       { [project_id]: [{ item_id, qty }] }  1대당 소요
 * @param missItem  { [row.missing_parts pn]: item_id }
 * @param inv       { [item_id]: 현재고 }
 * @param orders    [{ item_id, qty, date, vendor, po }]   미입고 구매발주
 * @param today     'YYYY-MM-DD'
 */
export function matchNeed({ events, bom, missItem, inv, orders, today }) {
  const remaining = {}
  const cur = (id) => (remaining[id] !== undefined ? remaining[id] : Number(inv[id]) || 0)
  const byItem = {}
  for (const o of orders || []) (byItem[o.item_id] ||= []).push(o)
  Object.values(byItem).forEach(l => l.sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999'))))
  const applied = new Set()

  const cards = []
  for (const e of events) {
    // 이 불출일까지 들어올 발주를 먼저 더한다
    for (const [id, list] of Object.entries(byItem)) {
      for (const o of list) {
        const k = o.po + '|' + id
        if (applied.has(k) || !o.date || o.date < today) continue
        if (e.due && o.date <= e.due) { remaining[id] = cur(id) + o.qty; applied.add(k) }
      }
    }
    let lines = []
    if (e.which === 'miss') {
      for (const m of e.missing) {
        const id = missItem[String(m.pn).trim()]
        lines.push({ item_id: id || null, pn: m.pn, qty: Number(m.qty) || 1, missName: m.name })
      }
    } else if (e.proj) {
      lines = (bom[e.proj.id] || []).map(b => ({ item_id: b.item_id, qty: b.qty }))
    }
    const parts = []
    for (const l of lines) {
      if (!l.item_id) { parts.push({ ...l, before: null, short: l.qty, status: 'noitem' }); continue }
      const before = cur(l.item_id)
      const list = byItem[l.item_id] || []
      const overdue = list.filter(o => o.date && o.date < today)
      const beforeDue = list.filter(o => o.date && o.date >= today && e.due && o.date <= e.due)
      const afterDue = list.filter(o => !o.date || (o.date >= today && (!e.due || o.date > e.due)))
      let status = 'ok'
      if (l.qty > 0 && before < l.qty) {
        status = before < 0 ? (list.length ? 'late' : 'danger')
          : beforeDue.length ? 'warn' : overdue.length ? 'late' : afterDue.length ? 'after' : 'danger'
      }
      parts.push({ ...l, before, short: Math.max(0, l.qty - Math.max(before, 0)), status, overdue, beforeDue, afterDue,
        next: beforeDue[0] || overdue[0] || afterDue[0] || null })
      remaining[l.item_id] = before - l.qty
    }
    const bad = parts.filter(p => p.status !== 'ok')
    cards.push({ ...e, parts, bad: bad.length, critical: bad.some(p => ['danger', 'late', 'noitem'].includes(p.status)) })
  }

  // ── 품목별 부족 구간 ───────────────────────────────────────────────
  const all = []
  for (const c of cards) for (const p of c.parts) if (p.item_id) all.push({ t: 'out', date: c.due || '9999-12-31', id: p.item_id, qty: p.qty, card: c })
  for (const o of orders || []) if (o.date && o.date >= today) all.push({ t: 'in', date: o.date, id: o.item_id, qty: o.qty, o })
  all.sort((a, b) => a.date.localeCompare(b.date) || (a.t === 'in' ? -1 : 1))
  const left = {}, open = {}, periods = []
  for (const x of all) {
    if (left[x.id] === undefined) left[x.id] = Number(inv[x.id]) || 0
    if (x.t === 'in') {
      left[x.id] += x.qty
      if (open[x.id] && left[x.id] >= 0) { periods.push({ ...open[x.id], end: x.date, by: x.o }); delete open[x.id] }
    } else {
      left[x.id] -= x.qty
      if (left[x.id] < 0) {
        if (!open[x.id]) open[x.id] = { item_id: x.id, start: x.date, max: -left[x.id], first: x.card }
        else open[x.id].max = Math.max(open[x.id].max, -left[x.id])
      }
    }
  }
  Object.values(open).forEach(p => periods.push({ ...p, end: null, by: null }))
  periods.sort((a, b) => a.start.localeCompare(b.start) || b.max - a.max)
  return { cards, periods }
}

export const STATUS = {
  ok:     { label: '충분',            cls: 'text-emerald-600', dot: 'bg-emerald-500' },
  warn:   { label: '입고 반영해도 부족', cls: 'text-amber-600',   dot: 'bg-amber-500' },
  after:  { label: '불출 뒤 입고',      cls: 'text-orange-600',  dot: 'bg-orange-500' },
  late:   { label: '입고 지연',        cls: 'text-red-600',     dot: 'bg-red-500' },
  danger: { label: '발주 없음',        cls: 'text-red-600',     dot: 'bg-red-600' },
  noitem: { label: '품번 미등록',      cls: 'text-slate-500',   dot: 'bg-slate-400' },
}
export { KINDS }
