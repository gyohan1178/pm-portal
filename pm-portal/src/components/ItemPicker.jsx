import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// 공통 품목 검색 자동완성 — 전 페이지의 제각각 품목 검색/드롭다운을 이걸로 통일.
// props:
//   value        : 입력창 표시 문자열(제어)
//   onChange(str): 입력 변할 때
//   onSelect(item): 결과 선택 시 (item = {id,std_code,name,type,unit,lt_weeks,manufacturer,manufacturer_code,purchase_price,vendor_id,vendors})
//   placeholder, disabled, autoFocus
//   extraSelect  : items select에 추가할 컬럼(문자열)
function useDebounced(v, ms = 250) {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}

const BASE_COLS = 'id,std_code,name,type,unit,lt_weeks,manufacturer,manufacturer_code,purchase_price,vendor_id,vendors(name)'

async function searchItems(term, extra) {
  const q = (term || '').replace(/[,()%]/g, ' ').trim()
  if (q.length < 1) return []
  const like = `%${q}%`
  const cols = extra ? `${BASE_COLS},${extra}` : BASE_COLS
  const { data } = await supabase.from('items').select(cols)
    .or(`std_code.ilike.${like},name.ilike.${like},manufacturer.ilike.${like},manufacturer_code.ilike.${like}`)
    .limit(12)
  return data || []
}

export default function ItemPicker({ value, onChange, onSelect, placeholder = '품명·기준코드·제조사품번', disabled, autoFocus, extraSelect }) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1)
  const term = useDebounced(value, 250)
  const boxRef = useRef(null)
  const { data: results = [] } = useQuery({
    queryKey: ['itemPicker', term, extraSelect || ''],
    queryFn: () => searchItems(term, extraSelect),
    enabled: open && !!term && String(term).trim().length >= 1,
  })
  function pick(it) { onSelect?.(it); onChange?.(it.name || it.std_code || ''); setOpen(false); setHi(-1) }
  return (
    <div className="relative" ref={boxRef}>
      <input
        value={value} disabled={disabled} autoFocus={autoFocus}
        onChange={e => { onChange?.(e.target.value); setOpen(true); setHi(-1) }}
        onFocus={() => { if (String(value || '').trim().length >= 1) setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (!open || !results.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, results.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
          else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); pick(results[hi]) }
          else if (e.key === 'Escape') { setOpen(false) }
        }}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50"/>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-30 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {results.map((it, i) => (
            <button key={it.id} type="button" onMouseDown={e => { e.preventDefault(); pick(it) }}
              className={`w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-slate-100 last:border-0 text-xs ${i === hi ? 'bg-indigo-50' : ''}`}>
              <div className="font-semibold text-slate-800 truncate">{it.name}</div>
              <div className="text-slate-400 font-mono text-xs flex gap-2 flex-wrap">
                <span>{it.std_code}</span>
                {it.manufacturer_code && <span className="text-violet-500">· {it.manufacturer_code}</span>}
                {it.vendors?.name && <span className="text-emerald-600">· {it.vendors.name}</span>}
                {it.purchase_price ? <span className="text-indigo-500">· ₩{Math.round(it.purchase_price).toLocaleString()}</span> : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
