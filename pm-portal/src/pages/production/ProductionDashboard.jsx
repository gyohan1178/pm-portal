import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'

// production 테이블: ax_pdbox 이관 + customer_code. 날짜는 'YYYY-MM-DD' text.
async function fetchProduction() {
  const data = await fetchAll(() => supabase
    .from('production')
    .select('id,customer_code,pn,name,hogi,status,req_date,arrival_date,machine_recv,harness_recv,elec_recv')
    .neq('status', '완료')
    .order('req_date', { ascending: true }))
  return data || []
}

const CUST = { AX:{name:'AXCELIS',color:'bg-indigo-50 text-indigo-700 border-indigo-200'}, ED:{name:'Edwards',color:'bg-blue-50 text-blue-700 border-blue-200'}, VM:{name:'VM',color:'bg-emerald-50 text-emerald-700 border-emerald-200'}, CSK:{name:'CSK',color:'bg-amber-50 text-amber-700 border-amber-200'} }
const STATUS_COLOR = { 'PO 접수':'bg-slate-100 text-slate-600', '제작 중':'bg-blue-50 text-blue-600', '품질 검수':'bg-violet-50 text-violet-600', '납품 대기':'bg-amber-50 text-amber-700' }

function dday(dateStr) {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0,0,0,0)
  const d = new Date(dateStr); if (isNaN(d)) return null
  return Math.round((d - today) / 86400000)
}
function urgency(n) {
  if (n == null) return 'text-slate-400'
  if (n <= 0) return 'text-red-600 font-bold'
  if (n <= 7) return 'text-orange-500 font-bold'
  if (n <= 14) return 'text-yellow-600 font-semibold'
  return 'text-emerald-600'
}

export default function ProductionDashboard() {
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['production'], queryFn: fetchProduction })

  const today = new Date().toISOString().split('T')[0]
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]

  const delayed = rows.filter(r => r.req_date && r.req_date < today)
  const urgent = rows.filter(r => r.req_date && r.req_date >= today && r.req_date <= in7)
  const issueWeek = rows.filter(r => r.arrival_date && !r.machine_recv && r.arrival_date >= today && r.arrival_date <= in7)
  const byCust = {}
  rows.forEach(r => { const c = r.customer_code || 'AX'; byCust[c] = (byCust[c] || 0) + 1 })

  if (isLoading) return <div className="text-center py-12 text-slate-400 text-sm">불러오는 중...</div>

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-lg font-bold text-slate-900">생산 대시보드</h1>
        <p className="text-xs text-slate-400 mt-0.5">전 고객사 호기 현황 — 납기·자재불출 중심</p>
      </div>

      {/* 요약 카드 (모바일 2열) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: '진행 중 호기', value: rows.length, color: 'border-slate-200', v: 'text-slate-800' },
          { label: '납기 지연', value: delayed.length, color: 'border-red-200 bg-red-50', v: 'text-red-600' },
          { label: 'D-7 임박', value: urgent.length, color: 'border-orange-200 bg-orange-50', v: 'text-orange-600' },
          { label: '이번주 자재불출', value: issueWeek.length, color: 'border-indigo-200 bg-indigo-50', v: 'text-indigo-600' },
        ].map(c => (
          <div key={c.label} className={`rounded-xl border p-3 ${c.color}`}>
            <p className="text-[11px] text-slate-500 font-semibold">{c.label}</p>
            <p className={`text-2xl font-bold ${c.v}`}>{c.value}<span className="text-xs font-semibold text-slate-400 ml-1">건</span></p>
          </div>
        ))}
      </div>

      {/* 고객사별 진입 */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(CUST).map(([code, c]) => (
          <Link key={code} to={`/production/${code}`}
            className={`px-3 py-1.5 rounded-lg border text-xs font-bold ${c.color}`}>
            {c.name} {byCust[code] || 0}건
          </Link>
        ))}
      </div>

      {/* 지연 + 임박 리스트 (카드형 — 모바일 우선) */}
      {[['🚨 납기 지연', delayed], ['⏰ 납기 임박 (D-7)', urgent], ['📦 이번주 자재불출 예정', issueWeek]].map(([title, list]) => (
        <section key={title}>
          <p className="text-sm font-bold text-slate-700 mb-2">{title} <span className="text-slate-400 font-semibold">{list.length}건</span></p>
          {list.length === 0
            ? <p className="text-xs text-slate-300 py-2">없음</p>
            : <div className="space-y-1.5">
                {list.slice(0, 20).map(r => {
                  const n = dday(title.includes('불출') ? r.arrival_date : r.req_date)
                  return (
                    <Link key={r.id} to={`/production/${r.customer_code || 'AX'}`}
                      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:bg-slate-50">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${(CUST[r.customer_code] || CUST.AX).color}`}>{r.customer_code || 'AX'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-800 truncate">{r.pn} <span className="text-slate-400 font-semibold">{r.hogi}</span></p>
                        <p className="text-[11px] text-slate-400 truncate">{r.name}</p>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${STATUS_COLOR[r.status] || 'bg-slate-100 text-slate-500'}`}>{r.status}</span>
                      <span className={`text-xs w-14 text-right ${urgency(n)}`}>{n == null ? '-' : n < 0 ? `D+${-n}` : n === 0 ? '오늘' : `D-${n}`}</span>
                    </Link>
                  )
                })}
                {list.length > 20 && <p className="text-[11px] text-slate-400 text-center">외 {list.length - 20}건 — 고객사 화면에서 전체 확인</p>}
              </div>}
        </section>
      ))}
    </div>
  )
}
