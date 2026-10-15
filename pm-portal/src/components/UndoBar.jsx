import { useState } from 'react'
import { toastError, toastSuccess } from '../lib/toast'

// 「방금 한 작업 되돌리기」 — 화면마다 하나만 기억한다. 다른 작업을 하면 그것으로 바뀐다 (v4.58.0)
//   remember(label, run, { note, confirm }) — run 은 되돌리는 async 함수
//   note 를 주면 되돌리기 전에 묻는다 (재고가 걸린 작업)
export function useUndo() {
  const [undo, setUndo] = useState(null)
  const [busy, setBusy] = useState(false)
  const remember = (label, run, opt = {}) => setUndo({ label, run, note: opt.note || '', after: opt.after })
  const clear = () => setUndo(null)
  async function runIt() {
    if (!undo || busy) return
    if (undo.note && !window.confirm(`「${undo.label}」을(를) 되돌릴까요?\n\n${undo.note}`)) return
    setBusy(true)
    try {
      const msg = await undo.run()
      toastSuccess(typeof msg === 'string' && msg ? msg : `되돌렸습니다 — ${undo.label}`)
      undo.after?.()
      setUndo(null)
    } catch (e) { toastError('되돌리기 실패: ' + (e?.message || e)) }
    finally { setBusy(false) }
  }
  const bar = undo ? (
    <div data-undo className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
      <span>방금 한 작업: <b>{undo.label}</b></span>
      <button data-undo-run disabled={busy} onClick={runIt}
        className="ml-auto px-3 py-1 text-xs font-bold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40">{busy ? '되돌리는 중…' : '↩ 되돌리기'}</button>
      <button onClick={clear} className="px-2 py-1 text-[11px] text-amber-500">닫기</button>
    </div>
  ) : null
  // run · busy — 화면이 자기 모양으로 「되돌리기」 단추를 그릴 때 (입고 처리 아래 칸 등, v4.62.0)
  return { remember, clear, bar, undo, run: runIt, busy }
}
