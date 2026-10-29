// 생산관리 「검수」 칸 (v4.116.0) — 누르면 작은 창: 합격 / 불합격(사유 필수) / 지우기 · 이력
//   VM 은 박스마다, CSK 는 호기마다 하나. 저장은 pm_prod_qc 에 한 줄씩 쌓는다 (lib/prodAuto.js)
import { useEffect, useRef, useState } from 'react'

const hm = (t) => { if (!t) return ''; const d = new Date(t); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

export default function QcCell({ title, cur, hist = [], need = true, disabled, disabledWhy, onSave, testId }) {
  const [pos, setPos] = useState(null)
  const [memo, setMemo] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  const r = cur && cur.result !== '취소' ? cur.result : null
  useEffect(() => {
    if (!pos) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setPos(null) }
    const esc = (e) => { if (e.key === 'Escape') setPos(null) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [pos])
  const open = (e) => {
    e.stopPropagation()
    if (disabled) return
    const b = e.currentTarget.getBoundingClientRect()
    const w = 320, x = Math.min(Math.max(8, b.left + b.width / 2 - w / 2), window.innerWidth - w - 8)
    const y = b.bottom + 6 + 260 > window.innerHeight ? Math.max(8, b.top - 266) : b.bottom + 6
    setMemo(r === '불합격' ? (cur?.memo || '') : ''); setErr(''); setPos({ x, y })
  }
  const save = async (result) => {
    if (result === '불합격' && !memo.trim()) { setErr('불합격은 사유를 적어 주세요'); return }
    setBusy(true)
    const ok = await onSave(result, memo.trim())
    setBusy(false)
    if (ok) setPos(null)
  }
  return (
    <>
      <button type="button" data-qc-cell={testId} onMouseDown={(e) => e.stopPropagation()} onClick={open}
        title={disabled ? disabledWhy : r ? `${r} · ${cur.by_name || ''} ${hm(cur.at)}${cur.memo ? ` · ${cur.memo}` : ''}` : '눌러서 검수 (합격 / 불합격)'}
        className={`px-1 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${disabled ? 'text-slate-200 cursor-default' : 'cursor-pointer'} ${
          r === '합격' ? 'text-emerald-600 hover:bg-emerald-50' : r === '불합격' ? 'text-rose-600 hover:bg-rose-50' : need ? 'text-slate-300 hover:text-violet-600 hover:bg-violet-50' : 'text-slate-200 hover:text-violet-500'}`}>
        {r === '합격' ? '✔ 합격' : r === '불합격' ? '✖ 불합격' : need ? '검수' : '—'}
      </button>
      {pos && (
        <div ref={ref} data-qc-pop onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
          className="fixed z-[70] w-[320px] rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl" style={{ left: pos.x, top: pos.y }}>
          <div className="flex items-start gap-2">
            <p className="text-sm font-bold text-slate-800">{title}</p>
            <button type="button" onClick={() => setPos(null)} className="ml-auto text-slate-400 hover:text-slate-600">✕</button>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">{r ? `지금: ${r} · ${cur.by_name || ''} ${hm(cur.at)}` : '아직 검수 전'}{!need ? ' · 자재 칸이 비어 검수 대상은 아님' : ''}</p>
          <div className="flex gap-1.5 mt-2.5">
            <button type="button" data-qc-pass onClick={() => save('합격')} disabled={busy}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border disabled:opacity-40 ${r === '합격' ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-emerald-200 text-emerald-700 bg-white hover:bg-emerald-50'}`}>✔ 합격</button>
            <button type="button" data-qc-fail onClick={() => save('불합격')} disabled={busy}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border disabled:opacity-40 ${r === '불합격' ? 'bg-rose-600 border-rose-600 text-white' : 'border-rose-200 text-rose-600 bg-white hover:bg-rose-50'}`}>✖ 불합격</button>
            {r && <button type="button" data-qc-clear onClick={() => save('취소')} disabled={busy}
              className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-500 bg-white hover:bg-slate-50 disabled:opacity-40">지우기</button>}
          </div>
          <input data-qc-memo value={memo} onChange={(e) => { setMemo(e.target.value); setErr('') }}
            onKeyDown={(e) => { if (e.key === 'Enter' && memo.trim()) save('불합격') }}
            placeholder="사유 — 불합격은 꼭 (예: 체결 토크 미달 2곳)" className="mt-2 w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />
          {err && <p data-field-error className="mt-1 text-[11px] font-bold text-rose-600">{err}</p>}
          {hist.length > 0 && (
            <div className="mt-2 max-h-28 overflow-y-auto border-t border-slate-100 pt-1.5 space-y-0.5">
              {[...hist].reverse().slice(0, 8).map((h) => (
                <p key={h.id} className="text-[11px] text-slate-500">
                  <b className={h.result === '합격' ? 'text-emerald-600' : h.result === '불합격' ? 'text-rose-600' : 'text-slate-400'}>{h.result}</b>
                  {' · '}{h.by_name || ''} {hm(h.at)}{h.memo ? ` · ${h.memo}` : ''}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
