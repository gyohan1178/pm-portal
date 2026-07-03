import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { ResizableTable } from '../../components/ResizableTable'
import * as XLSX from 'xlsx'
import CustomerTabs from '../../components/CustomerTabs'

function monthAgoStr() {
  const d = new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().split('T')[0]
}

async function fetchCustomer(code) {
  const { data } = await supabase.from('customers').select('id,name').eq('code', code).single()
  return data
}
async function fetchVendors() {
  const { data } = await supabase.from('vendors').select('id,name,ecount_code').order('name')
  return data || []
}
async function fetchPurchases(csId) {
  if (!csId) return []
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*, items!purchase_orders_item_id_fkey(std_code,name,type,lt_weeks,manufacturer,manufacturer_code), vendors(name,ecount_code), projects(code,name)')
    .eq('customer_id', csId).eq('order_type','purchase').neq('status','완료')
    .order('promise_date', { ascending: true })
  if (error) throw error
  return (data||[]).map(p=>({ ...p, isDelayed: p.promise_date && p.promise_date < today }))
}
async function fetchPurchaseHistory(csId, from, to) {
  if (!csId) return []
  const { data, error } = await supabase.from('stock_movements')
    .select('*, items(std_code,name,unit), purchase_orders(po_number,unit_price,vendor_id,project_id,vendors(name),projects(code,name))')
    .eq('movement_type','입고')
    .gte('created_at', from + 'T00:00:00')
    .lte('created_at', to + 'T23:59:59')
    .order('created_at', { ascending: false })
    .limit(300)
  if (error) throw error
  // customer_id 필터 (purchase_orders 통해서)
  const poIds = (data||[]).filter(r=>r.purchase_orders).map(r=>r.purchase_orders)
  // customer_id 직접 필터 안 되므로 별도 조회
  const { data: myPOs } = await supabase.from('purchase_orders').select('id').eq('customer_id', csId).eq('order_type','purchase')
  const myPOIds = new Set((myPOs||[]).map(p=>p.id))
  return (data||[]).filter(r=>myPOIds.has(r.po_id)).map(r=>({
    ...r,
    movement_date: r.movement_date || r.created_at?.split('T')[0],
    supply: r.qty * (r.purchase_orders?.unit_price||0),
  }))
}

async function genPoNumber() {
  const d = new Date()
  const yy = String(d.getFullYear()).slice(2)
  const mm = String(d.getMonth()+1).padStart(2,'0')
  const dd = String(d.getDate()).padStart(2,'0')
  const prefix = `JS-${yy}${mm}${dd}-`
  const { data } = await supabase.from('purchase_orders').select('po_number').like('po_number',`${prefix}%`)
  const nums = (data||[]).map(r=>parseInt(r.po_number?.replace(prefix,''))||0)
  return `${prefix}${String((nums.length?Math.max(...nums):0)+1).padStart(2,'0')}`
}

