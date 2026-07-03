import { useState, useMemo } from 'react'
import AnalysisTabs from '../../components/AnalysisTabs'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase, fetchAllRows } from '../../lib/supabase'
import { foldForSim, simulateShortage, compareSim } from '../../lib/whatIfSim'

const CUST = [
  { code: 'ax', name: 'AXCELIS', color: '#8b5cf6' },
  { code: 'csk', name: 'CSK', color: '#f59e0b' },
  { code: 'ed', name: 'Edwards', color: '#3b82f6' },
  { code: 'vm', name: 'VM', color: '#10b981' },
]

async function fetchCache(csCode) {
  const { data: cs } = await supabase.from('customers').select('id').eq('code', csCode).maybeSingle()
  if (!cs) return []
  return fetchAllRows('forecast_shortage_cache', { eq: { customer_id: cs.id } })
}

function Slider({ label, value, onChange, min, max, step, unit, hint }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-slate-600">{label}</span>
        <span className="text-xs font-bold text-indigo-600">{value > 0 ? '+' : ''}{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-indigo-600" />
      {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  )
}

export default function WhatIfSim() {
  const { scope } = useParams()
  const nav = useNavigate()
  const csCode = scope || 'ax'

  const [delay, setDelay] = useState(0)       // 입고 지연 주
  const [demand, setDemand] = useState(0)     // 수요 증감 %
  const [safety, setSafety] = useState(0)     // 안전 버퍼 % (현재고 대비)

  const { data: cache = [], isLoading } = useQuery({
    queryKey: ['whatif', csCode],
    queryFn: () => fetchCache(csCode),
  })

  const items = useMemo(() => foldForSim(cache), [cache])
  const base = useMemo(() => simulateShortage(items, {}), [items])
  const sim = useMemo(() => simulateShortage(items, { incomingDelayWeeks: delay, demandPct: demand, safetyPct: safety }), [items, delay, demand, safety])
  const cmp = useMemo(() => compareSim(base, sim), [base, sim])

  const reset = () => { setDelay(0); setDemand(0); setSafety(0) }
  const changed = delay !== 0 || demand !== 0 || safety !== 0

  if (isLoading) return <div className="text-center py-16 text-slate-400 text-sm">데이터를 불러오는 중...</div>

  return (
    <div className="space-y-5">
      <AnalysisTabs />
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">🔬 What-if 시뮬레이터</h1>
          <p className="text-xs text-slate-400 mt-0.5">변수를 바꿔 "만약 이러면 어디가 터지나"를 미리 실험 — 실제 데이터는 안 바뀝니다</p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {CUST.map(c => (
            <button key={c.code} onClick={() => nav(`/what-if/${c.code}`)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md ${csCode === c.code ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.color }} />{c.name}
            </button>
          ))}
        </div>
      </div>

      {/* 변수 조정 */}
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/50 to-violet-50/30 p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-bold text-indigo-700">🎛️ 시나리오 변수</p>
          {changed && <button onClick={reset} className="text-xs text-slate-500 hover:text-slate-700">↺ 초기화</button>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Slider label="입고 지연" value={delay} onChange={setDelay} min={0} max={12} step={1} unit="주" hint="발주 입고가 N주 늦어지면?" />
          <Slider label="수요 증감" value={demand} onChange={setDemand} min={-50} max={100} step={5} unit="%" hint="생산/수요가 ±N% 바뀌면?" />
          <Slider label="안전 버퍼" value={safety} onChange={setSafety} min={0} max={50} step={5} unit="%" hint="현재고의 N%를 버퍼로 남기면?" />
        </div>
      </div>

      {/* 기준 vs 시뮬 비교 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-bold text-slate-400 mb-2">현재 (기준)</p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-700">{cmp.baseRisk}</span>
            <span className="text-xs text-slate-400">품목 부족 위험</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">3개월 내 임박 {cmp.baseUrgent}건</p>
        </div>
        <div className={`rounded-xl border p-4 ${cmp.simRisk > cmp.baseRisk ? 'border-red-300 bg-red-50' : cmp.simRisk < cmp.baseRisk ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
          <p className="text-xs font-bold text-slate-400 mb-2">시뮬레이션 결과 {changed && <span className="text-indigo-500">(변수 적용됨)</span>}</p>
          <div className="flex items-baseline gap-2">
            <span className={`text-3xl font-bold ${cmp.simRisk > cmp.baseRisk ? 'text-red-600' : cmp.simRisk < cmp.baseRisk ? 'text-emerald-600' : 'text-slate-700'}`}>{cmp.simRisk}</span>
            <span className="text-xs text-slate-400">품목 부족 위험</span>
            {cmp.simRisk !== cmp.baseRisk && (
              <span className={`text-xs font-bold ${cmp.simRisk > cmp.baseRisk ? 'text-red-500' : 'text-emerald-500'}`}>
                {cmp.simRisk > cmp.baseRisk ? `▲ +${cmp.simRisk - cmp.baseRisk}` : `▼ ${cmp.simRisk - cmp.baseRisk}`}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">3개월 내 임박 {cmp.simUrgent}건</p>
        </div>
      </div>

      {/* 새로 위험해진 품목 */}
      {cmp.newlyRisk.length > 0 && (
        <div>
          <p className="text-xs font-bold text-red-500 mb-2">⚠ 이 시나리오에서 새로 터지는 품목 — {cmp.newlyRisk.length}건</p>
          <div className="rounded-xl border border-red-200 bg-white overflow-hidden">
            {cmp.newlyRisk.slice(0, 15).map((it, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2 border-b border-red-50 last:border-0">
                <span className="font-mono text-xs text-indigo-600">{it.std_code}</span>
                <span className="text-xs text-slate-500 flex-1 truncate">{it.name}</span>
                <span className="text-xs text-red-600 font-bold">{it.firstNeg}부터 {it.minProjected}</span>
              </div>
            ))}
            {cmp.newlyRisk.length > 15 && <div className="px-4 py-2 text-xs text-slate-400">+{cmp.newlyRisk.length - 15}건 더</div>}
          </div>
        </div>
      )}

      {!changed && (
        <div className="text-center py-8 text-slate-300 text-sm">
          위 슬라이더를 움직여 시나리오를 실험해보세요 — 변화가 실시간으로 계산됩니다
        </div>
      )}
    </div>
  )
}
