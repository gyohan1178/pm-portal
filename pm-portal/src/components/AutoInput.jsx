import { useState, useEffect } from 'react'
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
  const [debounced, setDebounced] = useState('')
  useEffect(() => { const t = setTimeout(() => setDebounced(value), 250); return () => clearTimeout(t) }, [value])
  const { data: suggestions = [] } = useQuery({
    queryKey: [keyName, debounced],
    queryFn: () => fetchSuggest(debounced),
    enabled: (debounced || '').trim().length >= minChars,
  })
  const submit = () => { onSubmit && onSubmit(); setShow(false) }
  return (
    <div className="flex gap-2">
      <div className="flex-1 relative">
        <input value={value}
          onChange={e => { setValue(e.target.value); setShow(true) }}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          onFocus={() => setShow(true)}
          onBlur={() => setTimeout(() => setShow(false), 150)}
          placeholder={placeholder}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
        {show && suggestions.length > 0 && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-72 overflow-y-auto">
            {suggestions.map((s, i) => (
              <button key={s.id || i} onMouseDown={() => { onPick(s); setShow(false) }}
                className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-slate-50 last:border-0">
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