function exportEcount(items, vendors) {
  const vendorMap = Object.fromEntries(vendors.map(v=>[v.id, v]))
  const today = new Date()
  const yyyymmdd = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`
  const headers = ['일자','순번','납기일자','거래처코드','거래처명','참조','담당자','거래유형','입고창고','통화','환율','프로젝트','배송지','메모','품목코드','품목명','규격','수량','단가','외화금액','공급가액','부가세','적요']
  const rows = items.map((po, i) => {
    const vendor = po.vendor_id ? vendorMap[po.vendor_id] : null
    const qty = po.qty_ordered||0, price = po.unit_price||0
    const supply = Math.round(qty*price), vat = Math.round(supply*0.1)
    return [yyyymmdd, i+1, po.promise_date?.replace(/-/g,'')||'', vendor?.ecount_code||'', vendor?.name||'', '','','','','','','','', po.memo||'', po.items?.std_code||'', po.items?.name||'', '', qty, price, '', supply, vat, '']
  })
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  ws['!cols'] = headers.map(()=>({width:14}))
  XLSX.utils.book_append_sheet(wb, ws, '발주서')
  XLSX.writeFile(wb, `이카운트발주서_${yyyymmdd}.xlsx`)
}

const PO_COLS = [
  {key:'check',         label:'',         defaultWidth:36},
  {key:'po_number',     label:'발주번호', defaultWidth:100},
  {key:'order_date',     label:'발주일자', defaultWidth:84},
  {key:'std_code',      label:'기준코드·품명', defaultWidth:150},
  {key:'mfg',           label:'제조사·품번', defaultWidth:120},
  {key:'type',          label:'구분',     defaultWidth:55},
  {key:'parent',        label:'상위품목', defaultWidth:84},
  {key:'lt',            label:'LT',       defaultWidth:45},
  {key:'qty_ordered',   label:'발주량',   defaultWidth:60},
  {key:'qty_received',  label:'입고',     defaultWidth:50},
  {key:'qty_remaining', label:'미입고',   defaultWidth:55},
  {key:'unit_price',    label:'단가',     defaultWidth:75},
  {key:'supply',        label:'공급가',   defaultWidth:80},
  {key:'promise_date',  label:'납기약속일',defaultWidth:84},
  {key:'vendor',        label:'구매처',   defaultWidth:80},
  {key:'status',        label:'상태',     defaultWidth:65},
  {key:'actions',       label:'',         defaultWidth:80},
]

const HIST_COLS = [
  {key:'date',    label:'입고일',   defaultWidth:90},
  {key:'std_code',label:'기준코드', defaultWidth:90},
  {key:'name',    label:'품명',     defaultWidth:160},
  {key:'qty',     label:'수량',     defaultWidth:60},
  {key:'unit',    label:'단위',     defaultWidth:45},
  {key:'unit_price',label:'단가',   defaultWidth:75},
  {key:'supply',  label:'공급가',   defaultWidth:85},
  {key:'po_number',label:'발주번호',defaultWidth:110},
  {key:'parent',  label:'상위품목', defaultWidth:90},
  {key:'vendor',  label:'구매처',   defaultWidth:80},
]

const EMPTY = { po_number:'', type:'자재', qty_ordered:'', promise_date:'', unit_price:'', memo:'' }

export default function PurchasePage() {
  const { customerId: csCode } = useParams()
  const qc = useQueryClient()
  const [tab, setTab] = useState('po') // po | history
  const [typeTab, setTypeTab] = useState('전체')
  const [search, setSearch] = useState('')  // 거래처·제조사·품번 검색
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [itemSearch, setItemSearch] = useState('')
  const [itemResults, setItemResults] = useState([])
  const [selItem, setSelItem] = useState(null)
  const [selVendor, setSelVendor] = useState('')
  const [checked, setChecked] = useState({})
  const [bulkPo, setBulkPo] = useState('')
  // 현황
  const [hFrom, setHFrom] = useState(monthAgoStr())
  const [hTo, setHTo] = useState(new Date().toISOString().split('T')[0])
  const [hQuery, setHQuery] = useState({ from:monthAgoStr(), to:new Date().toISOString().split('T')[0] })

  const { data: cs } = useQuery({ queryKey:['cs',csCode], queryFn:()=>fetchCustomer(csCode) })
  const { data: vendors=[] } = useQuery({ queryKey:['vendors'], queryFn:fetchVendors })
  const { data: purchases=[], isLoading, error } = useQuery({
    queryKey:['purchase',cs?.id], queryFn:()=>fetchPurchases(cs?.id), enabled:!!cs?.id,
  })
  const { data: history=[], isLoading:histLoading } = useQuery({
    queryKey:['purchaseHist',cs?.id,hQuery],
    queryFn:()=>fetchPurchaseHistory(cs?.id, hQuery.from, hQuery.to),
    enabled:!!cs?.id && tab==='history',
  })

  const saveMut = useMutation({
    mutationFn: async (data) => {
      const poNum = data.po_number?.trim() || null
      const payload = { vendor_id:selVendor||null, po_number:poNum, type:data.type, qty_ordered:Number(data.qty_ordered), promise_date:data.promise_date||null, unit_price:data.unit_price?Number(data.unit_price):null, memo:data.memo||null }
      if (editId) { const{error}=await supabase.from('purchase_orders').update(payload).eq('id',editId); if(error) throw error }
      else { const{error}=await supabase.from('purchase_orders').insert({...payload,customer_id:cs?.id,item_id:selItem?.id,order_type:'purchase',qty_received:0,status:'진행중'}); if(error) throw error }
    },
    onSuccess:()=>{ qc.invalidateQueries(['purchase']); setForm(EMPTY); setSelItem(null); setSelVendor(''); setShowForm(false); setEditId(null) },
    onError:(e)=>alert('오류: '+e.message),
  })
  const deleteMut = useMutation({
    mutationFn:async(id)=>{ const{error}=await supabase.from('purchase_orders').delete().eq('id',id); if(error) throw error },
    onSuccess:()=>qc.invalidateQueries(['purchase']),
  })
  const bulkPoMut = useMutation({
    mutationFn:async({ids,poNo})=>{ const{error}=await supabase.from('purchase_orders').update({po_number:poNo}).in('id',ids); if(error) throw error },
    onSuccess:()=>{ qc.invalidateQueries(['purchase']); setBulkPo(''); setChecked({}) },
    onError:(e)=>alert('오류: '+e.message),
  })

  function handleEdit(p) {
    setForm({po_number:p.po_number||'',type:p.type,qty_ordered:p.qty_ordered,promise_date:p.promise_date||'',unit_price:p.unit_price||'',memo:p.memo||''})
    setSelVendor(p.vendor_id||''); setSelItem(p.items?{id:p.item_id,name:p.items.name,std_code:p.items.std_code}:null)
    setItemSearch(p.items?.name||''); setEditId(p.id); setShowForm(true)
  }
  async function searchItems(val) {
    setItemSearch(val)
    if(val.length<1){setItemResults([]);return}
    const{data}=await supabase.from('items').select('id,std_code,name,type,lt_weeks,vendor_id,manufacturer,manufacturer_code,vendors(name)').or(`name.ilike.%${val}%,std_code.ilike.%${val}%,manufacturer.ilike.%${val}%,manufacturer_code.ilike.%${val}%`).limit(8)
    setItemResults(data||[])
  }

  const q = search.trim().toLowerCase()
  const filtered = purchases.filter(p => {
    if (typeTab !== '전체' && p.type !== typeTab) return false
    if (!q) return true
    const it = p.items || {}
    return [p.po_number, it.std_code, it.name, it.manufacturer, it.manufacturer_code, p.vendors?.name, p.projects?.code]
      .some(x => (x || '').toLowerCase().includes(q))
  })
  const today = new Date().toISOString().split('T')[0]
  const checkedPOs = filtered.filter(p=>checked[p.id])
  const histTotalSupply = history.reduce((a,r)=>a+(r.supply||0),0)
  const f = k => e => setForm(prev=>({...prev,[k]:e.target.value}))

  function exportHistory() {
    const data = history.map(r=>({
      '입고일':r.movement_date,'기준코드':r.items?.std_code,'품명':r.items?.name,
      '수량':r.qty,'단위':r.items?.unit,'단가':r.purchase_orders?.unit_price||0,
      '공급가':r.supply||0,'발주번호':r.purchase_orders?.po_number||'',
      '상위품목':r.purchase_orders?.projects?.code||'','구매처':r.purchase_orders?.vendors?.name||'',
    }))
    const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),'구매현황')
    XLSX.writeFile(wb,`구매현황_${hQuery.from}_${hQuery.to}.xlsx`)
  }

  if (error) return <div className="text-center py-12 text-red-500 text-sm">오류: {error.message}</div>

  return (
    <div className="space-y-4">
      <CustomerTabs />
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {[['po','📋 구매발주'],['history','📊 구매현황']].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${tab===k?'bg-white text-slate-900 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{l}</button>
          ))}
        </div>
        {tab==='po' && <>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {['전체','가공','자재'].map(t=>(
              <button key={t} onClick={()=>setTypeTab(t)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${typeTab===t?'bg-white text-slate-900 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{t}</button>
            ))}
          </div>
          <div className="relative">
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="거래처·제조사·품번·품명 검색"
              className="w-56 pl-8 pr-7 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
            {search&&<button onClick={()=>setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">✕</button>}
          </div>
          <div className="flex-1"/>
          {checkedPOs.length>0&&(
            <div className="inline-flex items-center gap-1">
              <input value={bulkPo} onChange={e=>setBulkPo(e.target.value)} placeholder="이카운트 발주번호"
                className="w-36 px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
              <button onClick={()=>bulkPoMut.mutate({ids:checkedPOs.map(p=>p.id),poNo:bulkPo.trim()})} disabled={!bulkPo.trim()||bulkPoMut.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40">
                🔖 발주번호 부여 ({checkedPOs.length})
              </button>
            </div>
          )}
          {checkedPOs.length>0&&(
            <button onClick={()=>exportEcount(checkedPOs,vendors)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">
              📑 이카운트 발주서 ({checkedPOs.length}건)
            </button>
          )}
          <button onClick={()=>{setForm(EMPTY);setEditId(null);setSelItem(null);setSelVendor('');setItemSearch('');setShowForm(!showForm)}}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
            ➕ 구매발주 추가
          </button>
        </>}
      </div>

      {tab==='po' && (
        <>
          {showForm&&(
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
              <p className="text-xs font-bold text-slate-700">{editId?'구매발주 수정':'구매발주 등록'} <span className="text-slate-400 font-normal">· 발주번호는 이카운트 값 직접 입력(체크 후 일괄부여도 가능)</span></p>
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-2 relative">
                  <label className="block text-xs font-bold text-slate-500 mb-1">품목 {!editId&&'*'}</label>
                  <input value={itemSearch} onChange={e=>searchItems(e.target.value)} placeholder="품명·기준코드·제조사품번" disabled={!!editId}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50"/>
                  {itemResults.length>0&&(
                    <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                      {itemResults.map(item=>(
                        <button key={item.id} onClick={()=>{setSelItem(item);setItemSearch(item.name);setItemResults([]);if(item.vendor_id) setSelVendor(item.vendor_id)}}
                          className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-slate-100 last:border-0 text-xs">
                          <div className="font-semibold text-slate-800">{item.name}</div>
                          <div className="text-slate-400 font-mono text-xs flex gap-2">
                            <span>{item.std_code}</span>
                            {item.manufacturer_code&&<span className="text-violet-500">· {item.manufacturer_code}</span>}
                            {item.vendors?.name&&<span className="text-emerald-600">· {item.vendors.name}</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {selItem&&<p className="text-xs text-emerald-600 mt-1">✓ {selItem.name}</p>}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">구매처</label>
                  <select value={selVendor} onChange={e=>setSelVendor(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">선택</option>
                    {vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">구분</label>
                  <select value={form.type} onChange={f('type')}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option>자재</option><option>가공</option>
                  </select>
                </div>
                <div><label className="block text-xs font-bold text-slate-500 mb-1">수량 *</label><input type="number" value={form.qty_ordered} onChange={f('qty_ordered')} placeholder="수량" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
                <div><label className="block text-xs font-bold text-slate-500 mb-1">단가</label><input type="number" value={form.unit_price} onChange={f('unit_price')} placeholder="단가" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
                <div><label className="block text-xs font-bold text-slate-500 mb-1">납기 약속일</label><input type="date" value={form.promise_date} onChange={f('promise_date')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
                <div><label className="block text-xs font-bold text-slate-500 mb-1">발주번호</label><input value={form.po_number} onChange={f('po_number')} placeholder="이카운트 발주번호" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
                <div><label className="block text-xs font-bold text-slate-500 mb-1">메모</label><input value={form.memo} onChange={f('memo')} placeholder="메모" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={()=>{setShowForm(false);setEditId(null)}} className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">취소</button>
                <button onClick={()=>saveMut.mutate(form)} disabled={(!selItem&&!editId)||!form.qty_ordered||saveMut.isPending}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                  {saveMut.isPending?'저장 중...':editId?'수정 완료':'발주 등록'}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">발주 건수</p><p className="text-xl font-bold text-slate-900">{filtered.length}</p></div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-3"><p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-1">납기 지연</p><p className="text-xl font-bold text-red-600">{filtered.filter(p=>p.isDelayed).length}</p></div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-bold text-amber-500 uppercase tracking-wide mb-1">D-7 임박</p><p className="text-xl font-bold text-amber-700">{filtered.filter(p=>{if(!p.promise_date)return false;const d=Math.round((new Date(p.promise_date)-new Date(today))/86400000);return d>=0&&d<=7}).length}</p></div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-xs font-bold text-emerald-500 uppercase tracking-wide mb-1">입고 예정</p><p className="text-xl font-bold text-emerald-700">{filtered.reduce((a,p)=>a+(p.qty_remaining||0),0)}</p></div>
          </div>

          {isLoading ? <div className="text-center py-12 text-slate-400 text-sm">불러오는 중...</div> : (
            <ResizableTable cols={PO_COLS} storageKey="purchase_cols">
              {()=>(
                <tbody>
                  {filtered.length===0
                    ? <tr><td colSpan={PO_COLS.length} className="text-center py-10 text-slate-400">구매 발주가 없습니다</td></tr>
                    : filtered.map(p=>{
                      const diff=p.promise_date?Math.round((new Date(p.promise_date)-new Date(today))/86400000):null
                      const supply=Math.round((p.qty_ordered||0)*(p.unit_price||0))
                      return (
                        <tr key={p.id} className={`border-b border-slate-100 hover:bg-slate-50 group ${p.isDelayed?'bg-red-50/30':''}`}>
                          <td className="px-3 py-2"><input type="checkbox" checked={!!checked[p.id]} onChange={e=>setChecked(prev=>({...prev,[p.id]:e.target.checked}))} className="w-3.5 h-3.5 accent-indigo-600"/></td>
                          <td className="px-3 py-2 font-mono text-slate-500 overflow-hidden truncate">{p.po_number||'-'}</td>
                          <td className="px-3 py-2 text-slate-500">{p.order_date||'-'}</td>
                          <td className="px-3 py-2 overflow-hidden">
                            <div className="font-mono text-xs text-indigo-600 truncate">{p.items?.std_code||'-'}</div>
                            <div className="text-[11px] text-slate-500 truncate">{p.items?.name||''}</div>
                          </td>
                          <td className="px-3 py-2 overflow-hidden">
                            <div className="text-xs text-slate-700 truncate">{p.items?.manufacturer||'-'}</div>
                            <div className="font-mono text-[11px] text-slate-400 truncate">{p.items?.manufacturer_code||''}</div>
                          </td>
                          <td className="px-3 py-2"><span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold ${p.type==='가공'?'bg-indigo-50 text-indigo-600':'bg-blue-50 text-blue-600'}`}>{p.type}</span></td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-400 overflow-hidden truncate">{p.projects?.code||'-'}</td>
                          <td className="px-3 py-2 text-slate-500">{p.items?.lt_weeks?`${p.items.lt_weeks}W`:'-'}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-700">{p.qty_ordered}</td>
                          <td className="px-3 py-2 text-right text-emerald-600">{p.qty_received}</td>
                          <td className="px-3 py-2 text-right font-bold text-slate-900">{p.qty_remaining}</td>
                          <td className="px-3 py-2 text-right text-slate-500">{p.unit_price?Number(p.unit_price).toLocaleString():'-'}</td>
                          <td className="px-3 py-2 text-right text-slate-500">{supply?supply.toLocaleString():'-'}</td>
                          <td className="px-3 py-2"><span className={`${diff!==null&&diff<0?'text-red-600 font-bold':diff!==null&&diff<=7?'text-amber-700 font-semibold':'text-slate-600'}`}>{p.promise_date||'-'}</span></td>
                          <td className="px-3 py-2 text-slate-500 overflow-hidden truncate">{p.vendors?.name||'-'}</td>
                          <td className="px-3 py-2"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${p.isDelayed?'bg-red-50 text-red-600':'bg-emerald-50 text-emerald-700'}`}>{p.isDelayed?'지연':'진행중'}</span></td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              <button onClick={()=>handleEdit(p)} className="px-2 py-1 text-xs font-semibold rounded border border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600">수정</button>
                              <button onClick={()=>{if(window.confirm('삭제할까요?'))deleteMut.mutate(p.id)}} className="px-2 py-1 text-xs font-semibold rounded border border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-500">삭제</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  }
                </tbody>
              )}
            </ResizableTable>
          )}
        </>
      )}

      {tab==='history' && (
        <div className="space-y-4">
          <div className="flex items-end gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50 flex-wrap">
            <div><label className="block text-xs font-bold text-slate-500 mb-1">시작일</label>
              <input type="date" value={hFrom} onChange={e=>setHFrom(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"/></div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">종료일</label>
              <input type="date" value={hTo} onChange={e=>setHTo(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"/></div>
            <button onClick={()=>setHQuery({from:hFrom,to:hTo})}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">조회</button>
            {history.length>0&&<button onClick={exportHistory}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">📥 엑셀</button>}
            <div className="ml-auto text-xs text-slate-400 self-center">총 {history.length}건</div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">입고 건수</p><p className="text-xl font-bold text-slate-900">{history.length}</p></div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-xs font-bold text-emerald-500 uppercase tracking-wide mb-1">총 입고 수량</p><p className="text-xl font-bold text-emerald-700">{history.reduce((a,r)=>a+r.qty,0).toLocaleString()}</p></div>
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3"><p className="text-xs font-bold text-indigo-400 uppercase tracking-wide mb-1">총 공급가</p><p className="text-xl font-bold text-indigo-700">{Math.round(histTotalSupply/10000).toLocaleString()}만원</p></div>
          </div>

          {histLoading ? <div className="text-center py-10 text-slate-400 text-sm">불러오는 중...</div> : (
            <ResizableTable cols={HIST_COLS} storageKey="purchase_hist_cols">
              {()=>(
                <tbody>
                  {history.length===0
                    ? <tr><td colSpan={HIST_COLS.length} className="text-center py-10 text-slate-400">입고 이력이 없습니다</td></tr>
                    : history.map(r=>(
                      <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 font-semibold text-slate-700">{r.movement_date}</td>
                        <td className="px-3 py-2 font-mono text-xs text-indigo-600">{r.items?.std_code}</td>
                        <td className="px-3 py-2 font-semibold text-slate-800">{r.items?.name}</td>
                        <td className="px-3 py-2 text-right font-bold text-emerald-700">{r.qty}</td>
                        <td className="px-3 py-2 text-slate-500">{r.items?.unit}</td>
                        <td className="px-3 py-2 text-right text-slate-500">{r.purchase_orders?.unit_price?Number(r.purchase_orders.unit_price).toLocaleString():'-'}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-700">{r.supply?Math.round(r.supply).toLocaleString():'-'}</td>
                        <td className="px-3 py-2 font-mono text-slate-500">{r.purchase_orders?.po_number||'-'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-400">{r.purchase_orders?.projects?.code||'-'}</td>
                        <td className="px-3 py-2 text-slate-500">{r.purchase_orders?.vendors?.name||'-'}</td>
                      </tr>
                    ))
                  }
                </tbody>
              )}
            </ResizableTable>
          )}
        </div>
      )}
    </div>
  )
}
