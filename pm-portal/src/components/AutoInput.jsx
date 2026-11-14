import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'

// 🔎 공용 자동완성 입력창
// props:
//  value/setValue      : 입력 상태 (부모 관리)
//  fetchSuggest(q)     : 2글자↑에서 호출되는 검색 함수 → 배열 반환
//  keyName             : react-query 캐시 키
//  onPick(item)        : 제안 클릭 시
//  onSubmit()          : Enter/검색버튼 (buttonLabel null이면 버튼 숨김)
//  renderSuggest(item) : 제안 행 렌더
//  placeholder, buttonLabel(기본 '검색', null=버튼없음), minChars(기본 2)
export default function AutoInput({
  value, setValue, fetchSuggest, keyName, onPick, onSubmit,
  renderSuggest, placeholder, buttonLabel = '검색', minChars = 2,
}) {
  const [show, setShow] = useState(false)
  const [hi, setHi] = useState(-1)       // 방향키로 고른 줄 (v4.193.0) — ↑↓ 이동 · Enter 고르기 · Esc 닫기
  const listRef = useRef(null)
  const [debounced, setDebounced] = useState('')
  useEffect(() => { const t = setTimeout(() => setDebounced(value), 250); return () => clearTimeout(t) }, [value])
  const { data: suggestions = [] } = useQuery({
    queryKey: [keyName, debounced],
    queryFn: () => fetchSuggest(debounced),
    enabled: (debounced || '').trim().length >= minChars,
  })
  const submit = () => { onSubmit && onSubmit(); setShow(false) }
  useEffect(() => { setHi(-1) }, [debounced, suggestions.length])
  useEffect(() => { if (hi >= 0) listRef.current?.querySelector(`[data-sug="${hi}"]`)?.scrollIntoView({ block: 'nearest' }) }, [hi])
  const onKey = (e) => {
    const open = show && suggestions.length > 0
    if (e.key === 'ArrowDown' && open) { e.preventDefault(); setHi((h) => Math.min(h + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp' && open) { e.preventDefault(); setHi((h) => Math.max(h - 1, -1)) }
    else if (e.key === 'Escape' && open) { setShow(false); setHi(-1) }
    else if (e.key === 'Enter') { if (open && hi >= 0) { e.preventDefault(); onPick(suggestions[hi]); setShow(false) } else submit() }
  }
  return (
    <div className="flex gap-2">
      <div className="flex-1 relative">
        <input value={value}
          onChange={e => { setValue(e.target.value); setShow(true) }}
          onKeyDown={onKey}
          onFocus={() => setShow(true)}
          onBlur={() => setTimeout(() => setShow(false), 150)}
          placeholder={placeholder}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
        {show && suggestions.length > 0 && (
          <div ref={listRef} className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-72 overflow-y-auto">
            {suggestions.map((s, i) => (
              <button key={s.id || i} type="button" data-sug={i} onMouseDown={() => { onPick(s); setShow(false) }} onMouseEnter={() => setHi(i)}
                className={`w-full text-left px-3 py-2 border-b border-slate-50 last:border-0 ${i === hi ? 'bg-indigo-50' : 'hover:bg-indigo-50'}`}>
                {renderSuggest(s)}
              </button>
            ))}
          </div>
        )}
      </div>
      {buttonLabel !== null && (
        <button onClick={submit} disabled={!(value || '').trim()}
          className="px-5 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">{buttonLabel}</button>
      )}
    </div>
  )
}
