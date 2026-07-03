import { NavLink } from 'react-router-dom'

// 분석 통합 서브탭 — 관제탑(홈) / 매출 / 매입 / What-if / 인사이트 상호 이동
export default function AnalysisTabs() {
  const tabs = [
    { to: '/', label: '🎯 관제탑', end: true },
    { to: '/sales', label: '💼 매출' },
    { to: '/purchase-dashboard', label: '💰 매입' },
    { to: '/what-if', label: '🔬 What-if' },
    { to: '/insights', label: '📊 인사이트' },
  ]
  return (
    <div className="inline-flex gap-1 p-1 bg-slate-100 rounded-lg mb-3 flex-wrap">
      {tabs.map(t => (
        <NavLink key={t.to} to={t.to} end={t.end}
          className={({ isActive }) =>
            `px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          {t.label}
        </NavLink>
      ))}
    </div>
  )
}
