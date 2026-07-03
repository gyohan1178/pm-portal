import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchInsightsData } from '../../lib/insightsData'
import { computePPV, computeVendorScorecard, computeActivity, computeNorthStar } from '../../lib/insights'
import { ResizableTable } from '../../components/ResizableTable'
import { useTableSort } from '../../hooks/useTableSort'
import AnalysisTabs from '../../components/AnalysisTabs'

const VENDOR_COLS = [
  { key:'_rank',      label:'순위',     defaultWidth:60,  sortable:false },
  { key:'name',       label:'거래처',   defaultWidth:170 },
  { key:'score',      label:'점수',     defaultWidth:80,  style:{textAlign:'center'} },
  { key:'onTimeRate', label:'납기준수', defaultWidth:90,  style:{textAlign:'center'} },
  { key:'avgDelay',   label:'평균지연', defaultWidth:90,  style:{textAlign:'center'} },
  { key:'priceVar',   label:'단가변동', defaultWidth:90,  style:{textAlign:'center'} },
  { key:'total',      label:'PO수',     defaultWidth:70,  style:{textAlign:'center'} },
]

const TABS = [
  ['north', '⭐ North Star'],
  ['ppv', '💰 단가 감지'],
  ['vendor', '🏢 공급처 평가'],
  ['activity', '📈 활동 추적'],
]

