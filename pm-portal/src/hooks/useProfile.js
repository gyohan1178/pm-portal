import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// 현재 로그인 사용자의 프로필(role, status) 조회
export function useProfile(session) {
  return useQuery({
    queryKey: ['profile', session?.user?.id],
    enabled: !!session?.user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pm_profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

// 권한 헬퍼 — 관리자 / 편집 / 조회 3단계
export const ROLE_LABEL = {
  admin: '관리자',
  editor: '편집',
  viewer: '조회',
  field_edit: '현장(수정)',
  field_view: '현장(열람)',
}
export const STATUS_LABEL = {
  pending: '승인 대기',
  approved: '활성',
  rejected: '거절됨',
}

// role 우선순위 (높을수록 권한 큼)
export const ROLE_RANK = { viewer: 0, editor: 1, admin: 2 }
export function hasRole(profile, minRole) {
  if (!profile) return false
  return (ROLE_RANK[profile.role] ?? -1) >= (ROLE_RANK[minRole] ?? 99)
}

// 현장 전용 계정인가 (현장 메뉴만 접근)
export function isFieldOnly(profile) {
  return profile?.role === 'field_edit' || profile?.role === 'field_view'
}

// 편집 권한 여부 (editor·admin, 또는 현장수정)
export function canEdit(profile) {
  if (profile?.role === 'field_edit') return true
  if (profile?.role === 'field_view') return false
  return hasRole(profile, 'editor')
}

// 현장 전용 계정이 접근 가능한 경로 (이 외에는 차단)
export const FIELD_PATHS = ['/production', '/production/AX', '/search', '/board']
export function canAccessPath(profile, pathname) {
  if (!isFieldOnly(profile)) return true // 일반 계정은 전체 접근
  return FIELD_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
}

// 세션 없이 현재 사용자 프로필 조회 (profile prop 못 받는 컴포넌트용)
export function useMyProfile() {
  return useQuery({
    queryKey: ['myProfile'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null
      const { data } = await supabase.from('pm_profiles').select('*').eq('id', user.id).maybeSingle()
      return data
    },
  })
}
