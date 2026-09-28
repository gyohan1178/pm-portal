import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/paginate'
import { toastError, toastSuccess } from '../lib/toast'
import { useCanEdit } from '../hooks/useProfile'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')
const sign = (v) => (v > 0 ? `+${n(v)}` : v < 0 ? `−${n(-v)}` : '0')

// 칸 실사 반영 — QR 로 칸을 찍어 기록한 실사를 재고에 반영한다.
//   반영은 「차이만큼」: 차이 = 실사 수량 − 실사 당시 장부.
//   실사와 반영 사이에 입출고가 있어도 그 움직임은 그대로 남는다 (DB 함수 pm_audit_apply).
export async function fetchPendingAudits() {
  const rows = await fetchAll(() => supabase.from('pm_stock_audit')
    .select('id,audit_date,location,item_id,std_code,book_qty,counted_qty,memo,counted_by,created_at')
    .eq('applied', false)
    .order('audit_date', { ascending: false }).order('id'))
  const ids = [...new Set(rows.map(r => r.item_id).filter(Boolean))]
  const items = {}, stock = {}
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200)
    const { data: its, error: e1 } = await supabase.from('items').select('id,std_code,name,manufacturer,manufacturer_code,unit').in('id', part)
    if (e1) throw e1
    ;(its || []).forEach(x => { items[x.id] = x })
    const { data: inv, error: e2 } = await supabase.from('inventory').select('item_id,qty').in('item_id', part)
    if (e2) throw e2
    ;(inv || []).forEach(x => { stock[x.item_id] = Number(x.qty) || 0 })
  }
  const uids = [...new Set(rows.map(r => r.counted_by).filter(Boolean))]
  const who = {}
  if (uids.length) {
    const { data, error } = await supabase.rpc('pm_user_names', { p_ids: uids })
    if (error && error.code !== 'PGRST202') throw error
    ;(data || []).forEach(u => { who[u.id] = u.name })
  }
  return rows.map(r => {
    const diff = (Number(r.counted_qty) || 0) - (Number(r.book_qty) || 0)
    const now = stock[r.item_id] ?? 0
    return { ...r, item: items[r.item_id] || null, diff, now, after: now + diff,
             moved: now !== (Number(r.book_qty) || 0), who: who[r.counted_by] || '' }
  })
}

