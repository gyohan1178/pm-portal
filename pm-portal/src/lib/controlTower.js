// ─────────────────────────────────────────────────────────────
// Control Tower KPI 계산 — 순수 함수 (프레임워크 무관)
// 쇼티지 캐시 / PO / 생산 데이터를 받아 관제탑 지표 산출
// ─────────────────────────────────────────────────────────────

// ⚙️ 관제탑 임계값 — 여기만 고치면 전체 기준이 바뀝니다 (검토하며 조정)
export const THRESHOLDS = {
  orderBufferMonths: 1,   // 발주필요: 음수까지 (LT + 이 개월) 내면 지금 발주
  negSoonMonths: 3,       // 재고음수 임박: N개월 내 음수
  prodDelayDays: 7,       // 생산지연: 납기 D-N 내 미완료
  poSoonDays: 14,         // 납품임박 PO: N일 내 납기
  harnessWindowDays: 30,  // 하네스 불출필요: 입고 N일 내 미불출
  newPODays: 3,           // 신규 PO: 최근 N일 내 생성
}

const dayMs = 86400000
export function dDays(dateStr, today = new Date().setHours(0, 0, 0, 0)) {
  if (!dateStr) return null
  const d = new Date(String(dateStr).slice(0, 10)); if (isNaN(d)) return null
  return Math.round((d.setHours(0, 0, 0, 0) - today) / dayMs)
}
const thisMonth = () => new Date().toISOString().slice(0, 7)
function monthDiff(ym) {
  // 'YYYY-MM' → 현재월로부터 몇 개월 뒤 (음수면 과거)
  if (!ym) return 999
  const [y, m] = ym.split('-').map(Number)
  const now = new Date()
  return (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth())
}

// 쇼티지 캐시 행들을 품번별로 묶어 "첫 음수월 / 최저재고" 산출
function foldShortage(cacheRows) {
  const tm = thisMonth()
  const map = {}
  for (const r of cacheRows) {
    if (r.year_month < tm) continue   // 과거월 제외
    const k = r.item_id
    if (!map[k]) map[k] = { item_id: r.item_id, std_code: r.std_code, name: r.name, lt_weeks: r.lt_weeks, current_stock: r.current_stock, cells: {} }
    map[k].cells[r.year_month] = { demand: r.demand, incoming: r.incoming, projected: r.projected }
  }
  const items = Object.values(map)
  for (const it of items) {
    const months = Object.keys(it.cells).sort()
    it.firstNeg = null
    for (const m of months) { if (it.cells[m].projected < 0) { it.firstNeg = m; break } }
    it.minProjected = Math.min(...months.map(m => it.cells[m].projected ?? Infinity).filter(x => x !== Infinity))
  }
  return items
}

