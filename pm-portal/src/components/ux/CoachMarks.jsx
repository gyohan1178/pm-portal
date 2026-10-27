// 처음 쓰는 사람 안내 (코치마크) — 화면을 처음 열 때 한 번만, 「안내 다시 보기」로 다시 (v4.104.0)
//   const coach = useCoach('orders-sales', steps, enabled)   steps: [{ sel: 'CSS 선택자', title, body }]
//   {coach.el}  ·  <button onClick={coach.start}>안내 다시 보기</button>
//   본 기록은 이 브라우저에만 (사람마다 · 기기마다 한 번)
import { useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const KEY = (id) => `pm_coach_seen_${id}`
const seen = (id) => { try { return localStorage.getItem(KEY(id)) === '1' } catch { return true } }
const markSeen = (id) => { try { localStorage.setItem(KEY(id), '1') } catch { /* 저장 안 돼도 안내는 닫힌다 */ } }

export function useCoach(id, steps, enabled = true) {
  const [i, setI] = useState(-1)
  const [box, setBox] = useState(null)
  const live = steps.filter((s) => typeof document !== 'undefined' && document.querySelector(s.sel))
  // 처음이면 자동으로 — 화면이 다 그려진 뒤 (대상이 하나라도 있을 때)
  useEffect(() => {
    if (!enabled || seen(id)) return undefined
    const t = setTimeout(() => { if (steps.some((s) => document.querySelector(s.sel))) setI(0) }, 900)
    return () => clearTimeout(t)
  }, [enabled, id]) // eslint-disable-line react-hooks/exhaustive-deps
  const step = i >= 0 ? live[i] : null
  useLayoutEffect(() => {
    if (!step) return undefined
    const el = document.querySelector(step.sel)
    if (!el) { setBox(null); return undefined }
    el.scrollIntoView({ block: 'center', behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' })
    const place = () => { const r = el.getBoundingClientRect(); setBox({ x: r.left, y: r.top, w: r.width, h: r.height }) }
    place()
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [step?.sel, i]) // eslint-disable-line react-hooks/exhaustive-deps
  const end = () => { markSeen(id); setI(-1) }
  const next = () => (i + 1 >= live.length ? end() : setI(i + 1))
  const start = () => setI(0)
  let el = null
  if (step && box) {
    const vw = window.innerWidth, vh = window.innerHeight, pad = 6
    const below = box.y + box.h + 170 < vh
    const left = Math.max(12, Math.min(box.x, vw - 292))
    el = createPortal(
      <div className="fixed inset-0 z-[90]" data-coach>
        <div className="absolute rounded-lg transition-all duration-200 pointer-events-none" style={{ left: box.x - pad, top: box.y - pad, width: box.w + pad * 2, height: box.h + pad * 2, boxShadow: '0 0 0 3px #fff, 0 0 0 9999px rgba(31,36,48,.55)' }} />
        <div className="absolute w-[280px] rounded-xl bg-white shadow-xl p-3.5" style={below ? { left, top: box.y + box.h + 14 } : { left, top: Math.max(12, box.y - 150) }} data-coach-box>
          <div className="text-[13px] font-extrabold text-slate-800">{step.title}</div>
          <p className="text-[12px] text-slate-600 mt-1 leading-relaxed">{step.body}</p>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">{i + 1} / {live.length}</span>
            <span className="flex gap-1.5">
              <button type="button" onClick={end} className="h-7 px-2.5 rounded-lg text-[11.5px] font-bold border border-slate-200 text-slate-500" data-coach-skip>그만 보기</button>
              <button type="button" onClick={next} className="h-7 px-3 rounded-lg text-[11.5px] font-bold bg-[#6c5ce7] text-white" data-coach-next>{i + 1 >= live.length ? '끝' : '다음'}</button>
            </span>
          </div>
        </div>
      </div>, document.body)
  }
  return { el, start, on: !!el }
}
