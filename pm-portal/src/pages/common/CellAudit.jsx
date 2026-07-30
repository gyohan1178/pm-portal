import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../../lib/toast'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')

// QR 을 스캔하면 열리는 화면. 폰에서 쓰므로 글자와 입력창을 크게 둔다.
//
//   1. 칸에 있는 품목과 장부 수량이 보인다
//   2. 실제 센 수량을 입력한다
//   3. 저장하면 차이가 기록되고, 반영은 따로 확인 후 한다
export default function CellAudit() {
  const { loc } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [counts, setCounts] = useState({})
  const [memos, setMemos] = useState({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const location = (loc || '').toUpperCase()

  const { data: items = [], isLoading, error } = useQuery({
    queryKey: ['cellItems', location],
    enabled: !!location,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_cell_items', { p_loc: location })
      if (error) throw error
      return data || []
    },
  })

  // 오늘 이 칸을 이미 실사했는지
  const { data: prev = [] } = useQuery({
    queryKey: ['cellAuditToday', location],
    enabled: !!location,
    queryFn: async () => {
      const { data } = await supabase.from('pm_stock_audit')
        .select('item_id,counted_qty,diff,applied,memo')
        .eq('location', location)
        .eq('audit_date', new Date().toISOString().slice(0, 10))
      return data || []
    },
  })

  // 이미 실사한 값이 있으면 채워둔다
  useEffect(() => {
    if (!prev.length) return
    const c = {}, m = {}
    prev.forEach(p => { c[p.item_id] = String(p.counted_qty); if (p.memo) m[p.item_id] = p.memo })
    setCounts(c); setMemos(m); setSaved(true)
  }, [prev])

  const diffOf = (it) => {
    const v = counts[it.item_id]
    if (v === undefined || v === '') return null
    return Number(v) - (Number(it.qty) || 0)
  }
  const filled = items.filter(it => counts[it.item_id] !== undefined && counts[it.item_id] !== '').length
  const diffCnt = items.filter(it => { const d = diffOf(it); return d !== null && d !== 0 }).length

  async function save() {
    const rows = items
      .filter(it => counts[it.item_id] !== undefined && counts[it.item_id] !== '')
      .map(it => ({
        item_id: it.item_id, std_code: it.std_code,
        book_qty: Number(it.qty) || 0,
        counted_qty: Number(counts[it.item_id]),
        memo: memos[it.item_id] || null,
      }))
    if (!rows.length) { toastError('입력한 수량이 없습니다'); return }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('pm_audit_save', { p_loc: location, p_rows: rows })
      if (error) throw error
      setSaved(true)
      qc.invalidateQueries({ queryKey: ['cellAuditToday'] })
      toastSuccess(`${n(data)}건 실사 기록 — 재고 반영은 재고현황에서 확인 후 진행하세요`)
    } catch (e) {
      toastError('저장 실패: ' + e.message)
    } finally { setBusy(false) }
  }

  // 전부 장부와 같다고 표시 (차이 없을 때 빠르게)
  const fillAllSame = () => {
    const c = { ...counts }
    items.forEach(it => { c[it.item_id] = String(Number(it.qty) || 0) })
    setCounts(c)
  }

  return (
    <div className="max-w-lg mx-auto space-y-4 pb-24">
      {/* 위치 */}
      <div className="rounded-2xl bg-slate-900 text-white p-5">
        <p className="text-xs text-slate-400">재고 실사 · 위치</p>
        <p className="text-4xl font-bold font-mono tracking-tight mt-1">{location}</p>
        <p className="text-xs text-slate-400 mt-1">
          {location.split('-')[0]} 랙 · {Number(location.split('-')[1])}칸 · {location.split('-')[2]}층
        </p>
      </div>

      {isLoading && <p className="text-center py-10 text-slate-400 text-sm">불러오는 중…</p>}
      {error && <p className="text-center py-10 text-rose-500 text-sm">위치를 찾을 수 없습니다: {location}</p>}

      {!isLoading && !items.length && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm text-slate-400">이 칸에 등록된 재고가 없습니다.</p>
          <button onClick={() => nav('/inventory')}
            className="mt-3 px-4 py-2 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
            재고현황에서 위치 지정하기
          </button>
        </div>
      )}

      {!!items.length && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{items.length}품목 · 입력 {filled}</span>
            {diffCnt > 0 && <span className="text-xs font-bold text-amber-600">차이 {diffCnt}건</span>}
            {saved && <span className="text-xs font-bold text-emerald-600">저장됨</span>}
            <button onClick={fillAllSame}
              className="ml-auto text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
              전부 장부와 같음
            </button>
          </div>

          <div className="space-y-2">
            {items.map(it => {
              const d = diffOf(it)
              return (
                <div key={it.item_id} className={`rounded-xl border bg-white p-3 ${d !== null && d !== 0
                  ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
                  <p className="font-mono text-sm font-bold text-indigo-600">{it.std_code}</p>
                  <p className="text-xs text-slate-600 mt-0.5">{it.name}</p>
                  {(it.manufacturer || it.manufacturer_code) && (
                    <p className="text-[11px] text-slate-400">
                      {it.manufacturer}{it.manufacturer && it.manufacturer_code ? ' · ' : ''}
                      <span className="font-mono">{it.manufacturer_code}</span>
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <div className="text-center">
                      <p className="text-[10px] text-slate-400">장부</p>
                      <p className="text-lg font-bold text-slate-700">{n(it.qty)}</p>
                    </div>
                    <div className="flex-1">
                      <p className="text-[10px] text-slate-400 mb-0.5">실사 수량</p>
                      <input type="number" inputMode="decimal"
                        value={counts[it.item_id] ?? ''}
                        onChange={e => setCounts(p => ({ ...p, [it.item_id]: e.target.value }))}
                        placeholder="세어본 수량"
                        className="w-full px-3 py-2.5 text-lg font-bold text-right border-2 border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500" />
                    </div>
                    {d !== null && (
                      <div className="text-center min-w-[52px]">
                        <p className="text-[10px] text-slate-400">차이</p>
                        <p className={`text-lg font-bold ${d === 0 ? 'text-emerald-600' : d > 0 ? 'text-sky-600' : 'text-rose-600'}`}>
                          {d === 0 ? '—' : d > 0 ? `+${n(d)}` : n(d)}
                        </p>
                      </div>
                    )}
                  </div>
                  {d !== null && d !== 0 && (
                    <input value={memos[it.item_id] || ''}
                      onChange={e => setMemos(p => ({ ...p, [it.item_id]: e.target.value }))}
                      placeholder="차이 사유 (선택)"
                      className="w-full mt-2 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />
                  )}
                  <span className="text-[10px] text-slate-400">{it.unit}</span>
                </div>
              )
            })}
          </div>

          {/* 저장 — 화면 아래 고정 */}
          <div className="fixed bottom-0 left-0 right-0 p-3 bg-white border-t border-slate-200">
            <div className="max-w-lg mx-auto flex gap-2">
              <button onClick={() => nav(-1)}
                className="px-4 py-3 text-sm font-semibold rounded-xl border border-slate-200 text-slate-600">
                뒤로
              </button>
              <button onClick={save} disabled={busy || !filled}
                className="flex-1 py-3 text-sm font-bold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                {busy ? '저장 중…' : `실사 기록 (${filled}/${items.length})`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
