import { useEffect, useRef, useState } from 'react'

// 넓은 표 — 가로 스크롤 막대를 화면 맨 아래에 붙여 둔다 (v4.246.0 → v4.250.1)
//   표가 길면 표 자체의 막대는 맨 끝까지 내려야 보인다 → 화면 아래(sticky bottom)에 같은 막대를 두고 서로 맞춰 움직인다
//   표가 화면 안에서 끝나면 그 자리(표 바로 아래)에 그대로 있다 · 표가 화면 폭에 다 들어가면 막대는 안 보인다
//   표 자체의 막대는 숨긴다 (막대가 두 개 보이지 않게)
//   사용: <TopScroll className="bg-white border rounded-xl"> <table className="w-max min-w-full"> … </TopScroll>
export default function TopScroll({ className = '', children, ...rest }) {
  const bar = useRef(null), body = useRef(null)
  const [w, setW] = useState(0)
  const [need, setNeed] = useState(false)
  useEffect(() => {
    const b = body.current
    if (!b) return
    const measure = () => { setW(b.scrollWidth); setNeed(b.scrollWidth > b.clientWidth + 1) }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(b); if (b.firstElementChild) ro?.observe(b.firstElementChild)
    window.addEventListener('resize', measure)
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
  const lock = useRef(false)
  const sync = (from, to) => () => {
    if (lock.current || !from.current || !to.current) return
    lock.current = true; to.current.scrollLeft = from.current.scrollLeft
    requestAnimationFrame(() => { lock.current = false })
  }
  return (
    <>
      <div ref={body} onScroll={sync(body, bar)} style={{ scrollbarWidth: 'none' }}
        className={`overflow-x-auto [&::-webkit-scrollbar]:hidden ${className}`} {...rest}>{children}</div>
      <div ref={bar} onScroll={sync(bar, body)} data-sticky-xscroll aria-hidden="true"
        className={`sticky bottom-0 z-20 overflow-x-auto overflow-y-hidden bg-white/90 backdrop-blur border-t border-slate-200 rounded-b ${need ? '' : 'hidden'}`} style={{ height: 16 }}>
        <div style={{ width: w, height: 1 }} />
      </div>
    </>
  )
}
export { TopScroll as StickyXScroll }
