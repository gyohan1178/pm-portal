// 구매발주 「제품 BOM 에서 가공품 불러오기」 (2026-10-12)
//   예전엔 BOM 줄의 수량을 그냥 더했다 → 상위 조립품 수량이 0(참조용)이거나 2개짜리 밑에 있어도
//   그대로 더해져, 110211211 에서 400001106 이 15개로 나왔다(실제 0).
//   이제 부족자재와 같은 규칙(DB pm_bom_explode: 상위 수량을 곱해 내려가고, 0 이면 하위도 0)으로 센다.
import { supabase } from './supabase'
import { explodeProjects } from './bomSupply'
import { catOf } from './utils'

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
  // 소수 전개(0.5 × 3 등) 오차 정리
  const rows = base.map(b => ({ ...b, qty_per_unit: Math.round(b.qty_per_unit * 10000) / 10000, items: meta[b.item_id] || null }))
    .sort((a, b) => String(a.items?.std_code || '').localeCompare(String(b.items?.std_code || '')))
  return { rows, exploded }
}
