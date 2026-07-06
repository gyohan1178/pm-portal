import { useState } from 'react'
import { isFieldOnly, canAccessSection } from '../../hooks/useProfile'
import { NavLink } from 'react-router-dom'
import { APP_VERSION, CHANGELOG } from '../../lib/version'
import { primaryCsCode } from '../../lib/customers'

const CUSTOMERS = [
  { id:'ax',  name:'AXCELIS', color:'#4F46E5' },
  { id:'ed',  name:'Edwards', color:'#3B82F6' },
  { id:'vm',  name:'VM',      color:'#059669' },
  { id:'csk', name:'CSK',     color:'#D97706' },
]

function usePersistOpen(key, defaultVal) {
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : defaultVal }
    catch { return defaultVal }
  })
  function toggle() { setOpen(v => { const n = !v; localStorage.setItem(key, JSON.stringify(n)); return n }) }
  return [open, toggle]
}

function MenuItem({ to, icon, children, end, onNavigate }) {
  return (
    <NavLink to={to} end={end} onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-4 py-[5px] text-[13px] font-medium relative transition-colors
        ${isActive
          ? 'text-indigo-600 bg-indigo-50 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:bg-indigo-600 before:rounded-r'
          : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}>
      <span className="text-sm w-4 text-center flex-shrink-0">{icon}</span>{children}
    </NavLink>
  )
}

function CollapseSection({ label, sKey, defaultOpen = true, children }) {
  const [open, toggle] = usePersistOpen(`sidebar_${sKey}`, defaultOpen)
  return (
    <div>
      <button onClick={toggle}
        className="w-full flex items-center justify-between px-4 pt-2 pb-0.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider hover:text-slate-600 transition-colors">
        {label}
        <span className={`text-slate-300 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}>▾</span>
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  )
}

function CustomerSection({ customer, onNavigate }) {
  const [open, toggle] = usePersistOpen(`sidebar_cs_${customer.id}`, true)
  const SUB = [
    { path:'cpo',     label:'고객사 PO' },
    { path:'short',   label:'부족자재' },
    { path:'purchase',label:'구매발주' },
    { path:'bom',     label:'BOM' },
    { path:'reqbom',  label:'소요량 조회' },
    { path:'forecast',label:'포캐스트' },
  ]
  return (
    <div>
      <button onClick={toggle}
        className="w-full flex items-center gap-2 px-4 py-1 hover:bg-slate-100 transition-colors">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: customer.color }} />
        <span className="text-xs font-bold text-slate-700 flex-1 text-left">{customer.name}</span>
        <span className={`text-slate-300 text-xs transition-transform duration-200 ${open ? '' : '-rotate-90'}`}>▾</span>
      </button>
      {open && SUB.map(s => (
        <NavLink key={s.path} to={`/customer/${customer.id}/${s.path}`} onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-1.5 pl-9 pr-4 py-[3px] text-xs font-medium transition-colors
            before:content-[''] before:w-1 before:h-1 before:rounded-full before:bg-current before:flex-shrink-0
            ${isActive ? 'text-indigo-600 font-semibold' : 'text-slate-400 hover:text-slate-700'}`}>
          {s.label}
        </NavLink>
      ))}
    </div>
  )
}

function ChangelogModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <p className="text-sm font-bold text-slate-900">업데이트 이력</p>
            <p className="text-xs text-slate-400 mt-0.5">PM Portal {APP_VERSION}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg w-8 h-8 flex items-center justify-center">✕</button>
        </div>
        <div className="overflow-y-auto p-5 space-y-5">
          {CHANGELOG.map(log => (
            <div key={log.version}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">{log.version}</span>
                <span className="text-xs text-slate-400">{log.date}</span>
              </div>
              <ul className="space-y-1">
                {log.changes.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                    <span className="text-slate-300 mt-0.5 flex-shrink-0">•</span>{c}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Sidebar({ onNavigate, profile }) {
  const isAdmin = profile?.role === 'admin'
  const fieldOnly = isFieldOnly(profile)
  const pcs = primaryCsCode(profile)
  const [showChangelog, setShowChangelog] = useState(false)

  return (
    <>
      <aside className="w-56 min-w-[224px] h-full bg-slate-50 border-r border-slate-200 flex flex-col overflow-y-auto">
        {/* 로고 */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <img src="/logo.png" alt="진선테크" className="h-7 object-contain" />
            <p className="text-xs text-slate-400 mt-0.5">구매/자재 포털</p>
          </div>
          {/* 모바일 닫기 버튼 */}
          {onNavigate && (
            <button onClick={onNavigate} className="lg:hidden p-1 text-slate-400 hover:text-slate-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          )}
        </div>

        {/* 홈 — 현장·조회 계정은 숨김 */}
        {!fieldOnly && profile?.role !== 'viewer' && (
        <div className="py-1">
          <MenuItem to="/" end icon="🎯" onNavigate={onNavigate}>관제탑 (홈)</MenuItem>
        </div>
        )}

        {/* 📦 자재 */}
        {canAccessSection(profile, 'mat') && (
        <CollapseSection label="📦 자재" sKey="mat">
          <MenuItem to="/search"    icon="🔎" onNavigate={onNavigate}>통합 검색</MenuItem>
          <MenuItem to={`/customer/${pcs}/short`} icon="🚨" onNavigate={onNavigate}>자재 상황판</MenuItem>
          <MenuItem to="/inventory" icon="📦" onNavigate={onNavigate}>재고현황</MenuItem>
          <MenuItem to="/outbound"  icon="📤" onNavigate={onNavigate}>출고 처리 (BOM·불출표)</MenuItem>
          <MenuItem to="/issue"     icon="🧺" onNavigate={onNavigate}>불출 장바구니 (호기별)</MenuItem>
        </CollapseSection>
        )}

        {/* 🛒 구매 */}
        {canAccessSection(profile, 'buy') && (
        <CollapseSection label="🛒 구매" sKey="buy">
          <MenuItem to={`/customer/${pcs}/purchase`} icon="🛒" onNavigate={onNavigate}>구매발주</MenuItem>
          <MenuItem to="/inbound"   icon="📥" onNavigate={onNavigate}>입고</MenuItem>
        </CollapseSection>
        )}

        {/* 🤝 영업 */}
        {canAccessSection(profile, 'sales') && (
        <CollapseSection label="🤝 영업" sKey="sales">
          <MenuItem to={`/customer/${pcs}/cpo`}      icon="📑" onNavigate={onNavigate}>고객사 PO</MenuItem>
          <MenuItem to={`/customer/${pcs}/forecast`} icon="📈" onNavigate={onNavigate}>포캐스트</MenuItem>
          <MenuItem to="/sales" icon="💼" onNavigate={onNavigate}>매출 대시보드</MenuItem>
        </CollapseSection>
        )}

        {/* 🏭 현장 */}
        {canAccessSection(profile, 'floor') && (
        <CollapseSection label="🏭 현장" sKey="floor">
          <MenuItem to="/field-search" icon="🔎" onNavigate={onNavigate}>현장 검색</MenuItem>
          <MenuItem to="/production" end icon="🏭" onNavigate={onNavigate}>생산 대시보드</MenuItem>
          <MenuItem to="/production/AX" icon="🔧" onNavigate={onNavigate}>생산 관리</MenuItem>
          <MenuItem to="/board"     icon="🖥" onNavigate={onNavigate}>생산 전광판</MenuItem>
        </CollapseSection>
        )}

        {/* 📊 분석 */}
        {canAccessSection(profile, 'report') && (
        <CollapseSection label="📊 분석" sKey="report" defaultOpen={false}>
          <MenuItem to="/weekly"              icon="📄" onNavigate={onNavigate}>주간업무보고</MenuItem>
          <MenuItem to="/sales"               icon="💼" onNavigate={onNavigate}>매출 대시보드</MenuItem>
          <MenuItem to="/purchase-dashboard"  icon="💰" onNavigate={onNavigate}>매입 대시보드</MenuItem>
          <MenuItem to="/what-if"             icon="🔬" onNavigate={onNavigate}>What-if 시뮬레이터</MenuItem>
          <MenuItem to="/insights"            icon="📊" onNavigate={onNavigate}>인사이트 (관리자)</MenuItem>
        </CollapseSection>
        )}

        {/* ⚙️ 기초자료 */}
        {canAccessSection(profile, 'master') && (
        <CollapseSection label="⚙️ 기초자료" sKey="master" defaultOpen={false}>
          <MenuItem to="/master/items"   icon="🗂️" onNavigate={onNavigate}>기준코드 DB</MenuItem>
          <MenuItem to="/master/vendors" icon="🏢" onNavigate={onNavigate}>협력사</MenuItem>
          <MenuItem to="/master/price"   icon="💲" onNavigate={onNavigate}>단가변동이력</MenuItem>
          <MenuItem to={`/customer/${pcs}/bom`} icon="🧬" onNavigate={onNavigate}>BOM</MenuItem>
          <MenuItem to="/cost"      icon="💵" onNavigate={onNavigate}>원가분석</MenuItem>
          <MenuItem to="/quote"     icon="🧾" onNavigate={onNavigate}>견적입력</MenuItem>
          <MenuItem to="/erp"       icon="🔗" onNavigate={onNavigate}>ERP 연동</MenuItem>
          {isAdmin && <MenuItem to="/backup" icon="🗄" onNavigate={onNavigate}>데이터 백업</MenuItem>}
        </CollapseSection>
        )}

        {/* 하단 고정 — 관리자/회원/도움말 */}
        <div className="mt-auto border-t border-slate-200 pt-1">
          <div className="px-2 py-1 space-y-0.5">
            {isAdmin && (
              <NavLink to="/admin" onClick={onNavigate}
                className={({isActive})=>`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${isActive?'text-indigo-600 bg-indigo-50':'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}>
                <span>⚙️</span> 관리자
              </NavLink>
            )}
            {isAdmin && (
              <NavLink to="/users" onClick={onNavigate}
                className={({isActive})=>`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${isActive?'text-indigo-600 bg-indigo-50':'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}>
                <span>👥</span> 회원 관리
              </NavLink>
            )}
            <NavLink to="/help" onClick={onNavigate}
              className={({isActive})=>`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${isActive?'text-indigo-600 bg-indigo-50':'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}>
              <span>❓</span> 도움말
            </NavLink>
          </div>
          {/* 버전 */}
          <div className="px-4 py-2">
            <button onClick={() => setShowChangelog(true)}
              className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-600 transition-colors group">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0"></span>
              {APP_VERSION}
              <span className="text-slate-300 group-hover:text-slate-400">· 이력</span>
            </button>
          </div>
        </div>
      </aside>

      {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}
    </>
  )
}
