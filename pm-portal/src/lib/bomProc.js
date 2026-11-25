// 구매발주 「제품 BOM 에서 가공품 불러오기」 (2026-10-12)
//   예전엔 BOM 줄의 수량을 그냥 더했다 → 상위 조립품 수량이 0(참조용)이거나 2개짜리 밑에 있어도
//   그대로 더해져, 110211211 에서 400001106 이 15개로 나왔다(실제 0).
//   이제 부족자재와 같은 규칙(DB pm_bom_explode: 상위 수량을 곱해 내려가고, 0 이면 하위도 0)으로 센다.
import { supabase } from './supabase'
import { explodeProjects } from './bomSupply'
import { catOf, PROC_CATS } from './utils'

// 판금으로 보는 거래처 — 품목 분류가 판금이 아니어도 이 업체 품목이면 판금 발주 대상 (김교한 차장 2026-10-12)
export const SHEET_METAL_VENDORS = ['동신', '정금', '뉴엔']
export const isSheetMetalVendor = (name) => !!name && SHEET_METAL_VENDORS.some(v => String(name).includes(v))

// 판금만 보기에 넣을지 + 왜 들어갔는지
export function procReason(items) {
  if (!items) return null
  if (catOf(items) === '판금') return 'cat'
  if (items.proc_order) return 'flag'
  if (isSheetMetalVendor(items.vendors?.name)) return 'vendor'
  return null
}

const ITEM_SEL = 'id,std_code,name,type,js_code,unit,manufacturer,manufacturer_code,purchase_price,proc_order,vendor_id,vendors(name)'

// 제품 1대당 품목별 실제 소요 → [{ item_id, qty_per_unit, items }]
//   pm_bom_explode 가 없으면(SQL 전) 예전처럼 BOM 줄을 더하고 exploded:false 로 알린다.
export async function fetchProjectProcRows(customerId, projectId) {
  const ex = await explodeProjects(customerId, [projectId])
  let base, exploded = true
  if (ex) {
    const sum = {}
    ex.forEach(r => { if (r.item_id) sum[r.item_id] = (sum[r.item_id] || 0) + (Number(r.qty_per_unit) || 0) })
    base = Object.entries(sum).filter(([, q]) => q > 0).map(([item_id, q]) => ({ item_id, qty_per_unit: q }))
  } else {
    exploded = false
    const { data, error } = await supabase.from('bom').select('item_id, qty_per_unit')
      .eq('customer_id', customerId).eq('project_id', projectId)
    if (error) throw error
    const sum = {}
    ;(data || []).forEach(r => { if (r.item_id) sum[r.item_id] = (sum[r.item_id] || 0) + (Number(r.qty_per_unit) || 0) })
    base = Object.entries(sum).map(([item_id, q]) => ({ item_id, qty_per_unit: q }))
  }
  const ids = base.map(b => b.item_id)
  const meta = {}
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await supabase.from('items').select(ITEM_SEL).in('id', ids.slice(i, i + 300))
    if (error) throw error
    ;(data || []).forEach(it => { meta[it.id] = it })
  }
  // 품목별 도면 REV — 가공물 발주서 「규격」에 「REV C」로 따라간다 (2026-10-14)
  const revs = await fetchBomRevs(customerId, ids, projectId)
  // 소수 전개(0.5 × 3 등) 오차 정리
  const rows = base.map(b => ({ ...b, qty_per_unit: Math.round(b.qty_per_unit * 10000) / 10000, items: meta[b.item_id] || null, rev: revs[b.item_id] || '' }))
    .sort((a, b) => String(a.items?.std_code || '').localeCompare(String(b.items?.std_code || '')))
  return { rows, exploded }
}

