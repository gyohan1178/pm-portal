import { useState, Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Sidebar from './Sidebar'
import SettingsModal from '../SettingsModal'
import CommandPalette from '../CommandPalette'

const CUSTOMER_NAMES = { ax:'AXCELIS', ed:'Edwards', vm:'VM', csk:'CSK' }
const PAGE_LABELS = {
  '':         ['', '전체 현황'],
  // 일일 업무
  inbound:    ['일일 업무', '입고'],
  outbound:   ['일일 업무', '출고'],
  issue:      ['일일 업무', '출고 작업(불출)'],
  inventory:  ['일일 업무', '재고현황'],
  search:     ['일일 업무', '통합 검색'],
  // 고객사 업무
  'po-upload':['고객사 업무', '통합 PO'],
  'forecast-shortage': ['소요·부족', '소요 예측'],
  // 생산
  production: ['생산', '생산 대시보드'],
  missing:    ['생산', '결품 현황'],
  // 주간 / 분석
  weekly:     ['주간 / 분석', '주간업무보고'],
  'purchase-dashboard': ['주간 / 분석', '매입 현황'],
  'control-tower': ['주간 / 분석', '마스터 관제탑'],
  'what-if':  ['주간 / 분석', 'What-if 시뮬레이터'],
  insights:   ['주간 / 분석', '인사이트 (관리자)'],
  // 기초자료
  items:      ['기초자료', '기준코드 DB'],
  vendors:    ['기초자료', '협력사'],
  price:      ['기초자료', '단가변동이력'],
  erp:        ['기초자료', 'ERP 연동'],
  quote:      ['기초자료', '견적입력'],
  help:       ['', '도움말'],
  // 고객사 work 탭 (section = 고객사명)
  cpo:        [null, '고객사 PO'],
  purchase:   [null, '구매발주'],
  short:      [null, '부족자재'],
  bom:        [null, 'BOM'],
  reqbom:     [null, '소요량 조회'],
  forecast:   [null, '포캐스트'],
}

export default function Layout({ profile }) {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const segments = location.pathname.split('/').filter(Boolean)
  let section = '', title = '전체 현황'

  if (segments[0] === 'customer' && segments[1]) {
    section = CUSTOMER_NAMES[segments[1]] || segments[1]
    title = PAGE_LABELS[segments[2] || '']?.[1] || segments[2] || ''
  } else if (segments[0] === 'master' && segments[1]) {
    const info = PAGE_LABELS[segments[1]]
    section = info?.[0] || ''; title = info?.[1] || segments[1]
  } else if (segments[0]) {
    const info = PAGE_LABELS[segments[0]]
    section = info?.[0] || ''; title = info?.[1] || segments[0]
  }

  async function handleLogout() { await supabase.auth.signOut() }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* 모바일 오버레이 */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)} />
      )}

      {/* 사이드바 - 모바일: fixed overlay, 데스크탑: static */}
      <div className={`
        fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-in-out
        lg:relative lg:transform-none lg:z-auto
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <Sidebar onNavigate={() => setSidebarOpen(false)} profile={profile} />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* 헤더 */}
        <header className="border-b border-slate-200 px-4 flex items-center gap-3 flex-shrink-0 bg-white" style={{height:'52px'}}>
          {/* 햄버거 버튼 - 모바일만 */}
          <button onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          </button>
          <div className="min-w-0">
            {section && <p className="text-xs text-slate-400 font-medium truncate">{section}</p>}
            <h1 className="text-sm font-bold text-slate-900 leading-tight tracking-tight truncate">{title}</h1>
          </div>
          <div className="flex-1" />
          <button onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
            className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors flex-shrink-0 mr-1" title="빠른 실행 (Ctrl+K)">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <span className="font-mono">⌘K</span>
          </button>
          <button onClick={() => setSettingsOpen(true)}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded hover:bg-slate-100 transition-colors flex-shrink-0" title="설정">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          </button>
          {profile?.role === 'viewer' && (
            <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded flex-shrink-0" title="열람 전용 계정 — 데이터 수정 불가">🔒 열람 전용</span>
          )}
          <button onClick={handleLogout}
            className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded hover:bg-slate-100 transition-colors flex-shrink-0">
            로그아웃
          </button>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-5">
          <Suspense fallback={<div className="flex items-center justify-center py-20 text-sm text-slate-400">불러오는 중...</div>}>
            <Outlet />
          </Suspense>
        </main>
        {settingsOpen && <SettingsModal profile={profile} onClose={() => setSettingsOpen(false)} />}
      </div>
      <CommandPalette />
    </div>
  )
}
