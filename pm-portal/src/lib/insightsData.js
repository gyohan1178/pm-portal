import { supabase } from '../lib/supabase'

async function pageAll(table, select, build) {
  // 총 개수 먼저 → 페이지 병렬 요청 (순차 왕복 제거)
  let cq = supabase.from(table).select('*', { count: 'exact', head: true })
  if (build) cq = build(cq)
  const { count } = await cq
  if (!count) return []
  const pages = Math.ceil(count / 1000)
  const reqs = []
  for (let i = 0; i < pages; i++) {
    let q = supabase.from(table).select(select)
    if (build) q = build(q)
    reqs.push(q.range(i * 1000, i * 1000 + 999).then(r => r.data || []))
  }
  return (await Promise.all(reqs)).flat()
}

export async function fetchInsightsData() {
  const [priceRows, vendors, pos, prod, inbound, shortage] = await Promise.all([
    supabase.from('price_history').select('*, items(std_code,name), vendors(name)').then(r => r.data || []),
    supabase.from('vendors').select('id,name').then(r => r.data || []),
    pageAll('purchase_orders', '*'),
    pageAll('production', '*'),
    supabase.from('stock_movements').select('*').eq('movement_type', '입고').limit(2000).then(r => r.data || []).catch(() => []),
    pageAll('forecast_shortage_cache', 'item_id,year_month,projected'),
  ])
  return { priceRows, vendors, pos, prod, inbound, shortage }
}
