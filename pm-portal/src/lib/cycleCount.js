// 순환 실사 (v4.76.0) — 계산만 하는 순수 함수 (화면 · 시험에서 같이 쓴다)
//
//   · 렉마다 담당자가 있다 (pm_rack_owner). 담당 렉의 칸 전부(빈 칸 포함)를 차례로 돈다.
//   · 칸 순서 = 렉 정렬순 → 칸(1,2,3…) → 층(1,2,3…)  예) J1-01-1, J1-01-2, J1-01-3, J1-02-1 …
//   · 오늘 셀 칸 = 이번 바퀴에서 아직 안 센 칸 먼저(센 횟수 적은 칸) → 「맨 뒤」 렉(불용재고 등)은 그 바퀴 끝에
//                  → 마지막으로 센 날이 오래된 칸 → 같으면 칸 순서 (붙어 있는 칸끼리)
//   · 렉 담당 표의 late=true 렉(예: G2 불용재고)은 칸 순서에서도 맨 뒤 (v4.77.2)
//   · 하루 기본 5칸. 「＋5칸 더」로 늘릴 수 있고, 목록 밖의 칸을 QR 로 세도 오늘 센 칸에 들어간다.
//   · 한 바퀴 = 담당 칸을 모두 한 번씩 센 것. 진행률 = 이번 바퀴에서 센 칸 / 담당 칸.

export const DAILY = 5

const pad2 = (v) => String(v).padStart(2, '0')
export const cellLoc = (rack, row, level) => `${String(rack).toUpperCase()}-${pad2(row)}-${level}`

// 위치 글자 맞추기 — 'j1-2-2' → 'J1-02-2' (형식이 다르면 대문자 · 공백 제거만)
export function normLoc(s) {
  const t = String(s ?? '').trim().toUpperCase()
  const m = t.match(/^([A-Z0-9]+)-(\d+)-(\d+)$/)
  return m ? cellLoc(m[1], Number(m[2]), Number(m[3])) : t
}
export const rackOf = (loc) => normLoc(loc).split('-')[0]

// 렉 묶음 글 — ['J1','J2','K1',…,'M2','E1',…,'G1','W5','W6'] → 'J1~M2 · E1~G1 · W5~W6'
//   렉 정렬순(racks)에서 끊기지 않고 이어지는 것끼리 묶는다.
export function rackRanges(codes, racks) {
  const order = (racks || []).map((r) => r.code)
  const idx = new Map(order.map((c, i) => [c, i]))
  const list = [...new Set(codes)].filter((c) => idx.has(c)).sort((a, b) => idx.get(a) - idx.get(b))
  const out = []
  let s = null, p = null
  for (const c of list) {
    if (s != null && idx.get(c) === idx.get(p) + 1) { p = c; continue }
    if (s != null) out.push(s === p ? s : `${s}~${p}`)
    s = c; p = c
  }
  if (s != null) out.push(s === p ? s : `${s}~${p}`)
  return out.join(' · ')
}

// 담당자별 칸 목록 (칸 순서대로)
//   racks: pm_rack [{code, rows_cnt, levels_cnt, sort_no}] · owners: pm_rack_owner [{rack_code, owner_name}]
export function ownerCells(racks, owners) {
  const who = new Map((owners || []).map((o) => [String(o.rack_code).toUpperCase(), o]))
  const isLate = (r) => !!who.get(String(r.code).toUpperCase())?.late
  const sorted = [...(racks || [])].sort((a, b) => (isLate(a) - isLate(b)) || (Number(a.sort_no) || 0) - (Number(b.sort_no) || 0))
  const out = new Map()   // name → { racks:[code], cells:[loc], late:Set(loc), lateRacks:[code] }
  for (const r of sorted) {
    const name = who.get(String(r.code).toUpperCase())?.owner_name
    if (!name) continue
    if (!out.has(name)) out.set(name, { racks: [], cells: [], late: new Set(), lateRacks: [] })
    const o = out.get(name)
    o.racks.push(r.code)
    if (isLate(r)) o.lateRacks.push(r.code)
    for (let row = 1; row <= (Number(r.rows_cnt) || 0); row++)
      for (let lv = 1; lv <= (Number(r.levels_cnt) || 0); lv++) {
        const loc = cellLoc(r.code, row, lv)
        o.cells.push(loc)
        if (isLate(r)) o.late.add(loc)
      }
  }
  return out
}

// 센 기록 → 칸별 { last: 마지막 날, days: 센 날 수 }
//   checks: [{location, check_date}] (pm_cell_check + 예전 칸 실사 pm_stock_audit 날짜를 합쳐 넣는다)
export function checkMap(checks) {
  const m = new Map()
  for (const c of checks || []) {
    const loc = normLoc(c.location), d = String(c.check_date || c.audit_date || '').slice(0, 10)
    if (!loc || !d) continue
    if (!m.has(loc)) m.set(loc, { last: d, dates: new Set([d]) })
    else { const x = m.get(loc); x.dates.add(d); if (d > x.last) x.last = d }
  }
  for (const x of m.values()) x.days = x.dates.size
  return m
}

