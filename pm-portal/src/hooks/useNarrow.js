import { useEffect, useState } from 'react'

// 휴대폰 폭(768px 미만)인가 — 표 대신 카드 · 검색칸을 위에 크게 (v4.152.0 · 수주대장 v4.90.7 과 같은 기준)
const NARROW_Q = '(max-width: 767px)'
export function useNarrow() {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(NARROW_Q).matches
  const [n, setN] = useState(get)
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(NARROW_Q)
    const on = () => setN(mq.matches)
    on(); mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on)
    return () => { mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on) }
  }, [])
  return n
}
