// 수주대장 → 자재 요청 창 (v4.103.0) — 체크한 줄을 그대로 자재 요청으로
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toastError, toastSuccess } from '../../lib/toast'
import { mrDraftOf, mrHeadOf, fetchPrevMr, createMrFromOrder } from '../../lib/orderMr'

const fmt = (n) => (Number(n) || 0).toLocaleString('ko-KR')
const btn = (on) => `flex-1 px-2 py-2 text-xs font-bold rounded-lg border whitespace-nowrap ${on ? 'border-violet-500 bg-violet-600 text-white' : 'border-slate-200 bg-white text-slate-500'}`

export default function OrderMrModal({ lines, meName, onClose, onDone }) {
  const qc = useQueryClient()
  const [head, setHead] = useState(() => mrHeadOf(lines, meName))
  const [rows, setRows] = useState(() => mrDraftOf(lines))
  const [prev, setPrev] = useState(new Map())
  const [busy, setBusy] = useState(false)
  useEffect(() => { let on = true; fetchPrevMr(rows.map((r) => r.tag)).then((m) => on && setPrev(m)); return () => { on = false } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setHead((h) => ({ ...h, [k]: v }))
  const dup = rows.filter((r) => prev.has(r.tag))
  async function submit() {
    setBusy(true)
    try {
      const n = await createMrFromOrder(head, rows)
      toastSuccess(`${fmt(n)}품목 자재 요청 등록 — ${head.check_dept}에 전달됩니다`)
      ;['materialRequests', 'todoList', 'ctReqPending', 'menuAlerts', 'requestNotice'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      onDone?.()
    } catch (e) { toastError('자재 요청 실패: ' + (e.message || e)) } finally { setBusy(false) }
  }
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-slate-900/40 flex items-start justify-center p-3 md:p-8 overflow-y-auto whitespace-normal" onClick={onClose} data-mr-modal>
      <div className="w-full max-w-[760px] bg-white rounded-2xl shadow-xl overflow-x-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="text-[11px] text-slate-400">수주대장</div>
          <h2 className="text-lg font-extrabold text-slate-800">📦 자재 요청</h2>
          <p className="text-xs text-slate-400 mt-0.5">체크한 품목을 그대로 자재 요청으로 보냅니다. 수량은 남은 수량(수량 − 납품)으로 채워 두었습니다. 등록하면 「자재 요청」 목록에 바로 올라갑니다.</p>
        </div>
        <div className="p-5 space-y-4 bg-[#f9fafc]">
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="block"><span className="block text-[11px] font-bold text-slate-500 mb-1">요청자 <b className="text-rose-500">*</b></span>
              <input value={head.requester_name} onChange={(e) => set('requester_name', e.target.value)} data-mr-requester className="w-full h-10 px-3 text-sm border border-slate-200 rounded-lg bg-white" /></label>
            <div><span className="block text-[11px] font-bold text-slate-500 mb-1">확인부서 <b className="text-rose-500">*</b></span>
              <div className="flex gap-1">{['구매자재팀', '하네스팀'].map((d) => <button key={d} type="button" onClick={() => setHead((h) => ({ ...h, check_dept: d, req_kind: d === '하네스팀' ? h.req_kind : '' }))} className={btn(head.check_dept === d)} data-mr-dept={d}>{d}</button>)}</div>
              {head.check_dept === '하네스팀' && <div className="flex gap-1 mt-1">{[['제작', '만들어 주세요'], ['자재', '자재만 주세요']].map(([k, t]) => <button key={k} type="button" title={t} onClick={() => set('req_kind', k)} className={btn(head.req_kind === k)} data-mr-kind={k}>{k}</button>)}</div>}
            </div>
            <div><span className="block text-[11px] font-bold text-slate-500 mb-1">긴급도</span>
              <div className="flex gap-1">{['보통', '긴급'].map((u) => <button key={u} type="button" onClick={() => set('urgency', u)} className={btn(head.urgency === u)} data-mr-urg={u}>{u}</button>)}</div></div>
          </div>
          <div className="grid sm:grid-cols-[minmax(0,1fr)_170px] gap-3">
            <label className="block"><span className="block text-[11px] font-bold text-slate-500 mb-1">사용 목적 <b className="text-rose-500">*</b></span>
              <input value={head.purpose} onChange={(e) => set('purpose', e.target.value)} data-mr-purpose className="w-full h-10 px-3 text-sm border border-slate-200 rounded-lg bg-white" /></label>
            <label className="block"><span className="block text-[11px] font-bold text-slate-500 mb-1">필요일</span>
              <input type="date" value={head.need_date} onChange={(e) => set('need_date', e.target.value)} data-mr-need className="w-full h-10 px-3 text-sm border border-slate-200 rounded-lg bg-white" />
              <span className="block text-[10.5px] text-slate-400 mt-0.5">가장 빠른 납기로 채움</span></label>
          </div>
          {dup.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-mr-dup>
              ⚠ 이미 자재 요청한 줄이 {dup.length}개 있습니다 — {dup.slice(0, 3).map((r) => `${r.std_code || r.item_name} (${prev.get(r.tag).req_no} · ${prev.get(r.tag).status})`).join(' · ')}{dup.length > 3 ? ' …' : ''}. 다시 요청하려면 그대로 등록하고, 아니면 ✕ 로 빼세요.
            </div>
          )}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[#f7f8fb] text-slate-500 border-b-2 border-slate-200"><tr className="text-left">
                <th className="px-3 py-2">품번 · 품명</th><th className="px-3 py-2">PO · 납기</th><th className="px-3 py-2 text-right w-24">요청 수량</th><th className="w-8" />
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-slate-100" data-mr-row={r.tag}>
                    <td className="px-3 py-2 min-w-0"><div className="font-mono text-[#5b6ee8] truncate">{r.std_code || '—'}</div><div className="text-[11.5px] text-slate-400 truncate max-w-[300px]">{r.item_name || '—'}</div>
                      {!r.item_id && <div className="text-[10.5px] text-amber-700">코드 미등록 — 구매자재가 코드를 붙여 처리</div>}
                      {prev.has(r.tag) && <div className="text-[10.5px] font-bold text-amber-700" data-mr-prev>이미 요청 {prev.get(r.tag).req_no} · {prev.get(r.tag).status}</div>}</td>
                    <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">{r.po}<div className="text-[11px] text-slate-400">{r.due || '납기 없음'}</div></td>
                    <td className="px-3 py-2 text-right"><input type="number" min="0" value={r.qty} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, qty: e.target.value } : x)))} data-mr-qty className="w-20 h-8 px-2 text-right font-bold border border-slate-200 rounded-lg" /></td>
                    <td className="pr-2 text-center"><button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="text-slate-300 hover:text-rose-500" title="빼기" data-mr-del>✕</button></td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={4} className="p-6 text-center text-slate-400">요청할 품목이 없습니다</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
          <span className="mr-auto text-[11px] text-slate-400">{rows.length}품목 · 단위 EA</span>
          <button type="button" onClick={onClose} className="h-[38px] px-4 rounded-[9px] text-[13px] font-bold border border-slate-200 bg-white text-slate-600">취소</button>
          <button type="button" disabled={busy || !rows.length} onClick={submit} data-mr-submit className="h-[38px] px-4 rounded-[9px] text-[13px] font-bold bg-[#6c5ce7] text-white disabled:opacity-40">{busy ? '등록 중…' : `📦 ${rows.length}품목 자재 요청`}</button>
        </div>
      </div>
    </div>, document.body)
}
