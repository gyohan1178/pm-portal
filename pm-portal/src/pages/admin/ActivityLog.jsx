import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../../lib/toast'
import { ACTION_LABEL, ACTION_STYLE, TARGET_LABEL } from '../../lib/activityLog'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')

const when = (ts) => {
  const d = new Date(ts)
  const diff = (Date.now() - d) / 1000
  if (diff < 60) return '방금'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`
  return d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
}

// 관리자 전용 — 누가 무엇을 바꿨는지, DB 용량은 얼마나 쓰는지.
// 3명이 함께 쓰면서 "이거 왜 이렇게 됐지?" 를 추적하기 위한 화면.
export default function ActivityLog() {
  const qc = useQueryClient()
  const [days, setDays] = useState(7)
  const [action, setAction] = useState('')
  const [busy, setBusy] = useState('')

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['activityList', days, action],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_activity_list', {
        p_days: days, p_user: null, p_action: action || null, p_limit: 300,
      })
      if (error) throw error
      return data || []
    },
  })

  const { data: summary = [] } = useQuery({
    queryKey: ['activitySummary', days],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_activity_summary', { p_days: days })
      if (error) throw error
      return data || []
    },
  })

  const { data: usage } = useQuery({
    queryKey: ['dbUsage'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_db_usage')
      if (error) throw error
      return data?.[0] || null
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data: tables = [] } = useQuery({
    queryKey: ['tableSizes'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_table_sizes', { p_limit: 12 })
      if (error) throw error
      return data || []
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data: cleanup = [] } = useQuery({
    queryKey: ['cleanupPreview'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_cleanup_preview')
      if (error) throw error
      return data || []
    },
    staleTime: 5 * 60 * 1000,
  })

  async function runCleanup(key, label, cnt) {
    if (!confirm(`${label} ${n(cnt)}건을 삭제합니다.\n되돌릴 수 없습니다. 계속할까요?`)) return
    setBusy(key)
    try {
      const { data, error } = await supabase.rpc('pm_cleanup_run', { p_target: key })
      if (error) throw error
      toastSuccess(`${label} ${n(data)}건 정리`)
      qc.invalidateQueries({ queryKey: ['cleanupPreview'] })
      qc.invalidateQueries({ queryKey: ['dbUsage'] })
      qc.invalidateQueries({ queryKey: ['tableSizes'] })
    } catch (e) {
      toastError('정리 실패: ' + e.message)
    } finally { setBusy('') }
  }

  const pct = Number(usage?.used_pct) || 0
  const barCls = pct > 80 ? 'bg-rose-500' : pct > 60 ? 'bg-amber-500' : 'bg-emerald-500'

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">🗂 활동 이력 · 용량</h1>
        <p className="text-xs text-slate-400">
          주요 작업 기록과 데이터베이스 사용량입니다. 조회·검색은 기록하지 않습니다. (관리자 전용)
        </p>
      </div>

      {/* 용량 */}
      {usage && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-end justify-between mb-2">
            <div>
              <p className="text-xs text-slate-400">데이터베이스 사용량</p>
              <p className="text-2xl font-bold text-slate-900">
                {usage.total_pretty}
                <span className="text-sm font-normal text-slate-400"> / 500 MB</span>
              </p>
            </div>
            <div className="text-right">
              <p className={`text-xl font-bold ${pct > 80 ? 'text-rose-600' : pct > 60 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {pct}%
              </p>
              <p className="text-[11px] text-slate-400">활동 이력 {usage.log_pretty} · {n(usage.log_rows)}건</p>
            </div>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full ${barCls} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          {pct > 80 && (
            <p className="mt-2 text-xs text-rose-600 font-semibold">
              ⚠ 80% 를 넘었습니다. 아래 보관기간 정리를 실행하거나 유료 플랜(월 $25, 8GB)을 검토하세요.
            </p>
          )}
          <p className="mt-2 text-[11px] text-slate-400">
            무료 플랜은 자동 백업이 없습니다. 데이터 백업 메뉴에서 주기적으로 내려받으세요.
          </p>
        </div>
      )}

      {/* 사용자별 요약 */}
      {!!summary.length && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {summary.slice(0, 4).map((s) => (
            <div key={s.user_name} className="bg-white rounded-xl border border-slate-200 p-3">
              <p className="text-xs font-bold text-slate-700 truncate">{s.user_name}</p>
              <p className="text-lg font-bold text-slate-900">{n(s.total)}<span className="text-xs font-normal text-slate-400">건</span></p>
              <p className="text-[10px] text-slate-400">
                등록 {n(s.creates)} · 수정 {n(s.updates)} · 삭제 {n(s.deletes)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {[[1, '오늘'], [7, '7일'], [30, '30일'], [90, '90일']].map(([d, l]) => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-1 text-xs font-semibold rounded-md ${days === d ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {l}
            </button>
          ))}
        </div>
        <select value={action} onChange={(e) => setAction(e.target.value)}
          className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg">
          <option value="">전체 작업</option>
          {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="text-xs text-slate-400 ml-auto">{n(rows.length)}건</span>
      </div>

      {/* 이력 */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-xs min-w-[700px]">
          <thead className="bg-slate-50 text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left w-24">시각</th>
              <th className="px-3 py-2 text-left w-20">담당</th>
              <th className="px-3 py-2 text-center w-16">작업</th>
              <th className="px-3 py-2 text-left w-24">대상</th>
              <th className="px-3 py-2 text-left w-32">식별자</th>
              <th className="px-3 py-2 text-left">내용</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="py-10 text-center text-slate-400">불러오는 중…</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 text-slate-400" title={new Date(r.created_at).toLocaleString('ko-KR')}>
                  {when(r.created_at)}
                </td>
                <td className="px-3 py-2 font-semibold text-slate-700">{r.user_name}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${ACTION_STYLE[r.action] || 'bg-slate-100 text-slate-600'}`}>
                    {ACTION_LABEL[r.action] || r.action}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600">{TARGET_LABEL[r.target] || r.target}</td>
                <td className="px-3 py-2 font-mono text-indigo-600 max-w-[160px] truncate" title={r.target_id}>
                  {r.target_id || '-'}
                </td>
                <td className="px-3 py-2 text-slate-600">{r.summary || '-'}</td>
              </tr>
            ))}
            {!isLoading && !rows.length && (
              <tr><td colSpan={6} className="py-10 text-center text-slate-400">기록이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 테이블별 용량 */}
      <details className="bg-white rounded-xl border border-slate-200 p-4">
        <summary className="text-xs font-bold text-slate-700 cursor-pointer">테이블별 용량</summary>
        <div className="mt-3 space-y-1">
          {tables.map((t) => (
            <div key={t.table_name} className="flex items-center gap-3 text-xs">
              <span className="w-52 font-mono text-slate-600 truncate">{t.table_name}</span>
              <span className="w-20 text-right text-slate-400">{n(t.rows_est)}행</span>
              <span className="w-20 text-right font-semibold text-slate-700">{t.size_pretty}</span>
              <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-slate-300"
                  style={{ width: `${Math.min(100, Number(t.size_bytes) / Number(tables[0]?.size_bytes || 1) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </details>

      {/* 보관기간 정리 */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-bold text-slate-700">보관기간 정리</p>
        <p className="text-[11px] text-slate-400 mb-3">
          활동 이력은 1년, 주간보고·확정매입은 3년 보관합니다.
          발주·입출고·단가 이력은 재고와 추이 계산의 근거라 지우지 않습니다.
        </p>
        <div className="space-y-2">
          {cleanup.map((c) => {
            const key = c.target.includes('활동') ? 'activity'
              : c.target.includes('주간') ? 'weekly'
              : c.target.includes('확정매입') ? 'ecount' : 'cache'
            const cnt = Number(c.rows_to_delete) || 0
            return (
              <div key={c.target} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
                <div className="flex-1">
                  <p className="text-xs font-bold text-slate-700">
                    {c.target}
                    <span className="ml-1.5 font-normal text-slate-400">
                      {Number(c.keep_years) > 0 ? `${c.keep_years}년 보관` : '캐시'}
                    </span>
                  </p>
                  <p className="text-[11px] text-slate-400">{c.note}</p>
                </div>
                <span className={`text-xs font-bold ${cnt > 0 ? 'text-amber-600' : 'text-slate-300'}`}>
                  {cnt > 0 ? `${n(cnt)}건` : '없음'}
                </span>
                <button onClick={() => runCleanup(key, c.target, cnt)}
                  disabled={!cnt || busy === key}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-600 disabled:opacity-30 whitespace-nowrap">
                  {busy === key ? '정리 중…' : '정리'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
