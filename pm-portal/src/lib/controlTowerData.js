import { supabase } from '../lib/supabase'

// customers code → id 매핑 캐시
async function getCustomers() {
  const { data } = await supabase.from('customers').select('id, code, name')
  return data || []
}

async function fetchShortageFor(customerIds) {
  // 고객사별로 병렬 + 페이지도 병렬 (순차 왕복 제거)
  const perCustomer = await Promise.all(customerIds.map(async (cid) => {
    // 1) 총 개수 파악
    const { count } = await supabase.from('forecast_shortage_cache')
      .select('*', { count: 'exact', head: true }).eq('customer_id', cid)
    if (!count) return []
    // 2) 필요한 페이지 수만큼 한꺼번에 요청
    const pages = Math.ceil(count / 1000)
    const reqs = []
    for (let i = 0; i < pages; i++) {
      reqs.push(
        supabase.from('forecast_shortage_cache').select('*')
          .eq('customer_id', cid).range(i * 1000, i * 1000 + 999)
          .then(r => r.data || [])
      )
    }
    const chunks = await Promise.all(reqs)
    return chunks.flat()
  }))
  return perCustomer.flat()
}

async function fetchPOsFor(customerIds) {
  const perCustomer = await Promise.all(customerIds.map(cid =>
    supabase.from('purchase_orders').select('*')
      .eq('customer_id', cid).eq('order_type', 'customer_po').neq('status', '완료')
      .then(r => r.data || [])
  ))
  return perCustomer.flat()
}

async function fetchProdFor(codes) {
  // production.customer_code 는 대문자 — 고객사별 병렬
  const perCode = await Promise.all(codes.map(async (code) => {
    const { count } = await supabase.from('production')
      .select('*', { count: 'exact', head: true }).eq('customer_code', code.toUpperCase())
    if (!count) return []
    const pages = Math.ceil(count / 1000)
    const reqs = []
    for (let i = 0; i < pages; i++) {
      reqs.push(
        supabase.from('production').select('*')
          .eq('customer_code', code.toUpperCase()).range(i * 1000, i * 1000 + 999)
          .then(r => r.data || [])
      )
    }
    return (await Promise.all(reqs)).flat()
  }))
  return perCode.flat()
}

// scope: 'ax' | 'ed' | 'vm' | 'csk' | 'all'
export async function fetchControlTowerData(scope) {
  const customers = await getCustomers()
  const target = scope === 'all' ? customers : customers.filter(c => c.code === scope)
  const ids = target.map(c => c.id)
  const codes = target.map(c => c.code)

  const [shortage, pos, prod] = await Promise.all([
    fetchShortageFor(ids),
    fetchPOsFor(ids),
    fetchProdFor(codes),
  ])

  // 마스터(all)일 때 고객사별 분해도 같이
  const byCustomer = {}
  if (scope === 'all') {
    for (const c of customers) {
      byCustomer[c.code] = {
        shortage: shortage.filter(r => r.customer_id === c.id),
        pos: pos.filter(p => p.customer_id === c.id),
        prod: prod.filter(p => (p.customer_code || '').toLowerCase() === c.code),
        name: c.name,
      }
    }
  }

  return { shortage, pos, prod, customers: target, byCustomer }
}
