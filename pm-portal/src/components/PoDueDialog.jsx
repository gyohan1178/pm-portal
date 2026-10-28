// 📅 납기 바꾸기 (v4.98.0) — 「협력사가 납기를 바꿈」과 「우리 필요일이 바뀜」을 나눠 남긴다
//   협력사 변경 → 변경 납기(vendor_date) · 요청 납기는 그대로 → 받을 날이 변경 납기가 되어 그날까지 지연에서 빠짐 (v4.108.0)
//   우리 필요일 변경 → 요청 납기(promise_date)를 고침 → 지연에서 빠짐. 두 경우 모두 사유 · 이력 필수
import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { refreshProcurement } from '../lib/refresh'
import { toastError, toastSuccess } from '../lib/toast'

const VENDOR_WHY = ['제조사 백오더', '협력사 생산 지연', '자재 수급 지연', '운송 · 통관 지연', '협력사가 날짜 당김']
const NEED_WHY = ['고객사 일정 연기', '고객사 일정 당김', '생산 계획 변경', '수량 · 사양 변경']
const missingFn = (e) => e && (e.code === 'PGRST202' || e.code === '42883' || /function .* does not exist|Could not find the function/i.test(e.message || ''))
export const DUE_SQL_HINT = '「납기변경_반영_261025.sql」 을 먼저 실행해야 합니다'

export default function PoDueDialog({ pos = [], onClose, onDone }) {
  const qc = useQueryClient()
  const one = pos.length === 1 ? pos[0] : null
  const [kind, setKind] = useState('vendor')     // vendor | need
  const [date, setDate] = useState(one?.vendor_date || '')
  const [clear, setClear] = useState(false)
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  useEffect(() => {
    if (!one) return
    supabase.from('pm_po_date_log').select('*').eq('po_id', one.id).order('at', { ascending: false }).limit(20)
      .then(({ data }) => setLog(data || []))
  }, [one?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (busy) return
    if (!why.trim()) { toastError('사유를 넣으세요'); return }
    if (!clear && !date) { toastError('날짜를 고르세요'); return }
    setBusy(true)
    try {
      const fn = kind === 'vendor' ? 'pm_po_set_vendor_date' : 'pm_po_set_need_date'
      const { data, error } = await supabase.rpc(fn, { p_ids: pos.map((p) => p.id), p_date: kind === 'vendor' && clear ? null : date, p_reason: why.trim() })
      if (error) throw missingFn(error) ? new Error(DUE_SQL_HINT) : error
      refreshProcurement(qc)
      qc.invalidateQueries({ queryKey: ['purchase'], exact: false })
      toastSuccess(`${Number(data) || 0}건 ${kind === 'vendor' ? (clear ? '변경 납기 지움' : '변경 납기 저장') : '요청 납기 변경'}`)
      onDone?.(); onClose?.()
    } catch (e) { toastError(e.message || String(e)) } finally { setBusy(false) }
  }

  const btn = (k, t, sub) => (
    <button type="button" onClick={() => setKind(k)} data-due-kind={k}
      className={`flex-1 text-left px-3 py-2 rounded-xl border-2 ${kind === k ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white'}`}>
      <div className="text-[13px] font-extrabold text-slate-800">{t}</div>
      <div className="text-[11px] text-slate-500 leading-snug">{sub}</div>
    </button>
  )
  return (
    <div className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center p-4" onClick={onClose} data-due-dialog>
      <div className="bg-white rounded-2xl w-full max-w-[480px] max-h-[92vh] overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-extrabold text-slate-800">📅 납기 바꾸기 <span className="text-[12px] font-bold text-slate-400">{pos.length}건</span></h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>
        {one && <p className="text-[12px] text-slate-500 -mt-1">{one.items?.std_code} · {one.vendors?.name || '구매처 미정'} · 요청 납기 <b className="font-mono">{one.promise_date || '-'}</b>{one.vendor_date && <> · 변경 납기 <b className="font-mono text-amber-700">{one.vendor_date}</b></>}</p>}
        <div className="flex gap-2">
          {btn('vendor', '협력사가 납기를 바꿈', '요청 납기는 그대로 두고 「변경 납기」로 남김 → 그날까지 지연에서 빠지고, 그날도 지나면 다시 지연')}
          {btn('need', '우리 필요일이 바뀜', '요청 납기 자체를 고침 → 지연에서 빠짐 (고객사 일정 변경 등)')}
        </div>
        <div className="flex items-end gap-3">
          <label className="flex-1">
            <span className="block text-[12px] font-bold text-slate-600 mb-1">{kind === 'vendor' ? '협력사가 다시 약속한 날' : '새 요청 납기'}</span>
            <input type="date" value={date} disabled={clear} onChange={(e) => setDate(e.target.value)} data-due-date
              className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg disabled:bg-slate-50" />
          </label>
          {kind === 'vendor' && pos.some((p) => p.vendor_date) && (
            <label className="flex items-center gap-1.5 text-[12px] text-slate-600 pb-2"><input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} /> 변경 납기 지우기</label>
          )}
        </div>
        <div>
          <span className="block text-[12px] font-bold text-slate-600 mb-1">사유 <span className="text-red-500">*</span></span>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {(kind === 'vendor' ? VENDOR_WHY : NEED_WHY).map((w) => (
              <button key={w} type="button" onClick={() => setWhy(w)} className={`px-2 py-0.5 rounded-full border text-[11.5px] font-bold ${why === w ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-500'}`}>{w}</button>
            ))}
          </div>
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="직접 적기" data-due-why className="w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg" />
        </div>
        {one && log.length > 0 && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11.5px] text-slate-600" data-due-log>
            <div className="font-bold text-slate-500 mb-0.5">변경 이력</div>
            {log.map((l) => <div key={l.id}>{String(l.at).slice(0, 10)} · {l.kind} · {l.old_date || '없음'} → {l.new_date || '지움'} · {l.reason}{l.by_name ? ` · ${l.by_name}` : ''}</div>)}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-100 text-slate-600">닫기</button>
          <button type="button" onClick={save} disabled={busy} data-due-save className="px-4 py-2 text-xs font-bold rounded-lg bg-[#6c5ce7] text-white disabled:opacity-50">저장</button>
        </div>
      </div>
    </div>
  )
}
