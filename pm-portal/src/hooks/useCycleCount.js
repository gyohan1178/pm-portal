import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toastError, toastSuccess } from '../lib/toast'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/paginate'

// 순환 실사 기초 데이터 — 렉 · 담당 · 센 기록 (v4.76.0)
//   재고현황 「오늘 실사」 카드와 칸 실사 화면(다음 칸)이 같이 쓴다 (같은 캐시).
//   담당 표(pm_rack_owner)가 없으면 = 순환 실사 SQL 을 아직 안 돌린 것 → setup:false
export async function fetchCycleBase() {
  const { data: owners, error: e1 } = await supabase.from('pm_rack_owner').select('*')   // late(맨 뒤) 칸은 SQL 전엔 없을 수 있어 * 로
  if (e1) return { setup: false, racks: [], owners: [], checks: [] }
  const { data: racks, error: e2 } = await supabase.from('pm_rack').select('code,rows_cnt,levels_cnt,zone,sort_no').order('sort_no')
  if (e2) throw e2
  const checks = await fetchAll(() => supabase.from('pm_cell_check')
    .select('id,location,check_date,checked_by,item_cnt,diff_cnt,empty').order('id'))
  // 예전 칸 실사(순환 실사 전) 날짜도 「센 날」로 친다
  const legacy = await fetchAll(() => supabase.from('pm_stock_audit').select('id,location,audit_date').order('id'))
  // 보류 칸 (v4.114.0) — 부를 때 저절로 풀 것(그 칸을 셈 · 음수 풀림)을 먼저 푼다. SQL 전이면 보류 없이
  const { data: holds, error: eh } = await supabase.rpc('pm_cell_hold_active')
  return {
    setup: true, racks: racks || [], owners: owners || [],
    holds: eh ? [] : (holds || []), holdSetup: !eh,
    checks: [...checks, ...legacy.map((a) => ({ location: a.location, check_date: a.audit_date }))],
  }
}

export function useCycleBase() {
  return useQuery({ queryKey: ['cycle'], queryFn: fetchCycleBase, staleTime: 60 * 1000 })
}

// 칸 보류 · 풀기 (v4.114.0) — 오늘 실사 카드 · 칸 실사 화면이 같이 쓴다
export function useCellHold() {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const run = async (fn, args, okMsg) => {
    setBusy(true)
    try {
      const { error } = await supabase.rpc(fn, args)
      if (error) throw error
      toastSuccess(okMsg)
      await qc.invalidateQueries({ queryKey: ['cycle'] })
      return true
    } catch (e) {
      const missing = e?.code === 'PGRST202' || /pm_cell_hold/.test(e?.message || '')
      toastError(missing ? '칸 보류는 DB 설정(순환실사_보류_반영_261029.sql)을 먼저 실행해야 합니다' : '보류 처리 실패: ' + (e?.message || e))
      return false
    } finally { setBusy(false) }
  }
  return {
    busy,
    hold: (loc, reason) => run('pm_cell_hold_set', { p_loc: loc, p_reason: reason || null }, `${loc} 보류 — 오늘 목록에서 빼고 다음 칸으로 채웠습니다`),
    release: (loc) => run('pm_cell_hold_release', { p_loc: loc }, `${loc} 보류 풂 — 다시 순서에 들어갑니다`),
  }
}

// 기본 사유 — 그 칸 음수 품목 수
export const holdReasonDefault = (negN) => (negN > 0 ? `음수 재고 ${negN}품목 — 입고 대기` : '')
