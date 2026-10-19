import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// 주요 관리대상 PD BOX 품번 — 기본 목록 (2026-07-02 16개 + 2026-10-19 4개)
// — 주요 품번만: 가공물·하네스·전장 일정 체크 + 하네스 우선순위 · 생산 전광판 · QR · 납기변경 PD BOX
// — 나머지(sub assy)는 진행상태만 표시
// 화면에서 바꾸기 (v4.73.0): 생산관리 › 모델별 › 「구분」 칸 → DB pm_main_pn 에 남고, 이 기본 목록보다 우선한다.
//   표가 아직 없으면(SQL 전) 이 기본 목록만 쓴다.
export const DEFAULT_MAIN_PNS = new Set([
  '110116240', // ASSY PWR DISTRIBUTION HEB PD
  '110132770', // Assembly Remote PD Standard LTI 208/480VAC
  '110134250', // ASSY LINAC PD
  '110140450', // ASSY CONTROLLER THREE-AXIS MANIPULATOR
  '110147240', // Assembly Remote PD Standard 208/480VAC
  '110153030', // ASSY MAIN PD
  '110158840', // ASSY EFEM PD
  '110167070', // Assembly End Station PD CVCF
  '110171800', // ASSY TERM PD 480VAC
  '110171970', // ASSY TERM PD 208VAC
  '110172280', // ASSY MAIN PD ELCB
  '110173200', // ASSY RM PD
  '110211211', // ASSY RMT PD PWR VACC 208/480VAC RT LOAD
  '110214084', // ASSY PWR DISTR LEB PD
  '110215107', // ASSY PD CONT REAR CORNER
  '110226948', // ASSY END STATION PD
  // 2026-10-19 추가
  '110173680',
  '110208273',
  '110208360',
  '110219638', // ASSY PWR DIST EFEM (110158840 신규품)
])
// 예전 이름 — 기본 목록. 판별은 isMainPn 으로 (화면에서 바꾼 값까지 반영)
export const MAIN_PNS = DEFAULT_MAIN_PNS

// 화면에서 바꾼 값 (pm_main_pn: pn → is_main). 기본 목록보다 우선
const OVR = new Map()
export const normPn = (pn) => String(pn || '').trim().replace(/^AX-/i, '')
export const isMainPn = (pn) => { const k = normPn(pn); return OVR.has(k) ? OVR.get(k) : DEFAULT_MAIN_PNS.has(k) }
export const isOverridden = (pn) => OVR.has(normPn(pn))
export function applyMainOverrides(rows) {
  OVR.clear()
  ;(rows || []).forEach((r) => { if (r && r.pn) OVR.set(normPn(r.pn), !!r.is_main) })
}
const MISSING = /pm_main_pn|does not exist|schema cache|Could not find/i
export async function fetchMainOverrides() {
  const { data, error } = await supabase.from('pm_main_pn').select('pn,is_main')
  if (error) {
    if (MISSING.test(error.message || '')) { applyMainOverrides([]); return { rows: [], missing: true } }
    throw error
  }
  applyMainOverrides(data || [])
  return { rows: data || [], missing: false }
}
// 화면에서 쓰는 곳은 이걸 불러 둔다 — 값이 바뀌면 ver 가 바뀌어 다시 계산된다
export function useMainPns() {
  const q = useQuery({ queryKey: ['mainPns'], queryFn: fetchMainOverrides, staleTime: 5 * 60 * 1000 })
  return { ver: q.dataUpdatedAt || 0, missing: !!q.data?.missing, error: q.error || null }
}
export async function saveMainPn(pn, isMain) {
  const { error } = await supabase.from('pm_main_pn')
    .upsert({ pn: normPn(pn), is_main: !!isMain, updated_at: new Date().toISOString() }, { onConflict: 'pn' })
  if (error) throw error
}

// 주요 관리대상인지 — 고객사까지 본다.
//   AXCELIS 만 sub assy 를 따로 두고 위 목록(+ 화면에서 바꾼 값)으로 가른다.
//   Edwards 는 한 줄이 이미 프로젝트+호기+구분이라 모두 주요 관리대상이다.
//   (프로젝트가 36종이고 계속 늘어 목록으로 관리할 수 없다)
export const isMainRow = (pn, csCode) =>
  String(csCode || '').toUpperCase() === 'AX' ? isMainPn(pn) : true
