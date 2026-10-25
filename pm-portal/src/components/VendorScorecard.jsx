// 📊 협력사 성적표 (v4.98.0) — 최근 3개월 입고된 발주 줄 기준
//   요청 납기 준수율 = 첫 입고일 ≤ 요청 납기 · 변경 약속 지킴 = 첫 입고일 ≤ 변경 납기 · 변경 횟수 = 「협력사 변경」 이력
//   비딩 · 협상 때 근거로 — 숫자는 구매자재 화면에서만 보인다
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export default function VendorScorecard({ onClose }) {
  const [months, setMonths] = useState(3)
  const [sortKey, setSortKey] = useState('lines')
  const { data, error, isLoading } = useQuery({
    queryKey: ['vendorScore', months],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_vendor_scorecard', { p_months: months })
      if (error) throw (error.code === 'PGRST202' || error.code === '42883') ? new Error('「납기변경_반영_261025.sql」 을 실행하면 성적표가 나옵니다') : error
      return data || []
    },
    retry: false, staleTime: 5 * 60 * 1000,
  })
  const rows = (data || []).map((r) => ({ ...r, rate: Number(r.lines) ? Math.round((Number(r.on_time) / Number(r.lines)) * 100) : null }))
    .sort((a, b) => sortKey === 'rate' ? (a.rate ?? 999) - (b.rate ?? 999) : sortKey === 'open' ? Number(b.open_late) - Number(a.open_late) : Number(b.lines) - Number(a.lines))
  const th = (k, l, cls = '') => <th onClick={() => k && setSortKey(k)} className={`px-3 py-2 font-bold whitespace-nowrap ${k ? 'cursor-pointer hover:text-slate-700' : ''} ${cls}`}>{l}{sortKey === k ? ' ▼' : ''}</th>
  return (
    <div className="rounded-xl border border-violet-200 bg-white" data-vendor-score>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-slate-100">
        <b className="text-[14px] text-slate-800">📊 협력사 성적표</b>
        <span className="text-[11.5px] text-slate-400">입고된 발주 줄 기준 · 요청 납기 준수율이 낮은 순으로 보려면 「준수율」을 누르세요</span>
        <div className="ml-auto inline-flex gap-1 p-0.5 rounded-lg bg-slate-100">
          {[3, 6, 12].map((m) => <button key={m} type="button" onClick={() => setMonths(m)} className={`px-2 py-0.5 rounded-md text-[11.5px] font-bold ${months === m ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}>{m}개월</button>)}
        </div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
      </div>
      {error && <p className="px-4 py-3 text-[12.5px] text-amber-700">{error.message}</p>}
      {isLoading && <p className="px-4 py-3 text-[12.5px] text-slate-400">불러오는 중…</p>}
      {!error && !isLoading && (
        <div className="overflow-x-auto max-h-[320px]">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-slate-50 text-[11.5px] text-slate-500 text-left"><tr>
              {th(null, '협력사')}{th('lines', '입고 줄', 'text-right')}{th('rate', '요청 납기 준수율', 'text-right')}{th(null, '늦은 줄 · 평균', 'text-right')}{th(null, '변경 약속 지킴', 'text-right')}{th(null, '납기 변경', 'text-right')}{th('open', '지금 지연 중', 'text-right')}
            </tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">기간 안에 입고된 발주가 없습니다</td></tr>}
              {rows.map((r) => (
                <tr key={r.vendor_id} className="border-t border-slate-100" data-score-row={r.vendor}>
                  <td className="px-3 py-1.5 font-bold text-slate-700">{r.vendor}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{Number(r.lines).toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">{r.rate === null ? '—' : <span className={`font-mono font-bold ${r.rate >= 90 ? 'text-emerald-600' : r.rate >= 70 ? 'text-amber-600' : 'text-red-600'}`}>{r.rate}%</span>}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-500">{Number(r.late) ? `${Number(r.late)}줄 · ${r.avg_late_days}일` : '—'}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-500">{Number(r.kept_vendor_date) || '—'}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-500">{Number(r.vendor_changes) || '—'}</td>
                  <td className="px-3 py-1.5 text-right">{Number(r.open_late) ? <span className="font-mono font-bold text-red-600">{Number(r.open_late)}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
