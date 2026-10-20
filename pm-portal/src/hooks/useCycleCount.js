import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/paginate'

// 순환 실사 기초 데이터 — 렉 · 담당 · 센 기록 (v4.76.0)
//   재고현황 「오늘 실사」 카드와 칸 실사 화면(다음 칸)이 같이 쓴다 (같은 캐시).
//   담당 표(pm_rack_owner)가 없으면 = 순환 실사 SQL 을 아직 안 돌린 것 → setup:false
export async function fetchCycleBase() {
  const { data: owners, error: e1 } = await supabase.from('pm_rack_owner').select('rack_code,owner_name')
  if (e1) return { setup: false, racks: [], owners: [], checks: [] }
  const { data: racks, error: e2 } = await supabase.from('pm_rack').select('code,rows_cnt,levels_cnt,zone,sort_no').order('sort_no')
  if (e2) throw e2
  const checks = await fetchAll(() => supabase.from('pm_cell_check')
    .select('id,location,check_date,checked_by,item_cnt,diff_cnt,empty').order('id'))
  // 예전 칸 실사(순환 실사 전) 날짜도 「센 날」로 친다
  const legacy = await fetchAll(() => supabase.from('pm_stock_audit').select('id,location,audit_date').order('id'))
  return {
    setup: true, racks: racks || [], owners: owners || [],
    checks: [...checks, ...legacy.map((a) => ({ location: a.location, check_date: a.audit_date }))],
  }
}

export function useCycleBase() {
  return useQuery({ queryKey: ['cycle'], queryFn: fetchCycleBase, staleTime: 60 * 1000 })
}