// ── 메인: 모든 KPI + TOP 리스트 산출 ──
// 입력: { shortage:[], pos:[], prod:[] }  (이미 scope로 필터된 데이터)
export function computeControlTower({ shortage = [], pos = [], prod = [] }) {
  const today = new Date().setHours(0, 0, 0, 0)
  const tm = thisMonth()
  const shortItems = foldShortage(shortage)

  // ── 🔴 즉시 대응 ──
  // 1) 발주 필요: 음수 예정이고 LT 고려 시 지금 발주해야 (firstNeg까지 남은 일수 <= LT주*7)
  const orderNeeded = shortItems.filter(it => {
    if (!it.firstNeg) return false
    const monthsToNeg = monthDiff(it.firstNeg)
    const ltMonths = (it.lt_weeks || 0) / 4.345   // 주→월 근사
    return monthsToNeg <= ltMonths + THRESHOLDS.orderBufferMonths
  }).map(it => ({
    kind: 'order', std_code: it.std_code, name: it.name,
    detail: `${it.firstNeg} 부족 (최저 ${it.minProjected}), LT ${it.lt_weeks || '?'}주`,
    urgency: 100 - monthDiff(it.firstNeg) * 5,   // 빠를수록 급함
    link: 'short',
  }))

  // 2) 재고 음수 임박: 3개월 내 projected<0
  const negSoon = shortItems.filter(it => it.firstNeg && monthDiff(it.firstNeg) <= THRESHOLDS.negSoonMonths)
  const negList = negSoon.map(it => ({
    kind: 'neg', std_code: it.std_code, name: it.name,
    detail: `${it.firstNeg}에 ${it.minProjected} (재고 바닥)`,
    urgency: 90 - monthDiff(it.firstNeg) * 10, link: 'short',
  }))

  // 3) 생산 지연: 납기 임박/지남인데 미완료 (req_date D-7 이하 & status≠완료)
  const prodDelay = prod.filter(p => {
    if (p.status === '완료') return false
    const d = dDays(p.req_date, today)
    return d != null && d <= THRESHOLDS.prodDelayDays
  }).map(p => {
    const d = dDays(p.req_date, today)
    const blockers = []
    if (!p.machine_recv) blockers.push('가공물 미입고')
    if (!p.harness_recv) blockers.push('하네스 미완료')
    if (!p.elec_recv) blockers.push('전장 미완료')
    return {
      kind: 'prodDelay', std_code: p.pn, name: `${p.name} ${p.hogi}`,
      detail: `${d < 0 ? `납기 ${-d}일 지남` : d === 0 ? '오늘 납기' : `D-${d}`}${blockers.length ? ' · ' + blockers.join(', ') : ''}`,
      urgency: 95 - d * 3, link: 'production',
    }
  })

  // ── 🟡 이번 주 챙길 것 ──
  // 4) 납품 임박 PO: promise_date 14일 내, 미완료
  const poSoon = pos.filter(p => {
    if (p.status === '완료') return false
    const d = dDays(p.promise_date, today)
    return d != null && d >= 0 && d <= THRESHOLDS.poSoonDays
  })

  // 5) 미입고 가공물: arrival_date 지났는데 machine_recv=false
  const lateArrival = prod.filter(p => {
    if (p.status === '완료' || p.machine_recv) return false
    const d = dDays(p.arrival_date, today)
    return d != null && d < 0
  }).map(p => ({
    kind: 'lateArrival', std_code: p.pn, name: `${p.name} ${p.hogi}`,
    detail: `입고예정 ${-dDays(p.arrival_date, today)}일 지남`, urgency: 70, link: 'production',
  }))

  // 6) 하네스 불출 필요: 입고 30일 내인데 미불출(harness_issue 없음) & 미완료
  const harnessNeed = prod.filter(p => {
    if (p.status === '완료' || p.harness_recv) return false
    const issued = p.harness_issue === true || (typeof p.harness_issue === 'string' && p.harness_issue.trim() && p.harness_issue !== 'false')
    if (issued) return false
    const d = dDays(p.arrival_date, today)
    return d != null && d <= THRESHOLDS.harnessWindowDays
  })

  // ── 🟢 모니터 ──
  // 7) 신규 PO: 최근 3일 내 생성
  const newPO = pos.filter(p => {
    const d = dDays(p.created_at, today)
    return d != null && d >= -THRESHOLDS.newPODays
  })
  // 8) 진행 중 생산
  const inProgress = prod.filter(p => p.status !== '완료')

  // ── ⚡ 통합 TOP 리스트 (긴급도순) ──
  const all = [...orderNeeded, ...prodDelay, ...negList, ...lateArrival]
  const seen = new Set()
  const top = all
    .sort((a, b) => b.urgency - a.urgency)
    .filter(x => { const k = x.kind + x.std_code + x.name; if (seen.has(k)) return false; seen.add(k); return true })
    .slice(0, 10)

  return {
    kpi: {
      orderNeeded: orderNeeded.length,
      negSoon: negSoon.length,
      prodDelay: prodDelay.length,
      poSoon: poSoon.length,
      lateArrival: lateArrival.length,
      harnessNeed: harnessNeed.length,
      newPO: newPO.length,
      inProgress: inProgress.length,
    },
    top,
    lists: { orderNeeded, negList, prodDelay, poSoon, lateArrival, harnessNeed, newPO },
  }
}