// 오늘 목록
//   target: 오늘 목표 칸 수 (5, ＋5칸 더 누르면 10 …)
//   반환: { list:[{loc, done, last, days, order}], done, target, left }
//   late: 「맨 뒤」 칸 Set (불용재고 렉 등) — 같은 바퀴 안에서 맨 끝으로
export function todayPlan(cells, cm, today, target = DAILY, late = null) {
  const info = (loc, i) => {
    const x = cm.get(loc)
    return { loc, i, last: x?.last || null, days: x?.days || 0, done: x?.last === today, late: !!late?.has(loc) }
  }
  const all = (cells || []).map(info)
  const done = all.filter((c) => c.done)
  const pending = all.filter((c) => !c.done).sort((a, b) => {
    if (a.days !== b.days) return a.days - b.days            // 이번 바퀴에서 안 센 칸(센 횟수 적은 칸) 먼저
    if (a.late !== b.late) return a.late ? 1 : -1            // 「맨 뒤」 렉은 그 바퀴 끝에
    if (!a.last !== !b.last) return a.last ? 1 : -1          // 안 센 칸 먼저
    if (a.last !== b.last) return a.last < b.last ? -1 : 1   // 오래된 칸 먼저
    return a.i - b.i                                          // 칸 순서
  })
  const need = Math.max(0, target - done.length)
  const next = pending.slice(0, need)
  // 화면 순서: 오늘 센 칸(칸 순서) → 다음 칸(셀 순서)
  const list = [...done.sort((a, b) => a.i - b.i), ...next]
  return { list, done: done.length, target, left: next.length, nextLoc: next[0]?.loc || null, pendingAll: pending.length }
}

// 한 바퀴 진행 — round: 지금 몇 바퀴째(1부터) · counted: 이번 바퀴에서 센 칸 · pct
export function roundStats(cells, cm) {
  const total = (cells || []).length
  if (!total) return { round: 1, counted: 0, total: 0, pct: 0 }
  let min = Infinity
  for (const loc of cells) min = Math.min(min, cm.get(loc)?.days || 0)
  const counted = cells.filter((loc) => (cm.get(loc)?.days || 0) > min).length
  return { round: min + 1, counted, total, pct: Math.floor((counted / total) * 100) }
}

// 칸별 품목 수 — 재고(위치 있는 것, 수량 0 포함)에서
export function itemsByLoc(inv) {
  const m = new Map()
  for (const r of inv || []) {
    if (!r.location) continue
    const k = normLoc(r.location)
    m.set(k, (m.get(k) || 0) + 1)
  }
  return m
}

// 담당자의 일거리 — 칸 수 · 품목 수 (칸에 품목이 몰려 있으면 칸 수보다 일이 많다)
export function workload(cells, byLoc) {
  let items = 0, filled = 0
  for (const loc of cells || []) { const k = byLoc.get(loc) || 0; items += k; if (k) filled++ }
  return { cells: (cells || []).length, filled, items }
}

// 이 칸의 담당자
export function ownerOfLoc(loc, owners) {
  const r = rackOf(loc)
  return (owners || []).find((o) => String(o.rack_code).toUpperCase() === r)?.owner_name || null
}

// 「＋5칸 더」 — 오늘 날짜에만 유효 (이 기기에 기억)
const XKEY = 'pm.cycleExtra.v1'
export function loadExtra(today) {
  try { const x = JSON.parse(localStorage.getItem(XKEY) || 'null'); return x && x.d === today ? Number(x.n) || 0 : 0 } catch { return 0 }
}
export function saveExtra(today, n) {
  try { localStorage.setItem(XKEY, JSON.stringify({ d: today, n })) } catch { /* 기억 못 해도 그만 */ }
}

// ── 할 일 탭 (v4.78.0) ──
//   못 한 날은 넘기지 않는다 — 매일 5칸. 못 한 날은 이번 주 줄에 0 으로만 남는다.
const WD = ['일', '월', '화', '수', '목', '금', '토']
const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dow = (ymd) => new Date(`${ymd}T12:00:00Z`).getUTCDay()

// 실사하는 날 = 평일 · 공휴일 아님
export const isWorkday = (ymd, isHoliday = () => false) => { const w = dow(ymd); return w !== 0 && w !== 6 && !isHoliday(ymd) }

// 이번 주 월~금 — [{ d, label, n, today, future, off }]
//   n = 그날 센 담당 칸 수 (누가 셌든 그 사람 렉 칸)
export function weekStrip(cells, cm, today, isHoliday = () => false) {
  const w = dow(today)
  const mon = addDays(today, w === 0 ? -6 : 1 - w)
  const out = []
  for (let k = 0; k < 5; k++) {
    const d = addDays(mon, k)
    let n = 0
    for (const loc of cells || []) if (cm.get(loc)?.dates?.has(d)) n++
    out.push({ d, label: WD[dow(d)], n, today: d === today, future: d > today, off: isHoliday(d) })
  }
  return out
}
