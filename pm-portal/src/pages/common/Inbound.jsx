import { useState, useMemo, useEffect } from 'react'
import { refreshProcurement } from '../../lib/refresh'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useCustomers } from '../../hooks/useCustomers'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCanEdit } from '../../hooks/useProfile'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import * as XLSX from 'xlsx'

function todayStr() { return new Date().toISOString().split('T')[0] }
function monthAgoStr() {
  const d = new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().split('T')[0]
}

async function fetchVendors() {
  const { data } = await supabase.from('vendors').select('id,name').order('name')
  return data || []
}
async function fetchPendingPOs(customerId, vendorId) {
  const make = () => {
    let q = supabase.from('purchase_orders')
      .select('*, items!purchase_orders_item_id_fkey(std_code,name,unit,manufacturer,manufacturer_code), vendors(name), customers(name,code)')
      .eq('order_type','purchase').neq('status','완료')
    if (customerId) q = q.eq('customer_id', customerId)
    if (vendorId) q = q.eq('vendor_id', vendorId)
    return q.order('order_date', { ascending: true })
  }
  return await fetchAll(make)
}
async function fetchInboundHistory({ from, to, customerId, vendorId }) {
  // movement_date가 null인 경우 created_at 기준으로 대체 조회
  const { data, error } = await supabase.from('stock_movements')
    .select('*, items(std_code,name,unit,vendors(name)), customers(name,code)')
    .eq('movement_type','입고')
    .gte('movement_date', from)
    .lte('movement_date', to)
    .order('movement_date', { ascending: false })
    .limit(500)
  if (error) throw error
  let rows = (data||[]).map(r=>({
    ...r,
    movement_date: r.movement_date,
  }))
  if (customerId) rows = rows.filter(r=>r.customer_id===customerId)
  return rows
}

async function processInbound({ items, inboundData, note, inboundDate }) {
  // 입고 처리 전체를 Postgres 함수에서 트랜잭션으로 — 전부 성공 아니면 전부 취소(중복/부분반영 없음)
  const lines = items.map(item => {
    const qty = Number(inboundData[item.id]?.qty)
    if (!qty || qty <= 0) return null
    const up = inboundData[item.id]?.unit_price
    return { po_id: item.id, qty, unit_price: (up !== undefined && up !== '') ? Number(up) : null, item_id: item.item_id }
  }).filter(Boolean)
  if (!lines.length) return
  // RPC엔 기존 형식(po_id·qty·unit_price)만 전달
  const { error } = await supabase.rpc('pm_process_inbound', {
    p_lines: lines.map(({ item_id, ...l }) => l), p_note: note || null, p_date: inboundDate,
  })
  if (error) throw error
  // 입고 시 확정/수정된 단가를 최근 매입단가로 items.purchase_price에 반영 (입고가 발주단가보다 우선)
  const seen = {}
  for (const l of lines) {
    if (l.item_id && l.unit_price != null && l.unit_price > 0 && !seen[l.item_id]) {
      seen[l.item_id] = true
      await supabase.from('items').update({ purchase_price: l.unit_price }).eq('id', l.item_id)
    }
  }
}

// 발주외(구두발주·단건) 입고 — PO 없이 품목 직접 입고
async function processDirectInbound({ item_id, qty, unit_price, customer_id, memo, date }) {
  const { error } = await supabase.rpc('pm_direct_inbound', {
    p_item_id: item_id,
    p_qty: Number(qty),
    p_unit_price: (unit_price !== undefined && unit_price !== '') ? Number(unit_price) : null,
    p_customer_id: customer_id || null,
    p_vendor_note: memo || null,
    p_date: date,
  })
  if (error) throw error
}

const today = new Date().toISOString().split('T')[0]

