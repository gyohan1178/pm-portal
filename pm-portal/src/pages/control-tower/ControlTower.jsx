import { useMemo } from 'react'
import AnalysisTabs from '../../components/AnalysisTabs'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchControlTowerData } from '../../lib/controlTowerData'
import { computeControlTower } from '../../lib/controlTower'

const CUST = [
  { code: 'ax', name: 'AXCELIS', color: '#8b5cf6' },
  { code: 'csk', name: 'CSK', color: '#f59e0b' },
  { code: 'ed', name: 'Edwards', color: '#3b82f6' },
  { code: 'vm', name: 'VM', color: '#10b981' },
]

// 카드: 큰 숫자 + 라벨, 클릭 시 링크
function KpiCard({ tone, label, value, sub, onClick }) {
  const tones = {
    red: 'border-red-200 bg-red-50 text-red-600',
    yellow: 'border-amber-200 bg-amber-50 text-amber-700',
    green: 'border-slate-200 bg-white text-slate-700',
  }
  return (
    <button onClick={onClick}
      className={`text-left rounded-xl border p-3 transition-all hover:shadow-sm ${tones[tone]} ${value > 0 && tone === 'red' ? 'ring-1 ring-red-300' : ''}`}>
      <p className="text-[11px] font-bold opacity-70 mb-1">{label}</p>
      <p className="text-2xl font-bold leading-none">{value}</p>
      {sub && <p className="text-[10px] opacity-50 mt-1">{sub}</p>}
    </button>
  )
}

const LINK_MAP = {
  short: (scope) => `/customer/${scope}/short`,
  production: (scope) => `/production/${scope.toUpperCase()}`,
  cpo: (scope) => `/customer/${scope}/cpo`,
}

