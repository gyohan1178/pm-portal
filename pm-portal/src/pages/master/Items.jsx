import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import * as XLSX from 'xlsx'

async function fetchItems(search, type) {
  let q = supabase.from('items').select('*, customer_item_codes(customer_code, customers(name))').order('std_code')
  if (search) q = q.or(`name.ilike.%${search}%,std_code.ilike.%${search}%`)
  if (type !== '전체') q = q.eq('type', type)
  const { data } = await q.limit(200)
  return data || []
}

export default function Items() {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('전체')
  const [query, setQuery] = useState({ search: '', type: '전체' })

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['items', query],
    queryFn: () => fetchItems(query.search, query.type),
  })

  function exportExcel() {
    const data = items.map(item => ({
      '기준코드': item.std_code,
      '품명': item.name,
      '구분': item.type,
      '단위': item.unit,
      'LT(주)': item.lt_weeks,
      '안전재고': item.safety_stock,
      '제조사': item.manufacturer || '',
      '메모': item.memo || '',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), '기준코드DB')
    XLSX.writeFile(wb, `기준코드DB_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') setQuery({ search, type: typeFilter }) }}
          placeholder="품명 또는 기준코드 검색 후 Enter"
          className="w-64 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {['전체','가공','자재'].map(t => (
            <button key={t} onClick={() => { setTypeFilter(t); setQuery({ search, type: t }) }}
              className={`px-3 py-1 text-xs font-600 rounded-md transition-all
                ${typeFilter===t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{t}</button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="text-xs text-slate-400 font-600">{items.length}개</span>
        <button onClick={exportExcel}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-600 rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">
          📥 엑셀 추출
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['기준코드','품명','구분','단위','LT(주)','안전재고','제조사','고객사 코드'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-700 text-slate-400 text-[10px] uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">불러오는 중...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">데이터가 없습니다. ERP 기준코드 등록 후 사용하세요.</td></tr>
              ) : items.map(item => (
                <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-[10px] font-600 text-indigo-600">{item.std_code}</td>
                  <td className="px-3 py-2 font-600 text-slate-800">{item.name}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-700
                      ${item.type === '가공' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>
                      {item.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{item.unit}</td>
                  <td className="px-3 py-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-600 bg-slate-100 text-slate-600">{item.lt_weeks}W</span></td>
                  <td className="px-3 py-2 text-right text-slate-600">{item.safety_stock}</td>
                  <td className="px-3 py-2 text-slate-500">{item.manufacturer || '-'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(item.customer_item_codes || []).map((c, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                          {c.customers?.name}: {c.customer_code}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
