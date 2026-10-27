// 스낵바 「되돌리기」 — 묻지 않고 처리한 뒤 몇 초 동안 되돌릴 수 있게 (v4.104.0)
//   const snack = useUndoSnack()
//   snack.show('납품 표시 3품목', async () => { …되돌리는 일… })
//   {snack.el}
//   재고가 걸린 작업(입고 · 출고)은 지금처럼 묻고 진행 — 거기엔 쓰지 않는다
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toastError, toastSuccess } from '../../lib/toast'

export function useUndoSnack(ms = 6000) {
  const [s, setS] = useState(null)      // { label, run, key }
  const [busy, setBusy] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const show = (label, run) => {
    clearTimeout(timer.current)
    const key = Date.now()
    setS({ label, run, key })
    timer.current = setTimeout(() => setS((cur) => (cur?.key === key ? null : cur)), ms)
  }
  const doUndo = async () => {
    if (!s || busy) return
    clearTimeout(timer.current); setBusy(true)
    const key = s.key
    try { const msg = await s.run(); toastSuccess(typeof msg === 'string' && msg ? msg : `되돌렸습니다 — ${s.label}`); setS((cur) => (cur?.key === key ? null : cur)) }
    catch (e) { toastError('되돌리기 실패: ' + (e?.message || e)) }
    finally { setBusy(false) }
  }
  const el = s ? createPortal(
    <div key={s.key} className="pm-snack fixed left-1/2 bottom-6 z-[70] -translate-x-1/2 flex items-center gap-4 rounded-xl bg-[#1f2430] text-white pl-4 pr-2 py-2.5 shadow-lg text-[13px] whitespace-nowrap overflow-hidden" data-undo-snack>
      <span>{s.label}</span>
      <button type="button" onClick={doUndo} disabled={busy} className="px-2.5 py-1 rounded-lg font-bold text-[#a5b4fc] hover:bg-white/10 disabled:opacity-50" data-undo-snack-run>{busy ? '되돌리는 중…' : '되돌리기'}</button>
      <button type="button" onClick={() => setS(null)} className="px-1.5 text-white/50 hover:text-white" aria-label="닫기">✕</button>
      <span className="pm-snack-bar absolute left-0 bottom-0 h-[3px] bg-[#a5b4fc]" style={{ animationDuration: `${ms}ms` }} />
    </div>, document.body) : null
  // 화면이 통째로 바뀌는 일(다른 견적 불러오기 등) 뒤에는 지난 되돌리기를 닫는다
  const hide = () => { clearTimeout(timer.current); setS(null) }
  return { show, hide, el, active: !!s }
}