export default function Insights() {
  const [tab, setTab] = useState('north')
  const { data, isLoading } = useQuery({ queryKey: ['insights'], queryFn: fetchInsightsData })

  const ns = useMemo(() => data ? computeNorthStar(data) : null, [data])
  const ppv = useMemo(() => data ? computePPV(data.priceRows) : [], [data])
  const vendor = useMemo(() => data ? computeVendorScorecard(data.pos, data.vendors, data.priceRows) : [], [data])
  const { sorted: vSorted, sortKey: vSortKey, sortDir: vSortDir, onSort: vOnSort } = useTableSort(vendor, {})
  const activity = useMemo(() => data ? computeActivity(data) : null, [data])

  return (
    <div className="space-y-4">
      <AnalysisTabs />
      <div>
        <h1 className="text-lg font-bold text-slate-900">📊 인사이트 (관리자)</h1>
        <p className="text-xs text-slate-400 mt-0.5">North Star · 단가 이상 · 공급처 평가 · 시스템 활동 — 데이터로 증명하는 구매자재</p>
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit flex-wrap">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap ${tab === k ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{label}</button>
        ))}
      </div>

      {isLoading ? <div className="text-center py-16 text-slate-400 text-sm">분석 중...</div> : (
        <>
          {/* ⭐ North Star */}
          {tab === 'north' && ns && (
            <div className="space-y-4">
              <div className="rounded-2xl border-2 border-slate-800 bg-gradient-to-br from-slate-50 to-indigo-50/40 p-6 text-center">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">⭐ NORTH STAR — 적시 납품률</p>
                <p className="text-6xl font-bold text-slate-900">{ns.onTimeRate != null ? ns.onTimeRate : '—'}<span className="text-2xl text-slate-400">%</span></p>
                <p className="text-xs text-slate-400 mt-2">완료 {ns.completedPO} · 지연 {ns.delayedPO}</p>
              </div>
              <p className="text-xs font-bold text-slate-500">받침 지표 (입력)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className={`rounded-xl border p-4 ${ns.shortageRiskItems === 0 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                  <p className="text-xs font-bold text-slate-400 mb-1">쇼티지 위험 품목</p>
                  <p className={`text-3xl font-bold ${ns.shortageRiskItems === 0 ? 'text-emerald-600' : 'text-amber-700'}`}>{ns.shortageRiskItems}</p>
                  <p className="text-[10px] text-slate-400 mt-1">{ns.shortageRiskItems === 0 ? '✓ 부족 없음 — 건강' : '부족 예정 품목'}</p>
                </div>
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                  <p className="text-xs font-bold text-slate-400 mb-1">진행 중 PO</p>
                  <p className="text-3xl font-bold text-indigo-700">{(data.pos || []).filter(p => p.status !== '완료').length}</p>
                  <p className="text-[10px] text-slate-400 mt-1">관리 중인 발주</p>
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-500">
                💡 적시 납품률이 떨어지면 → 받침 지표(쇼티지·활동)를 보고 원인을 추적하세요. 결과(출력)는 행동(입력)에서 나옵니다.
              </div>
            </div>
          )}

          {/* 💰 PPV */}
          {tab === 'ppv' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">단가 급변동(±10%↑) 또는 거래처 간 가격차(5%↑)를 감지합니다 — 협상·검토 대상</p>
              {ppv.length === 0 ? <div className="text-center py-12 text-slate-300 text-sm">감지된 단가 이상이 없습니다 👍</div> : (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  {ppv.slice(0, 30).map((a, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-50 last:border-0">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${a.type === 'price_up' ? 'bg-red-100 text-red-600' : a.type === 'price_down' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-700'}`}>
                        {a.type === 'price_up' ? `▲${a.pct}%` : a.type === 'price_down' ? `▼${-a.pct}%` : `격차${a.pct}%`}
                      </span>
                      <span className="font-mono text-xs text-indigo-600">{a.std_code}</span>
                      <span className="text-xs text-slate-500 flex-1 truncate">{a.name} · {a.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 🏢 공급처 스코어카드 */}
          {tab === 'vendor' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">납기 준수 · 단가 안정성 · 거래량으로 거래처를 평가합니다</p>

              {/* 모바일: 카드뷰 */}
              <div className="sm:hidden space-y-2">
                {vendor.slice(0, 30).map((v, i) => (
                  <div key={v.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-slate-300 flex-shrink-0">{i + 1}</span>
                        <span className="text-sm font-bold text-slate-700 truncate">{v.name}</span>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-sm font-bold flex-shrink-0 ${v.score >= 80 ? 'bg-emerald-100 text-emerald-700' : v.score >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>{v.score}점</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-center">
                      <div><p className="text-[10px] text-slate-400">납기준수</p><p className="text-xs font-semibold text-slate-700">{v.onTimeRate != null ? `${v.onTimeRate}%` : '—'}</p></div>
                      <div><p className="text-[10px] text-slate-400">평균지연</p><p className="text-xs font-semibold">{v.avgDelay > 0 ? <span className="text-red-500">{v.avgDelay}일</span> : '-'}</p></div>
                      <div><p className="text-[10px] text-slate-400">단가변동</p><p className="text-xs font-semibold">{v.priceVar > 0 ? <span className="text-amber-600">{v.priceVar}회</span> : <span className="text-emerald-500">안정</span>}</p></div>
                      <div><p className="text-[10px] text-slate-400">PO수</p><p className="text-xs font-semibold text-slate-500">{v.total}</p></div>
                    </div>
                  </div>
                ))}
              </div>

              {/* PC: 테이블뷰 */}
              <div className="hidden sm:block">
                <ResizableTable cols={VENDOR_COLS} storageKey="insights_vendor_cols" sortKey={vSortKey} sortDir={vSortDir} onSort={vOnSort}>
                  {() => (
                  <tbody className="divide-y divide-slate-100">
                    {vSorted.slice(0, 30).map((v, i) => (
                      <tr key={v.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-bold text-slate-400">{i + 1}</td>
                        <td className="px-3 py-2 font-semibold text-slate-700 whitespace-nowrap overflow-hidden truncate">{v.name}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`px-2 py-0.5 rounded-full font-bold ${v.score >= 80 ? 'bg-emerald-100 text-emerald-700' : v.score >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>{v.score}</span>
                        </td>
                        <td className="px-3 py-2 text-center">{v.onTimeRate != null ? `${v.onTimeRate}%` : '—'}</td>
                        <td className="px-3 py-2 text-center">{v.avgDelay > 0 ? <span className="text-red-500">{v.avgDelay}일</span> : '-'}</td>
                        <td className="px-3 py-2 text-center">{v.priceVar > 0 ? <span className="text-amber-600">{v.priceVar}회</span> : <span className="text-emerald-500">안정</span>}</td>
                        <td className="px-3 py-2 text-center text-slate-500">{v.total}</td>
                      </tr>
                    ))}
                  </tbody>
                  )}
                </ResizableTable>
              </div>
              <p className="text-[10px] text-slate-400">※ 점수 = 납기준수 50% + 단가안정 30% + 거래량 20%. 실입고일 데이터가 쌓이면 정밀도 향상.</p>
            </div>
          )}

          {/* 📈 활동 추적 */}
          {tab === 'activity' && activity && (
            <div className="space-y-4">
              {activity.staleWarnings.length > 0 && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
                  <p className="text-xs font-bold text-amber-700 mb-1">⚠ 업데이트 필요</p>
                  {activity.staleWarnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-600">· {w.what} — {w.days}일째 미갱신</p>
                  ))}
                </div>
              )}
              <div>
                <p className="text-xs font-bold text-slate-500 mb-2">최근 4주 활동</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <ActCard label="PO 등록" val={activity.recent.poCreated} />
                  <ActCard label="PO 갱신" val={activity.recent.poUpdated} />
                  <ActCard label="생산 갱신" val={activity.recent.prodUpdated} />
                  <ActCard label="입고 처리" val={activity.recent.inbound} />
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-500 mb-2">데이터 신선도 (마지막 업데이트)</p>
                <div className="grid grid-cols-3 gap-3">
                  <FreshCard label="PO" days={activity.freshness.po} />
                  <FreshCard label="생산" days={activity.freshness.prod} />
                  <FreshCard label="입고" days={activity.freshness.inbound} />
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-500 mb-2">올해 누적 (성실 사용 증명)</p>
                <div className="grid grid-cols-3 gap-3">
                  <ActCard label="PO 처리" val={activity.yearly.po} accent />
                  <ActCard label="생산 호기" val={activity.yearly.prod} accent />
                  <ActCard label="입고 건수" val={activity.yearly.inbound} accent />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ActCard({ label, val, accent }) {
  return <div className={`rounded-xl border p-3 ${accent ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200'}`}>
    <p className="text-[11px] font-bold text-slate-400 mb-1">{label}</p>
    <p className={`text-2xl font-bold ${accent ? 'text-indigo-700' : 'text-slate-900'}`}>{val}</p>
  </div>
}
function FreshCard({ label, days }) {
  const stale = days != null && days >= 3
  return <div className={`rounded-xl border p-3 ${stale ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
    <p className="text-[11px] font-bold text-slate-400 mb-1">{label}</p>
    <p className={`text-lg font-bold ${stale ? 'text-amber-700' : 'text-emerald-600'}`}>{days == null ? '—' : days === 0 ? '오늘' : `${days}일 전`}</p>
  </div>
}
