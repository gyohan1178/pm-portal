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
// 지금 로그인한 사람. 할 일 담당자·댓글 작성자에 쓴다.
export function useMe() {
  const { data } = useQuery({
    queryKey: ['me'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null
      const { data: p } = await supabase.from('pm_profiles')
        .select('id,email,name,role,status').eq('id', user.id).single()
      return p
    },
  })
  return data || null
}

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

// 편집 권한 — 불러오기 전에는 false.
//   useCanEdit 는 화면이 깜빡이지 않도록 기본을 true 로 두는데,
//   재고처럼 가려야 하는 정보에는 그 사이 잠깐 노출되는 것이 문제다.
//   모를 때는 숨기는 쪽을 택한다.
export function useCanEditStrict() {
  const { data, isLoading } = useQuery({
    queryKey: ['myRoleLite'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return null
      const { data: p } = await supabase.from('pm_profiles').select('role,status').eq('id', user.id).single()
      return p
    },
  })
  if (isLoading || !data) return false
  return canEdit(data)
}

// 자재 요청 등록 권한.
//   요청은 현장 누구나 낼 수 있어야 한다. 조회 계정도 등록만은 가능하게 한다.
//   (처리 — 불출·발주·반려 — 는 편집 권한자만 할 수 있다)
export function useCanRequest() {
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
  if (!data) return true
  // 거절·대기 계정만 막는다. 그 외에는 역할과 무관하게 요청할 수 있다.
  return data.status !== 'rejected' && data.status !== 'pending'
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
  // 부서 업무·주간회의 안건 — 계정마다 허용해 쓴다
  { key: 'todo',   label: '📋 할 일' },
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
  if (pathname === '/todo') return 'todo'
  if (pathname.startsWith('/production') || pathname === '/field-search' || pathname === '/board' || pathname === '/drawings' || pathname === '/schedule-changes' || pathname === '/material-request') return 'floor'
  if (pathname === '/inventory' || pathname === '/outbound' || pathname === '/issue' || pathname === '/missing' || pathname === '/search' || pathname === '/rack-layout' || pathname === '/finder' || pathname === '/lot' || pathname === '/upload' || pathname.startsWith('/cell/') || pathname.startsWith('/rack/')) return 'mat'
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
const SECTION_LANDING = { todo: '/todo', floor: '/field-search', mat: '/search', buy: '/inbound', sales: '/sales', report: '/weekly', master: '/master/items' }
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
  // 자재 요청은 누구나 접근한다 — 현장에서 요청을 내야 하기 때문이다.
  // 처리(불출·발주)는 화면 안에서 편집 권한으로 다시 가린다.
  if (pathname === '/material-request') return true

  // 도움말은 누구나 본다.
  //   'home' 으로 분류되어 관제탑 규칙에 걸리면서
  //   현장·조회 계정이 열지 못하던 문제가 있었다.
  if (pathname === '/help') return true

  // 삭제 기록 복구는 편집 권한자만
  if (pathname === '/restore') return canEdit(profile)

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
