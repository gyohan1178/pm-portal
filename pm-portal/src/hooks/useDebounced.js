import { useState, useEffect, useRef } from 'react'

/**
 * 값이 멈춘 뒤에야 반영한다.
 *
 * 검색창에 한 글자 칠 때마다 조회가 나가면 타이핑이 밀린다.
 * ('AX-160003770' 12자 → 12번 조회)
 * 이 훅을 쓰면 입력이 멈춘 후 한 번만 조회한다.
 *
 *   const [text, setText] = useState('')
 *   const query = useDebounced(text)        // 이걸 queryKey 에 넣는다
 *
 * @param value  화면 입력값 (즉시 반영 — 타이핑은 끊기지 않는다)
 * @param delay  멈춤 판정 시간(ms). 기본 300
 */
export function useDebounced(value, delay = 300) {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])

  return settled
}

/**
 * 입력값과 확정값을 함께 관리한다.
 * 화면에는 text 를 묶고, 조회에는 query 를 쓴다.
 *
 *   const { text, setText, query, clear, pending } = useSearchInput()
 *   <input value={text} onChange={e => setText(e.target.value)} />
 *   useQuery({ queryKey: ['items', query], ... })
 *
 * pending 이 true 면 아직 입력 중이라는 뜻 — 스피너를 띄울 수 있다.
 */
export function useSearchInput(initial = '', delay = 300) {
  const [text, setText] = useState(initial)
  const query = useDebounced(text, delay)
  const clear = () => setText('')
  return { text, setText, query, clear, pending: text !== query }
}

/**
 * 함수 호출을 묶는다. 자동저장처럼 잦은 호출을 줄일 때.
 *
 *   const save = useDebouncedCallback((v) => saveToDb(v), 600)
 */
export function useDebouncedCallback(fn, delay = 300) {
  const timer = useRef(null)
  const latest = useRef(fn)
  latest.current = fn

  useEffect(() => () => clearTimeout(timer.current), [])

  return (...args) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => latest.current(...args), delay)
  }
}
