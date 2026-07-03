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

// 편집 권한 여부 (편집 이상 = editor, admin)
export function canEdit(profile) {
  return hasRole(profile, 'editor')
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
