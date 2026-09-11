import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import AnalysisTabs from '../components/AnalysisTabs'

// 자재요청 업무량 — 잔건 대응에 얼마나 시간을 쓰는지 보여 주는 화면.
//
//   ⚠ 「반려 + 요청자 취소」가 핵심이다.
//     응답도 하고 확인도 했는데 결과적으로 아무것도 안 나간 일이다.
//
//   ⚠ 「단품 요청」(품목 1개짜리 요청서)이 잔건의 지표다.
//     같은 품목 수라도 요청서가 여러 장이면 확인·회신·불출 절차가 그만큼 돈다.

const n0 = v => (Number(v) || 0).toLocaleString('ko-KR')
const UNITS = [['month', '월'], ['week', '주'], ['day', '일']]
const BYS = [['requester', '요청자'], ['dept', '확인부서'], ['customer', '고객사']]

async function call(fn, args) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data || []
}

export default function RequestLoad() {
  const [unit, setUnit] = useState('month')
  const [by, setBy] = useState('requester')

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['reqLoad', unit],
    queryFn: () => call('pm_request_load', { p_unit: unit }),
    staleTime: 5 * 60 * 1000,
  })
  const { data: byRows = [] } = useQuery({
    queryKey: ['reqLoadBy', by],
    queryFn: () => call('pm_request_load_by', { p_by: by }),
    staleTime: 5 * 60 * 1000,
  })
  const { data: reasons = [] } = useQuery({
    queryKey: ['reqReasons'],
    queryFn: () => call('pm_request_reject_reasons', {}),
    staleTime: 5 * 60 * 1000,
  })

  const cur = rows[0] || {}
  const prev = rows[1] || {}
  const delta = (a, b) => {
    const x = Number(a) || 0, y = Number(b) || 0
    if (!y) return null
    return Math.round((x - y) / y * 100)
  }

  return (
    <div className="space-y-4">
      <AnalysisTabs />

      <div>
        <h1 className="text-lg font-bold text-slate-900">🗂 자재요청 업무량</h1>
        <p className="text-xs text-slate-400">
          요청을 받아 확인·회신·불출하기까지 얼마나 손이 가는지 봅니다.
          품목 단위로 세되, 절차는 요청서마다 한 번씩 도므로 장수도 함께 냅니다.
        </p>
      </div>

      {/* 이번 기간 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label={`${cur.period || '-'} 처리 품목`} value={n0(cur.req_items)}
              sub={prev.period ? `지난 기간 ${n0(prev.req_items)}` : ''}
              delta={delta(cur.req_items, prev.req_items)} accent="slate" />
        <Card label="요청서 장수" value={n0(cur.req_sheets)}
              sub={`절차가 돈 횟수 · 요청자 ${n0(cur.requesters)}명`} accent="sky" />
        <Card label="불출" value={n0(cur.issued)}
              sub={cur.req_items ? `${Math.round(cur.issued / cur.req_items * 100)}%` : ''}
              accent="emerald" />
        <Card label="반려 + 취소" value={n0(cur.wasted)}
              sub={`반려 ${n0(cur.rejected)} · 취소 ${n0(cur.cancelled)}`}
              accent="rose" />
      </div>

      {/* 불출로 이어지지 않은 일 */}
      {Number(cur.wasted) > 0 && (
        <div className="rounded-xl border-2 border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm font-bold text-rose-800">
            {cur.period} 에 {n0(cur.wasted)}건은 불출로 이어지지 않았습니다
            {cur.req_items ? ` (전체의 ${Math.round(cur.wasted / cur.req_items * 100)}%)` : ''}
          </p>
          <p className="text-xs text-rose-600 mt-0.5">
            확인하고 회신까지 했으나 반려되거나 요청자가 취소한 건입니다.
            요청 단계에서 걸러지면 그만큼 손이 덜 갑니다.
          </p>
        </div>
      )}

      {/* 기간별 */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex-wrap">
          <p className="text-sm font-bold text-slate-700">기간별</p>
          <div className="flex gap-1 ml-auto">
            {UNITS.map(([k, l]) => (
              <button key={k} onClick={() => setUnit(k)}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg border ${
                  unit === k ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                             : 'border-slate-200 bg-white text-slate-500'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['기간', '품목', '요청서', '요청자', '불출', '반려', '취소',
                  '진행중', '단품요청', '장당품목', '평균처리일', '당일'].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-bold text-slate-500 ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={12} className="px-3 py-6 text-center text-slate-400">불러오는 중…</td></tr>}
              {!isLoading && !rows.length && <tr><td colSpan={12} className="px-3 py-6 text-center text-slate-400">자료가 없습니다</td></tr>}
              {rows.map((r, i) => (
                <tr key={r.period} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/30' : ''}`}>
                  <td className="px-3 py-1.5 font-bold text-slate-700">{r.period}</td>
                  <td className="px-3 py-1.5 text-right font-bold text-slate-800">{n0(r.req_items)}</td>
                  <td className="px-3 py-1.5 text-right text-sky-700">{n0(r.req_sheets)}</td>
                  <td className="px-3 py-1.5 text-right text-slate-400">{n0(r.requesters)}</td>
                  <td className="px-3 py-1.5 text-right text-emerald-600">{n0(r.issued)}</td>
                  <td className="px-3 py-1.5 text-right text-rose-600">{n0(r.rejected)}</td>
                  <td className="px-3 py-1.5 text-right text-amber-600">{n0(r.cancelled)}</td>
                  <td className="px-3 py-1.5 text-right text-slate-400">{n0(r.in_progress)}</td>
                  <td className="px-3 py-1.5 text-right text-violet-600">{n0(r.single_item)}</td>
                  <td className="px-3 py-1.5 text-right text-slate-500">{r.avg_items ?? '-'}</td>
                  <td className="px-3 py-1.5 text-right text-slate-500">{r.avg_days ?? '-'}일</td>
                  <td className="px-3 py-1.5 text-right text-slate-500">{n0(r.same_day)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 요청자별 */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex-wrap">
          <div>
            <p className="text-sm font-bold text-slate-700">누가 얼마나 요청하나</p>
            <p className="text-[11px] text-slate-400">
              단품요청 = 품목 1개짜리 요청서. 많을수록 절차가 자주 돕니다.
            </p>
          </div>
          <div className="flex gap-1 ml-auto">
            {BYS.map(([k, l]) => (
              <button key={k} onClick={() => setBy(k)}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg border ${
                  by === k ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                           : 'border-slate-200 bg-white text-slate-500'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['구분', '품목', '요청서', '불출', '반려', '취소',
                  '단품요청', '단품비율', '장당품목', '평균처리일'].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-bold text-slate-500 ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!byRows.length && <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">자료가 없습니다</td></tr>}
              {byRows.map((r, i) => {
                const heavy = Number(r.single_pct) >= 50 && Number(r.req_sheets) >= 5
                return (
                  <tr key={r.label} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/30' : ''}`}>
                    <td className="px-3 py-1.5 font-bold text-slate-700">{r.label}</td>
                    <td className="px-3 py-1.5 text-right font-bold text-slate-800">{n0(r.req_items)}</td>
                    <td className="px-3 py-1.5 text-right text-sky-700">{n0(r.req_sheets)}</td>
                    <td className="px-3 py-1.5 text-right text-emerald-600">{n0(r.issued)}</td>
                    <td className="px-3 py-1.5 text-right text-rose-600">{n0(r.rejected)}</td>
                    <td className="px-3 py-1.5 text-right text-amber-600">{n0(r.cancelled)}</td>
                    <td className="px-3 py-1.5 text-right text-violet-600">{n0(r.single_item)}</td>
                    <td className={`px-3 py-1.5 text-right font-bold ${heavy ? 'text-rose-600' : 'text-slate-400'}`}>
                      {r.single_pct ?? '-'}%
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-500">{r.avg_items ?? '-'}</td>
                    <td className="px-3 py-1.5 text-right text-slate-500">{r.avg_days ?? '-'}일</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 반려 사유 */}
      {reasons.length > 0 && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
            <p className="text-sm font-bold text-slate-700">반려·취소 사유</p>
            <p className="text-[11px] text-slate-400">
              같은 사유가 반복되면 요청 단계에서 줄일 수 있습니다.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['사유', '구분', '품목', '요청서', '요청자', '마지막'].map((h, i) => (
                    <th key={h} className={`px-3 py-2 font-bold text-slate-500 whitespace-nowrap ${i >= 2 && i <= 3 ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reasons.map((r, i) => (
                  <tr key={`${r.reason}-${r.kind}`} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/30' : ''}`}>
                    <td className="px-3 py-1.5 text-slate-700">{r.reason}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        r.kind === '요청자 취소' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                        {r.kind}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-bold text-slate-700">{n0(r.cnt)}</td>
                    <td className="px-3 py-1.5 text-right text-slate-500">{n0(r.sheets)}</td>
                    <td className="px-3 py-1.5 text-slate-500">{r.requesters}</td>
                    <td className="px-3 py-1.5 text-slate-400 whitespace-nowrap">{r.last_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400 leading-relaxed">
        · <b>품목</b> 요청서 안의 줄 수 · <b>요청서</b> 확인·회신·불출 절차가 돈 횟수<br />
        · <b>단품요청</b> 품목이 하나뿐인 요청서. 같은 품목 수라도 장수가 많으면 손이 더 갑니다.<br />
        · <b>취소</b> 요청자가 무른 것으로, 우리가 거절한 반려와 따로 셉니다.<br />
        · <b>평균처리일</b> 요청일에서 처리일까지. 불출 예정일을 회신한 뒤 나중에 나간 건은 그 날짜까지 포함됩니다.
      </p>
    </div>
  )
}

function Card({ label, value, sub, delta, accent }) {
  const ac = { emerald: 'text-emerald-600', rose: 'text-rose-600', sky: 'text-sky-600',
               slate: 'text-slate-900' }[accent] || 'text-slate-800'
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="text-[11px] font-semibold text-slate-400">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-lg font-bold ${ac}`}>{value}</span>
        {delta != null && (
          <span className={`text-[11px] font-bold ${delta > 0 ? 'text-rose-500' : delta < 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
            {delta > 0 ? '▲' : delta < 0 ? '▼' : ''}{Math.abs(delta)}%
          </span>
        )}
      </div>
      {sub && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  )
}
