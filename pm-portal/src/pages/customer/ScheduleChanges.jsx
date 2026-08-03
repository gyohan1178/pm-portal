import { useState, Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { MAIN_PNS } from '../production/mainPns'
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
  const [open, setOpen] = useState(null)   // 이력을 펼친 행
  const [pdOnly, setPdOnly] = useState(false)   // 생산관리 대상(PD BOX)만

  // 생산관리 대상 판별 — std_code 는 'AX-110153030' 형태라 접두를 벗겨 대조한다
  const isPdBox = (code) => MAIN_PNS.has(String(code || '').replace(/^AX-/i, '').trim())

  const { data: allRows = [], isLoading } = useQuery({
    queryKey: ['scheduleChanges', days],
    staleTime: 5 * 60 * 1000,   // PO 업로드 시에만 바뀐다
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_schedule_changes', { p_days: days })
      if (error) throw error
      return data || []
    },
    staleTime: 3 * 60 * 1000,   // PO 업로드 때만 바뀌므로 자주 조회할 필요가 없다
  })

  const rows = pdOnly ? allRows.filter(r => isPdBox(r.std_code)) : allRows
  const pdCount = allRows.filter(r => isPdBox(r.std_code)).length

  // 당겨진 건과 밀린 건을 나눈다 — 대응이 다르기 때문
  const earlier = rows.filter(r => r.from_date && r.to_date && r.to_date < r.from_date)
  const later = rows.filter(r => r.from_date && r.to_date && r.to_date > r.from_date)
  // 반복해서 밀린 건 — 한 번 밀린 것보다 위험 신호가 크다
  const repeated = rows.filter(r => (Number(r.chg_count) || 0) >= 3)

  function exportExcel() {
    if (!rows.length) { toastError('내보낼 내역이 없습니다'); return }
    try {
      const data = rows.map(r => ({
        'PO번호': r.po_number || '',
        '오더/DEL': [r.order_line, r.del_line].filter(Boolean).join('-'),
        '구분': isPdBox(r.std_code) ? 'PD BOX' : '',
        '기준코드': r.std_code || '',
        '품명': r.item_name || '',
        '수량': Number(r.qty) || 0,
        '전주월요일 납기': r.from_date || '',
        '현재 납기': r.to_date || '',
        '변경 방향': r.to_date < r.from_date ? '당겨짐' : r.to_date > r.from_date ? '밀림' : '-',
        '이번주 변경횟수': Number(r.chg_count) || 0,
        
        '변동일': r.total_shift ?? '',
        '현재 납기': r.promise_date || '',
        'D-day': dday(r.promise_date) ?? '',
        '기준일': r.changed_at || '',
        '고객사': r.customer || '',
      }))
      const ws = XLSX.utils.json_to_sheet(data)
      ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 9 }, { wch: 16 }, { wch: 32 }, { wch: 7 },
                     { wch: 12 }, { wch: 12 }, { wch: 9 }, { wch: 9 }, { wch: 12 }, { wch: 9 },
                     { wch: 11 }, { wch: 7 }, { wch: 11 }, { wch: 10 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '일정변경')
      XLSX.writeFile(wb, `납품일정변경${pdOnly ? '_PDBOX' : ''}_${new Date().toISOString().slice(0, 10)}.xlsx`)
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
            전주 월요일 시점과 비교해 납기가 바뀐 건입니다. 매주 월요일에 기준이 갱신됩니다.{pdOnly && ' (PD BOX 만)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPdOnly(v => !v)}
            title="생산관리 대상 PD BOX 품번만 (16종)"
            className={`px-3 py-2 text-xs font-bold rounded-lg border whitespace-nowrap ${pdOnly
              ? 'border-indigo-500 bg-indigo-600 text-white'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            🏭 PD BOX만 {pdCount > 0 && `(${pdCount})`}
          </button>
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-[11px] font-bold text-amber-600">이번 주 3회+</p>
          <p className="text-2xl font-bold text-amber-700">{n(repeated.length)}</p>
          <p className="text-[10px] text-amber-500">3회 이상</p>
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
              <th className="px-3 py-2 text-center font-bold">전주 월요일 → 현재</th>
              <th className="px-3 py-2 text-center font-bold">이번 주 변경</th>
              <th className="px-3 py-2 text-center font-bold">D-day</th>
              <th className="px-3 py-2 text-left font-bold">기준일</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="py-10 text-center text-slate-400">불러오는 중…</td></tr>
            )}
            {!isLoading && !rows.length && (
              <tr><td colSpan={8} className="py-12 text-center text-slate-400">
                최근 변경된 납품 일정이 없습니다.
              </td></tr>
            )}
            {rows.map((r, i) => {
              const d = dday(r.promise_date)
              const pulled = r.to_date < r.from_date
              return (
              <Fragment key={i}>
                <tr className={`border-t border-slate-100 hover:bg-slate-50 ${open === i ? 'bg-amber-50/40' : ''}`}>
                  <td className="px-3 py-2 font-mono text-indigo-600">{r.po_number || '-'}</td>
                  <td className="px-3 py-2 text-slate-500">
                    {[r.order_line, r.del_line].filter(Boolean).join('-') || '-'}
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-mono text-indigo-600">
                      {r.std_code}
                      {isPdBox(r.std_code) && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[9px] font-bold">PD</span>
                      )}
                    </p>
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
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    {(Number(r.chg_count) || 1) > 1 ? (
                      <button onClick={() => setOpen(open === i ? null : i)}
                        title="눌러서 전체 이력 보기 (이번 주 변경 횟수)"
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                          (Number(r.chg_count) || 0) >= 3
                            ? 'border-amber-400 bg-amber-100 text-amber-800'
                            : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                        🔁 {r.chg_count}회
                        {r.total_shift != null && (
                          <span className={r.total_shift > 0 ? 'text-rose-600' : 'text-sky-600'}>
                            {r.total_shift > 0 ? '+' : ''}{r.total_shift}일
                          </span>
                        )}
                      </button>
                    ) : <span className="text-slate-300 text-[11px]">변경 없음</span>}
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
                {open === i && (
                  <tr className="bg-amber-50/60">
                    <td colSpan={8} className="px-6 py-3">
                      <HistoryRows po={r.po_number} code={r.std_code}
                        order={r.order_line} del={r.del_line} />
                    </td>
                  </tr>
                )}
              </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {!!rows.length && (
        <p className="text-[11px] text-slate-400">
          <span className="text-rose-500 font-bold">◀ 당겨짐</span> 은 납기가 앞당겨져 제조 일정을 확인해야 하는 건입니다.
          전주 월요일과 비교하므로 매주 월요일에 목록이 새로 잡힙니다.
        </p>
      )}
    </div>
  )
}


// 한 건의 전체 납기 변경 이력.
// 몇 번 밀렸는지, 언제부터 밀리기 시작했는지 보인다.
function HistoryRows({ po, code, order, del }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['scheduleHistory', po, code, order, del],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_schedule_history',
        { p_po: po, p_code: code, p_order: order, p_del: del })
      if (error) throw error
      return data || []
    },
    staleTime: 10 * 60 * 1000,
  })

  if (isLoading) return <p className="text-[11px] text-slate-400">불러오는 중…</p>
  if (!rows.length) return <p className="text-[11px] text-slate-400">이력이 없습니다.</p>

  return (
    <div>
      <p className="text-[11px] font-bold text-amber-700 mb-2">납기 변경 이력</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="px-2 py-1 rounded bg-white border border-slate-200 text-[11px] font-mono font-bold text-slate-500">
          {rows[0].from_date}
        </span>
        {rows.map((h, k) => {
          const sh = Number(h.shift_days)
          return (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={`text-xs ${sh > 0 ? 'text-rose-400' : 'text-sky-400'}`}>→</span>
              <span title={`${h.changed_at} 변경`}
                className={`px-2 py-1 rounded border text-[11px] font-mono font-bold ${
                  sh > 0 ? 'border-rose-200 bg-rose-50 text-rose-700'
                         : 'border-sky-200 bg-sky-50 text-sky-700'}`}>
                {h.to_date}
                {!isNaN(sh) && <span className="ml-1 opacity-70">{sh > 0 ? '+' : ''}{sh}</span>}
              </span>
            </span>
          )
        })}
      </div>
      <p className="text-[10px] text-slate-400 mt-2">
        각 상자 위에 마우스를 올리면 변경일이 표시됩니다 · 숫자는 직전 대비 변동일
      </p>
    </div>
  )
}
