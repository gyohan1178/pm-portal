import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../../lib/toast'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')
const dday = (d) => {
  if (!d) return null
  const diff = Math.ceil((new Date(d) - new Date(new Date().toDateString())) / 86400000)
  return diff
}

// 납품 예정 건 중 일정이 바뀐 것.
//
//   제조팀 요청 — 2개월 이내 납품 품목의 일정 변경을 알고 싶다.
//   여기 목록을 그대로 엑셀로 뽑아 공유할 수 있다.
export default function ScheduleChanges() {
  const [days, setDays] = useState(60)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['scheduleChanges', days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_schedule_changes', { p_days: days })
      if (error) throw error
      return data || []
    },
  })

  // 당겨진 건과 밀린 건을 나눈다 — 대응이 다르기 때문
  const earlier = rows.filter(r => r.from_date && r.to_date && r.to_date < r.from_date)
  const later = rows.filter(r => r.from_date && r.to_date && r.to_date > r.from_date)

  function exportExcel() {
    if (!rows.length) { toastError('내보낼 내역이 없습니다'); return }
    try {
      const data = rows.map(r => ({
        'PO번호': r.po_number || '',
        '오더/DEL': [r.order_line, r.del_line].filter(Boolean).join('-'),
        '기준코드': r.std_code || '',
        '품명': r.item_name || '',
        '수량': Number(r.qty) || 0,
        '변경 전 납기': r.from_date || '',
        '변경 후 납기': r.to_date || '',
        '변경 방향': r.to_date < r.from_date ? '당겨짐' : r.to_date > r.from_date ? '밀림' : '-',
        '현재 납기': r.promise_date || '',
        'D-day': dday(r.promise_date) ?? '',
        '변경일': r.changed_at || '',
        '고객사': r.customer || '',
      }))
      const ws = XLSX.utils.json_to_sheet(data)
      ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 32 }, { wch: 7 },
                     { wch: 12 }, { wch: 12 }, { wch: 9 }, { wch: 11 }, { wch: 7 }, { wch: 11 }, { wch: 10 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '일정변경')
      XLSX.writeFile(wb, `납품일정변경_${new Date().toISOString().slice(0, 10)}.xlsx`)
      toastSuccess(`${rows.length}건 내보냄`)
    } catch (e) {
      toastError('내보내기 실패: ' + (e?.message || e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-slate-900">📅 납품 일정 변경</h1>
          <p className="text-xs text-slate-400">
            고객사 PO 업로드 시 납기가 바뀐 건입니다. 가장 최근 업로드에서 바뀐 것만 표시됩니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {[[30, '1개월'], [60, '2개월'], [90, '3개월']].map(([d, l]) => (
              <button key={d} onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs font-bold rounded-md ${days === d ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                {l}
              </button>
            ))}
          </div>
          <button onClick={exportExcel} disabled={!rows.length}
            className="px-3 py-2 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40">
            📥 엑셀
          </button>
        </div>
      </div>

      {/* 요약 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-bold text-slate-400">전체</p>
          <p className="text-2xl font-bold text-slate-800">{n(rows.length)}</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
          <p className="text-[11px] font-bold text-rose-500">당겨짐</p>
          <p className="text-2xl font-bold text-rose-700">{n(earlier.length)}</p>
          <p className="text-[10px] text-rose-400">제조 일정 확인 필요</p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
          <p className="text-[11px] font-bold text-sky-500">밀림</p>
          <p className="text-2xl font-bold text-sky-700">{n(later.length)}</p>
        </div>
      </div>

      {/* 목록 */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-xs min-w-[860px]">
          <thead className="bg-slate-50 text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left font-bold">PO번호</th>
              <th className="px-3 py-2 text-left font-bold">오더/DEL</th>
              <th className="px-3 py-2 text-left font-bold">기준코드 · 품명</th>
              <th className="px-3 py-2 text-right font-bold">수량</th>
              <th className="px-3 py-2 text-center font-bold">납기 변경</th>
              <th className="px-3 py-2 text-center font-bold">D-day</th>
              <th className="px-3 py-2 text-left font-bold">변경일</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="py-10 text-center text-slate-400">불러오는 중…</td></tr>
            )}
            {!isLoading && !rows.length && (
              <tr><td colSpan={7} className="py-12 text-center text-slate-400">
                최근 변경된 납품 일정이 없습니다.
              </td></tr>
            )}
            {rows.map((r, i) => {
              const d = dday(r.promise_date)
              const pulled = r.to_date < r.from_date
              return (
                <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-indigo-600">{r.po_number || '-'}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {[r.order_line, r.del_line].filter(Boolean).join('-') || '-'}
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-mono text-indigo-600">{r.std_code}</p>
                    <p className="text-slate-500 max-w-[240px] truncate">{r.item_name}</p>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-700">{n(r.qty)}</td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    <span className="text-slate-400">{r.from_date}</span>
                    <span className={`mx-1.5 font-bold ${pulled ? 'text-rose-500' : 'text-sky-500'}`}>
                      {pulled ? '◀' : '▶'}
                    </span>
                    <span className={`font-bold ${pulled ? 'text-rose-700' : 'text-sky-700'}`}>{r.to_date}</span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {d === null ? '-' : (
                      <span className={`font-bold ${d <= 7 ? 'text-rose-600' : d <= 30 ? 'text-amber-600' : 'text-slate-500'}`}>
                        D{d >= 0 ? '-' : '+'}{Math.abs(d)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{r.changed_at}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!!rows.length && (
        <p className="text-[11px] text-slate-400">
          <span className="text-rose-500 font-bold">◀ 당겨짐</span> 은 납기가 앞당겨져 제조 일정을 확인해야 하는 건입니다.
          엑셀로 내보내 제조팀에 공유할 수 있습니다.
        </p>
      )}
    </div>
  )
}
