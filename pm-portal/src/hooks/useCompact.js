import { useEffect, useState } from 'react'

// 노트북 화면(화면 크기 94% · 88%)인가 — 위 지표 칸 등을 얇게 그릴 때 (v4.64.0, lib/viewPrefs.js)
const isCompact = () => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-compact')
export function useCompact() {
  const [c, setC] = useState(isCompact)
  useEffect(() => {
    const f = () => setC(isCompact())
    window.addEventListener('pm:viewscale', f)
    window.addEventListener('resize', f)
    return () => { window.removeEventListener('pm:viewscale', f); window.removeEventListener('resize', f) }
  }, [])
  return c
}
