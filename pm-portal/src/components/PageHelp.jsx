// 화면 위 「❓ 안내」 (v4.209.0) — 지금 화면의 안내(lib/pageHelp.js)를 오른쪽에 펼친다
//   안내가 없는 화면은 버튼이 도움말 페이지로 간다
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { helpFor } from '../lib/pageHelp'

export function HelpBody({ h }) {
  return (
    <div className="space-y-3 text-[13px] text-slate-700">
      <p className="text-slate-600 leading-relaxed">{h.what}</p>
      {h.steps?.length > 0 && (
        <ol className="space-y-1.5">
          {h.steps.map((s, i) => (
            <li key={i} className="flex gap-2"><span className="flex-none w-5 h-5 rounded-full bg-[#6c5ce7] text-white text-[11px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span><span className="leading-relaxed">{s}</span></li>
          ))}
        </ol>
      )}
      {h.tips?.length > 0 && (
        <ul className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 space-y-1 text-[12px] text-slate-600">
          {h.tips.map((t, i) => <li key={i}>💡 {t}</li>)}
        </ul>
      )}
    </div>
  )
}

export default function PageHelp({ pathname }) {
  const [open, setOpen] = useState(false)
  const h = helpFor(pathname)
  useEffect(() => { setOpen(false) }, [pathname])
  if (!h) {
    return (
      <Link to="/help" title="도움말" data-page-help="none"
        className="hidden sm:flex items-center text-xs text-slate-400 hover:text-slate-600 px-2 py-1.5 rounded-lg hover:bg-slate-100 flex-shrink-0">❓</Link>
    )
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-page-help={h.key} title="이 화면 안내"
        className="flex items-center gap-1 text-xs font-bold text-white/85 sm:text-[#6c5ce7] px-2 py-1.5 rounded-lg sm:bg-[#eeebfd] hover:brightness-95 flex-shrink-0">❓<span className="hidden md:inline">안내</span></button>
      {open && (
        <div className="fixed inset-0 z-[70]" data-page-help-panel>
          <div className="absolute inset-0 bg-black/25" />
          <aside className="absolute right-0 top-0 h-full w-full max-w-[420px] bg-white shadow-xl flex flex-col">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
              <span className="text-xl">{h.icon}</span>
              <div className="min-w-0"><p className="text-[11px] text-slate-400">이 화면 안내</p><h2 className="text-base font-extrabold text-slate-900 truncate">{h.name}</h2></div>
              <button type="button" onClick={() => setOpen(false)} className="ml-auto text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="닫기">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4"><HelpBody h={h} /></div>
            <div className="px-5 py-3 border-t border-slate-100 text-[12px]">
              <Link to="/help" onClick={() => setOpen(false)} className="font-bold text-[#6c5ce7]">전체 도움말 · 다른 화면 안내 →</Link>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
