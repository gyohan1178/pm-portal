import { useMemo } from 'react'
import AnalysisTabs from '../../components/AnalysisTabs'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
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
  inbound: () => '/inbound',        // 입고 화면은 고객사 구분이 없다
  request: () => '/material-request',
  lot: () => '/lot',
}

export default function ControlTower({ scope = 'ax' }) {
  const nav = useNavigate()
  const isMaster = scope === 'all'

  // 수시로 열어두는 화면이므로 5분마다 조용히 갱신하고,
  // 다른 창을 보다 돌아왔을 때도 최신값을 가져온다.
  const { data, isLoading } = useQuery({
    queryKey: ['controlTower', scope],
    queryFn: () => fetchControlTowerData(scope),
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  })

  const ct = useMemo(() => {
    if (!data) return null
    // 마스터에서는 고객사별로 계산해 항목마다 어느 고객사인지 붙인다.
    //   담당자가 자기 고객사 화면으로 바로 넘어갈 수 있어야 한다.
    if (isMaster && data.byCustomer) {
      const merged = { kpi: {}, top: [], lists: {} }
      CUST.forEach(c => {
        const d = data.byCustomer[c.code]
        if (!d) return
        const r = computeControlTower({
          shortage: d.shortage, pos: d.pos, prod: d.prod, buyPos: d.buyPos || [],
        })
        Object.entries(r.kpi).forEach(([k, v]) => { merged.kpi[k] = (merged.kpi[k] || 0) + v })
        merged.top.push(...r.top.map(x => ({ ...x, cs: c.code, csName: c.name, csColor: c.color })))
      })
      merged.top.sort((a, b) => b.urgency - a.urgency)
      merged.top = merged.top.slice(0, 30)
      return merged
    }
    return computeControlTower({
      shortage: data.shortage, pos: data.pos, prod: data.prod, buyPos: data.buyPos || [],
    })
  }, [data])

  // 마스터: 고객사별 위험도 비교
  const byCust = useMemo(() => {
    if (!isMaster || !data?.byCustomer) return []
    return CUST.map(c => {
      const d = data.byCustomer[c.code]
      if (!d) return { ...c, score: 0, kpi: null }
      const r = computeControlTower({ shortage: d.shortage, pos: d.pos, prod: d.prod, buyPos: d.buyPos || [] })
      // 입고 지연은 바로 생산을 막으므로 가중치를 크게 둔다
      const score = (r.kpi.inboundLate ?? 0) * 3 + r.kpi.orderNeeded * 3 + r.kpi.negSoon * 2 + r.kpi.prodDelay * 2 + r.kpi.lateArrival
      return { ...c, score, kpi: r.kpi }
    }).sort((a, b) => b.score - a.score)
  }, [isMaster, data])

  // 자재 요청 — 처리 전인 것. 확인이 늦어 놓치는 일이 잦아 앞자리에 둔다.
  const { data: reqPending = 0 } = useQuery({
    queryKey: ['ctReqPending'],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.rpc('pm_request_list',
        { p_status: null, p_days: 180, p_mine: false, p_customer: null, p_dept: null })
      return (data || []).filter(r => ['요청', '코드대기', '확인'].includes(r.status)).length
    },
  })

  // 로트 — 기한이 지났거나 다가온 것
  const { data: lotAlert = 0 } = useQuery({
    queryKey: ['ctLotAlert'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.rpc('pm_lot_summary')
      return (data || []).filter(r => (r.expired_cnt || 0) > 0 || (r.soon_cnt || 0) > 0).length
    },
  })

  // 항목마다 어느 고객사 건인지 붙여 두었으므로 그쪽으로 보낸다.
  //   담당자는 자기 고객사만 보므로 바로 넘어가야 한다.
  const goLink = (item) => {
    const cs = item.cs || (isMaster ? 'ax' : scope)
    const fn = LINK_MAP[item.link]
    if (fn) nav(fn(cs))
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
          <p className="text-xs text-slate-400 mt-0.5">자재 흐름 — 요청·입고·발주·재고</p>
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
      {/* 값이 있는 고객사만 보인다. 전부 0 인 칸은 자리만 차지한다. */}
      {isMaster && byCust.some(c => c.score > 0) && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {byCust.filter(c => c.score > 0).map((c, i) => (
            <button key={c.code} onClick={() => nav(`/control-tower/${c.code}`)}
              className={`text-left rounded-xl border p-3 transition-all hover:shadow-md ${i === 0 && c.score > 0 ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                <span className="text-sm font-bold text-slate-800">{c.name}</span>
                {i === 0 && c.score > 0 && <span className="ml-auto text-[10px] font-bold text-red-500 bg-red-100 px-1.5 py-0.5 rounded-full">최우선</span>}
              </div>
              {c.kpi ? (
                <div className="text-[11px] text-slate-500 space-y-0.5">
                  <p>🔴 입고지연 {c.kpi.inboundLate ?? 0} · 발주 {c.kpi.orderNeeded}</p>
                  <p>🟡 재고음수 {c.kpi.negSoon}</p>
                </div>
              ) : <p className="text-[11px] text-slate-300">데이터 없음</p>}
            </button>
          ))}
        </div>
      )}

      {/* KPI — 한눈에 보이게 한 줄로 압축.
          수시로 여는 화면이므로 스크롤 없이 상태가 파악되어야 한다. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {/* 구매·자재만 남긴다. 담당자들이 각자 화면을 갖게 되면서
            생산·영업 항목은 그쪽에서 보는 편이 낫다. */}
        {[
          { v: reqPending,    l: '자재 요청',  s: '처리 대기',   t: 'red',    link: 'request' },
          { v: k.inboundLate, l: '입고 지연',  s: '납기 지남',   t: 'red',    link: 'inbound' },
          { v: k.orderNeeded, l: '발주 필요',  s: 'LT 고려',     t: 'red',    link: 'short' },
          { v: k.negSoon,     l: '재고 음수',  s: '3개월 내',    t: 'yellow', link: 'short' },
          { v: lotAlert,      l: '로트 기한',  s: '만료·임박',   t: 'yellow', link: 'lot' },
        ].map((x, i) => {
          const tone = x.v === 0
            ? 'border-slate-200 bg-white text-slate-300'
            : x.t === 'red' ? 'border-rose-300 bg-rose-50 text-rose-700'
            : x.t === 'yellow' ? 'border-amber-300 bg-amber-50 text-amber-700'
            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          return (
            <button key={i} onClick={() => goLink({ link: x.link })}
              className={`rounded-xl border-2 p-2.5 text-left transition-all hover:shadow-md ${tone}`}>
              <p className="text-[10px] font-bold opacity-70 leading-tight">{x.l}</p>
              <p className="text-2xl font-bold leading-none mt-0.5">{x.v}</p>
              {x.s && <p className="text-[9px] opacity-60 mt-0.5 leading-tight">{x.s}</p>}
            </button>
          )
        })}
      </div>

      {/* 급한 건 — 무엇부터 할지 하나로 보여 준다.
          예전의 '오늘 할 일' 은 별도 메뉴가 생겨 뺐다. */}
      <div>
        <div className="flex items-baseline gap-2 mb-2">
          <p className="text-xs font-bold text-slate-700">⚡ 지금 가장 급한 건</p>
          <span className="text-[11px] text-slate-400">{ct.top.length}건</span>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          {ct.top.length === 0
            ? <div className="text-center py-8 text-slate-300 text-sm">긴급 항목이 없습니다 👍</div>
            : ct.top.slice(0, 12).map((item, i) => (
              <div key={i} onClick={() => goLink(item)}
                className="flex items-center gap-2.5 px-3 py-2 border-b border-slate-50 last:border-0 hover:bg-slate-50 cursor-pointer text-xs">
                <span className="text-xs font-bold text-slate-300 w-5">{i + 1}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  item.kind === 'inboundLate' ? 'bg-red-100 text-red-700'
                  : item.kind === 'order' ? 'bg-red-100 text-red-600'
                  : item.kind === 'prodDelay' ? 'bg-orange-100 text-orange-600'
                  : item.kind === 'neg' ? 'bg-rose-100 text-rose-600'
                  : 'bg-amber-100 text-amber-600'}`}>
                  {item.kind === 'inboundLate' ? '입고지연'
                   : item.kind === 'order' ? '발주'
                   : item.kind === 'prodDelay' ? '생산지연'
                   : item.kind === 'neg' ? '재고음수' : '미입고'}
                </span>
                {/* 어느 고객사 건인지 — 담당자가 자기 것을 바로 찾는다 */}
                {item.csName && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0"
                    style={{ background: `${item.csColor}18`, color: item.csColor }}>
                    {item.csName}
                  </span>
                )}
                <span className="font-mono text-xs text-indigo-600 flex-shrink-0">{item.std_code}</span>
                <span className="text-xs text-slate-500 flex-1 truncate">{item.name} · {item.detail}</span>
                <span className="text-slate-300 text-xs">→</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
