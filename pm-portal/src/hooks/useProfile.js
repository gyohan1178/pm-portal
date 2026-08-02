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

// 페이지 어디서든 내 편집권한 확인 (뷰어 가드용) — 로딩 중엔 true(RLS가 최종 방어)
export function useCanEdit() {
  const { data } = useQuery({
    queryKey: ['myRoleLite'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null
      const { data: p } = await supabase.from('pm_profiles').select('role,status').eq('id', user.id).single()
      return p
    },
  })
  return data ? canEdit(data) : true
}

// 편집 권한 여부 (editor·admin, 또는 현장수정)
export function canEdit(profile) {
  if (profile?.role === 'field_edit') return true
  if (profile?.role === 'field_view') return false
  return hasRole(profile, 'editor')
}

// ── 상위메뉴(섹션)별 접근 권한 ──
// menu_scope(jsonb 배열)로 사용자별 허용 섹션 지정. 비어있으면 전체 접근(admin/editor/viewer 기본)
export const SECTIONS = [
  // 관제탑은 전사 현황이 보이므로 지정한 인원만 허용한다
  { key: 'home',   label: '🎯 관제탑' },
  { key: 'floor',  label: '🏭 현장' },
  { key: 'mat',    label: '📦 자재' },
  { key: 'buy',    label: '🛒 구매' },
  { key: 'sales',  label: '🤝 영업' },
  { key: 'report', label: '📊 분석' },
  { key: 'master', label: '⚙️ 기초자료' },
]

// 이 프로필이 접근 가능한 섹션 목록 (null = 전체)
export function allowedSections(profile) {
  if (!profile) return []
  if (profile.role === 'field_edit' || profile.role === 'field_view') return ['floor'] // 현장 role = 현장만
  const ms = profile.menu_scope
  if (Array.isArray(ms) && ms.length > 0) return ms
  return null // 지정 없음 = 전체
}
export function canAccessSection(profile, key) {
  const a = allowedSections(profile)
  return a === null || a.includes(key)
}

// 경로 → 섹션 매핑 (라우트 가드용)
export function sectionOfPath(pathname) {
  if (pathname === '/' || pathname === '') return 'home'
  if (pathname.startsWith('/production') || pathname === '/field-search' || pathname === '/board' || pathname === '/drawings' || pathname === '/schedule-changes' || pathname === '/material-request') return 'floor'
  if (pathname === '/inventory' || pathname === '/outbound' || pathname === '/issue' || pathname === '/missing' || pathname === '/search' || pathname === '/rack-tags' || pathname === '/rack-layout' || pathname === '/upload' || pathname.startsWith('/cell/') || pathname.startsWith('/rack/')) return 'mat'
  // 구매 — 입고·품목 단가 등록(/quote)
  if (pathname === '/inbound' || pathname === '/quote' || pathname === '/payment-plan') return 'buy'
  // 영업 — 매출견적(+견적이력 내부 탭)
  if (pathname === '/sales-quote' || pathname === '/quote-history') return 'sales'
  // 분석 — 원가분석이 여기로 이동
  if (pathname.startsWith('/weekly') || pathname === '/ecount' || pathname === '/purchase-dashboard'
      || pathname === '/sales' || pathname === '/cost'
      || pathname === '/what-if' || pathname === '/insights') return 'report'
  if (pathname.startsWith('/master') || pathname === '/erp' || pathname === '/activity') return 'master'
  // 고객사 하위 경로: 마지막 세그먼트로 판정
  if (pathname.startsWith('/customer/')) {
    if (pathname.endsWith('/short')) return 'buy'   // 자재 상황판 — 부족 확인 후 발주로 이어지므로 구매
    if (pathname.endsWith('/purchase')) return 'buy'
    if (pathname.endsWith('/cpo') || pathname.endsWith('/forecast')) return 'sales'
    if (pathname.endsWith('/bom') || pathname.endsWith('/reqbom')) return 'master'
  }
  return 'home' // 그 외(설정 등)는 홈 취급 → 전체 허용
}

// 제한 계정의 기본 착지 경로 (접근 불가 페이지 진입 시 여기로)
const SECTION_LANDING = { floor: '/field-search', mat: '/search', buy: '/inbound', sales: '/sales', report: '/weekly', master: '/master/items' }
export function landingPath(profile) {
  if (profile?.role === 'field_edit' || profile?.role === 'field_view') return '/production'
  const a = allowedSections(profile)
  if (a !== null) {
    // 관제탑(home) 이 허용되면 홈으로, 아니면 허용된 첫 섹션으로.
    // 현장 검색은 모두가 볼 수 있는 화면이라 기본 도착지로 둔다.
    if (a.includes('home')) return '/'
    return SECTION_LANDING[a.find(x => x !== 'home')] || '/field-search'
  }
  if (profile?.role === 'viewer') return '/search'   // 제한 없는 조회 계정: 통합검색
  return '/'          // 전체 접근 (menu_scope 없음)
}

// 특정 경로 접근 가능? (섹션 제한 계정 대응)
export function canAccessPath(profile, pathname) {
  const sec = sectionOfPath(pathname)
  if (sec === 'home') {
    // 관제탑은 지정한 사람만 본다.
    // menu_scope 에 'home' 이 있어야 하며, 없으면 landingPath 로 보낸다.
    if (isFieldOnly(profile) || profile?.role === 'viewer') return false
    return canAccessSection(profile, 'home')
  }
  return canAccessSection(profile, sec)
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
