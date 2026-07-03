import { useParams, useNavigate } from 'react-router-dom'
import { orderedCustomers } from '../lib/customers'
import { useMyProfile } from '../hooks/useProfile'

// 각 customer 페이지 상단 고객사 전환 탭 + 관제탑 바로가기. 주 고객사가 맨 앞.
export default function CustomerTabs() {
  const { customerId } = useParams()
  const nav = useNavigate()
  const { data: profile } = useMyProfile()
  const customers = orderedCustomers(profile)
  const work = window.location.pathname.split('/customer/')[1]?.split('/')[1] || 'cpo'

  return (
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {customers.map(c => (
          <button key={c.id} onClick={() => nav(`/customer/${c.id}/${work}`)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${customerId === c.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
            {c.name}
          </button>
        ))}
      </div>
      <button onClick={() => nav(`/control-tower/${customerId || 'ax'}`)}
        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border border-indigo-200 text-indigo-600 bg-white hover:bg-indigo-50">
        🎯 관제탑
      </button>
    </div>
  )
}
