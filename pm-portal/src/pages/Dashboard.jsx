import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

const CUSTOMERS = [
  { id: 'ax',  name: 'AXCELIS', color: '#4F46E5' },
  { id: 'ed',  name: 'Edwards', color: '#3B82F6' },
  { id: 'vm',  name: 'VM',      color: '#059669' },
  { id: 'csk', name: 'CSK',     color: '#D97706' },
]

// 납기 지연 기준: promise_date < 오늘 && status = 진행중
// D-7: promise_date <= 오늘+7일

async function fetchDashboard() {
  const today = new Date()
  const d7 = new Date(today); d7.setDate(d7.getDate() + 7)
  const todayStr = today.toISOString().split('T')[0]
  const d7Str    = d7.toISOString().split('T')[0]

  const { data: pos } = await supabase
    .from('purchase_orders')
    .select('*, customers(code,name,color)')
    .neq('status', '완료')

  const { data: issues } = await supabase
    .from('issues')
    .select('id, status')
    .neq('status', '완료')

  const { data: todos } = await supabase
    .from('todos')
    .select('id, done')
    .eq('done', false)

  const delayed  = (pos || []).filter(p => p.promise_date && p.promise_date < todayStr)
  const upcoming = (pos || []).filter(p =>
    p.promise_date && p.promise_date >= todayStr && p.promise_date <= d7Str
  )

  // 고객사별 집계
  const byCs = {}
  CUSTOMERS.forEach(c => {
    byCs[c.id] = { total: 0, delayed: 0, d7: 0 }
  })
  ;(pos || []).forEach(p => {
    const code = p.customers?.code
    if (!byCs[code]) return
    byCs[code].total++
    if (p.promise_date && p.promise_date < todayStr)   byCs[code].delayed++
    if (p.promise_date && p.promise_date >= todayStr && p.promise_date <= d7Str) byCs[code].d7++
  })

  return {
    totalPo: (pos || []).length,
    delayed,
    upcoming,
    openIssues: (issues || []).length,
    pendingTodos: (todos || []).length,
    byCs,
    poList: pos || [],
  }
}

