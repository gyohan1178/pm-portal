// 포털 확인 창 — 브라우저 기본 confirm · prompt 대신 (v4.104.0)
//   const [ask, dialog] = useConfirm()
//   const ok = await ask({ title, desc, items: ['…'], okText: '삭제', danger: true, input: { label, required, placeholder } })
//   → 취소 버튼 false · Esc · 바깥 누름 null (둘 다 「아니오」로 보면 됨) · 입력 칸이 있으면 { value } · 없으면 true
//   알림만 (버튼 하나): ask({ title, items, okText: '확인', cancelText: null })
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export function useConfirm() {
  const [st, setSt] = useState(null)
  const cur = useRef(null)
  // 창이 떠 있는데 또 물으면 앞의 질문은 「취소」로 끝내고 새 창으로 (앞의 기다림이 영영 안 끝나는 일 막기)
  const ask = (opt) => new Promise((resolve) => {
    cur.current?.resolve(false)
    const next = { ...opt, resolve, key: Date.now() + Math.random() }
    cur.current = next
    setSt(next)
  })
  const close = (v) => { st?.resolve(v); if (cur.current === st) cur.current = null; setSt(null) }
  return [ask, st ? <ConfirmDialog key={st.key} {...st} onDone={close} /> : null]
}

function ConfirmDialog({ title, desc, items = [], more = 0, okText = '확인', cancelText = '취소', danger = false, input, onDone }) {
  const [val, setVal] = useState(input?.value || '')
  const [err, setErr] = useState('')
  const ref = useRef(null)
  const boxRef = useRef(null)
  useEffect(() => {
    const t = setTimeout(() => (ref.current || document.querySelector('[data-confirm-ok]'))?.focus(), 30)
    const onKey = (e) => {
      if (e.key === 'Escape') { onDone(null); return }
      // Tab 이 창 밖(뒤 화면 버튼)으로 나가지 않게 — 뒤의 「출고 처리」 등을 Enter 로 눌러 버리는 일 막기
      if (e.key === 'Tab') {
        const box = boxRef.current
        const f = box ? [...box.querySelectorAll('button, textarea, input, select, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.disabled) : []
        if (!f.length) return
        const i = f.indexOf(document.activeElement)
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus() }
        else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const ok = () => {
    if (input) {
      if (input.required && !val.trim()) { setErr(input.requiredMsg || `${input.label}을(를) 적어 주세요`); ref.current?.focus(); return }
      onDone({ value: val.trim() })
    } else onDone(true)
  }
  return createPortal(
    <div className="fixed inset-0 z-[80] bg-slate-900/40 flex items-center justify-center p-4 whitespace-normal" onMouseDown={() => onDone(null)} data-confirm-dialog>
      <div ref={boxRef} className="w-full max-w-[440px] bg-white rounded-2xl shadow-xl p-5" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3 className="text-[15px] font-extrabold text-slate-800">{title}</h3>
        {desc && <p className="text-[12.5px] text-slate-500 mt-1 whitespace-pre-line">{desc}</p>}
        {items.length > 0 && (
          <ul className="mt-3 max-h-48 overflow-y-auto rounded-lg bg-[#f9fafc] border border-slate-100 px-3 py-2 text-[12px] text-slate-600 space-y-0.5" data-confirm-items>
            {items.map((t, i) => <li key={i} className="truncate">{t}</li>)}
            {more > 0 && <li className="text-slate-400">… 외 {more.toLocaleString('ko-KR')}건</li>}
          </ul>
        )}
        {input && (
          <div className="mt-3">
            <label className="block text-[12px] font-bold text-slate-600 mb-1">{input.label} {input.required && <span className="text-rose-500">*</span>}</label>
            <textarea ref={ref} rows={input.rows || 2} value={val} onChange={(e) => { setVal(e.target.value); setErr('') }} placeholder={input.placeholder || ''}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ok() }}
              className={`w-full px-3 py-2 text-[13px] border rounded-lg focus:outline-none ${err ? 'border-rose-400 bg-rose-50/40' : 'border-slate-200 focus:border-violet-500'}`} data-confirm-input />
            {err && <p className="text-[11px] font-bold text-rose-600 mt-1" data-field-error>{err}</p>}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          {cancelText !== null && <button type="button" onClick={() => onDone(false)} className="h-[38px] px-4 rounded-[9px] text-[13px] font-bold border border-slate-200 bg-white text-slate-600" data-confirm-cancel>{cancelText}</button>}
          <button type="button" onClick={ok} className={`h-[38px] px-4 rounded-[9px] text-[13px] font-bold text-white ${danger ? 'bg-rose-500 hover:bg-rose-600' : 'bg-[#6c5ce7] hover:bg-violet-700'}`} data-confirm-ok>{okText}</button>
        </div>
      </div>
    </div>, document.body)
}
