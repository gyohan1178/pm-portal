// 보던 조건 기억 (v4.191.0) — 거르기 · 정렬 · 고객사 선택을 이 브라우저에 남겨, 화면을 옮겼다 와도 그대로
//   검색어 · 날짜 범위는 기억하지 않는다 (어제 친 검색어가 남아 「왜 안 나오지」가 되지 않게)
//   ok(값): 저장된 값이 지금도 쓸 수 있는 값인지 — 아니면 기본값으로 (없어진 선택지 대비)
import { useState, useCallback } from 'react'

const KEY = (k) => `pm.keep.${k}`
export function readKept(key, init, ok) {
  try {
    const raw = localStorage.getItem(KEY(key))
    if (raw == null) return init
    const v = JSON.parse(raw)
    return ok && !ok(v) ? init : v
  } catch { return init }
}
export function useRemember(key, init, ok) {
  const [v, setV] = useState(() => readKept(key, init, ok))
  const set = useCallback((next) => {
    setV((prev) => {
      const n = typeof next === 'function' ? next(prev) : next
      try { localStorage.setItem(KEY(key), JSON.stringify(n)) } catch { /* 저장 못 해도 화면은 그대로 */ }
      return n
    })
  }, [key])
  return [v, set]
}
