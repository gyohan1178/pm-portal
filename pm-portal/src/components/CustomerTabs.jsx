import { useParams, useNavigate } from 'react-router-dom'
import { orderedCustomers } from '../lib/customers'
import { useMyProfile } from '../hooks/useProfile'

// 각 customer 페이지 상단 고객사 전환 탭 + 관제탑 바로가기. 주 고객사가 맨 앞.
//   주소에 고객사가 없는 화면(소요예측 등)은 active · onPick 으로 같은 모양을 쓴다 (2026-10-01 탭 위치 통일)
export default function CustomerTabs({ active, onPick, flush = false } = {}) {
  const params = useParams()
  const customerId = active || params.customerId
  const nav = useNavigate()
  const { data: profile } = useMyProfile()
  const customers = orderedCustomers(profile)
  const work = window.location.pathname.split('/customer/')[1]?.split('/')[1] || 'cpo'

  return (
    <div className={`flex items-center gap-2 flex-wrap ${flush ? '' : 'mb-4'}`}>
      <div className="flex items-center gap-1.5 flex-wrap" data-customer-tabs>
        {customers.map(c => (
          <button key={c.id} onClick={() => (onPick ? onPick(c.id) : nav(`/customer/${c.id}/${work}`))} data-customer-tab={c.id} aria-pressed={customerId === c.id}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-full transition-all ${customerId === c.id ? 'bg-slate-800 text-white shadow-sm' : 'bg-white text-slate-600 shadow-[0_1px_2px_rgba(20,30,50,.06)] hover:text-slate-900'}`}>
            <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
            {c.name}
          </button>
        ))}
      </div>
      <button onClick={() => nav(`/control-tower/${customerId || 'ax'}`)}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-full text-indigo-600 bg-indigo-50 hover:bg-indigo-100">
        🎯 관제탑
      </button>
    </div>
  )
}
