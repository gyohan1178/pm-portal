import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

async function fetchPriceHistory(search) {
  let q = supabase
    .from('price_history')
    .select('*, items(std_code, name, type), vendors(name)')
    .order('year', { ascending: false })
  const { data } = await q.limit(200)
  if (!search) return data || []
  return (data || []).filter(r =>
    r.items?.name?.includes(search) || r.items?.std_code?.includes(search)
  )
}

export default function PriceHistory() {
  const [search, setSearch] = useState('')

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['price-history', search],
    queryFn: () => fetchPriceHistory(search),
  })

  // 기준코드별 연도 비교
  const grouped = {}
  rows.forEach(r => {
    const key = r.item_id
    if (!grouped[key]) grouped[key] = { item: r.items, vendor: r.vendors, years: {} }
    grouped[key].years[r.year] = r.price
  })

  const years = [...new Set(rows.map(r => r.year))].sort((a,b) => b-a)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="품명 또는 기준코드 검색"
          className="w-full sm:w-64 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <div className="flex-1" />
        <p className="text-xs text-slate-400">견적 입력 시 자동 누적됩니다</p>
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-3 py-2.5 text-left font-700 text-slate-400 text-[10px] uppercase tracking-wide">기준코드</th>
              <th className="px-3 py-2.5 text-left font-700 text-slate-400 text-[10px] uppercase tracking-wide">품명</th>
              <th className="px-3 py-2.5 text-left font-700 text-slate-400 text-[10px] uppercase tracking-wide">구분</th>
              {years.map(y => (
                <th key={y} className="px-3 py-2.5 text-right font-700 text-slate-400 text-[10px] uppercase tracking-wide">{y}년</th>
              ))}
              {years.length >= 2 && (
                <th className="px-3 py-2.5 text-right font-700 text-slate-400 text-[10px] uppercase tracking-wide">전년 대비</th>
              )}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={10} className="text-center py-10 text-slate-400">불러오는 중...</td></tr>
            ) : Object.keys(grouped).length === 0 ? (
              <tr><td colSpan={10} className="text-center py-10 text-slate-400">단가 이력이 없습니다</td></tr>
            ) : Object.entries(grouped).map(([itemId, g]) => {
              const latestPrice = g.years[years[0]]
              const prevPrice = years.length >= 2 ? g.years[years[1]] : null
              const diff = latestPrice && prevPrice ? ((latestPrice - prevPrice) / prevPrice * 100).toFixed(1) : null
              return (
                <tr key={itemId} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-[10px] text-indigo-600">{g.item?.std_code}</td>
                  <td className="px-3 py-2 font-600 text-slate-800">{g.item?.name}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-700
                      ${g.item?.type === '가공' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>
                      {g.item?.type}
                    </span>
                  </td>
                  {years.map(y => (
                    <td key={y} className="px-3 py-2 text-right font-600 text-slate-700">
                      {g.years[y] ? Number(g.years[y]).toLocaleString() : '-'}
                    </td>
                  ))}
                  {years.length >= 2 && (
                    <td className="px-3 py-2 text-right">
                      {diff !== null ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-700
                          ${Number(diff) > 0 ? 'bg-red-50 text-red-600' : Number(diff) < 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {Number(diff) > 0 ? '▲' : Number(diff) < 0 ? '▼' : ''}{Math.abs(diff)}%
                        </span>
                      ) : '-'}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
