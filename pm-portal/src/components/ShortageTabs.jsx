import { NavLink } from 'react-router-dom'

// 소요·부족 통합 서브탭 — 부족자재(PO) / 소요 예측(포캐스트) / 소요량 조회
export default function ShortageTabs({ cs = 'ax' }) {
  const tabs = [
    { to: `/customer/${cs}/short`, label: '부족자재 (PO 확정)', exact: false },
    // 고객사를 이어 간다 — 예전엔 소요예측으로 넘어가면 늘 AXCELIS 로 돌아갔다
    { to: `/forecast-shortage?cs=${cs}`, label: '소요예측 (포캐스트)', exact: false },
    { to: `/customer/${cs}/reqbom`, label: '소요량 조회', exact: false },
    // Edwards — 생산관리 불출 예정 순으로 차례로 빼 본 부족 (생산관리 › 📦 소요량 매칭)
    ...(String(cs).toUpperCase() === 'ED' ? [{ to: '/production/ED?view=need', label: '📦 불출순 부족 (생산관리)', exact: false }] : []),
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
