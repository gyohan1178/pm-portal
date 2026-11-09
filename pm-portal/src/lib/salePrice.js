// 판매 실적가 (v4.162.0) — 고객사에 낸 판매단가를 품목 · 하위 부품별로 남기고, 다음 견적에서 그 값을 다시 쓴다
//   왜: 상위 ASSY 는 구성이 바뀌어도, 세부견적으로 나간 하위 부품 단가가 견적마다 달라지면 고객이 헷갈린다
//   · 기록: 매출견적 저장 때 — 단품 줄 단가 · ASSY 줄 단가 · ASSY 세부 부품 판매가(세부견적 계산과 같은 값)
//   · 사용: 같은 고객사 · 같은 통화의 직전 실적가가 있으면 그 값을 쓴다 (ASSY 는 하위 합계 + 작업비)
//           단품 줄 단가 + 세부견적으로 실제 나간 부품 단가 중 가장 최근 값 (세부견적 안 낸 부품 계산값은 기록만)
//   · 경고: 지금 매입가로 보면 마진이 구간 마진보다 5%p 넘게 낮거나 0 이하면 표시 — 「지금 계산가로」 로 바꿀 수 있음
//   SQL: 판매실적가_반영_261109.sql (pm_sale_price_hist · pm_last_sale_price)
import { supabase } from './supabase'
import { normMpn } from './quotePartsPaste'
import { tierMargin } from './costAnalysis'

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const up = (v) => String(v ?? '').trim().toUpperCase()

// 고객사 열쇠 — 고객사 id, 고객사 없는 견적(기타 · 직접 입력)은 「ETC:이름」
export const etcKey = (name) => (up(name) ? 'ETC:' + up(name) : null)
// 부품 · 품목 열쇠 — 기준코드, 없으면(부품표로 만든 줄) 제조사품번
export const partKey = (p) => (up(p?.std_code) ? up(p.std_code) : normMpn(p?.manufacturer_code) ? 'MPN:' + normMpn(p.manufacturer_code) : null)

// 지금 쓸 실적가 — 이 통화로 받은 값이 있고, 「지금 계산가로」를 누르지 않았으면
export const prevOf = (x, cur) => (x && x.usePrev !== false && x.salePrev && x.salePrev.currency === cur && n(x.salePrev.price) > 0 ? n(x.salePrev.price) : null)

// 실적가를 쓸 수 있는 부품 — 체크됨 · 단가 제외(문서 · 소요량 0) 아님 · 수량 있음
export const prevEligible = (p) => p && !p.excluded && p.status !== 'skip' && !p.supplySkip && n(p.qty) > 0

// 실적가의 지금 마진 — 매입가(원) 기준. null = 매입가 없음
export function prevMargin(buyKrw, price, cur, sellRate) {
  if (buyKrw == null || !(n(buyKrw) > 0) || !(n(price) > 0)) return null
  const krw = cur === 'KRW' ? n(price) : n(price) * (n(sellRate) || 1)
  return 1 - n(buyKrw) / krw
}
// 경고 — 'loss'(0 이하) · 'low'(구간 마진 −5%p 아래) · null
export function prevWarn(buyKrw, price, cur, sellRate, tiers) {
  const m = prevMargin(buyKrw, price, cur, sellRate)
  if (m == null) return null
  if (m <= 0) return 'loss'
  if (m < tierMargin(buyKrw, tiers) - 0.05) return 'low'
  return null
}

// 견적에 담긴 줄들의 열쇠 — 단품 줄 + ASSY 부품
export function saleKeys(lines) {
  const s = new Set()
  ;(lines || []).forEach((l) => {
    if (l.kind !== 'assy') { const k = partKey(l); if (k) s.add(k) }
    ;(Array.isArray(l.parts) ? l.parts : []).forEach((p) => { const k = partKey(p); if (k) s.add(k) })
  })
  return [...s].sort()
}

export const isMissingSaleFn = (e) => /pm_last_sale_price|pm_sale_price_hist|PGRST202|PGRST205|does not exist|schema cache/i.test(String(e?.message || e?.code || e || ''))

