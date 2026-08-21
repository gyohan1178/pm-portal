import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { toastError, toastSuccess } from '../lib/toast'
import { useCanEdit } from '../hooks/useProfile'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')

// Tailwind 는 문자열을 만들어 쓰면 클래스를 못 찾는다. 전체를 적어 둔다.
const KIND = {
  bom:      { label: 'BOM',      cls: 'bg-indigo-100 text-indigo-700' },
  weekly:   { label: '주간보고',  cls: 'bg-sky-100 text-sky-700' },
  movement: { label: '입고 이력', cls: 'bg-emerald-100 text-emerald-700' },
  rack:     { label: '랙 위치',   cls: 'bg-amber-100 text-amber-700' },
}

// 삭제 기록.
//
//   대량 삭제는 되돌릴 수 없어 사고가 반복됐다.
//   BOM 1,626행, 랙 위치 87건을 잃은 적이 있다.
//
//   이제 지우기 전에 기록을 남기므로 여기서 되돌린다.
//   랙은 구조가 달라 따로 쌓이지만, 화면에서는 함께 보여준다.
export default function SnapshotRestore() {
  const qc = useQueryClient()
  const canEdit = useCanEdit()
  const [days, setDays] = useState(30)
  const [kind, setKind] = useState('')
  const [ask, setAsk] = useState(null)

  const { data: snaps = [], isLoading } = useQuery({
    queryKey: ['snapList', days, kind],
    queryFn: async () => {
      const [a, b] = await Promise.all([
        supabase.rpc('pm_snap_list', { p_days: days, p_kind: kind || null }),
        kind && kind !== 'rack'
          ? Promise.resolve({ data: [] })
          : supabase.rpc('pm_rack_snapshots', { p_days: days }),
      ])
      const rows = [
        ...(a.data || []).map(x => ({ ...x, src: 'snap' })),
        ...(b.data || []).map(x => ({
          id: x.id, kind: 'rack', src: 'rack',
          label: `${x.rack_code}${x.scope === 'cell'
            ? `-${String(x.row_no).padStart(2, '0')}-${x.level_no} 칸` : ' 랙 전체'} 비움`,
          target: x.rack_code, tbl: 'inventory',
          cnt: x.cnt, restored: x.restored,
          created_at: x.created_at, who: x.who, preview: x.preview,
        })),
      ]
      return rows.sort((p, q) => String(q.created_at).localeCompare(String(p.created_at)))
    },
    staleTime: 30 * 1000,
  })

  async function restore(row) {
    try {
      const { data, error } = row.src === 'rack'
        ? await supabase.rpc('pm_rack_restore', { p_snap_id: row.id })
        : await supabase.rpc('pm_snap_restore', { p_id: row.id })
      if (error) throw error
      toastSuccess(data || '복구됨')
      qc.invalidateQueries({ queryKey: ['snapList'], exact: false })
      // 되돌린 내용이 화면에 바로 반영되도록
      ;['bom', 'inventory', 'inboundHistory', 'rackMap', 'rackUsage',
        'weeklyItems', 'shortage'].forEach(k =>
        qc.invalidateQueries({ queryKey: [k], exact: false }))
      setAsk(null)
    } catch (e) { toastError('복구 실패: ' + e.message) }
  }

  const live = snaps.filter(s => !s.restored)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">↩ 삭제 기록</h1>
        <p className="text-xs text-slate-400">
          대량 삭제 전에 남긴 기록입니다. 되돌릴 수 있습니다.
        </p>
      </div>

      {live.length > 0 && (
        <div className="rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-bold text-amber-800">
            되돌릴 수 있는 기록 {live.length}건
          </p>
          <p className="text-xs text-amber-700 mt-0.5">
            실수로 지운 것이 있으면 여기서 복구하세요. 90일이 지나면 정리됩니다.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {[['', '전체'], ...Object.entries(KIND).map(([k, v]) => [k, v.label])].map(([k, l]) => (
            <button key={k} onClick={() => setKind(k)}
              className={`px-3 py-1.5 text-xs font-bold rounded-md ${
                kind === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
              {l}
            </button>
          ))}
        </div>
        <select value={days} onChange={e => setDays(Number(e.target.value))}
          className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg">
          <option value={7}>최근 7일</option>
          <option value={30}>최근 30일</option>
          <option value={90}>최근 90일</option>
        </select>
        <span className="text-xs text-slate-400">{n(snaps.length)}건</span>
      </div>

      {isLoading && <p className="text-center py-10 text-sm text-slate-400">불러오는 중…</p>}
      {!isLoading && !snaps.length && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm text-slate-500 font-semibold">기록이 없습니다</p>
          <p className="text-xs text-slate-400 mt-1">
            대량 삭제를 하면 여기에 남습니다
          </p>
        </div>
      )}

      <div className="space-y-2">
        {snaps.map(s => {
          const k = KIND[s.kind] || { label: s.kind, cls: 'bg-slate-100 text-slate-600' }
          return (
            <div key={`${s.src}-${s.id}`}
              className={`rounded-xl border p-3.5 ${
                s.restored ? 'border-slate-100 bg-slate-50' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${k.cls}`}>
                      {k.label}
                    </span>
                    <span className="text-sm font-semibold text-slate-800">{s.label}</span>
                    <span className="text-xs font-bold text-slate-500">{n(s.cnt)}건</span>
                    {s.restored && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-200 text-[10px] font-bold text-slate-500">
                        복구됨
                      </span>
                    )}
                  </div>
                  {s.preview && (
                    <p className="text-[11px] text-slate-400 mt-1 truncate">{s.preview} …</p>
                  )}
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {String(s.created_at).slice(0, 16).replace('T', ' ')}
                    {s.who ? ` · ${s.who}` : ''}
                  </p>
                </div>
                {!s.restored && canEdit && (
                  <button onClick={() => setAsk(s)}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50">
                    되돌리기
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {ask && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setAsk(null)}>
          <div className="bg-white w-full max-w-sm rounded-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 bg-emerald-50 border-b border-emerald-100">
              <h3 className="text-base font-bold text-emerald-800">되돌리기</h3>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm font-semibold text-slate-800">{ask.label}</p>
              <p className="text-xs text-slate-500">
                <b>{n(ask.cnt)}건</b>을 되돌립니다.
                {ask.src === 'rack'
                  ? ' 위치가 비어 있는 품목만 복구되며, 그 사이 다른 자리가 잡혔으면 건드리지 않습니다.'
                  : ' 이미 같은 내용이 있으면 건너뜁니다.'}
              </p>
              <div className="flex gap-2">
                <button onClick={() => restore(ask)}
                  className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-emerald-600 text-white">
                  되돌리기
                </button>
                <button onClick={() => setAsk(null)}
                  className="flex-1 py-2.5 text-sm font-bold rounded-lg border border-slate-300 text-slate-600">
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
