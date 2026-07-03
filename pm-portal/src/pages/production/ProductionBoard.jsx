import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { isMainPn } from './mainPns'

// 🖥 생산 전광판 — 현장 대형 화면용 (다크 · 품번 그룹 · 전장완료일 기준 · 5분 자동갱신 · F11)
const dayMs = 86400000
const truthy = (v) => v === true || (typeof v === 'string' && v.trim() && v !== 'false')
const md = (d) => d ? String(d).slice(5, 10).replace('-', '/') : ''
const dd = (d) => { if (!d) return null; const x = new Date(String(d).slice(0, 10) + 'T00:00:00'); if (isNaN(x)) return null; return Math.round((x - new Date(new Date().toDateString())) / dayMs) }

// 역산 (생산관리와 동일): 납품 -2영업일 = 품질요청, -품질MD = 전장완료예정
const QC_LEAD_BD = 2
function bdMinus(dateStr, n) {
  if (!dateStr) return null
  const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00'); if (isNaN(d)) return null
  let left = Math.max(0, Math.round(n))
  while (left > 0) { d.setDate(d.getDate() - 1); const w = d.getDay(); if (w !== 0 && w !== 6) left-- }
  return d.toISOString().slice(0, 10)
}
function elecDue(r, qcMd) {
  if (r.elec_done) return String(r.elec_done).slice(0, 10)
  const q = bdMinus(r.req_date, QC_LEAD_BD)
  return bdMinus(q, Math.max(1, Math.ceil(Number(qcMd) || 2)))
}

function stepIdx(r) {
  if (truthy(r.quality_recv)) return 5
  if (truthy(r.elec_recv)) return 4
  if (truthy(r.harness_recv) || truthy(r.part_issue)) return 3
  if (truthy(r.machine_recv)) return 2
  if (r.status === 'PO접수') return 0
  return 1
}
const STEP_LABEL = ['미불출', '대기', '가공입고', '전장조립', '품질', '출하대기']
const STEP_COLOR = ['text-slate-500', 'text-slate-400', 'text-amber-400', 'text-violet-300', 'text-rose-300', 'text-emerald-300']

async function fetchBoard() {
  const today = new Date().toISOString().slice(0, 10)
  const [{ data }, { count: shippedToday }, { data: items }] = await Promise.all([
    supabase.from('production')
      .select('id,pn,hogi,name,status,req_date,arrival_date,machine_recv,harness_recv,part_issue,elec_done,elec_recv,quality_recv,missing_parts')
      .eq('customer_code', 'AX').neq('status', '완료'),
    supabase.from('production').select('id', { count: 'exact', head: true })
      .eq('customer_code', 'AX').eq('shipped_date', today),
    supabase.from('items').select('std_code,qc_md_days').like('std_code', 'AX-11%'),
  ])
  const qcMap = Object.fromEntries((items || []).map(i => [String(i.std_code).replace('AX-', ''), i.qc_md_days]))
  const rows = (data || []).filter(r => isMainPn(r.pn))
  rows._shippedToday = shippedToday || 0
  rows._qcMap = qcMap
  return rows
}

