import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { isMainPn } from './mainPns'

// 🖥 생산 전광판 — 현장 대형 화면용 (다크 · 큰 글씨 · 60초 자동갱신 · F11 전체화면)
const dayMs = 86400000
const dd = (d) => { if (!d) return null; const x = new Date(String(d).slice(0,10)+'T00:00:00'); if (isNaN(x)) return null; return Math.round((x - new Date(new Date().toDateString())) / dayMs) }
const md = (d) => d ? String(d).slice(5,10).replace('-','/') : ''
const truthy = (v) => v === true || (typeof v === 'string' && v.trim() && v !== 'false')

async function fetchBoard() {
  const today = new Date().toISOString().slice(0, 10)
  const [{ data }, { count: shippedToday }] = await Promise.all([
    supabase.from('production')
      .select('id,pn,hogi,name,status,req_date,arrival_date,machine_recv,harness_recv,part_issue,elec_recv,quality_recv,missing_parts')
      .eq('customer_code','AX').neq('status','완료'),
    supabase.from('production').select('id', { count: 'exact', head: true })
      .eq('customer_code','AX').eq('shipped_date', today),
  ])
  const rows = data || []; rows._shippedToday = shippedToday || 0
  return rows
}

const STEP = (r) => {
  if (truthy(r.quality_recv)) return { label: '출하대기', cls: 'text-emerald-400' }
  if (truthy(r.elec_recv)) return { label: '품질', cls: 'text-rose-400' }
  if (truthy(r.harness_recv) || truthy(r.part_issue)) return { label: '전장조립', cls: 'text-violet-400' }
  if (truthy(r.machine_recv)) return { label: '가공입고', cls: 'text-amber-400' }
  return { label: r.status || '대기', cls: 'text-slate-400' }
}

