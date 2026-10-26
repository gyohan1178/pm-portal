import { useState, useEffect, useRef } from 'react'
import PageHead from '../../components/PageHead'
import ItemPicker from '../../components/ItemPicker'
import VendorPicker from '../../components/VendorPicker'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { todayISO } from '../../lib/utils'
import { ilikeAny } from '../../lib/pgFilter'
import { ltWeeksOf, saveQuotes } from '../../lib/quoteBulk'
import QuoteBulk from './QuoteBulk'
import QuotePriceReqs, { PRICE_REQ_KEY } from './QuotePriceReqs'

async function searchItems(keyword) {
  if (!keyword || keyword.length < 1) return []
  const { data } = await supabase.from('items')
    .select('id,std_code,name,type,unit,lt_weeks,purchase_price,manufacturer')
    .or(ilikeAny(['name', 'std_code'], keyword))
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

// 한 품목 저장 — 여러 품목과 같은 저장 함수 (납기 · MOQ · 매입가 갱신 · LT 반영)
async function saveQuote({ itemId, vendorId, unitPrice, quoteDate, validUntil, memo, leadTime, moq, updatePrice, applyLt }) {
  return saveQuotes([{ item_id: itemId, unit_price: unitPrice, lead_time: leadTime, moq, updatePrice, ltWeeks: applyLt ? ltWeeksOf(leadTime) : null }],
    { vendorId, quoteDate, validUntil, memo })
}

export default function Quote() {
  const [mode, setMode] = useState('one')   // one 한 품목 · bulk 여러 품목 (v4.86.0)
  // 영업 견적 단가 요청에서 「단가 넣기」 → 한 품목 입력칸에 채움 (v4.99.2)
  const [pick, setPick] = useState(null)      // { item, rfqs, n }
  return (
    <div className="space-y-4">
      <PageHead crumb="기초자료" title="품목 단가 등록"
        desc="협력사 견적 단가를 등록합니다. 한 품목씩 넣거나, 견적서 표를 붙여넣어 여러 품목을 한 번에 등록합니다. 저장하면 견적 이력이 남고, 고른 품목은 「최근 매입가」도 바뀝니다."></PageHead>

      <QuotePriceReqs onPick={(item, rfqs) => { setMode('one'); setPick({ item, rfqs, n: Date.now() }) }} />

      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit" data-quote-mode>
        {[['one', '한 품목'], ['bulk', '📋 여러 품목 (견적서 붙여넣기)']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setMode(k)} data-quote-tab={k}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-md ${mode === k ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
        ))}
      </div>
      {mode === 'bulk' ? <QuoteBulk /> : <QuoteOne pick={pick} />}
    </div>
  )
}

