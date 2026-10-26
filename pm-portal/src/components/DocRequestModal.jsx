// 📎 자료 요청 쓰기 (v4.98.0) — 어느 화면에서 열어도 같은 창. preset 으로 품번 · 고객사 · Rev · 관련 PO 를 미리 채운다
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useMyProfile, canEdit } from '../hooks/useProfile'
import { toastError, toastSuccess } from '../lib/toast'
import { todayISO } from '../lib/utils'
import { DOC_KINDS, KIND_SHOW, DOC_DEPTS, DOC_CUSTOMERS, custName, guessCustomer, lookupItem, findOpenSame, createDocRequest } from '../lib/docRequest'

const addDays = (n) => { const d = new Date(todayISO()); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const inp = 'w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-300'

export function DocRequestButton({ preset, label = '📎 영업에 자료 요청', className = '', small = false }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-doc-req-open
        className={className || `${small ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1.5 text-xs'} font-bold rounded-lg border border-[#f3d9b1] bg-[#fff7ec] text-[#8a5a00] hover:bg-[#ffefd6] whitespace-nowrap`}>{label}</button>
      {/* 창은 body 바로 아래에 — 버튼이 「줄바꿈 안 함」 영역(화면 머리 버튼 줄 등) 안에 있어도 글자가 창 밖으로 안 나가게 (v4.102.0) */}
      {open && createPortal(<DocRequestModal preset={preset} onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

export default function DocRequestModal({ preset = {}, onClose }) {
  const qc = useQueryClient()
  const { data: profile } = useMyProfile()
  const myDept = DOC_DEPTS.includes(profile?.dept) && profile?.dept !== '영업' ? profile.dept : ''
  const [f, setF] = useState(() => ({
    kind: preset.kind || '도면', kind_label: preset.kind_label || '', part_no: preset.part_no || '', item_id: preset.item_id || null, item_name: preset.item_name || '',
    customer_code: preset.customer_code || guessCustomer(preset.part_no) || '', rev: preset.rev || '', need_date: preset.need_date || addDays(7),
    reason: preset.reason || '', ref: preset.ref || '', source: preset.source || 'direct', from_dept: myDept,
  }))
  const [same, setSame] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e?.target ? e.target.value : e }))

  // 품번이 바뀌면 품목 · 고객사를 찾아 채운다
  async function lookup() {
    const code = f.part_no.trim()
    if (!code) return
    const it = await lookupItem(code)
    setF((p) => ({ ...p, part_no: it?.std_code || code.toUpperCase(), item_id: it?.id || null, item_name: it?.name || p.item_name, customer_code: p.customer_code || guessCustomer(it?.std_code || code) }))
  }
  useEffect(() => { if (preset.part_no && !preset.item_id) lookup() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // 같은 자료가 진행 중인지
  useEffect(() => {
    let alive = true
    const etc = f.kind === '기타'
    if ((!f.part_no && !etc) || (etc && !f.kind_label.trim()) || !f.customer_code) { setSame(null); return undefined }
    const t = setTimeout(() => findOpenSame(f).then((r) => { if (alive) setSame(r) }), etc ? 400 : 0)   // 직접 입력은 글자 칠 때마다 찾지 않게
    return () => { alive = false; clearTimeout(t) }
  }, [f.part_no, f.kind, f.customer_code, f.kind_label])

  const already = same && (same.from_dept === f.from_dept || (same.also_depts || []).includes(f.from_dept))
  async function submit() {
    if (busy) return
    setBusy(true)
    try {
      const r = await createDocRequest(f, profile)
      qc.invalidateQueries({ queryKey: ['docRequests'], exact: false })
      toastSuccess(r.already ? '이미 요청한 자료입니다' : r.followed ? '같은 자료를 이미 요청한 부서가 있어 「같이 기다리기」로 붙었습니다' : `영업(${custName(f.customer_code)} 담당)에게 요청했습니다`)
      onClose?.()
    } catch (e) { toastError(e.message || String(e)) } finally { setBusy(false) }
  }

  const editable = canEdit(profile)
  return (
    <div className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center p-4 whitespace-normal" onClick={onClose} data-doc-req-modal>
      <div className="bg-white rounded-2xl w-full max-w-[460px] max-h-[92vh] overflow-y-auto overflow-x-hidden p-5 space-y-3" onClick={(e) => e.stopPropagation()} data-doc-req-box>
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-extrabold text-slate-800">📎 영업에 자료 요청</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>
        <p className="text-[12px] text-slate-500 -mt-1">영업이 고객사에 받아서 올리면 요청한 부서로 「받은 자료」 알림이 갑니다.</p>

        <div>
          <label className="block text-[12px] font-bold text-slate-600 mb-1">무엇이 필요한가요</label>
          <div className="inline-flex flex-wrap max-w-full gap-1 p-1 rounded-lg bg-slate-100">
            {DOC_KINDS.map((k) => <button key={k} type="button" onClick={() => set('kind')(k)} data-doc-kind={k}
              className={`px-3 py-1 rounded-md text-[12.5px] font-bold ${f.kind === k ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}>{KIND_SHOW[k] || k}</button>)}
          </div>
          {f.kind === '기타' && (
            <div className="mt-1.5 min-w-0" data-doc-label-box>
              <input value={f.kind_label} onChange={set('kind_label')} autoFocus placeholder="어떤 자료인가요 — 예: CN 내역 · 성적서 · 인증서" className={`${inp} block`} data-doc-label />
              <p className="text-[10.5px] text-slate-400 mt-1">적은 이름이 목록 · 고객사 요청 메일에 그대로 나갑니다. 품번이 없는 자료면 품번은 비워도 됩니다.</p>
            </div>
          )}
        </div>
        <div>
          <label className="block text-[12px] font-bold text-slate-600 mb-1">품번 {f.kind === '기타' ? <span className="font-normal text-slate-400">(있으면)</span> : <span className="text-red-500">*</span>}</label>
          <input value={f.part_no} onChange={set('part_no')} onBlur={lookup} placeholder={f.kind === '기타' ? '관련 품번 · 없으면 비움' : 'AX-110219638 · 숫자만 넣으면 AX- 자동'} className={inp} data-doc-pn />
          {f.item_name && <p className="text-[11px] text-slate-500 mt-1">{f.item_name}</p>}
        </div>
        <div>
          <label className="block text-[12px] font-bold text-slate-600 mb-1">어느 고객사 자료인가요 <span className="text-red-500">*</span></label>
          <div className="flex flex-wrap gap-1">
            {DOC_CUSTOMERS.map((c) => <button key={c.code} type="button" onClick={() => set('customer_code')(c.code)} data-doc-cust={c.code}
              className={`px-2.5 py-1 rounded-lg border text-[12px] font-bold ${f.customer_code === c.code ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-500'}`}>{c.name}</button>)}
          </div>
          <p className="text-[10.5px] text-slate-400 mt-1">품번으로 자동 선택 · 여러 고객사가 쓰는 품번은 직접 고름 → 받는 사람은 그 고객사 담당 영업</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {f.kind === '도면' && <div>
            <label className="block text-[12px] font-bold text-slate-600 mb-1">필요한 Rev</label>
            <input value={f.rev} onChange={set('rev')} placeholder="예: C" className={inp} data-doc-rev />
          </div>}
          <div>
            <label className="block text-[12px] font-bold text-slate-600 mb-1">필요일 <span className="text-red-500">*</span></label>
            <input type="date" value={f.need_date} onChange={set('need_date')} className={inp} data-doc-need />
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-bold text-slate-600 mb-1">관련 PO · 호기</label>
          <input value={f.ref} onChange={set('ref')} placeholder="예: PO 4500123 · 133EA" className={inp} />
        </div>
        <div>
          <label className="block text-[12px] font-bold text-slate-600 mb-1">왜 필요한가요 <span className="font-normal text-slate-400">— 영업 화면 목록에 그대로 보입니다</span></label>
          <textarea value={f.reason} onChange={set('reason')} rows={2} placeholder="예: 판금물 견적 · 초도품 확인 · 설계변경 이력 확인" className={inp} data-doc-reason />
        </div>
        {!myDept && (
          <div>
            <label className="block text-[12px] font-bold text-slate-600 mb-1">요청 부서 <span className="text-red-500">*</span></label>
            <select value={f.from_dept} onChange={set('from_dept')} className={inp} data-doc-dept>
              <option value="">고르세요</option>
              {DOC_DEPTS.filter((d) => d !== '영업').map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
        )}
        {same && !already && <div className="px-3 py-2 rounded-lg bg-amber-50 text-[12px] text-amber-800 leading-relaxed" data-doc-same>
          ⚠ 같은 자료를 <b>{same.from_dept}</b>{same.requester_name ? ` (${same.requester_name})` : ''}가 {String(same.created_at || '').slice(5, 10)} 이미 요청했습니다 → 새로 만들지 않고 <b>「같이 기다리기」</b>로 붙습니다.
        </div>}
        {already && <div className="px-3 py-2 rounded-lg bg-slate-100 text-[12px] text-slate-600">이미 우리 부서가 요청한 자료입니다.</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-100 text-slate-600">닫기</button>
          <button type="button" onClick={submit} disabled={busy || !editable || already} data-doc-submit
            className="px-4 py-2 text-xs font-bold rounded-lg bg-[#6c5ce7] text-white disabled:opacity-50">{!editable ? '요청 권한 없음' : same && !already ? '같이 기다리기' : '영업에 요청'}</button>
        </div>
      </div>
    </div>
  )
}
