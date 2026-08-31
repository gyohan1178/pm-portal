// 품목 검색 결과에 재고와 보관위치를 붙인다.
//
//   같은 제조사품번인데 코드가 여러 개 등록된 경우가 있다.
//   그중 실제로 재고를 관리하는 것은 하나뿐이라,
//   화면만 봐서는 어느 것을 골라야 하는지 알 수 없었다.
//
//   재고가 붙어 있으면 고를 때 바로 보인다.
//   다품목 출고 · 구매발주 · 통합검색이 같은 함수를 쓴다.

import { supabase } from './supabase'

// 한 품목이 여러 위치에 나뉘어 있을 수 있어 합산하고 위치는 모은다
export async function stockByItemIds(ids) {
  const out = {}
  const list = [...new Set((ids || []).filter(Boolean))]
  if (!list.length) return out

  // .in() 에 한꺼번에 넣으면 결과가 잘리고 주소도 길어진다
  for (let i = 0; i < list.length; i += 200) {
    const { data, error } = await supabase.from('inventory')
      .select('item_id,qty,location')
      .in('item_id', list.slice(i, i + 200))
    if (error) throw error
    for (const r of data || []) {
      const o = out[r.item_id] || (out[r.item_id] = { qty: 0, locs: new Set() })
      o.qty += Number(r.qty) || 0
      if (r.location) o.locs.add(r.location)
    }
  }
  for (const k of Object.keys(out)) {
    out[k] = { qty: out[k].qty, location: [...out[k].locs].join(', ') }
  }
  return out
}

// 검색 결과 배열에 stock·location 을 붙여 돌려준다
export async function attachStock(rows, idField = 'id') {
  if (!rows?.length) return rows || []
  const map = await stockByItemIds(rows.map(r => r[idField]))
  return rows.map(r => ({
    ...r,
    stock: map[r[idField]]?.qty ?? 0,
    location: map[r[idField]]?.location ?? '',
    hasStock: !!map[r[idField]],       // 재고를 관리하는 품목인지
  }))
}
