// 주간업무보고 — 순환실사 운영 현황 (v4.189.0)
//   담당자별: 이번 주 센 칸 / 목표 · 한 바퀴 진행률 · 차이 발견 품목 · 재고 반영
//   기록은 이미 쌓이는 것만 쓴다 — 센 기록 pm_cell_check · 품목별 실사 pm_stock_audit (새 표 없음)
import { supabase } from './supabase'
import { fetchAll } from './paginate'
import { ownerCells, withHelpers, checkMap, roundStats, heldSet, dailyOf, rackRanges, isWorkday, ownerOfLoc, normLoc } from './cycleCount'
import { isHoliday } from './bizdays'

const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

// 계산만 (시험용 순수 함수)
//   base: fetchCycleBase 결과 · audits: 그 주 pm_stock_audit 줄 · people: [{id,name}] · today: 오늘(한국)
export function cycleWeek({ base, audits, people, from, to, today, holiday = isHoliday }) {
  if (!base?.setup) return { setup: false, rows: [], sum: null, diffs: [] }
  const cfg = base.people || {}
  const byOwner = withHelpers(ownerCells(base.racks, base.owners), cfg)
  const cmAll = checkMap(base.checks)
  const held = heldSet(base)
  const uidOf = (name) => (people || []).find((p) => p.name === name)?.id || null
  // 그 주에 실사하는 날 — 오늘 이후는 목표에서 뺀다 (이번 주를 주중에 볼 때)
  const end = today && today < to ? today : to
  const days = []
  for (let d = from; d <= end; d = addDays(d, 1)) if (isWorkday(d, holiday)) days.push(d)
  const inWeek = (c) => { const d = String(c.check_date || '').slice(0, 10); return d >= from && d <= to }
  const weekChecks = (base.checks || []).filter(inWeek)

  const rows = []
  for (const [name, o] of byOwner) {
    const uid = uidOf(name)
    if (o.helper && !uid) continue                       // 아직 가입 전 도우미
    const cells = new Set(o.cells)
    const own = (o.helper || o.shared) && uid            // 도우미 · 도우미가 붙은 담당자는 자기가 센 칸만
    const seen = new Set()
    for (const c of weekChecks) {
      const loc = normLoc(c.location)
      if (!cells.has(loc)) continue
      if (own && c.checked_by !== uid) continue
      seen.add(`${String(c.check_date).slice(0, 10)}|${loc}`)
    }
    const daily = dailyOf(cfg, name)
    rows.push({
      name, helper: !!o.helper, of: o.of || null,
      racks: rackRanges(o.racks, base.racks),
      counted: seen.size, target: daily * days.length, daily,
      rs: o.helper ? null : roundStats(o.cells, cmAll, held),   // 한 바퀴는 렉 담당 기준 (도우미는 같은 칸이라 중복)
      diff: 0, applied: 0,
    })
  }
  // 차이 — 그 주 실사에서 장부와 실물이 달랐던 품목 (칸의 렉 담당자에게 붙인다)
  const diffs = (audits || []).filter((a) => Number(a.diff) !== 0)
  const byName = new Map(rows.map((r) => [r.name, r]))
  for (const a of diffs) {
    const r = byName.get(ownerOfLoc(a.location, base.owners))
    if (!r) continue
    r.diff++; if (a.applied) r.applied++
  }
  const main = rows.filter((r) => !r.helper)
  const tot = main.reduce((s, r) => ({ counted: s.counted + (r.rs?.counted || 0), total: s.total + (r.rs?.total || 0) }), { counted: 0, total: 0 })
  const sum = {
    counted: rows.reduce((a, r) => a + r.counted, 0), target: rows.reduce((a, r) => a + r.target, 0),
    lapCounted: tot.counted, lapTotal: tot.total, lapPct: tot.total ? Math.floor((tot.counted / tot.total) * 100) : 0,
    diff: diffs.length, applied: diffs.filter((a) => a.applied).length, days: days.length,
  }
  const top = [...diffs].sort((a, b) => Math.abs(Number(b.diff)) - Math.abs(Number(a.diff))).slice(0, 5)
  return { setup: true, rows, sum, diffs: top }
}

export async function fetchWeeklyCycle(from, to, today, fetchCycleBase) {
  const base = await fetchCycleBase()
  if (!base?.setup) return { setup: false, rows: [], sum: null, diffs: [] }
  const [audits, ppl] = await Promise.all([
    fetchAll(() => supabase.from('pm_stock_audit')
      .select('id,location,audit_date,book_qty,counted_qty,diff,applied,items(std_code,name)')
      .gte('audit_date', from).lte('audit_date', to).order('id')).catch(() => []),
    supabase.rpc('pm_todo_people').then((r) => r.data || [], () => []),
  ])
  return cycleWeek({ base, audits, people: ppl, from, to, today })
}
