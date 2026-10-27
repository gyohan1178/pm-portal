// 지표 기준 설명 — ⓘ 를 누르면 말풍선 (휴대폰에서도 보이게, 마우스 올리기 대신) (v4.104.0)
import { useEffect, useRef, useState } from 'react'
export default function InfoTip({ text, className = '', align = 'left' }) {
  const [on, setOn] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!on) return undefined
    const off = (e) => { if (!ref.current?.contains(e.target)) setOn(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [on])
  return (
    <span ref={ref} className={`relative inline-flex align-middle ${className}`} onClick={(e) => e.stopPropagation()}>
      <span role="button" tabIndex={0} aria-label="기준 설명" onClick={() => setOn((v) => !v)} onKeyDown={(e) => { if (e.key === 'Enter') setOn((v) => !v) }}
        className="w-4 h-4 rounded-full bg-slate-200/80 text-slate-600 text-[10px] font-extrabold inline-flex items-center justify-center cursor-pointer hover:bg-slate-300" data-info-tip>i</span>
      {on && (
        <span className={`absolute top-full mt-2 ${align === 'right' ? 'right-0' : 'left-0'} z-40 w-[260px] rounded-lg bg-[#1f2430] text-white text-[11.5px] font-normal leading-relaxed px-3 py-2 shadow-lg whitespace-normal text-left`} data-info-tip-body>{text}</span>
      )}
    </span>
  )
}