function QuoteOne({ pick }) {
  const qc = useQueryClient()
  const formRef = useRef(null)
  const [keyword, setKeyword] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [selItem, setSelItem] = useState(null)
  const [selVendor, setSelVendor] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [quoteDate, setQuoteDate] = useState(todayISO())
  const [validUntil, setValidUntil] = useState('')
  const [memo, setMemo] = useState('')
  const [leadTime, setLeadTime] = useState('')
  const [moq, setMoq] = useState('')
  const [updatePrice, setUpdatePrice] = useState(true)
  const [applyLt, setApplyLt] = useState(false)
  const [searching, setSearching] = useState(false)
  const [saved, setSaved] = useState(false)

  const lt = ltWeeksOf(leadTime)
  const { data: history=[], refetch: refetchHistory } = useQuery({
    queryKey:['quoteHistory', selItem?.id],
    queryFn:()=>fetchQuoteHistory(selItem?.id),
    enabled:!!selItem?.id,
  })

  const saveMut = useMutation({
    mutationFn: () => saveQuote({ itemId:selItem?.id, vendorId:selVendor, unitPrice, quoteDate, validUntil, memo, leadTime, moq, updatePrice, applyLt }),
    onSuccess: (r) => {
      setSaved(r || true)
      if (r?.fallback) toast('납기 · MOQ 는 메모에 적었습니다 — DB 설정(품목단가등록_261023.sql) 뒤에는 따로 저장됩니다')
      refetchHistory()
      qc.invalidateQueries(['items'])
      qc.invalidateQueries({ queryKey: PRICE_REQ_KEY })   // 영업 단가 요청 목록에 「등록됨 ✓」
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

  // 영업 단가 요청 「단가 넣기」 — 그 품목을 고르고 메모에 견적 건 이름을 남김
  useEffect(() => {
    if (!pick?.item) return
    selectItem(pick.item)
    setKeyword(pick.item.name || pick.item.std_code || '')
    const t = [...new Set((pick.rfqs || []).map((r) => r.title).filter(Boolean))].join(' / ')
    if (t) setMemo(`영업 견적 요청 — ${t}`)
    setTimeout(() => formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 50)
  }, [pick?.n]) // eslint-disable-line react-hooks/exhaustive-deps

  const priceChange = selItem && unitPrice && Number(unitPrice) !== selItem.purchase_price
    ? Number(unitPrice) - (selItem.purchase_price||0)
    : 0

  return (
    <div className="space-y-4" ref={formRef}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
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
                <button onClick={()=>{setSelItem(null);setKeyword('');setUnitPrice('');setLeadTime('');setMoq('');setApplyLt(false)}} className="text-xs text-slate-400 hover:text-slate-600">✕ 초기화</button>
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
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">납기</label>
                  <input data-quote-lead value={leadTime} onChange={e=>setLeadTime(e.target.value)} placeholder="예) 2~3주"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                  <p className="text-[10px] text-slate-400 mt-0.5">「2~3주」「6~8주」「재고」처럼 견적서 그대로</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">MOQ</label>
                  <input data-quote-moq type="number" value={moq} onChange={e=>setMoq(e.target.value)} placeholder="최소 주문 수량"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-500 mb-1">메모</label>
                  <input value={memo} onChange={e=>setMemo(e.target.value)} placeholder="메모"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-4 flex-wrap text-xs font-semibold text-slate-600">
                  <label className="inline-flex items-center gap-1.5"><input type="checkbox" data-quote-upd checked={updatePrice} onChange={e=>setUpdatePrice(e.target.checked)} /> 최근 매입가 갱신</label>
                  <label className={`inline-flex items-center gap-1.5 ${lt ? '' : 'opacity-40'}`}><input type="checkbox" data-quote-lt checked={applyLt && !!lt} disabled={!lt} onChange={e=>setApplyLt(e.target.checked)} /> 품목 LT(주)도 {lt ? `${lt}주로` : '반영'}{selItem.lt_weeks ? <span className="font-normal text-slate-400"> (지금 {selItem.lt_weeks}주)</span> : null}</label>
                </div>
                <p className="text-[10px] text-slate-400">LT 는 납기의 큰 숫자로 (2~3주 → 3주 · 6~8주 → 8주) — 부족자재 · 발주 납기 계산에 쓰입니다</p>
              </div>

              {saved && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-700 font-semibold">
                  ✅ 견적 저장 완료{saved.priced ? ' · 최근 매입가 갱신됨' : ''}{saved.lt ? ' · LT 반영됨' : ''}
                </div>
              )}

              <button data-quote-save onClick={()=>saveMut.mutate()}
                disabled={!unitPrice||saveMut.isPending}
                className="w-full py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                {saveMut.isPending?'저장 중...':updatePrice?'💾 견적 저장 + 매입가 갱신':'💾 견적 저장 (매입가 그대로)'}
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
              <div className="rounded-xl border border-slate-200 overflow-x-auto">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <p className="text-xs font-bold text-slate-600">견적 이력</p>
                </div>
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2 text-left font-bold text-slate-400">견적일</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-400">협력사</th>
                    <th className="px-3 py-2 text-right font-bold text-slate-400">단가</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-400">납기</th>
                    <th className="px-3 py-2 text-right font-bold text-slate-400">MOQ</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-400">유효기간</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-400">메모</th>
                  </tr></thead>
                  <tbody>
                    {history.length===0 ? (
                      <tr><td colSpan={7} className="text-center py-6 text-slate-400">이력 없음</td></tr>
                    ) : history.map((h,i)=>(
                      <tr key={h.id} className={`border-b border-slate-100 ${i===0?'bg-indigo-50/30':''}`}>
                        <td className="px-3 py-2 text-slate-600">{h.quote_date}</td>
                        <td className="px-3 py-2 text-slate-600">{h.vendors?.name||'-'}</td>
                        <td className="px-3 py-2 text-right font-bold text-slate-900">{Number(h.unit_price).toLocaleString()}원</td>
                        <td className="px-3 py-2 text-slate-600">{h.lead_time||'-'}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{Number(h.moq)>0?Number(h.moq).toLocaleString():'-'}</td>
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
