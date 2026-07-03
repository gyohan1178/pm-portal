import { useState } from 'react'

// 공통 엑셀 붙여넣기 — 기준코드[탭]수량[탭]단가(선택) 여러 줄을 파싱해서 onParsed로 넘김.
// props: onParsed(rows: [{code, qty, price}]), label, hint
export default function PasteBox({ onParsed, label = '📋 엑셀 붙여넣기로 여러 품목 담기', hint = '엑셀에서 기준코드·수량·단가(선택) 열 복사 → 붙여넣기 (탭/쉼표 구분, 한 줄에 한 품목)' }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  function parse() {
    const rows = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      .map(l => l.split(/[\t,]/).map(x => x.trim()))
      .map(c => ({ code: c[0], qty: Number(c[1]) || 0, price: (c[2] != null && c[2] !== '') ? Number(c[2]) : null }))
      .filter(r => r.code)
    if (!rows.length) return
    onParsed?.(rows)
    setText(''); setOpen(false)
  }
  return (
    <div className="mt-2 pt-2 border-t border-slate-100">
      <button type="button" onClick={() => setOpen(v => !v)} className="text-xs font-bold text-indigo-600 hover:underline">{label} {open ? '▲' : '▼'}</button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-slate-400">{hint}</p>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
            placeholder={'AX-510000540\t100\nAX-500001501\t50\t1200'}
            className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
          <div className="flex justify-end">
            <button type="button" onClick={parse} disabled={!text.trim()}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">일괄 담기 →</button>
          </div>
        </div>
      )}
    </div>
  )
}