function StatCard({ label, value, sub, color = 'default', onClick }) {
  const colors = {
    default: 'border-slate-200',
    red:     'border-red-200   bg-red-50',
    yellow:  'border-amber-200 bg-amber-50',
    indigo:  'border-indigo-200 bg-indigo-50',
  }
  const valColors = {
    default: 'text-slate-900',
    red:     'text-red-600',
    yellow:  'text-amber-700',
    indigo:  'text-indigo-600',
  }
  return (
    <div
      className={`rounded-xl border p-4 ${colors[color]} ${onClick ? 'cursor-pointer hover:shadow-sm transition-shadow' : ''}`}
      onClick={onClick}
    >
      <p className="text-[10px] font-700 text-slate-400 uppercase tracking-widest mb-1.5">{label}</p>
      <p className={`text-2xl font-700 tracking-tight ${valColors[color]}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

function DelayedTable({ rows, title, emptyMsg }) {
  if (!rows.length) return (
    <div className="text-center py-8 text-slate-400 text-xs">{emptyMsg}</div>
  )
  const today = new Date().toISOString().split('T')[0]
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="text-left px-3 py-2 font-700 text-slate-400 uppercase tracking-wide text-[10px]">고객사</th>
            <th className="text-left px-3 py-2 font-700 text-slate-400 uppercase tracking-wide text-[10px]">PO번호</th>
            <th className="text-left px-3 py-2 font-700 text-slate-400 uppercase tracking-wide text-[10px]">구분</th>
            <th className="text-left px-3 py-2 font-700 text-slate-400 uppercase tracking-wide text-[10px]">약속일</th>
            <th className="text-left px-3 py-2 font-700 text-slate-400 uppercase tracking-wide text-[10px]">{title === '지연' ? '지연' : 'D-'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const diff = p.promise_date
              ? Math.round((new Date(p.promise_date) - new Date(today)) / 86400000)
              : null
            return (
              <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.customers?.color || '#94A3B8' }} />
                    <span className="font-600 text-slate-700">{p.customers?.name || '-'}</span>
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-slate-500">{p.po_number || '-'}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-700
                    ${p.type === '가공' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>
                    {p.type}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600">{p.promise_date || '-'}</td>
                <td className="px-3 py-2">
                  {diff !== null && (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-700
                      ${diff < 0
                        ? 'bg-red-50 text-red-600'
                        : diff <= 3
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-emerald-50 text-emerald-700'}`}>
                      {diff < 0 ? `+${Math.abs(diff)}일 초과` : `D-${diff}`}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('buy')
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboard,
  })

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
      데이터 불러오는 중...
    </div>
  )
  if (error) return (
    <div className="flex items-center justify-center h-64 text-red-500 text-sm">
      오류: {error.message}
    </div>
  )

  const { totalPo, delayed, upcoming, openIssues, pendingTodos, byCs, poList } = data

  return (
    <div className="space-y-5">
      {/* 탭 */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[['buy','구매 현황'],['amt','매입 금액']].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setActiveTab(k)}
            className={`px-4 py-1.5 text-xs font-600 rounded-md transition-all
              ${activeTab === k
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'buy' ? (
        <>
          {/* 상단 통계 */}
          <div className="grid grid-cols-5 gap-3">
            <StatCard label="전체 미입고 PO" value={totalPo}           sub="4개 고객사"       color="default" />
            <StatCard label="납기 지연"       value={delayed.length}   sub="즉시 확인 필요"   color="red"     />
            <StatCard label="D-7 임박"        value={upcoming.length}  sub="이번주 내"        color="yellow"  />
            <StatCard label="미처리 이슈"     value={openIssues}       sub="이슈 탭 확인"     color="default" />
            <StatCard label="미완료 Todo"     value={pendingTodos}     sub="Todo 탭 확인"     color="default" />
          </div>

          {/* 고객사별 현황 */}
          <div>
            <h2 className="text-xs font-700 text-slate-400 uppercase tracking-widest mb-3">고객사별 현황</h2>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-2.5 font-700 text-slate-400 text-[10px] uppercase tracking-wide">고객사</th>
                    <th className="text-right px-4 py-2.5 font-700 text-slate-400 text-[10px] uppercase tracking-wide">미입고 PO</th>
                    <th className="text-right px-4 py-2.5 font-700 text-slate-400 text-[10px] uppercase tracking-wide">납기지연</th>
                    <th className="text-right px-4 py-2.5 font-700 text-slate-400 text-[10px] uppercase tracking-wide">D-7</th>
                  </tr>
                </thead>
                <tbody>
                  {CUSTOMERS.map(c => {
                    const s = byCs[c.id] || { total: 0, delayed: 0, d7: 0 }
                    return (
                      <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                            <span className="font-600 text-slate-800">{c.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-600 text-slate-700">{s.total}</td>
                        <td className="px-4 py-2.5 text-right">
                          {s.delayed > 0
                            ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-700 bg-red-50 text-red-600">{s.delayed}</span>
                            : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-700 bg-emerald-50 text-emerald-700">0</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {s.d7 > 0
                            ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-700 bg-amber-50 text-amber-700">{s.d7}</span>
                            : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-700 bg-emerald-50 text-emerald-700">0</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 납기 지연 목록 */}
          <div>
            <h2 className="text-xs font-700 text-slate-400 uppercase tracking-widest mb-3">
              납기 지연 {delayed.length > 0 && <span className="text-red-500">({delayed.length})</span>}
            </h2>
            <DelayedTable rows={delayed} title="지연" emptyMsg="🎉 납기 지연 없음" />
          </div>

          {/* D-7 임박 */}
          <div>
            <h2 className="text-xs font-700 text-slate-400 uppercase tracking-widest mb-3">
              D-7 임박 {upcoming.length > 0 && <span className="text-amber-600">({upcoming.length})</span>}
            </h2>
            <DelayedTable rows={upcoming} title="D7" emptyMsg="이번주 납기 임박 건 없음" />
          </div>
        </>
      ) : (
        /* 매입 금액 탭 - 추후 데이터 연동 */
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-slate-400">
          <p className="text-2xl">📊</p>
          <p className="text-sm font-600 text-slate-500">매입 금액 대시보드</p>
          <p className="text-xs">입고 데이터 쌓이면 자동 집계됩니다</p>
        </div>
      )}
    </div>
  )
}
