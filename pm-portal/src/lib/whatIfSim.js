// ─────────────────────────────────────────────────────────────
// What-if 시뮬레이터 — 쇼티지 데이터에 변수 적용해 재계산
// 변수: 입고지연(주), 수요증감(%), 안전재고 추가
// ─────────────────────────────────────────────────────────────

function thisMonth() { return new Date().toISOString().slice(0, 7) }
function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// 캐시 행 → 품번별 묶음
export function foldForSim(cacheRows) {
  const tm = thisMonth()
  const map = {}
  for (const r of cacheRows) {
    if (r.year_month < tm) continue
    const k = r.item_id
    if (!map[k]) map[k] = { item_id: r.item_id, std_code: r.std_code, name: r.name, lt_weeks: r.lt_weeks, current_stock: r.current_stock, cells: {} }
    map[k].cells[r.year_month] = { demand: r.demand || 0, incoming: r.incoming || 0 }
  }
  return Object.values(map)
}

// 시뮬레이션 적용
// params: { incomingDelayWeeks, demandPct, safetyPct }
//   incomingDelayWeeks: 입고를 N주 늦춤 (월 단위 근사)
//   demandPct: 수요 ±% (예: +20 → 1.2배)
//   safetyPct: 현재고의 N%를 안전 버퍼로 확보(차감) — 품목 규모에 비례
export function simulateShortage(items, params = {}) {
  const { incomingDelayWeeks = 0, demandPct = 0, safetyPct = 0 } = params
  const delayMonths = Math.round(incomingDelayWeeks / 4.345)
  const demandMul = 1 + (demandPct / 100)
  const safetyMul = safetyPct / 100

  const out = []
  for (const it of items) {
    const months = Object.keys(it.cells).sort()
    if (!months.length) continue

    // 입고 지연: incoming을 delayMonths 만큼 뒤로 밀기
    const shiftedIncoming = {}
    for (const m of months) {
      const tgt = delayMonths > 0 ? addMonths(m, delayMonths) : m
      shiftedIncoming[tgt] = (shiftedIncoming[tgt] || 0) + it.cells[m].incoming
    }

    // projected 재계산 (안전 버퍼 = 현재고의 safetyPct%)
    const cur = it.current_stock || 0
    let running = cur - Math.round(cur * safetyMul)
    let firstNeg = null, minProj = Infinity
    const cells = {}
    for (const m of months) {
      const demand = (it.cells[m].demand || 0) * demandMul
      const incoming = shiftedIncoming[m] || 0
      running = running + incoming - demand
      cells[m] = { demand: Math.round(demand), incoming: Math.round(incoming), projected: Math.round(running) }
      if (running < 0 && !firstNeg) firstNeg = m
      if (running < minProj) minProj = running
    }
    out.push({ ...it, simCells: cells, firstNeg, minProjected: Math.round(minProj) })
  }
  return out
}

// 기준(현재) vs 시뮬 비교 요약
export function compareSim(baseItems, simItems) {
  const tm = thisMonth()
  const within3 = (ym) => {
    if (!ym) return false
    const [y, m] = ym.split('-').map(Number); const now = new Date()
    return (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()) <= 3
  }
  const baseRisk = baseItems.filter(it => it.firstNeg).length
  const simRisk = simItems.filter(it => it.firstNeg).length
  const baseUrgent = baseItems.filter(it => within3(it.firstNeg)).length
  const simUrgent = simItems.filter(it => within3(it.firstNeg)).length
  // 새로 위험해진 품목
  const baseNegSet = new Set(baseItems.filter(it => it.firstNeg).map(it => it.item_id))
  const newlyRisk = simItems.filter(it => it.firstNeg && !baseNegSet.has(it.item_id))
  return { baseRisk, simRisk, baseUrgent, simUrgent, newlyRisk }
}
