// ─────────────────────────────────────────────────────────────
// 인사이트 분석 로직 — PPV / 공급처 스코어카드 / 활동추적 / North Star
// 모두 순수 함수. 이미 있는 데이터(price_history, PO, production)로 계산.
// ─────────────────────────────────────────────────────────────

const dayMs = 86400000
function dDays(a, b) { return Math.round((new Date(a).setHours(0,0,0,0) - new Date(b).setHours(0,0,0,0)) / dayMs) }

// ── 1. PPV (Purchase Price Variance) — 단가 이상 감지 ──
// price_history: [{ item_id, vendor_id, year, price, items{std_code,name}, vendors{name} }]
// 품번별로 연도 추세 + 같은 품번 거래처별 가격차 + 급등 감지
export function computePPV(priceRows) {
  const byItem = {}
  for (const r of priceRows) {
    const k = r.item_id
    if (!byItem[k]) byItem[k] = { item_id: k, std_code: r.items?.std_code, name: r.items?.name, records: [] }
    byItem[k].records.push({ year: r.year, price: Number(r.price) || 0, vendor: r.vendors?.name || '미지정', vendor_id: r.vendor_id })
  }

  const alerts = []
  for (const it of Object.values(byItem)) {
    const recs = it.records.filter(r => r.price > 0).sort((a, b) => a.year - b.year)
    if (recs.length < 1) continue

    // (a) 연도별 급등: 최근 vs 직전
    if (recs.length >= 2) {
      const last = recs[recs.length - 1], prev = recs[recs.length - 2]
      if (prev.price > 0) {
        const chg = ((last.price - prev.price) / prev.price) * 100
        if (Math.abs(chg) >= 10) {
          alerts.push({
            type: chg > 0 ? 'price_up' : 'price_down',
            std_code: it.std_code, name: it.name,
            detail: `${prev.year} ${prev.price.toLocaleString()}원 → ${last.year} ${last.price.toLocaleString()}원`,
            pct: Math.round(chg), severity: Math.abs(chg),
          })
        }
      }
    }

    // (b) 같은 품번, 거래처별 가격차 (최신 연도 기준)
    const latestYear = Math.max(...recs.map(r => r.year))
    const sameYear = recs.filter(r => r.year === latestYear)
    if (sameYear.length >= 2) {
      const prices = sameYear.map(r => r.price)
      const min = Math.min(...prices), max = Math.max(...prices)
      if (min > 0 && (max - min) / min >= 0.05) {
        const cheapest = sameYear.find(r => r.price === min)
        const dearest = sameYear.find(r => r.price === max)
        alerts.push({
          type: 'vendor_gap',
          std_code: it.std_code, name: it.name,
          detail: `${dearest.vendor} ${max.toLocaleString()}원 vs ${cheapest.vendor} ${min.toLocaleString()}원`,
          pct: Math.round(((max - min) / min) * 100), severity: ((max - min) / min) * 100,
        })
      }
    }
  }
  alerts.sort((a, b) => b.severity - a.severity)
  return alerts
}

// ── 2. 공급처 스코어카드 ──
// pos: 발주(구매발주) 데이터, vendors: 거래처
// 거래처별: 납기준수율, PO건수, 단가 안정성(가격이력 변동 횟수)
export function computeVendorScorecard(pos, vendors, priceRows) {
  const today = Date.now()
  const vmap = {}
  for (const v of vendors) vmap[v.id] = { id: v.id, name: v.name, total: 0, onTime: 0, late: 0, delayDays: 0 }

  for (const p of pos) {
    if (!p.vendor_id || !vmap[p.vendor_id]) continue
    const v = vmap[p.vendor_id]
    v.total++
    // 납기 준수: 완료된 것 중 promise_date 지켰나 (실입고일 없으면 status로 근사)
    if (p.status === '완료') {
      // promise_date 대비 — 실제 입고일 필드 없으면 약속일 기준만
      v.onTime++   // 완료된 건 일단 준수로 (실입고일 있으면 정밀화)
    } else if (p.promise_date && new Date(p.promise_date).getTime() < today) {
      v.late++
      v.delayDays += dDays(today, p.promise_date)
    }
  }

  // 단가 변동 횟수 (price_history에서 거래처별)
  const priceChanges = {}
  const byVendorItem = {}
  for (const r of priceRows) {
    if (!r.vendor_id) continue
    const k = `${r.vendor_id}|${r.item_id}`
    if (!byVendorItem[k]) byVendorItem[k] = []
    byVendorItem[k].push(Number(r.price) || 0)
  }
  for (const [k, prices] of Object.entries(byVendorItem)) {
    const vid = k.split('|')[0]
    if (prices.length >= 2) {
      // 변동 있었나
      const changed = new Set(prices).size > 1
      if (changed) priceChanges[vid] = (priceChanges[vid] || 0) + 1
    }
  }

  const cards = Object.values(vmap).filter(v => v.total > 0).map(v => {
    const completed = v.onTime + v.late
    const onTimeRate = completed > 0 ? Math.round((v.onTime / completed) * 100) : null
    const avgDelay = v.late > 0 ? Math.round(v.delayDays / v.late) : 0
    const priceVar = priceChanges[v.id] || 0
    // 점수: 납기 50% + 단가안정 30% + 거래량 20%
    let score = 50
    if (onTimeRate != null) score = onTimeRate * 0.5 + (priceVar === 0 ? 30 : Math.max(0, 30 - priceVar * 5)) + Math.min(20, v.total)
    return { ...v, onTimeRate, avgDelay, priceVar, score: Math.round(score) }
  }).sort((a, b) => b.score - a.score)

  return cards
}

