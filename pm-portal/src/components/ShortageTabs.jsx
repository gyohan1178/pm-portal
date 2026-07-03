import { NavLink } from 'react-router-dom'

// 소요·부족 통합 서브탭 — 부족자재(PO) / 소요 예측(포캐스트) / 소요량 조회
export default function ShortageTabs({ cs = 'ax' }) {
  const tabs = [
    { to: `/customer/${cs}/short`, label: '부족자재', exact: false },
    { to: '/forecast-shortage', label: '소요 예측', exact: false },
    { to: `/customer/${cs}/reqbom`, label: '소요량 조회', exact: false },
  ]
  return (
    <div className="inline-flex gap-1 p-1 bg-slate-100 rounded-lg">
      {tabs.map(t => (
        <NavLink key={t.to} to={t.to}
          className={({ isActive }) =>
            `px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          {t.label}
        </NavLink>
      ))}
    </div>
  )
}
