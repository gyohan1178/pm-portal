import { NavLink, useParams } from 'react-router-dom'

const CUSTOMERS = [
  { id: 'ax',  name: 'AXCELIS', color: '#4F46E5' },
  { id: 'ed',  name: 'Edwards', color: '#3B82F6' },
  { id: 'vm',  name: 'VM',      color: '#059669' },
  { id: 'csk', name: 'CSK',     color: '#D97706' },
]

function SidebarSection({ label, children }) {
  return (
    <div className="py-2 border-b border-slate-200 last:border-0">
      {label && (
        <p className="px-4 pb-1.5 text-[10px] font-700 text-slate-400 uppercase tracking-widest">
          {label}
        </p>
      )}
      {children}
    </div>
  )
}

function MenuItem({ to, icon, children, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2 px-4 py-1.5 text-xs font-500 rounded-none relative transition-colors
        ${isActive
          ? 'text-accent bg-accent/10 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:bg-accent before:rounded-r'
          : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
        }`
      }
    >
      <span className="text-sm">{icon}</span>
      {children}
    </NavLink>
  )
}

function CustomerSection({ customer }) {
  const SUB = [
    { path: 'po',    label: '발주현황' },
    { path: 'short', label: '부족자재' },
    { path: 'bom',   label: 'BOM' },
  ]
  return (
    <div className="mb-0.5">
      <div className="flex items-center gap-2 px-4 py-1.5">
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: customer.color }}
        />
        <span className="text-xs font-700 text-slate-700">{customer.name}</span>
      </div>
      <div>
        {SUB.map(s => (
          <NavLink
            key={s.path}
            to={`/customer/${customer.id}/${s.path}`}
            className={({ isActive }) =>
              `flex items-center gap-1.5 pl-8 pr-4 py-1 text-[11px] font-500 transition-colors
              before:content-[''] before:w-1 before:h-1 before:rounded-full before:bg-current before:flex-shrink-0
              ${isActive
                ? 'text-accent font-600'
                : 'text-slate-400 hover:text-slate-700'
              }`
            }
          >
            {s.label}
          </NavLink>
        ))}
      </div>
    </div>
  )
}

export default function Sidebar() {
  return (
    <aside className="w-48 min-w-[192px] bg-slate-50 border-r border-slate-200 flex flex-col overflow-y-auto">
      {/* 로고 */}
      <div className="px-4 py-4 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-accent rounded-md flex items-center justify-center">
            <svg className="w-3.5 h-3.5 stroke-white fill-none" viewBox="0 0 14 14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="1" width="5" height="5" rx="1"/>
              <rect x="8" y="1" width="5" height="5" rx="1"/>
              <rect x="1" y="8" width="5" height="5" rx="1"/>
              <path d="M8 10.5h5M10.5 8v5"/>
            </svg>
          </div>
          <span className="text-sm font-700 text-slate-900 tracking-tight">PM Portal</span>
        </div>
        <p className="text-[10px] text-slate-400 mt-0.5 pl-8">진선테크 구매/자재</p>
      </div>

      {/* 대시보드 */}
      <SidebarSection>
        <MenuItem to="/" end icon="📊">대시보드</MenuItem>
      </SidebarSection>

      {/* 공통 업무 */}
      <SidebarSection label="공통 업무">
        <MenuItem to="/inbound"  icon="📥">입고</MenuItem>
        <MenuItem to="/outbound" icon="📤">출고</MenuItem>
        <MenuItem to="/quote"    icon="🧾">견적입력</MenuItem>
        <MenuItem to="/issues"   icon="⚠️">이슈</MenuItem>
        <MenuItem to="/todo"     icon="✅">Todo</MenuItem>
      </SidebarSection>

      {/* 고객사 */}
      <SidebarSection label="고객사">
        {CUSTOMERS.map(c => <CustomerSection key={c.id} customer={c} />)}
      </SidebarSection>

      {/* 기초자료 */}
      <SidebarSection label="기초자료">
        <MenuItem to="/master/items"   icon="🗂️">기준코드 DB</MenuItem>
        <MenuItem to="/master/vendors" icon="🏭">협력사</MenuItem>
        <MenuItem to="/master/price"   icon="💰">단가이력</MenuItem>
      </SidebarSection>

      {/* ERP */}
      <SidebarSection>
        <MenuItem to="/erp" icon="📋">ERP 연동</MenuItem>
      </SidebarSection>
    </aside>
  )
}
