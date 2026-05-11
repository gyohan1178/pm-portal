import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

async function fetchVendors() {
  const { data } = await supabase.from('vendors').select('id, name')
  return data || []
}
async function fetchCustomers() {
  const { data } = await supabase.from('customers').select('id, code, name')
  return data || []
}
async function searchItems(keyword) {
  if (!keyword || keyword.length < 1) return []
  const { data } = await supabase
    .from('items')
    .select('id, std_code, name, type, unit')
    .or(`name.ilike.%${keyword}%,std_code.ilike.%${keyword}%`)
    .limit(10)
  return data || []
}
async function fetchRecentQuotes() {
  const { data } = await supabase
    .from('quotes')
    .select('*, items(std_code, name), vendors(name), customers(name)')
    .order('created_at', { ascending: false })
    .limit(30)
  return data || []
}

const EMPTY_FORM = {
  item_id: '', item_name_temp: '', vendor_id: '', customer_id: '',
  unit_price: '', qty: '', valid_until: '', memo: '', add_to_db: false,
  item_type: '자재', item_unit: 'EA',
}

export default function Quote() {
  const qc = useQueryClient()
  const [form, setForm] = useState(EMPTY_FORM)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [selectedItem, setSelectedItem] = useState(null)
  const [isNewItem, setIsNewItem] = useState(false)
  const [tab, setTab] = useState('new')

  const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: fetchVendors })
  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: fetchCustomers })
  const { data: recentQuotes = [] } = useQuery({ queryKey: ['quotes'], queryFn: fetchRecentQuotes })

  async function handleSearch(val) {
    setSearch(val)
    if (val.length < 1) { setSearchResults([]); return }
    const results = await searchItems(val)
    setSearchResults(results)
  }

  function selectItem(item) {
    setSelectedItem(item)
    setForm(f => ({ ...f, item_id: item.id, item_name_temp: '' }))
    setSearch(item.name)
    setSearchResults([])
    setIsNewItem(false)
  }

  const saveMut = useMutation({
    mutationFn: async (data) => {
      // 견적 저장
      const quotePayload = {
        item_id: data.item_id || null,
        item_name_temp: data.item_name_temp || null,
        vendor_id: data.vendor_id || null,
        customer_id: data.customer_id || null,
        unit_price: data.unit_price ? Number(data.unit_price) : null,
        qty: data.qty ? Number(data.qty) : null,
        valid_until: data.valid_until || null,
        memo: data.memo || null,
        add_to_db: data.add_to_db,
      }
      const { data: quote, error } = await supabase.from('quotes').insert(quotePayload).select().single()
      if (error) throw error

      // DB 등록 옵션 체크 시 items 테이블에 추가
      if (data.add_to_db && !data.item_id && data.item_name_temp) {
        const code = `JST-NEW-${Date.now().toString().slice(-5)}`
        const { data: newItem, error: itemErr } = await supabase.from('items').insert({
          std_code: code,
          name: data.item_name_temp,
          type: data.item_type || '자재',
          unit: data.item_unit || 'EA',
        }).select().single()
        if (!itemErr && newItem) {
          await supabase.from('quotes').update({ item_id: newItem.id }).eq('id', quote.id)
        }
      }

      // 단가 이력 업데이트
      if (data.unit_price && (data.item_id || data.add_to_db)) {
        // price_history는 item_id 확정 후 추가 (신규는 위에서 처리됨)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries(['quotes'])
      setForm(EMPTY_FORM); setSearch(''); setSelectedItem(null); setIsNewItem(false)
      alert('견적 저장 완료')
    },
    onError: (e) => alert('오류: ' + e.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[['new','견적 입력'],['history','견적 이력']].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-1.5 text-xs font-600 rounded-md transition-all
              ${tab===k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
        ))}
      </div>

      {tab === 'new' ? (
        <div className="grid grid-cols-2 gap-5">
          <div className="space-y-4">
            {/* 품목 검색 */}
            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <h3 className="text-xs font-700 text-slate-700">품목 선택</h3>
              <div className="relative">
                <input value={search} onChange={e => handleSearch(e.target.value)}
                  placeholder="품명 또는 기준코드 검색..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                {searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                    {searchResults.map(item => (
                      <button key={item.id} onClick={() => selectItem(item)}
                        className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-slate-100 last:border-0">
                        <div className="text-xs font-600 text-slate-800">{item.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{item.std_code} · {item.type} · {item.unit}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { setIsNewItem(!isNewItem); setSelectedItem(null); setForm(f => ({...f, item_id:''})); setSearch('') }}
                  className={`px-3 py-1.5 text-xs font-600 rounded-lg border transition-all
                    ${isNewItem ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                  + 신규 품목
                </button>
                {selectedItem && (
                  <span className="text-xs text-emerald-600 font-600">✓ {selectedItem.name} 선택됨</span>
                )}
              </div>
              {isNewItem && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <input value={form.item_name_temp} onChange={e => setForm(f => ({...f, item_name_temp: e.target.value}))}
                    placeholder="신규 품명 입력"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <div className="grid grid-cols-2 gap-2">
                    <select value={form.item_type} onChange={e => setForm(f => ({...f, item_type: e.target.value}))}
                      className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                      <option>자재</option><option>가공</option>
                    </select>
                    <input value={form.item_unit} onChange={e => setForm(f => ({...f, item_unit: e.target.value}))}
                      placeholder="단위 (EA/SET/M)"
                      className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.add_to_db} onChange={e => setForm(f => ({...f, add_to_db: e.target.checked}))}
                      className="w-4 h-4 accent-indigo-600" />
                    <span className="text-xs text-slate-600">기준코드 DB에 등록 (임시코드 자동 부여)</span>
                  </label>
                </div>
              )}
            </div>

            {/* 견적 정보 */}
            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <h3 className="text-xs font-700 text-slate-700">견적 정보</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-700 text-slate-500 mb-1">협력사</label>
                  <select value={form.vendor_id} onChange={e => setForm(f => ({...f, vendor_id: e.target.value}))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">선택</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-700 text-slate-500 mb-1">고객사 (선택)</label>
                  <select value={form.customer_id} onChange={e => setForm(f => ({...f, customer_id: e.target.value}))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">선택</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-700 text-slate-500 mb-1">단가 *</label>
                  <input type="number" value={form.unit_price} onChange={e => setForm(f => ({...f, unit_price: e.target.value}))}
                    placeholder="단가"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-700 text-slate-500 mb-1">수량</label>
                  <input type="number" value={form.qty} onChange={e => setForm(f => ({...f, qty: e.target.value}))}
                    placeholder="수량"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-700 text-slate-500 mb-1">유효기간</label>
                  <input type="date" value={form.valid_until} onChange={e => setForm(f => ({...f, valid_until: e.target.value}))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-700 text-slate-500 mb-1">메모</label>
                <input value={form.memo} onChange={e => setForm(f => ({...f, memo: e.target.value}))}
                  placeholder="메모"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>

            <button onClick={() => saveMut.mutate(form)}
              disabled={saveMut.isPending || (!form.item_id && !form.item_name_temp) || !form.unit_price}
              className="w-full py-2.5 text-sm font-700 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
              {saveMut.isPending ? '저장 중...' : '견적 저장'}
            </button>
          </div>

          {/* 요약 */}
          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-xs font-700 text-slate-700 mb-3">견적 요약</h3>
            {!form.unit_price ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
                <p className="text-2xl">🧾</p>
                <p className="text-xs">단가를 입력하면 요약이 표시됩니다</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-slate-50 rounded-lg p-3 space-y-2">
                  {[
                    ['품목', selectedItem?.name || form.item_name_temp || '-'],
                    ['기준코드', selectedItem?.std_code || (isNewItem ? '신규 (미정)' : '-')],
                    ['협력사', vendors.find(v => v.id === form.vendor_id)?.name || '-'],
                    ['단가', form.unit_price ? Number(form.unit_price).toLocaleString() + '원' : '-'],
                    ['수량', form.qty || '-'],
                    ['금액', form.unit_price && form.qty ? (Number(form.unit_price) * Number(form.qty)).toLocaleString() + '원' : '-'],
                    ['유효기간', form.valid_until || '-'],
                  ].map(([k,v]) => (
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-slate-500">{k}</span>
                      <span className="font-600 text-slate-800">{v}</span>
                    </div>
                  ))}
                </div>
                {form.add_to_db && (
                  <div className="bg-amber-50 rounded-lg p-3 text-xs text-amber-700 font-600">
                    ⚡ 저장 시 기준코드 DB에 자동 등록됩니다
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['날짜','품명','기준코드','협력사','고객사','단가','수량','금액','유효기간'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-700 text-slate-400 text-[10px] uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentQuotes.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-slate-400">견적 이력이 없습니다</td></tr>
              ) : recentQuotes.map(q => (
                <tr key={q.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-500">{new Date(q.created_at).toLocaleDateString('ko-KR')}</td>
                  <td className="px-3 py-2 font-600 text-slate-800">{q.items?.name || q.item_name_temp || '-'}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{q.items?.std_code || '-'}</td>
                  <td className="px-3 py-2 text-slate-600">{q.vendors?.name || '-'}</td>
                  <td className="px-3 py-2 text-slate-500">{q.customers?.name || '-'}</td>
                  <td className="px-3 py-2 text-right font-600 text-slate-900">{q.unit_price ? Number(q.unit_price).toLocaleString() : '-'}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{q.qty || '-'}</td>
                  <td className="px-3 py-2 text-right font-600 text-slate-700">{q.unit_price && q.qty ? (q.unit_price * q.qty).toLocaleString() : '-'}</td>
                  <td className="px-3 py-2 text-slate-500">{q.valid_until || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