// BOM 에 적힌 품목 REV (bom.item_rev) — item_id → 'C'
//   같은 품목이 여러 BOM 에 있으면 ① 지금 고른 제품 BOM 의 값 ② 없으면 가장 높은 REV (B < C < AA)
export const revRank = (r) => { const v = String(r || '').trim().toUpperCase(); return v ? v.length * 100 + (v.charCodeAt(v.length - 1) - 64) + (v.length > 1 ? (v.charCodeAt(0) - 64) * 30 : 0) : -1 }
export async function fetchBomRevs(customerId, itemIds, projectId = null) {
  const ids = [...new Set((itemIds || []).filter(Boolean))]
  const best = {}, own = {}
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('bom').select('item_id,item_rev,project_id')
      .eq('customer_id', customerId).in('item_id', ids.slice(i, i + 200)).not('item_rev', 'is', null)
    if (error) throw error
    ;(data || []).forEach(r => {
      const v = String(r.item_rev || '').trim().toUpperCase(); if (!v) return
      if (projectId && r.project_id === projectId) { if (revRank(v) > revRank(own[r.item_id])) own[r.item_id] = v }
      if (revRank(v) > revRank(best[r.item_id])) best[r.item_id] = v
    })
  }
  const out = {}
  ids.forEach(id => { const v = own[id] || best[id]; if (v) out[id] = v })
  return out
}

// 가공물 제조사품번 + 도면 REV — 「170023456_C」 (v4.251.0, 사용자 지정 형식)
//   제조사품번이 없으면 기준코드(AX- 뺀 것)에 붙인다 · 이미 _REV 가 붙어 있으면 그대로
export function mpnRev(code, rev, stdCode = '') {
  const c = String(code || '').trim() || String(stdCode || '').trim().replace(/^AX-/i, '')
  const r = String(rev || '').trim().toUpperCase()
  if (!r) return c
  if (!c) return `_${r}`
  return c.toUpperCase().endsWith(`_${r}`) ? c : `${c}_${r}`
}
// 가공물(판금 · 어셈블리 · 하네스)인지 — 분류 정보를 안 읽어 온 품목은 가공물로 본다(REV 가 저장돼 있으면 붙인다)
export const isProcItem = (it) => (!it || (!it.js_code && !it.type)) ? true : PROC_CATS.has(catOf(it))
// 발주 줄의 제조사품번 — 가공물이고 REV 가 저장된 줄은 「제조사품번_REV」
export const poMpn = (p, rev) => {
  const r = rev || p?.item_rev
  return r && isProcItem(p?.items) ? mpnRev(p?.items?.manufacturer_code, r, p?.items?.std_code) : (p?.items?.manufacturer_code || '')
}
// 이카운트 발주서 「규격」 — 제조사 · 제조사품번, 가공물은 「제조사품번_REV」
export const ecountSpec = (po, rev) => [po.items?.manufacturer, poMpn(po, rev || po.item_rev || '')].filter(Boolean).join(' ')

// 발주 저장할 때 가공물(판금 · 어셈블리 · 하네스) 줄에 그때 BOM 의 최신 REV 를 채운다 (v4.251.0)
//   이미 REV 가 있는 줄(BOM 담기 등)은 그대로 · BOM 에 REV 가 없으면 비워 둔다
//   rows: purchase_orders insert 줄들 (customer_id · item_id) → 같은 배열에 item_rev 를 채워 돌려준다
export async function fillProcRevs(rows) {
  const need = (rows || []).filter(r => r && !r.item_rev && r.item_id && r.customer_id)
  if (!need.length) return rows
  const ids = [...new Set(need.map(r => r.item_id))]
  const proc = new Set()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('items').select('id,js_code,type').in('id', ids.slice(i, i + 200))
    if (error) throw error
    ;(data || []).forEach(it => { if (PROC_CATS.has(catOf(it))) proc.add(it.id) })
  }
  const target = need.filter(r => proc.has(r.item_id))
  for (const cid of [...new Set(target.map(r => r.customer_id))]) {
    const m = await fetchBomRevs(cid, target.filter(r => r.customer_id === cid).map(r => r.item_id))
    target.filter(r => r.customer_id === cid).forEach(r => { if (m[r.item_id]) r.item_rev = m[r.item_id] })
  }
  return rows
}