export default function ControlTower({ scope = 'ax' }) {
  const nav = useNavigate()
  const isMaster = scope === 'all'

  const { data, isLoading } = useQuery({
    queryKey: ['controlTower', scope],
    queryFn: () => fetchControlTowerData(scope),
  })

  const ct = useMemo(() => {
    if (!data) return null
    return computeControlTower({ shortage: data.shortage, pos: data.pos, prod: data.prod })
  }, [data])

  // 마스터: 고객사별 위험도 비교
  const byCust = useMemo(() => {
    if (!isMaster || !data?.byCustomer) return []
    return CUST.map(c => {
      const d = data.byCustomer[c.code]
      if (!d) return { ...c, score: 0, kpi: null }
      const r = computeControlTower({ shortage: d.shortage, pos: d.pos, prod: d.prod })
      const score = r.kpi.orderNeeded * 3 + r.kpi.negSoon * 2 + r.kpi.prodDelay * 3 + r.kpi.lateArrival
      return { ...c, score, kpi: r.kpi }
    }).sort((a, b) => b.score - a.score)
  }, [isMaster, data])

  const goLink = (item) => {
    const csForLink = isMaster ? 'ax' : scope   // 마스터에선 ax로 (추후 item별 고객사 라우팅 가능)
    const fn = LINK_MAP[item.link]
    if (fn) nav(fn(csForLink))
  }

  if (isLoading) return <div className="text-center py-16 text-slate-400 text-sm">관제 데이터를 불러오는 중...</div>
  if (!ct) return <div className="text-center py-16 text-slate-300 text-sm">데이터가 없습니다</div>

  const k = ct.kpi

  return (
    <div className="space-y-5">
      <AnalysisTabs />
      {/* 헤더 */}
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">
            🎯 {isMaster ? '마스터 관제탑' : `${CUST.find(c => c.code === scope)?.name || scope} 관제탑`}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">발주 → 자재 → 생산 → 납품 전 과정 통합 모니터링</p>
        </div>
        <div className="flex items-center gap-2">
        <button onClick={() => nav(`/what-if/${isMaster ? 'ax' : scope}`)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border border-violet-200 text-violet-600 bg-white hover:bg-violet-50">
          🔬 What-if
        </button>
        {!isMaster && (
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {CUST.map(c => (
              <button key={c.code} onClick={() => nav(`/control-tower/${c.code}`)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md ${scope === c.code ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.color }} />{c.name}
              </button>
            ))}
          </div>
        )}
        </div>
      </div>

      {/* 마스터: 고객사별 위험도 비교 */}
      {isMaster && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {byCust.map((c, i) => (
            <button key={c.code} onClick={() => nav(`/control-tower/${c.code}`)}
              className={`text-left rounded-xl border p-3 transition-all hover:shadow-md ${i === 0 && c.score > 0 ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                <span className="text-sm font-bold text-slate-800">{c.name}</span>
                {i === 0 && c.score > 0 && <span className="ml-auto text-[10px] font-bold text-red-500 bg-red-100 px-1.5 py-0.5 rounded-full">최우선</span>}
              </div>
              {c.kpi ? (
                <div className="text-[11px] text-slate-500 space-y-0.5">
                  <p>🔴 발주 {c.kpi.orderNeeded} · 음수 {c.kpi.negSoon} · 지연 {c.kpi.prodDelay}</p>
                  <p>🟡 납품임박 {c.kpi.poSoon} · 미입고 {c.kpi.lateArrival}</p>
                </div>
              ) : <p className="text-[11px] text-slate-300">데이터 없음</p>}
            </button>
          ))}
        </div>
      )}

      {/* 🔴 즉시 대응 */}
      <div>
        <p className="text-xs font-bold text-red-500 mb-2 flex items-center gap-1.5">🔴 즉시 대응 <span className="text-slate-300 font-normal">— 지금 안 하면 터집니다</span></p>
        <div className="grid grid-cols-3 gap-3">
          <KpiCard tone="red" label="발주 필요" value={k.orderNeeded} sub="LT 고려 시 지금 발주" onClick={() => goLink({ link: 'short' })} />
          <KpiCard tone="red" label="재고 음수 임박" value={k.negSoon} sub="3개월 내 바닥" onClick={() => goLink({ link: 'short' })} />
          <KpiCard tone="red" label="생산 지연" value={k.prodDelay} sub="납기 D-7 내 미완료" onClick={() => goLink({ link: 'production' })} />
        </div>
      </div>

      {/* 🟡 이번 주 챙길 것 */}
      <div>
        <p className="text-xs font-bold text-amber-600 mb-2 flex items-center gap-1.5">🟡 이번 주 챙길 것 <span className="text-slate-300 font-normal">— 곧 챙겨야 합니다</span></p>
        <div className="grid grid-cols-3 gap-3">
          <KpiCard tone="yellow" label="납품 임박 PO" value={k.poSoon} sub="14일 내 납기" onClick={() => goLink({ link: 'cpo' })} />
          <KpiCard tone="yellow" label="미입고 가공물" value={k.lateArrival} sub="입고예정 지남" onClick={() => goLink({ link: 'production' })} />
          <KpiCard tone="yellow" label="하네스 불출 필요" value={k.harnessNeed} sub="입고 30일 내 미불출" onClick={() => goLink({ link: 'production' })} />
        </div>
      </div>

      {/* 🟢 모니터 */}
      <div>
        <p className="text-xs font-bold text-emerald-600 mb-2 flex items-center gap-1.5">🟢 흐름 모니터 <span className="text-slate-300 font-normal">— 참고</span></p>
        <div className="grid grid-cols-2 gap-3">
          <KpiCard tone="green" label="신규 PO (3일 내)" value={k.newPO} onClick={() => goLink({ link: 'cpo' })} />
          <KpiCard tone="green" label="진행 중 생산" value={k.inProgress} onClick={() => goLink({ link: 'production' })} />
        </div>
      </div>

      {/* ⚡ 급한 TOP 10 */}
      <div>
        <p className="text-xs font-bold text-slate-700 mb-2">⚡ 지금 가장 급한 TOP 10</p>
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          {ct.top.length === 0
            ? <div className="text-center py-8 text-slate-300 text-sm">긴급 항목이 없습니다 👍</div>
            : ct.top.map((item, i) => (
              <div key={i} onClick={() => goLink(item)}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-50 last:border-0 hover:bg-slate-50 cursor-pointer">
                <span className="text-xs font-bold text-slate-300 w-5">{i + 1}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${item.kind === 'order' ? 'bg-red-100 text-red-600' : item.kind === 'prodDelay' ? 'bg-orange-100 text-orange-600' : item.kind === 'neg' ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
                  {item.kind === 'order' ? '발주' : item.kind === 'prodDelay' ? '생산지연' : item.kind === 'neg' ? '재고음수' : '미입고'}
                </span>
                <span className="font-mono text-xs text-indigo-600">{item.std_code}</span>
                <span className="text-xs text-slate-500 flex-1 truncate">{item.name} · {item.detail}</span>
                <span className="text-slate-300 text-xs">→</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
