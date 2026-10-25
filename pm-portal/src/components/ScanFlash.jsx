// QR 스캔 결과 — 화면 전체를 초록(성공) · 빨강(실패)으로 잠깐 덮는다 (v4.97.0)
//   장갑 낀 채 화면을 자세히 못 보는 현장용. 멀리서 곁눈으로도 결과를 알게 하고, 폰이면 진동도 준다.
//   value = { ok, title, sub } (매번 새 객체를 넘기면 다시 뜬다) · 성공 1.3초 · 실패 2초 뒤 저절로 닫히고, 누르면 바로 닫힌다.
import { useEffect } from 'react'

export default function ScanFlash({ value, onDone }) {
  useEffect(() => {
    if (!value) return undefined
    try { navigator.vibrate?.(value.ok ? 60 : [90, 60, 90]) } catch { /* 진동 없는 기기 */ }
    const t = setTimeout(() => onDone?.(), value.ok ? 1300 : 2000)
    return () => clearTimeout(t)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!value) return null
  const ok = !!value.ok
  return (
    <button type="button" onClick={() => onDone?.()} data-scan-flash={ok ? 'ok' : 'ng'} aria-live="assertive"
      className={`pm-scan-in fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 px-6 text-center text-white ${ok ? 'bg-[#12a05f]' : 'bg-[#e0505f]'}`}>
      <span className={ok ? 'pm-big-pop flex flex-col items-center gap-4' : 'pm-shake flex flex-col items-center gap-4'}>
        <span className="w-28 h-28 rounded-full bg-white/25 flex items-center justify-center">
          {ok
            ? <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
            : <svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>}
        </span>
        <span className="text-[26px] font-extrabold leading-tight">{value.title}</span>
        {value.sub && <span className="text-[15px] text-white/90">{value.sub}</span>}
      </span>
    </button>
  )
}
