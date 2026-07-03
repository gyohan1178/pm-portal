import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// 공통 구매처 선택 — 페이지마다 select/검색 뒤섞인 것을 이걸로 통일.
// props: value(vendor id), onChange(id, vendor), placeholder, allowClear
async function fetchVendors() {
  const { data } = await supabase.from('vendors').select('id,name,ecount_code').order('name')
  return data || []
}

export default function VendorPicker({ value, onChange, placeholder = '구매처 검색·선택', allowClear = true }) {
  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors })
  const selected = vendors.find(v => v.id === value)
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const shown = open ? text : (selected?.name || '')
  const fv = vendors.filter(v => !text || v.name.toLowerCase().includes(text.toLowerCase()))
  return (
    <div className="relative">
      <input
        value={shown}
        onChange={e => { setText(e.target.value); setOpen(true); onChange?.('', null) }}
        onFocus={() => { setText(''); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
      {allowClear && value && !open && (
        <button type="button" onMouseDown={() => onChange?.('', null)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 text-sm">×</button>
      )}
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-52 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg">
          {fv.slice(0, 60).map(v => (
            <button key={v.id} type="button"
              onMouseDown={() => { onChange?.(v.id, v); setText(''); setOpen(false) }}
              className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50 ${value === v.id ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-slate-700'}`}>
              {v.name}
            </button>
          ))}
          {fv.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">검색 결과 없음</div>}
        </div>
      )}
    </div>
  )
}
