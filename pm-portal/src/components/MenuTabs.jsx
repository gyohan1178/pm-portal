// 메뉴 묶음 탭 (v4.187.0) — 사이드바에서 한 줄로 합친 화면들을 화면 위에서 오간다 (lib/menuGroups)
import { NavLink, useLocation } from 'react-router-dom'
import { menuGroupOf } from '../lib/menuGroups'
import { useMyProfile, canAccessPath } from '../hooks/useProfile'
import { primaryCsCode } from '../lib/customers'

export default function MenuTabs() {
  const { pathname } = useLocation()
  const { data: profile } = useMyProfile()
  const g = menuGroupOf(pathname)
  if (!g) return null
  const cs = g.cs || primaryCsCode(profile) || 'ax'
  // 권한 없는 화면의 탭은 안 보인다 · 남는 탭이 하나뿐이면 탭 줄 자체를 안 그린다
  const tabs = g.group.tabs.map((t, i) => ({ i, label: t.label, to: typeof t.to === 'function' ? t.to(cs) : t.to }))
    .filter((t) => t.i === g.active || !profile || canAccessPath(profile, t.to))
  if (tabs.length < 2) return null
  return (
    <div className="mb-3 inline-flex max-w-full overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 gap-1 print:hidden" data-menu-tabs={g.group.id}>
      {tabs.map(({ i, label, to }) => (
        <NavLink key={i} to={to} data-menu-tab={i} data-active={i === g.active ? '1' : '0'}
          className={`px-3 py-1.5 rounded-lg text-[12.5px] font-bold whitespace-nowrap ${i === g.active ? 'bg-[#eeebfd] text-[#6c5ce7]' : 'text-slate-500 hover:bg-slate-50'}`}>
          {label}
        </NavLink>
      ))}
    </div>
  )
}
