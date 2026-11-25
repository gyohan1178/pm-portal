import { useEffect, useRef, useState } from 'react'

// 넓은 표 — 위에도 가로 스크롤 막대 (v4.246.0)
//   표가 길면 아래 막대는 맨 끝까지 내려야 보인다 → 표 위에 같은 막대를 하나 더 두고 서로 맞춰 움직인다
//   표가 화면에 다 들어가면 위 막대는 안 보인다
export default function TopScroll({ className = '', children, ...rest }) {
  const top = useRef(null), body = useRef(null)
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
  let lock = false
  const sync = (from, to) => () => {
    if (lock || !from.current || !to.current) return
    lock = true; to.current.scrollLeft = from.current.scrollLeft
    requestAnimationFrame(() => { lock = false })
  }
  return (
    <>
      <div ref={top} onScroll={sync(top, body)} data-top-scroll aria-hidden="true"
        className={`overflow-x-auto overflow-y-hidden mb-1 ${need ? '' : 'hidden'}`} style={{ height: 14 }}>
        <div style={{ width: w, height: 1 }} />
      </div>
      <div ref={body} onScroll={sync(body, top)} className={`overflow-x-auto ${className}`} {...rest}>{children}</div>
    </>
  )
}