export default function ProductionBoard() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  const { data: rows = [], dataUpdatedAt } = useQuery({
    queryKey: ['prodBoard'], queryFn: fetchBoard,
    refetchInterval: 5 * 60 * 1000, refetchIntervalInBackground: true, // 5분 갱신 (생산 현황은 분단위 변화 없음)
  })

  const d = useMemo(() => {
    const active = rows.filter(r => r.req_date)
    const late = active.filter(r => dd(r.req_date) < 0).sort((a,b) => a.req_date.localeCompare(b.req_date))
    const week = active.filter(r => { const n = dd(r.req_date); return n >= 0 && n <= 7 }).sort((a,b) => a.req_date.localeCompare(b.req_date))
    const next = active.filter(r => { const n = dd(r.req_date); return n > 7 && n <= 21 }).sort((a,b) => a.req_date.localeCompare(b.req_date))
    const mchLate = rows.filter(r => r.arrival_date && !truthy(r.machine_recv) && dd(r.arrival_date) < 0)
    const missing = rows.filter(r => Array.isArray(r.missing_parts) && r.missing_parts.length > 0)
    const byStatus = {}
    rows.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1 })
    return { late, week, next, mchLate, missing, byStatus, total: rows.length }
  }, [rows])

  const Row = ({ r, showD = true }) => {
    const n = dd(r.req_date); const st = STEP(r)
    return (
      <div className="flex items-center gap-3 py-1.5 border-b border-slate-800">
        <span className="font-mono text-xl font-bold text-white w-36 shrink-0">{r.pn}</span>
        <span className="font-mono text-xl font-black text-indigo-400 w-14 shrink-0">{r.hogi}</span>
        <span className="text-sm text-slate-500 truncate flex-1 hidden lg:block">{r.name}</span>
        <span className={`text-sm font-bold w-20 text-center shrink-0 ${st.cls}`}>{st.label}</span>
        {Array.isArray(r.missing_parts) && r.missing_parts.length > 0 && <span className="text-xs font-bold text-red-400 shrink-0">결품{r.missing_parts.length}</span>}
        <span className="font-mono text-xl font-bold text-slate-200 w-20 text-right shrink-0">{md(r.req_date)}</span>
        {showD && <span className={`font-mono text-lg font-black w-16 text-right shrink-0 ${n < 0 ? 'text-red-400' : n <= 2 ? 'text-orange-400' : n <= 7 ? 'text-yellow-300' : 'text-slate-400'}`}>{n < 0 ? `D+${-n}` : n === 0 ? '오늘' : `D-${n}`}</span>}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-6 select-none">
      {/* 헤더 */}
      <div className="flex items-end justify-between border-b-2 border-slate-700 pb-3 mb-5">
        <div className="flex items-end gap-4">
          <h1 className="text-3xl font-black text-white">🏭 PD BOX 생산 현황</h1>
          <span className="text-sm text-slate-500 mb-1">진행 {d.total}대 · <b className="text-emerald-400">오늘 출하 {rows._shippedToday || 0}대</b> · {new Date(dataUpdatedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})} 갱신 · 5분 자동</span>
        </div>
        <div className="text-right">
          <div className="font-mono text-4xl font-black text-white tabular-nums">{now.toLocaleTimeString('ko-KR', { hour12: false })}</div>
          <div className="text-sm text-slate-400">{now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}</div>
        </div>
      </div>

      {/* 경보 배너 */}
      {(d.late.length > 0 || d.mchLate.length > 0) && (
        <div className="flex gap-3 mb-5 flex-wrap">
          {d.late.length > 0 && <div className="px-4 py-2 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 font-bold text-lg animate-pulse">🚨 납기 지연 {d.late.length}대</div>}
          {d.mchLate.length > 0 && <div className="px-4 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300 font-bold text-lg">⚙ 가공물 입고 지연 {d.mchLate.length}건</div>}
          {d.missing.length > 0 && <div className="px-4 py-2 rounded-xl bg-orange-500/15 border border-orange-500/40 text-orange-300 font-bold text-lg">📦 결품 보유 {d.missing.length}대</div>}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* 좌: 지연 + 이번주 */}
        <div className="space-y-5">
          {d.late.length > 0 && (
            <section className="rounded-2xl bg-red-500/5 border border-red-500/30 p-4">
              <h2 className="text-lg font-black text-red-400 mb-2">🚨 지연 — 즉시 확인</h2>
              {d.late.map(r => <Row key={r.id} r={r} />)}
            </section>
          )}
          <section className="rounded-2xl bg-slate-900 border border-slate-700 p-4">
            <h2 className="text-lg font-black text-yellow-300 mb-2">📦 이번 주 납품 (7일 내) — {d.week.length}대</h2>
            {d.week.length === 0 ? <p className="text-slate-600 py-4 text-center">이번 주 납품 없음</p> : d.week.map(r => <Row key={r.id} r={r} />)}
          </section>
        </div>

        {/* 우: 다음 + 집계 */}
        <div className="space-y-5">
          <section className="rounded-2xl bg-slate-900 border border-slate-700 p-4">
            <h2 className="text-lg font-black text-slate-300 mb-2">📅 다음 납품 (8~21일) — {d.next.length}대</h2>
            {d.next.length === 0 ? <p className="text-slate-600 py-4 text-center">없음</p> : d.next.slice(0, 12).map(r => <Row key={r.id} r={r} />)}
            {d.next.length > 12 && <p className="text-slate-500 text-sm pt-2">외 {d.next.length - 12}대…</p>}
          </section>
          <section className="rounded-2xl bg-slate-900 border border-slate-700 p-4">
            <h2 className="text-lg font-black text-slate-300 mb-3">진행 상태</h2>
            <div className="flex gap-3 flex-wrap">
              {['PO접수','자재발주','제작중','품질검수','납품대기'].map(st => (
                <div key={st} className="flex-1 min-w-[100px] rounded-xl bg-slate-800 px-3 py-3 text-center">
                  <div className="text-3xl font-black text-white tabular-nums">{d.byStatus[st] || 0}</div>
                  <div className="text-xs font-bold text-slate-400 mt-1">{st}</div>
                </div>
              ))}
            </div>
          </section>
          <p className="text-center text-slate-600 text-xs">F11 전체화면 · 이 화면은 조회 전용입니다</p>
        </div>
      </div>
    </div>
  )
}
