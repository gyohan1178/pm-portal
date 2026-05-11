import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

const EMPTY = { name:'', category:'자재', contact:'', phone:'', email:'', lt_avg_weeks:'', memo:'' }

async function fetchVendors(search) {
  let q = supabase.from('vendors').select('*').order('name')
  if (search) q = q.ilike('name', `%${search}%`)
  const { data } = await q
  return data || []
}

export default function Vendors() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ['vendors', search],
    queryFn: () => fetchVendors(search),
  })

  const addMut = useMutation({
    mutationFn: async (data) => {
      const { error } = await supabase.from('vendors').insert({ ...data, lt_avg_weeks: data.lt_avg_weeks ? Number(data.lt_avg_weeks) : null })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries(['vendors']); setForm(EMPTY); setShowForm(false) },
    onError: (e) => alert('오류: ' + e.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="협력사명 검색"
          className="w-56 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <div className="flex-1" />
        <button onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-700 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
          ➕ 협력사 추가
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[['name','협력사명 *'],['contact','담당자'],['phone','연락처'],['email','이메일'],].map(([k,l]) => (
              <div key={k}>
                <label className="block text-[10px] font-700 text-slate-500 mb-1">{l}</label>
                <input value={form[k]} onChange={e => setForm(f => ({...f, [k]: e.target.value}))} placeholder={l}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            ))}
            <div>
              <label className="block text-[10px] font-700 text-slate-500 mb-1">구분</label>
              <select value={form.category} onChange={e => setForm(f => ({...f, category: e.target.value}))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option>자재</option><option>가공</option><option>기타</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-700 text-slate-500 mb-1">평균 LT(주)</label>
              <input type="number" value={form.lt_avg_weeks} onChange={e => setForm(f => ({...f, lt_avg_weeks: e.target.value}))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-700 text-slate-500 mb-1">메모</label>
            <input value={form.memo} onChange={e => setForm(f => ({...f, memo: e.target.value}))} placeholder="메모"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-xs font-600 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">취소</button>
            <button onClick={() => addMut.mutate(form)} disabled={!form.name.trim() || addMut.isPending}
              className="px-4 py-2 text-xs font-700 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
              {addMut.isPending ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {['협력사명','구분','담당자','연락처','이메일','평균LT','메모'].map(h => (
                <th key={h} className="px-3 py-2.5 text-left font-700 text-slate-400 text-[10px] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="text-center py-10 text-slate-400">불러오는 중...</td></tr>
            ) : vendors.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-10 text-slate-400">협력사 정보를 추가해주세요</td></tr>
            ) : vendors.map(v => (
              <tr key={v.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-600 text-slate-800">{v.name}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-700
                    ${v.category === '가공' ? 'bg-indigo-50 text-indigo-600' : v.category === '자재' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                    {v.category}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600">{v.contact || '-'}</td>
                <td className="px-3 py-2 text-slate-500">{v.phone || '-'}</td>
                <td className="px-3 py-2 text-slate-500">{v.email || '-'}</td>
                <td className="px-3 py-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-600 bg-slate-100 text-slate-600">{v.lt_avg_weeks ? v.lt_avg_weeks + 'W' : '-'}</span></td>
                <td className="px-3 py-2 text-slate-400">{v.memo || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