// 직전 실적가 — { key: { price, currency, quote_no, quote_date, detail_sent, parent_code, kind } }
//   SQL 전이면 { missing: true } 로 빈 값 (견적은 지금처럼)
export async function fetchSalePrev(custKey, currency, keys) {
  if (!custKey || !keys?.length) return { map: {}, missing: false }
  const map = {}
  for (let i = 0; i < keys.length; i += 300) {
    const { data, error } = await supabase.rpc('pm_last_sale_price', { p_cust_key: custKey, p_currency: currency, p_keys: keys.slice(i, i + 300) })
    if (error) { if (isMissingSaleFn(error)) return { map: {}, missing: true }; throw error }
    ;(data || []).forEach((r) => {
      map[r.code_key] = { price: n(r.unit_price), currency: r.currency, quote_no: r.quote_no, quote_date: r.quote_date,
        detail_sent: !!r.detail_sent, parent_code: r.parent_code || null, kind: r.kind }
    })
  }
  return { map, missing: false }
}

// 받은 실적가를 줄 · 부품에 붙인다. 바뀐 줄만 새 객체로 (단가 다시 뽑을 줄 표시: _prevChanged)
const samePrev = (a, b) => (a?.price ?? null) === (b?.price ?? null) && (a?.currency ?? null) === (b?.currency ?? null) && (a?.quote_no ?? null) === (b?.quote_no ?? null)
export function attachSalePrev(lines, map) {
  return (lines || []).map((l) => {
    let changed = false
    let nl = l
    if (l.kind !== 'assy') {
      const pv = map[partKey(l)] || null
      if (!samePrev(l.salePrev, pv)) { nl = { ...nl, salePrev: pv }; changed = true }
    }
    if (Array.isArray(l.parts)) {
      let pc = false
      const parts = l.parts.map((p) => {
        const pv = map[partKey(p)] || null
        if (samePrev(p.salePrev, pv)) return p
        pc = true
        return { ...p, salePrev: pv }
      })
      if (pc) { nl = { ...nl, parts }; changed = true }
    }
    return changed ? { ...nl, _prevChanged: true } : l
  })
}

/**
 * 저장할 실적가 줄
 * lines   : 견적 줄 · details: buildDetails(lines, …) 전체(세부견적 켬/끔과 관계없이) — 부품 판매가
 * ctx     : { custKey, customerId, customerName, currency, quote:{id, quote_no, quote_date}, detailOn, by }
 */
export function saleRows(lines, details, ctx) {
  const base = {
    cust_key: ctx.custKey, customer_id: ctx.customerId || null, customer_name: ctx.customerName || null,
    currency: ctx.currency, quote_id: ctx.quote.id, quote_no: ctx.quote.quote_no, quote_date: ctx.quote.quote_date,
    source: 'quote', created_by: ctx.by || null,
  }
  const out = []
  ;(lines || []).forEach((l) => {
    const price = n(l.unitPrice)
    const k = partKey(l)
    if (!k || !(price > 0)) return
    out.push({ ...base, code_key: k, std_code: up(l.std_code) || null, mpn: null, item_name: l.description || null,
      kind: l.kind === 'assy' ? 'assy' : 'item', parent_code: null, unit_price: price, qty: n(l.qty) || null,
      cost_krw: n(l.materialKrw) + n(l.laborKrw) || null, detail_sent: true })
  })
  ;(details || []).forEach(({ line, detail }) => {
    detail.rows.forEach((r) => {
      if (!r.key || !(n(r.price) > 0)) return
      out.push({ ...base, code_key: r.key, std_code: r.std_code && !String(r.key).startsWith('MPN:') ? up(r.std_code) : null,
        mpn: r.makerPn || null, item_name: r.name || null, kind: 'part', parent_code: up(line.std_code) || null,
        unit_price: n(r.price), qty: n(r.qty) || null, cost_krw: r.buyKrw != null ? n(r.buyKrw) : null, detail_sent: !!ctx.detailOn })
    })
  })
  return out
}

export async function recordSalePrices(rows) {
  if (!rows.length) return 0
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('pm_sale_price_hist').insert(rows.slice(i, i + 500))
    if (error) throw error
  }
  return rows.length
}