export default function ProductionBoard() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t) }, [])
  const { data: rows = [], dataUpdatedAt } = useQuery({
    queryKey: ['prodBoard'], queryFn: fetchBoard,
    refetchInterval: 5 * 60 * 1000, refetchIntervalInBackground: true,
  })

  const d = useMemo(() => {
    const qcMap = rows._qcMap || {}
    const enriched = rows.map(r => {
      const due = elecDue(r, qcMap[r.pn])
      return { ...r, _elecDue: due, _dday: dd(due), _step: stepIdx(r) }
    })
    const groupMap = {}
    enriched.forEach(r => { (groupMap[r.pn] ??= { pn: r.pn, name: r.name, rows: [] }).rows.push(r) })
    const groups = Object.values(groupMap).sort((a, b) => a.pn.localeCompare(b.pn))
    groups.forEach(g => {
      g.rows.sort((a, b) => String(a._elecDue || '9999').localeCompare(String(b._elecDue || '9999')))
      g.lateCnt = g.rows.filter(r => r._dday != null && r._dday < 0).length
      g.riskCnt = g.rows.filter(r => r._step === 0 && r._dday != null && r._dday <= 7).length
    })
    const lateTotal = enriched.filter(r => r._dday != null && r._dday < 0).length
    const riskTotal = enriched.filter(r => r._step === 0 && r._dday != null && r._dday <= 7).length
    const mchLate = enriched.filter(r => r.arrival_date && !truthy(r.machine_recv) && dd(r.arrival_date) < 0).length
    const missing = enriched.filter(r => Array.isArray(r.missing_parts) && r.missing_parts.length > 0).length
    const byStatus = {}
    enriched.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1 })
    return { groups, lateTotal, riskTotal, mchLate, missing, byStatus, total: enriched.length }
  }, [rows])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 px-5 py-4 select-none">
      <div className="flex items-center justify-between border-b-2 border-slate-700 pb-2.5 mb-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-black text-white">🏭 PD BOX 생산 현황</h1>
          <span className="text-xs text-slate-500">주요 {d.total}대 · 오늘 출하 <b className="text-emerald-400">{rows._shippedToday || 0}</b> · {new Date(dataUpdatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 갱신</span>
        </div>
        <div className="font-mono text-xl font-bold text-white tabular-nums">
          {now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })} {now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}
        </div>
      </div>

      <div className="flex gap-2 mb-3 flex-wrap text-sm font-bold">
        {d.lateTotal > 0 && <span className="px-3 py-1 rounded-lg bg-red-500/15 border border-red-500/40 text-red-300 animate-pulse">🚨 전장 지연 {d.lateTotal}대</span>}
        {d.riskTotal > 0 && <span className="px-3 py-1 rounded-lg bg-orange-500/15 border border-orange-500/40 text-orange-300">⚠ 미불출·임박 {d.riskTotal}대</span>}
        {d.mchLate > 0 && <span className="px-3 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300">⚙ 가공물 지연 {d.mchLate}건</span>}
        {d.missing > 0 && <span className="px-3 py-1 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300">📦 결품 {d.missing}대</span>}
        <span className="ml-auto text-slate-500 text-xs self-center"><b className="text-slate-400">전장 완료예정일 기준</b> · 🟥지남 🟧임박 🟨이번주</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
        {d.groups.map(g => (
          <div key={g.pn} className={`rounded-xl border p-2.5 ${g.lateCnt > 0 ? 'bg-red-500/5 border-red-500/40' : g.riskCnt > 0 ? 'bg-orange-500/5 border-orange-500/30' : 'bg-slate-900 border-slate-700'}`}>
            <div className="flex items-center justify-between mb-1.5 pb-1.5 border-b border-slate-700/60">
              <div className="min-w-0">
                <div className="font-mono text-lg font-black text-white leading-none">{g.pn}</div>
                <div className="text-[10px] text-slate-500 truncate">{g.name}</div>
              </div>
              <div className="text-right shrink-0 ml-2">
                <div className="text-[10px] text-slate-500">{g.rows.length}대</div>
                {g.lateCnt > 0 && <div className="text-[10px] font-black text-red-400">지연 {g.lateCnt}</div>}
                {g.lateCnt === 0 && g.riskCnt > 0 && <div className="text-[10px] font-black text-orange-400">미불출 {g.riskCnt}</div>}
              </div>
            </div>
            <div className="space-y-1">
              {g.rows.slice(0, 6).map((r, i) => {
                const n = r._dday
                const ddCls = n == null ? 'text-slate-500' : n < 0 ? 'text-red-400' : n <= 3 ? 'text-orange-400' : n <= 7 ? 'text-yellow-300' : 'text-slate-400'
                const hi = i === 0 && (n == null || n <= 7)
                return (
                  <div key={r.id} className={`flex items-center gap-1.5 rounded px-1.5 py-1 ${hi ? 'bg-slate-800' : ''}`}>
                    <span className="font-mono text-sm font-black text-indigo-300 w-8 shrink-0">{r.hogi}</span>
                    <span className={`text-[11px] font-bold w-14 shrink-0 ${STEP_COLOR[r._step]}`}>{STEP_LABEL[r._step]}</span>
                    <div className="flex-1 flex gap-0.5 min-w-0">
                      {[2, 3, 4, 5].map(s => <div key={s} className={`h-1.5 flex-1 rounded-sm ${r._step >= s ? (r._step >= 5 ? 'bg-emerald-400' : 'bg-violet-400') : 'bg-slate-700'}`} />)}
                    </div>
                    {Array.isArray(r.missing_parts) && r.missing_parts.length > 0 && <span className="text-[9px] font-bold text-rose-400 shrink-0">결{r.missing_parts.length}</span>}
                    <span className="font-mono text-[11px] text-slate-400 w-10 text-right shrink-0">{md(r._elecDue)}</span>
                    <span className={`font-mono text-xs font-black w-11 text-right shrink-0 ${ddCls}`}>{n == null ? '-' : n < 0 ? `D+${-n}` : n === 0 ? '오늘' : `D-${n}`}</span>
                  </div>
                )
              })}
              {g.rows.length > 6 && <div className="text-[10px] text-slate-500 text-center pt-0.5">외 {g.rows.length - 6}대…</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mt-3">
        {['PO접수', '자재발주', '제작중', '품질검수', '납품대기'].map(st => (
          <div key={st} className="flex-1 rounded-lg bg-slate-900 border border-slate-700 py-2 text-center">
            <span className="text-2xl font-black text-white tabular-nums">{d.byStatus[st] || 0}</span>
            <span className="block text-[10px] font-bold text-slate-400">{st}</span>
          </div>
        ))}
      </div>
      <p className="text-center text-slate-600 text-[10px] mt-2">전장 완료예정일 기준 · F11 전체화면 · 조회 전용 · 5분 자동갱신</p>
    </div>
  )
}