// ── 3. 활동 추적 ──
// 각 데이터의 created_at/updated_at으로 "얼마나 성실히 썼나"
export function computeActivity({ pos = [], prod = [], inbound = [], priceRows = [] }, weeks = 4) {
  const now = Date.now()
  const weekMs = 7 * dayMs
  const inLastWeeks = (ts, n) => ts && (now - new Date(ts).getTime()) <= n * weekMs

  // 데이터별 신선도 (마지막 업데이트)
  const lastUpdate = (arr, field = 'updated_at') => {
    const ts = arr.map(x => x[field] ? new Date(x[field]).getTime() : 0).filter(Boolean)
    return ts.length ? Math.max(...ts) : null
  }

  const freshness = {
    po: lastUpdate(pos), prod: lastUpdate(prod), inbound: lastUpdate(inbound, 'created_at'),
  }
  const daysAgo = (ts) => ts ? Math.floor((now - ts) / dayMs) : null

  // 최근 N주 활동량
  const recent = {
    poCreated: pos.filter(p => inLastWeeks(p.created_at, weeks)).length,
    poUpdated: pos.filter(p => inLastWeeks(p.updated_at, weeks)).length,
    prodUpdated: prod.filter(p => inLastWeeks(p.updated_at, weeks)).length,
    inbound: inbound.filter(p => inLastWeeks(p.created_at, weeks)).length,
  }

  // 연간 누적
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime()
  const thisYear = (ts) => ts && new Date(ts).getTime() >= yearStart
  const yearly = {
    po: pos.filter(p => thisYear(p.created_at)).length,
    prod: prod.filter(p => thisYear(p.created_at)).length,
    inbound: inbound.filter(p => thisYear(p.created_at)).length,
  }

  // 신선도 경고 (N일 이상 미갱신)
  const staleWarnings = []
  if (daysAgo(freshness.prod) != null && daysAgo(freshness.prod) >= 3) staleWarnings.push({ what: '생산 현황', days: daysAgo(freshness.prod) })
  if (daysAgo(freshness.po) != null && daysAgo(freshness.po) >= 7) staleWarnings.push({ what: 'PO', days: daysAgo(freshness.po) })

  return { freshness: { po: daysAgo(freshness.po), prod: daysAgo(freshness.prod), inbound: daysAgo(freshness.inbound) }, recent, yearly, staleWarnings }
}

// ── 4. North Star: 쇼티지 0일수 + 적시납품률 ──
export function computeNorthStar({ shortage = [], pos = [] }) {
  // 적시납품률: 완료 PO 중 약속일 지킨 비율 (실입고일 없으면 완료=준수 근사)
  const completed = pos.filter(p => p.status === '완료')
  const delayed = pos.filter(p => p.status === '지연' || (p.status !== '완료' && p.promise_date && new Date(p.promise_date) < new Date()))
  const onTimeRate = (completed.length + delayed.length) > 0
    ? Math.round((completed.length / (completed.length + delayed.length)) * 100) : null

  // 쇼티지: 현재 음수 예정 품목 수 (0이면 건강)
  const tm = new Date().toISOString().slice(0, 7)
  const negItems = new Set()
  for (const r of shortage) {
    if (r.year_month >= tm && r.projected < 0) negItems.add(r.item_id)
  }

  return {
    onTimeRate,
    shortageRiskItems: negItems.size,
    completedPO: completed.length,
    delayedPO: delayed.length,
  }
}