export default function AuditApplyModal({ onClose }) {
  const qc = useQueryClient()
  const canEdit = useCanEdit()
  const { data: rows = [], isLoading, refetch } = useQuery({ queryKey: ['pendingAudits'], queryFn: fetchPendingAudits })
  const [onlyDiff, setOnlyDiff] = useState(true)
  const [sel, setSel] = useState(null)   // null = 차이 있는 것 전부 (처음)
  const [busy, setBusy] = useState(false)

  const shown = useMemo(() => (onlyDiff ? rows.filter(r => r.diff !== 0) : rows), [rows, onlyDiff])
  const picked = sel ?? new Set(rows.filter(r => r.diff !== 0).map(r => r.id))
  const toggle = (id) => setSel(() => { const s = new Set(picked); s.has(id) ? s.delete(id) : s.add(id); return s })
  const same = rows.filter(r => r.diff === 0)

  async function apply(ids, label) {
    if (!ids.length) return
    if (!canEdit) { toastError('열람 전용 계정입니다 — 수정 권한이 없습니다'); return }
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('pm_audit_apply', { p_ids: ids })
      if (error) throw error
      const r = Array.isArray(data) ? data[0] : data
      toastSuccess(`${label} ${n(r?.done_cnt)}건 — 재고 줄임 ${n(r?.out_cnt)} · 늘림 ${n(r?.in_cnt)}`)
      setSel(null)
      qc.invalidateQueries({ queryKey: ['inventory'], exact: false })
      qc.invalidateQueries({ queryKey: ['pendingAuditCount'] })
      qc.invalidateQueries({ queryKey: ['cellItems'], exact: false })
      qc.invalidateQueries({ queryKey: ['cellAuditToday'], exact: false })
      refetch()
    } catch (e) { toastError('반영 실패: ' + e.message) }
    finally { setBusy(false) }
  }

  const pickedDiff = [...picked].filter(id => shown.some(r => r.id === id))

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-auto" onClick={onClose}>
      <div className="bg-white w-full max-w-5xl rounded-2xl my-6" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-4 pb-3 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">📋 칸 실사 반영</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              QR 로 칸을 찍어 기록한 실사 중 아직 재고에 반영 안 된 것입니다. 반영은 <b>차이만큼</b> —
              실사한 뒤 그 품목이 입출고됐어도 그 움직임은 그대로 둡니다.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-500 text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-2 flex flex-wrap items-center gap-3 text-xs">
          <label className="inline-flex items-center gap-1.5 text-slate-600">
            <input type="checkbox" checked={onlyDiff} onChange={e => setOnlyDiff(e.target.checked)} /> 차이 있는 것만
          </label>
          <span className="text-slate-400">대기 {n(rows.length)}건 · 차이 {n(rows.length - same.length)}건</span>
          {same.length > 0 && (
            <button onClick={() => apply(same.map(r => r.id), '차이 없음 정리')} disabled={busy}
              className="ml-auto px-3 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40">
              차이 없는 {n(same.length)}건 반영됨으로 정리
            </button>
          )}
        </div>

        <div className="px-5 pb-2 max-h-[60vh] overflow-auto">
          {isLoading ? <p className="py-10 text-center text-sm text-slate-400">불러오는 중…</p>
           : shown.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">반영할 실사가 없습니다</p>
           : (
            <table className="w-full text-xs whitespace-nowrap">
              <thead><tr className="bg-slate-50 text-slate-400 border-b border-slate-200">
                {['', '실사일·위치', '품목', '실사 당시 장부', '실사', '차이', '지금 재고', '반영 후', '사유', '실사자'].map((h, i) =>
                  <th key={i} className={`px-2 py-2 font-bold ${i >= 3 && i <= 7 ? 'text-right' : 'text-left'}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id} onClick={() => toggle(r.id)}
                    className={`border-b border-slate-100 cursor-pointer ${picked.has(r.id) ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`}>
                    <td className="px-2 py-1.5"><input type="checkbox" readOnly checked={picked.has(r.id)} /></td>
                    <td className="px-2 py-1.5 text-slate-500">{r.audit_date} · <span className="font-mono text-slate-700">{r.location}</span></td>
                    <td className="px-2 py-1.5">
                      <div className="font-mono text-indigo-600">{r.item?.std_code || r.std_code}</div>
                      <div className="text-[11px] text-slate-500 max-w-[220px] truncate">{r.item?.name}{r.item?.manufacturer_code ? ` · ${r.item.manufacturer_code}` : ''}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right text-slate-500">{n(r.book_qty)}</td>
                    <td className="px-2 py-1.5 text-right font-bold text-slate-800">{n(r.counted_qty)}</td>
                    <td className={`px-2 py-1.5 text-right font-bold ${r.diff > 0 ? 'text-sky-600' : r.diff < 0 ? 'text-rose-600' : 'text-slate-400'}`}>{sign(r.diff)}</td>
                    <td className="px-2 py-1.5 text-right text-slate-500" title={r.moved ? '실사한 뒤 입출고가 있었습니다 — 그 움직임은 그대로 둡니다' : ''}>
                      {n(r.now)}{r.moved && <span className="ml-1 text-[10px] text-amber-600">움직임</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right font-bold text-indigo-700">{n(r.after)}</td>
                    <td className="px-2 py-1.5 text-slate-500 max-w-[160px] truncate" title={r.memo || ''}>{r.memo || '-'}</td>
                    <td className="px-2 py-1.5 text-slate-500">{r.who || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">닫기</button>
          <button onClick={() => apply(pickedDiff, '재고 반영')} disabled={busy || !pickedDiff.length}
            className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
            {busy ? '반영 중…' : `고른 ${n(pickedDiff.length)}건 재고에 반영`}
          </button>
        </div>
      </div>
    </div>
  )
}
