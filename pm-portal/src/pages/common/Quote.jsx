import { useState } from 'react'
import ItemPicker from '../../components/ItemPicker'
import VendorPicker from '../../components/VendorPicker'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

async function searchItems(keyword) {
  if (!keyword || keyword.length < 1) return []
  const { data } = await supabase.from('items')
    .select('id,std_code,name,type,unit,lt_weeks,purchase_price,manufacturer')
    .or(`name.ilike.%${keyword}%,std_code.ilike.%${keyword}%`)
    .limit(10)
  return data || []
}

async function fetchQuoteHistory(itemId) {
  if (!itemId) return []
  const { data } = await supabase.from('quotes')
    .select('*, vendors(name)')
    .eq('item_id', itemId)
    .order('quote_date', { ascending: false })
    .limit(10)
  return data || []
}

async function saveQuote({ itemId, vendorId, unitPrice, quoteDate, validUntil, memo }) {
  const { error } = await supabase.from('quotes').insert({
    item_id: itemId,
    vendor_id: vendorId || null,
    unit_price: Number(unitPrice),
    quote_date: quoteDate,
    valid_until: validUntil || null,
    memo: memo || null,
  })
  if (error) throw error
  // 기준코드 매입가 갱신
  const { error: itemErr } = await supabase.from('items')
    .update({ purchase_price: Number(unitPrice) })
    .eq('id', itemId)
  if (itemErr) throw itemErr
}

export default function Quote() {
  const qc = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [selItem, setSelItem] = useState(null)
  const [selVendor, setSelVendor] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [quoteDate, setQuoteDate] = useState(new Date().toISOString().split('T')[0])
  const [validUntil, setValidUntil] = useState('')
  const [memo, setMemo] = useState('')
  const [searching, setSearching] = useState(false)
  const [saved, setSaved] = useState(false)

  const { data: history=[], refetch: refetchHistory } = useQuery({
    queryKey:['quoteHistory', selItem?.id],
    queryFn:()=>fetchQuoteHistory(selItem?.id),
    enabled:!!selItem?.id,
  })

  const saveMut = useMutation({
    mutationFn: () => saveQuote({ itemId:selItem?.id, vendorId:selVendor, unitPrice, quoteDate, validUntil, memo }),
    onSuccess: () => {
      setSaved(true)
      refetchHistory()
      qc.invalidateQueries(['items'])
      setTimeout(()=>setSaved(false), 3000)
    },
    onError: (e) => toastError('오류: ' + e.message),
  })

  async function handleSearch() {
    if (!keyword.trim()) return
    setSearching(true)
    const results = await searchItems(keyword)
    setSearchResults(results)
    setSearching(false)
  }

  function selectItem(item) {
    setSelItem(item)
    setUnitPrice(item.purchase_price || '')
    setSearchResults([])
    setKeyword(item.name)
  }

  const priceChange = selItem && unitPrice && Number(unitPrice) !== selItem.purchase_price
    ? Number(unitPrice) - (selItem.purchase_price||0)
    : 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-6">
        {/* 왼쪽: 견적 입력 */}
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <p className="text-xs font-bold text-slate-700">품목 검색</p>
            <ItemPicker value={keyword} onChange={setKeyword} onSelect={selectItem}
              placeholder="품명·기준코드·제조사품번" />
          </div>

          {selItem && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-700">견적 입력</p>
                <button onClick={()=>{setSelItem(null);setKeyword('');setUnitPrice('')}} className="text-xs text-slate-400 hover:text-slate-600">✕ 초기화</button>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1">
                <p className="text-xs font-bold text-slate-800">{selItem.name}</p>
                <p className="text-xs text-slate-400 font-mono">{selItem.std_code}</p>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-xs text-slate-500">현재 매입가</span>
                  <span className="text-sm font-bold text-slate-900">
                    {selItem.purchase_price ? `${Number(selItem.purchase_price).toLocaleString()}원` : '미등록'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">협력사</label>
                  <VendorPicker value={selVendor} onChange={id=>setSelVendor(id)} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">견적단가 *</label>
                  <div className="relative">
                    <input type="number" value={unitPrice} onChange={e=>setUnitPrice(e.target.value)}
                      placeholder="단가 입력"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                    {priceChange !== 0 && (
                      <span className={`absolute right-2 top-2.5 text-xs font-bold ${priceChange>0?'text-red-500':'text-emerald-500'}`}>
                        {priceChange>0?'+':''}{priceChange.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">견적일</label>
                  <input type="date" value={quoteDate} onChange={e=>setQuoteDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">유효기간</label>
                  <input type="date" value={validUntil} onChange={e=>setValidUntil(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-500 mb-1">메모</label>
                  <input value={memo} onChange={e=>setMemo(e.target.value)} placeholder="메모"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                </div>
              </div>

              {saved && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700 font-semibold">
                  ✅ 견적 저장 완료 · 기준코드 매입가 갱신됨
                </div>
              )}

              <button onClick={()=>saveMut.mutate()}
                disabled={!unitPrice||saveMut.isPending}
                className="w-full py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                {saveMut.isPending?'저장 중...':'💾 견적 저장 + 매입가 갱신'}
              </button>
            </div>
          )}
        </div>

        {/* 오른쪽: 견적 이력 & 요약 */}
        <div className="space-y-4">
          {selItem ? (
            <>
              {/* 기존 단가 요약 */}
              <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                <p className="text-xs font-bold text-slate-700">기존 견적 요약</p>
                {history.length === 0 ? (
                  <p className="text-xs text-slate-400">견적 이력이 없습니다</p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-slate-400 mb-1">최저가</p>
                        <p className="text-sm font-bold text-emerald-600">{Math.min(...history.map(h=>h.unit_price)).toLocaleString()}원</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-slate-400 mb-1">최고가</p>
                        <p className="text-sm font-bold text-red-600">{Math.max(...history.map(h=>h.unit_price)).toLocaleString()}원</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-xs text-slate-400 mb-1">평균가</p>
                        <p className="text-sm font-bold text-slate-700">{Math.round(history.reduce((a,h)=>a+h.unit_price,0)/history.length).toLocaleString()}원</p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-400">최근 {history.length}건 기준</p>
                  </>
                )}
              </div>

              {/* 견적 이력 */}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <p className="text-xs font-bold text-slate-600">견적 이력</p>
                </div>
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2 text-left font-bold text-slate-400">견적일</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-400">협력사</th>
                    <th className="px-3 py-2 text-right font-bold text-slate-400">단가</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-400">유효기간</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-400">메모</th>
                  </tr></thead>
                  <tbody>
                    {history.length===0 ? (
                      <tr><td colSpan={5} className="text-center py-6 text-slate-400">이력 없음</td></tr>
                    ) : history.map((h,i)=>(
                      <tr key={h.id} className={`border-b border-slate-100 ${i===0?'bg-indigo-50/30':''}`}>
                        <td className="px-3 py-2 text-slate-600">{h.quote_date}</td>
                        <td className="px-3 py-2 text-slate-600">{h.vendors?.name||'-'}</td>
                        <td className="px-3 py-2 text-right font-bold text-slate-900">{Number(h.unit_price).toLocaleString()}원</td>
                        <td className="px-3 py-2 text-slate-400">{h.valid_until||'-'}</td>
                        <td className="px-3 py-2 text-slate-400">{h.memo||'-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-400">
              <p className="text-2xl mb-2">🧾</p>
              <p className="text-sm">품목을 검색하면 기존 견적 요약이 나타납니다</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
