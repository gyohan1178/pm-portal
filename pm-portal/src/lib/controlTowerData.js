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
      // TODO: 컬럼 이름 확인 후 필요한 열만 뽑도록 좁힐 것.
      //   지금은 8,743 행을 통째로 받아 화면 열 때마다 무겁다.
      reqs.push(
        supabase.from('forecast_shortage_cache').select('*')
          .eq('customer_id', cid).order('item_id').range(i * 1000, i * 1000 + 999)
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

// 구매발주 — 자재를 사 오는 쪽. 위 fetchPOsFor 는 고객사 PO(파는 쪽)다.
async function fetchBuyPOsFor(customerIds) {
  const per = await Promise.all(customerIds.map(cid =>
    supabase.from('purchase_orders')
      .select('id,po_number,promise_date,order_date,qty_ordered,qty_received,qty_remaining,unit_price,status,customer_id,item_id,vendor_id, items!purchase_orders_item_id_fkey(std_code,name), vendors(name)')
      .eq('customer_id', cid)
      .eq('order_type', 'purchase')          // neq 는 null 을 걸러내 못 잡는다
      // 지난 것(지연)과 앞으로 2주(예정)를 함께 가져온다
      .lte('promise_date', new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10))
      .neq('status', '취소')
      .then(r => r.data || [])
  ))
  return per.flat()
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
          .eq('customer_code', code.toUpperCase()).order('id').range(i * 1000, i * 1000 + 999)
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

  const [shortage, pos, prod, buyPos] = await Promise.all([
    fetchShortageFor(ids),
    fetchPOsFor(ids),
    fetchProdFor(codes),
    fetchBuyPOsFor(ids),
  ])

  // 마스터(all)일 때 고객사별 분해도 같이
  const byCustomer = {}
  if (scope === 'all') {
    for (const c of customers) {
      byCustomer[c.code] = {
        shortage: shortage.filter(r => r.customer_id === c.id),
        pos: pos.filter(p => p.customer_id === c.id),
        prod: prod.filter(p => (p.customer_code || '').toLowerCase() === c.code),
        buyPos: buyPos.filter(p => p.customer_id === c.id),
        name: c.name,
      }
    }
  }

  return { shortage, pos, prod, buyPos, customers: target, byCustomer }
}
