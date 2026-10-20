import { useEffect, useMemo, useRef, useState } from 'react'
import { bomImageRows, drawBomImage, canvasToBlob, DWG_COLS, DWG_DEFAULT, DWG_SIZES } from '../lib/bomImage'
import { toastError, toastSuccess } from '../lib/toast'

// BOM → 도면용 흑백 이미지 (v4.75.0)
//   설정(열 · 줄 순서 · 글자 크기 · 머리 줄 · 참조용 빼기)을 바꾸면 미리보기가 바로 다시 그려진다.
//   「클립보드 복사」 → CAD · PDF · PPT 에서 Ctrl+V / 「PNG 저장」.
//   설정은 이 PC 에 기억해 둔다 (다음에 열 때 그대로).
const KEY = 'pm.bomImage.v1'
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {} } catch { return {} } }

export default function BomImageDialog({ rows, assembly, onClose }) {
  const saved = load()
  const [cols, setCols] = useState(Array.isArray(saved.cols) && saved.cols.length ? saved.cols : DWG_DEFAULT)
  const [order, setOrder] = useState(saved.order || 'maker')
  const [size, setSize] = useState(saved.size || '보통')
  const [withTitle, setWithTitle] = useState(saved.withTitle ?? true)
  const [dropZero, setDropZero] = useState(saved.dropZero ?? false)
  const [busy, setBusy] = useState(false)
  const canvasRef = useRef(null)

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ cols, order, size, withTitle, dropZero })) } catch { /* 저장 못 해도 그만 */ }
  }, [cols, order, size, withTitle, dropZero])

  const list = useMemo(() => bomImageRows(rows, { order, dropZero }), [rows, order, dropZero])
  const today = new Date().toISOString().slice(0, 10)
  const title = withTitle && assembly ? `${assembly.code}${assembly.name ? ' ' + assembly.name : ''} · REV ${assembly.rev || 'A'}` : ''

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !cv.getContext) return
    let ok2d = null; try { ok2d = cv.getContext('2d') } catch { ok2d = null }
    if (!ok2d) return                 // 그릴 수 없는 환경 (시험용 가짜 브라우저 등)
    try {
      const { width } = drawBomImage(cv, { rows: list, cols, size: DWG_SIZES[size] || 13, title, date: withTitle ? today : '' })
      cv.style.width = `${Math.round(width)}px`   // 화면에는 실제 크기로 (이미지 자체는 3배 촘촘)
    }
    catch (e) { console.warn('도면용 이미지 그리기 실패', e) }
  }, [list, cols, size, title, withTitle, today])

  const toggleCol = (k) => setCols((cs) => {
    if (cs.includes(k)) return cs.length > 1 ? cs.filter((x) => x !== k) : cs
    return DWG_COLS.map((c) => c.key).filter((x) => x === k || cs.includes(x))   // 정해진 순서 유지
  })

  async function copy() {
    const cv = canvasRef.current; if (!cv) return
    setBusy(true)
    try {
      if (!navigator.clipboard?.write || typeof window.ClipboardItem === 'undefined') throw new Error('이 브라우저는 이미지 복사를 지원하지 않습니다 — 「PNG 저장」을 쓰세요')
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': canvasToBlob(cv) })])
      toastSuccess(`복사했습니다 (${list.length}줄) — 도면에서 Ctrl+V`)
    } catch (e) { toastError('복사 실패: ' + (e?.message || e)) }
    finally { setBusy(false) }
  }
  async function save() {
    const cv = canvasRef.current; if (!cv) return
    try {
      const blob = await canvasToBlob(cv)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `BOM_${assembly?.code || 'bom'}_${today.replace(/-/g, '').slice(2)}.png`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { toastError('저장 실패: ' + (e?.message || e)) }
  }

  const seg = (cur, set, opts) => (
    <div className="flex bg-slate-100 rounded-lg p-0.5">
      {opts.map(([v, l]) => (
        <button key={v} type="button" onClick={() => set(v)}
          className={`flex-1 px-2 py-1.5 text-xs rounded-md ${cur === v ? 'bg-white font-bold text-slate-900 shadow-sm' : 'text-slate-500'}`}>{l}</button>
      ))}
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-auto" onClick={onClose}>
      <div data-bom-image className="bg-white rounded-2xl w-full max-w-6xl my-6 flex flex-col lg:flex-row gap-4 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="lg:w-80 flex-shrink-0 space-y-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">📐 도면용 이미지</h3>
            <p className="text-xs text-slate-400 mt-0.5">도면에 붙일 BOM 을 흑백으로 또렷하게 만듭니다</p>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-600 mb-1.5">넣을 열</p>
            <div className="flex flex-wrap gap-1.5">
              {DWG_COLS.map((c) => (
                <button key={c.key} type="button" data-col={c.key} onClick={() => toggleCol(c.key)}
                  className={`px-2.5 py-1 rounded-full text-xs border ${cols.includes(c.key) ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-bold' : 'bg-white border-slate-200 text-slate-400'}`}>{c.label}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-600 mb-1.5">줄 순서</p>
            {seg(order, setOrder, [['maker', '제조사순'], ['bom', 'BOM 순서']])}
            <p className="text-[11px] text-slate-400 mt-1">{order === 'maker' ? '제조사 → 제조사품번 오름차순 · 제조사가 빈 줄(가공품 · 어셈블리)은 맨 아래' : '레벨만큼 품명을 들여씁니다'}</p>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-600 mb-1.5">글자 크기</p>
            {seg(size, setSize, Object.keys(DWG_SIZES).map((k) => [k, k]))}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={withTitle} onChange={(e) => setWithTitle(e.target.checked)} /> 위에 상위품번 · REV · 날짜</label>
          <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={dropZero} onChange={(e) => setDropZero(e.target.checked)} /> 참조용(수량 0) 줄 빼기</label>
          <div className="flex gap-2 pt-1">
            <button data-bom-copy type="button" onClick={copy} disabled={busy || !list.length}
              className="flex-1 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">📋 클립보드 복사</button>
            <button data-bom-png type="button" onClick={save} disabled={!list.length}
              className="flex-1 py-2 text-sm font-bold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40">💾 PNG 저장</button>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">복사한 뒤 CAD · PDF · PPT 에서 Ctrl+V. 화면보다 3배 촘촘하게 만들어 확대해도 안 깨집니다. 설정은 이 PC 에 기억합니다.</p>
          <button type="button" onClick={onClose} className="w-full py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-500">닫기</button>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-400 mb-1.5">미리보기 · {list.length.toLocaleString('ko-KR')}줄</p>
          <div className="border border-slate-200 rounded-xl bg-slate-50 p-3 overflow-auto max-h-[75vh]">
            <canvas ref={canvasRef} data-bom-canvas className="bg-white max-w-full h-auto shadow-sm" />
          </div>
        </div>
      </div>
    </div>
  )
}
