import { Outlet, useMatches } from 'react-router-dom'
import Sidebar from './Sidebar'

const CUSTOMER_NAMES = { ax: 'AXCELIS', ed: 'Edwards', vm: 'VM', csk: 'CSK' }
const PAGE_LABELS = {
  '':        ['', '전체 현황'],
  inbound:   ['공통 업무', '입고'],
  outbound:  ['공통 업무', '출고'],
  quote:     ['공통 업무', '견적입력'],
  issues:    ['공통 업무', '이슈'],
  todo:      ['공통 업무', 'Todo'],
  erp:       ['', 'ERP 연동'],
  items:     ['기초자료', '기준코드 DB'],
  vendors:   ['기초자료', '협력사'],
  price:     ['기초자료', '단가이력'],
  po:        [null, '발주현황'],
  short:     [null, '부족자재 분석'],
  bom:       [null, 'BOM'],
}

export default function Layout() {
  const matches = useMatches()
  const last = matches[matches.length - 1]
  const segments = last.pathname.replace(/^\/pm-portal/, '').split('/').filter(Boolean)

  let section = ''
  let title = '전체 현황'
  let customerName = ''

  if (segments[0] === 'customer' && segments[1]) {
    customerName = CUSTOMER_NAMES[segments[1]] || segments[1]
    const sub = segments[2] || ''
    section = customerName
    title = PAGE_LABELS[sub]?.[1] || sub
  } else if (segments[0] === 'master' && segments[1]) {
    const info = PAGE_LABELS[segments[1]]
    section = info?.[0] || ''
    title = info?.[1] || segments[1]
  } else if (segments[0]) {
    const info = PAGE_LABELS[segments[0]]
    section = info?.[0] || ''
    title = info?.[1] || segments[0]
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 상단바 */}
        <header className="h-13 border-b border-slate-200 px-5 flex items-center gap-3 flex-shrink-0">
          <div>
            {section && (
              <p className="text-[11px] text-slate-400 font-500">{section}</p>
            )}
            <h1 className="text-sm font-700 text-slate-900 leading-tight tracking-tight">
              {title}
            </h1>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-700">
              교
            </div>
            <span className="text-xs font-600 text-slate-700">교한</span>
          </div>
        </header>

        {/* 페이지 콘텐츠 */}
        <main className="flex-1 overflow-y-auto p-5">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