export default function Inbound() {
  const qc = useQueryClient()
  const [tab, setTab] = useState('process') // process | direct | history
  // 발주외 입고 (단건)
  const [dItem, setDItem] = useState(null)      // 선택된 품목 {id,std_code,name,unit}
  const [dSearch, setDSearch] = useState('')
  const [dShowSug, setDShowSug] = useState(false)
  const [dQty, setDQty] = useState('')
  const [dPrice, setDPrice] = useState('')
  const [dCustomer, setDCustomer] = useState('')
  const [dMemo, setDMemo] = useState('')
  const [dDate, setDDate] = useState(todayStr())
  // 입고 처리
  const [selCustomer, setSelCustomer] = useState('')
  const [selVendor, setSelVendor] = useState('')
  const [checked, setChecked] = useState({})
  const [rowSearch, setRowSearch] = useState('')
  const [vendorText, setVendorText] = useState('')
  const [inboundData, setInboundData] = useState({})
  const [note, setNote] = useState('')
  const [inboundDate, setInboundDate] = useState(todayStr())
  const [result, setResult] = useState(null)
  const [sort, setSort] = useState({ key:'order_date', dir:'asc' })  // 입고처리 표 헤더 정렬
  // 입고 현황
  const [hFrom, setHFrom] = useState(monthAgoStr())
  const [hTo, setHTo] = useState(todayStr())
  const [hCustomer, setHCustomer] = useState('')
  const [hVendor, setHVendor] = useState('')
  const [hVendorText, setHVendorText] = useState('')
  const [hItem, setHItem] = useState('')
  const [hQuery, setHQuery] = useState({ from: monthAgoStr(), to: todayStr(), customerId:'', vendorId:'' })
  const [selHist, setSelHist] = useState(new Set())

  const { data: customers=[] } = useCustomers()
  // 발주외 품목 자동완성
  const [dDebounced, setDDebounced] = useState('')
  useEffect(()=>{ const t=setTimeout(()=>setDDebounced(dSearch),250); return ()=>clearTimeout(t) }, [dSearch])
  const { data: dSuggest=[] } = useQuery({
    queryKey:['directItemSuggest', dDebounced],
    queryFn: async () => {
      if (!dDebounced || dDebounced.trim().length < 2) return []
      const { data } = await supabase.from('items').select('id,std_code,name,unit,manufacturer_code')
        .or(`std_code.ilike.%${dDebounced}%,name.ilike.%${dDebounced}%,manufacturer_code.ilike.%${dDebounced}%`).limit(8)
      return data || []
    },
    enabled: dDebounced.trim().length >= 2,
  })
  const iCanEdit = useCanEdit()
  const guardEdit = () => { if (!iCanEdit) { toastError('열람 전용 계정입니다 — 수정 권한이 없습니다'); return false } return true }
  const directMut = useMutation({
    mutationFn: () => { if (!guardEdit()) throw new Error('__READONLY__'); return processDirectInbound({ item_id:dItem.id, qty:dQty, unit_price:dPrice, customer_id:dCustomer, memo:dMemo, date:dDate }) },
    onSuccess: () => {
      setResult(`발주외 입고 완료 — ${dItem.std_code} ${dQty}${dItem.unit||''}`)
      setDItem(null); setDSearch(''); setDQty(''); setDPrice(''); setDMemo('')
      refreshProcurement(qc)
    },
    onError: (e) => { if (e.message !== '__READONLY__') toastError('오류: ' + e.message) },
  })
  const { data: vendors=[] } = useQuery({ queryKey:['vendors'], queryFn:fetchVendors })
  const { data: pendingPOs=[], isLoading, refetch } = useQuery({
    queryKey:['pendingPOs',selCustomer],
    queryFn:()=>fetchPendingPOs(selCustomer||null, null),
  })
  const { data: history=[], isLoading: histLoading } = useQuery({
    queryKey:['inboundHistory', hQuery],
    queryFn:()=>fetchInboundHistory({ from:hQuery.from, to:hQuery.to, customerId:hQuery.customerId, vendorId:hQuery.vendorId }),
    enabled: tab==='history',
  })

  const inboundMut = useMutation({
    mutationFn: () => { if (!guardEdit()) throw new Error('__READONLY__'); return processInbound({ items: checkedRows, inboundData, note, inboundDate }) },
    onSuccess: () => {
      setResult(`입고 처리 완료 (${inboundDate}) — ${checkedRows.length}건`)
      setInboundData({}); setChecked({}); setNote('')
      refreshProcurement(qc); refetch()
    },
    onError: (e) => { if (e.message !== '__READONLY__') toastError('오류: ' + e.message) },
  })

  const delHistMut = useMutation({
    mutationFn: async (ids) => {
      if (!guardEdit()) throw new Error('__READONLY__')
      if (!guardEdit()) throw new Error('__READONLY__')
      const { error } = await supabase.rpc('pm_delete_movements', { p_ids: ids })
      if (error) throw error
    },
    onSuccess: () => {
      setSelHist(new Set())
      qc.invalidateQueries(['inboundHistory']); qc.invalidateQueries(['inventory'])
      qc.invalidateQueries(['purchase']); qc.invalidateQueries(['shortage'])
      qc.invalidateQueries(['pendingPOs']); refetch()
    },
    onError: (e) => { if (e.message !== '__READONLY__') toastError('삭제 오류: ' + e.message) },
  })
  const PROC_COLS = [
    { key:'order_date', label:'발주일자', get:po=>po.order_date||'', num:false },
    { key:'promise_date', label:'입고요청일', get:po=>po.promise_date||'', num:false },
    { key:'std_code', label:'기준코드·품명', get:po=>po.items?.std_code||'', num:false },
    { key:'mfg', label:'제조사·품번', get:po=>po.items?.manufacturer||'', num:false },
    { key:'vendor', label:'구매처', get:po=>po.vendors?.name||'', num:false },
    { key:'customer', label:'고객사', get:po=>po.customers?.code||po.customers?.name||'', num:false },
    { key:'qty_ordered', label:'발주', get:po=>po.qty_ordered||0, num:true },
    { key:'qty_received', label:'입고', get:po=>po.qty_received||0, num:true },
    { key:'qty_remaining', label:'잔량', get:po=>po.qty_remaining||0, num:true },
    { key:'unit_price', label:'발주단가', get:po=>po.unit_price||0, num:true },
    { key:'qty_input', label:'입고수량', sortable:false },
  ]
  function toggleSort(key) {
    setSort(s => s.key===key ? { key, dir: s.dir==='asc'?'desc':'asc' } : { key, dir:'asc' })
  }

  // 미입고 발주를 "품목 행"으로 나열 (검색 + 헤더 정렬) + 제조사/품번/코드/품명 검색
  const rows = useMemo(() => {
    const q = rowSearch.trim().toLowerCase()
    const vq = vendorText.trim().toLowerCase()
    let list = !q ? pendingPOs : pendingPOs.filter(po => {
      const it = po.items || {}
      return [it.std_code, it.name, it.manufacturer, it.manufacturer_code]
        .some(x => (x||'').toLowerCase().includes(q))
    })
    if (vq) list = list.filter(po => (po.vendors?.name||'').toLowerCase().includes(vq))
    const col = PROC_COLS.find(c => c.key === sort.key)
    if (col && col.get) {
      list = [...list].sort((a, b) => {
        const va = col.get(a), vb = col.get(b)
        const c = col.num ? (Number(va)||0) - (Number(vb)||0) : String(va).localeCompare(String(vb), 'ko')
        return sort.dir === 'asc' ? c : -c
      })
    }
    return list
  }, [pendingPOs, rowSearch, vendorText, sort])
  function toggleRow(po) {
    setChecked(prev => ({ ...prev, [po.id]: !prev[po.id] }))
    setInboundData(prev => prev[po.id] ? prev : ({ ...prev, [po.id]: { qty: po.qty_remaining||0, unit_price: po.unit_price||'' } }))
  }
  function toggleAll() {
    if (rows.length && rows.every(r => checked[r.id])) { setChecked({}) }
    else {
      const c = {}, d = { ...inboundData }
      rows.forEach(r => { c[r.id] = true; if (!d[r.id]) d[r.id] = { qty: r.qty_remaining||0, unit_price: r.unit_price||'' } })
      setChecked(c); setInboundData(d)
    }
  }
  function updateData(id, field, val) {
    setInboundData(prev => ({ ...prev, [id]: { ...prev[id], [field]: val } }))
  }

  const checkedRows = rows.filter(r => checked[r.id])
  const hasInput = checkedRows.some(r => inboundData[r.id]?.qty && Number(inboundData[r.id].qty) > 0)
  const histShown = (history||[]).filter(r => {
    const vq = hVendorText.trim().toLowerCase()
    const iq = hItem.trim().toLowerCase()
    const vname = (r.purchase_orders?.vendors?.name || r.items?.vendors?.name || '').toLowerCase()
    if (vq && !vname.includes(vq)) return false
    if (iq && !`${r.items?.std_code||''} ${r.items?.name||''}`.toLowerCase().includes(iq)) return false
    return true
  })
  const histTotal = histShown.reduce((a,r)=>a+r.qty,0)

  function exportHistory() {
    const data = histShown.map(r=>({
      '입고일':r.movement_date, '기준코드':r.items?.std_code, '품명':r.items?.name,
      '단위':r.items?.unit, '수량':r.qty, '발주번호':r.purchase_orders?.po_number||'',
      '구매처':r.purchase_orders?.vendors?.name||'', '고객사':r.purchase_orders?.customers?.name||'',
      '비고':r.note||'',
    }))
    const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),'입고현황')
    XLSX.writeFile(wb,`입고현황_${hQuery.from}_${hQuery.to}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {[['process','📥 입고 처리'],['direct','✍️ 발주외 입고'],['history','📋 입고 현황']].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${tab===k?'bg-white text-slate-900 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{l}</button>
        ))}
      </div>

      {tab==='process' && (
        <>
          <div className="flex items-end gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50 flex-wrap">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">고객사</label>
              <select value={selCustomer} onChange={e=>setSelCustomer(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="">전체</option>
                {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">구매처 검색</label>
              <input value={vendorText} onChange={e=>setVendorText(e.target.value)} placeholder="구매처명 입력"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">입고 날짜</label>
              <div className="flex items-center gap-2">
                <input type="date" value={inboundDate} onChange={e=>setInboundDate(e.target.value)}
                  className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"/>
                {inboundDate !== todayStr() && (
                  <button onClick={()=>setInboundDate(todayStr())} className="text-xs text-indigo-500 hover:text-indigo-700 font-semibold">오늘로</button>
                )}
              </div>
              {inboundDate !== todayStr() && <p className="text-xs text-amber-600 mt-1">⚠️ 오늘이 아닌 날짜</p>}
            </div>
            <div className="ml-auto text-xs text-slate-400 self-center">미입고 {rows.length}건{checkedRows.length>0 && ` · 선택 ${checkedRows.length}`}</div>
          </div>

          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 font-semibold flex items-center">
              ✅ {result}
              <button onClick={()=>setResult(null)} className="ml-auto text-emerald-400">✕</button>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">미입고 발주 — 들어온 품목 체크 후 일괄 입고</p>
              <input value={rowSearch} onChange={e=>setRowSearch(e.target.value)}
                placeholder="제조사·제조사품번·기준코드·품명 검색"
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
              <span className="ml-auto text-xs text-slate-400">정렬: {(PROC_COLS.find(c=>c.key===sort.key)?.label)||''} {sort.dir==='asc'?'▲':'▼'} · {rows.length}건</span>
            </div>

            {isLoading ? <div className="text-center py-8 text-slate-400 text-xs">불러오는 중...</div>
            : rows.length === 0
              ? <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-400 text-xs">
                  미입고 발주가 없습니다
                </div>
              : (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto max-h-[58vh] overflow-y-auto">
                    <table className="w-full text-xs whitespace-nowrap">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-slate-100 border-b border-slate-200 text-slate-500">
                          <th className="px-2 py-2 text-center">
                            <input type="checkbox" checked={rows.length>0 && rows.every(r=>checked[r.id])} onChange={toggleAll} />
                          </th>
                          {PROC_COLS.map(c=>(
                            <th key={c.key} onClick={c.sortable===false?undefined:()=>toggleSort(c.key)}
                              className={`px-3 py-2 text-left font-bold whitespace-nowrap ${c.sortable===false?'':'cursor-pointer select-none hover:text-indigo-600'}`}>
                              {c.label}
                              {sort.key===c.key && <span className="ml-0.5 text-indigo-500">{sort.dir==='asc'?'▲':'▼'}</span>}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(po=>{
                          const on = !!checked[po.id]
                          const delayed = po.promise_date && po.promise_date < today
                          return (
                            <tr key={po.id} onClick={()=>toggleRow(po)}
                              className={`border-b border-slate-100 cursor-pointer ${on?'bg-indigo-50':'hover:bg-slate-50'}`}>
                              <td className="px-2 py-2 text-center" onClick={e=>e.stopPropagation()}>
                                <input type="checkbox" checked={on} onChange={()=>toggleRow(po)} />
                              </td>
                              <td className="px-3 py-2 text-slate-500">{po.order_date||'-'}</td>
                              <td className="px-3 py-2 text-slate-500">{po.promise_date||'-'}{delayed && <span className="ml-1 text-red-500 font-bold">지연</span>}</td>
                              <td className="px-3 py-2">
                                <div className="font-mono text-indigo-600 truncate max-w-[160px]">{po.items?.std_code}</div>
                                <div className="text-[11px] text-slate-500 truncate max-w-[160px]">{po.items?.name||''}</div>
                              </td>
                              <td className="px-3 py-2">
                                <div className="text-slate-700 truncate max-w-[130px]">{po.items?.manufacturer||'-'}</div>
                                <div className="font-mono text-[11px] text-slate-400 truncate max-w-[130px]">{po.items?.manufacturer_code||''}</div>
                              </td>
                              <td className="px-3 py-2 text-slate-500">{po.vendors?.name||'-'}</td>
                              <td className="px-3 py-2 text-indigo-500 font-semibold">{po.customers?.code||po.customers?.name||'-'}</td>
                              <td className="px-3 py-2 text-right text-slate-600">{po.qty_ordered}</td>
                              <td className="px-3 py-2 text-right text-emerald-600">{po.qty_received}</td>
                              <td className="px-3 py-2 text-right font-bold text-slate-900">{po.qty_remaining}</td>
                              <td className="px-3 py-2" onClick={e=>e.stopPropagation()}>
                                <input type="number" min={0} value={inboundData[po.id]?.unit_price??''}
                                  onChange={e=>updateData(po.id,'unit_price',e.target.value)}
                                  placeholder={po.unit_price||'단가'} disabled={!on}
                                  className="w-24 px-2 py-1 text-xs border border-slate-200 rounded text-right disabled:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-500"/>
                              </td>
                              <td className="px-3 py-2" onClick={e=>e.stopPropagation()}>
                                <input type="number" min={0} value={inboundData[po.id]?.qty??''}
                                  onChange={e=>updateData(po.id,'qty',e.target.value)} disabled={!on}
                                  title={Number(inboundData[po.id]?.qty||0) > (po.qty_remaining||0) ? '잔량 초과 입고 (MOQ 등)' : ''}
                                  className={`w-20 px-2 py-1 text-xs border rounded text-right disabled:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${Number(inboundData[po.id]?.qty||0) > (po.qty_remaining||0) ? 'border-amber-400 text-amber-700 font-bold' : 'border-slate-200'}`}/>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center gap-3 flex-wrap">
                    <input value={note} onChange={e=>setNote(e.target.value)} placeholder="입고 비고 (선택)"
                      className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                    <p className="text-xs text-slate-400">입고일 <span className="font-semibold text-indigo-600">{inboundDate}</span> · 선택 <span className="font-semibold text-indigo-600">{checkedRows.length}</span>건</p>
                    <button onClick={()=>inboundMut.mutate()} disabled={inboundMut.isPending||!hasInput}
                      className="px-6 py-2 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
                      {inboundMut.isPending?'처리 중...':`✅ 선택 ${checkedRows.length}건 입고 처리`}
                    </button>
                  </div>
                </div>
              )
            }
          </div>
        </>
      )}

      {tab==='direct' && (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 max-w-2xl">
            <div>
              <p className="text-sm font-bold text-slate-700">✍️ 발주외 입고 (구두발주·단건)</p>
              <p className="text-[11px] text-slate-400 mt-0.5">PO 없이 품목을 직접 입고합니다. 재고가 바로 증가하고, 입고 현황에 "발주외"로 기록됩니다.</p>
            </div>

            {/* 품목 검색 (자동완성) */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">품목 <span className="text-rose-400">*</span></label>
              {dItem ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-indigo-200 rounded-lg">
                  <span className="font-mono text-xs text-indigo-600">{dItem.std_code}</span>
                  <span className="text-xs text-slate-600 truncate flex-1">{dItem.name}</span>
                  <button onClick={()=>{ setDItem(null); setDSearch('') }} className="text-xs text-slate-400 hover:text-rose-500">✕ 변경</button>
                </div>
              ) : (
                <div className="relative">
                  <input value={dSearch}
                    onChange={e=>{ setDSearch(e.target.value); setDShowSug(true) }}
                    onFocus={()=>setDShowSug(true)}
                    onBlur={()=>setTimeout(()=>setDShowSug(false),150)}
                    placeholder="기준코드·품명·제조사품번 검색 (2글자↑)"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
                  {dShowSug && dSuggest.length>0 && (
                    <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-72 overflow-y-auto">
                      {dSuggest.map(it=>(
                        <button key={it.id} onMouseDown={()=>{ setDItem(it); setDShowSug(false) }}
                          className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-slate-50 last:border-0">
                          <div className="font-mono text-xs text-indigo-600">{it.std_code}</div>
                          <div className="text-[11px] text-slate-500 truncate">{it.name}{it.manufacturer_code?` · ${it.manufacturer_code}`:''}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">입고 수량 <span className="text-rose-400">*</span></label>
                <input type="number" min={0} value={dQty} onChange={e=>setDQty(e.target.value)}
                  placeholder="0" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">단가 <span className="text-slate-300 font-normal">(선택)</span></label>
                <input type="number" min={0} value={dPrice} onChange={e=>setDPrice(e.target.value)}
                  placeholder="입력 시 매입단가 갱신" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">입고일</label>
                <input type="date" value={dDate} onChange={e=>setDDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">고객사 <span className="text-slate-300 font-normal">(선택)</span></label>
                <select value={dCustomer} onChange={e=>setDCustomer(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                  <option value="">-</option>
                  {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">메모 <span className="text-slate-300 font-normal">(구매처·사유 등)</span></label>
              <input value={dMemo} onChange={e=>setDMemo(e.target.value)}
                placeholder="예: OO상사 구두발주 / 긴급건" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" />
            </div>

            <button onClick={()=>directMut.mutate()}
              disabled={!dItem || !dQty || Number(dQty)<=0 || directMut.isPending}
              className="w-full px-4 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
              {directMut.isPending?'처리 중...':'📥 발주외 입고 처리'}
            </button>
          </div>

          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 font-semibold flex items-center max-w-2xl">
              ✅ {result}
              <button onClick={()=>setResult(null)} className="ml-auto text-emerald-400">✕</button>
            </div>
          )}
        </>
      )}

      {tab==='history' && (
        <div className="space-y-4">
          <div className="flex items-end gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50 flex-wrap">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">시작일</label>
              <input type="date" value={hFrom} onChange={e=>setHFrom(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">종료일</label>
              <input type="date" value={hTo} onChange={e=>setHTo(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">고객사</label>
              <select value={hCustomer} onChange={e=>setHCustomer(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="">전체</option>
                {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">구매처 검색</label>
              <input value={hVendorText} onChange={e=>setHVendorText(e.target.value)} placeholder="구매처명 입력"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">품번 검색</label>
              <input value={hItem} onChange={e=>setHItem(e.target.value)} placeholder="기준코드·품명"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>
            <button onClick={()=>setHQuery({from:hFrom,to:hTo,customerId:hCustomer,vendorId:null})}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">조회</button>
            {histShown.length>0&&(
              <button onClick={exportHistory}
                className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">📥 엑셀</button>
            )}
            {selHist.size>0&&(
              <button onClick={()=>{
                  if(window.confirm(`선택한 입고 이력 ${selHist.size}건을 삭제할까요?\n재고와 입고수량(qty_received)도 그만큼 되돌립니다.`))
                    delHistMut.mutate([...selHist])
                }} disabled={delHistMut.isPending}
                className="px-3 py-2 text-xs font-bold rounded-lg border border-red-200 text-red-600 bg-white hover:bg-red-50 disabled:opacity-40">
                🗑 선택 {selHist.size}건 삭제</button>
            )}
            <div className="ml-auto text-xs text-slate-400 self-center">
              총 {histShown.length}건 / {histTotal.toLocaleString()} {history[0]?.items?.unit||''}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">총 입고 건수</p>
              <p className="text-xl font-bold text-slate-900">{histShown.length}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-bold text-emerald-500 uppercase tracking-wide mb-1">총 입고 수량</p>
              <p className="text-xl font-bold text-emerald-700">{histTotal.toLocaleString()}</p>
            </div>
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-xs font-bold text-indigo-400 uppercase tracking-wide mb-1">품목 수</p>
              <p className="text-xl font-bold text-indigo-700">{new Set(histShown.map(r=>r.item_id)).size}</p>
            </div>
          </div>

          {histLoading ? <div className="text-center py-10 text-slate-400 text-sm">불러오는 중...</div> : (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2.5 w-8">
                      <input type="checkbox"
                        checked={histShown.length>0 && selHist.size===histShown.length}
                        onChange={e=>setSelHist(e.target.checked ? new Set(histShown.map(r=>r.id)) : new Set())}/>
                    </th>
                    {['입고일','기준코드','품명','수량','단위','발주번호','상위품목','구매처','고객사','비고'].map(h=>(
                      <th key={h} className="px-3 py-2.5 text-left font-bold text-slate-400 text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {histShown.length===0
                      ? <tr><td colSpan={11} className="text-center py-10 text-slate-400">입고 이력이 없습니다</td></tr>
                      : histShown.map(r=>(
                        <tr key={r.id} className={`border-b border-slate-100 hover:bg-slate-50 ${selHist.has(r.id)?'bg-red-50/40':''}`}>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" checked={selHist.has(r.id)}
                              onChange={e=>{ const n=new Set(selHist); e.target.checked?n.add(r.id):n.delete(r.id); setSelHist(n) }}/>
                          </td>
                          <td className="px-3 py-2 font-semibold text-slate-700">{r.movement_date}</td>
                          <td className="px-3 py-2 font-mono text-xs text-indigo-600">{r.items?.std_code}</td>
                          <td className="px-3 py-2 font-semibold text-slate-800">{r.items?.name}</td>
                          <td className="px-3 py-2 text-right font-bold text-emerald-700">{r.qty}</td>
                          <td className="px-3 py-2 text-slate-500">{r.items?.unit}</td>
                          <td className="px-3 py-2">{r.po_id ? <span className="font-mono text-slate-500">{r.purchase_orders?.po_number||'-'}</span> : <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 text-[10px] font-bold">발주외</span>}</td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-400">{r.purchase_orders?.projects?.code||'-'}</td>
                          <td className="px-3 py-2 text-slate-500">{r.items?.vendors?.name||'-'}</td>
                          <td className="px-3 py-2 text-slate-500">{r.customers?.name||'-'}</td>
                          <td className="px-3 py-2 text-slate-400">{r.memo||r.note||'-'}</td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
