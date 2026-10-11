// 구매처 목록 — ['vendors'] 캐시를 쓰는 화면이 모두 같은 모양을 받도록 한 곳에서 (2026-10-08)
//   예전엔 4곳이 각자 다른 칸을 받았다. 입고 화면을 먼저 열면 id · name 만 든 목록이 5분간 캐시를 차지해
//   구매발주에서 해외업체 판정(is_foreign) · markup 이 빠졌다.
import { supabase } from './supabase'

export async function fetchVendors() {
  const { data, error } = await supabase.from('vendors')
    .select('id,name,ecount_code,is_foreign,currency,markup,tariff_rate')
    .order('name').order('id')
  if (error) throw error
  return data || []
}
