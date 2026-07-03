import { useState, useEffect } from 'react'
import { refreshProcurement } from '../../lib/refresh'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useResizableColumns } from '../../hooks/useResizableColumns'
import { useCustomer } from '../../hooks/useCustomers'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import * as XLSX from 'xlsx'
import CustomerTabs from '../../components/CustomerTabs'
import ShortageTabs from '../../components/ShortageTabs'
import { getCategoryCode, ITEM_CATEGORIES, catOf, PROC_CATS } from '../../lib/utils'

// 입력 디바운스
function useDebounced(val, ms=250) {
  const [d, setD] = useState(val)
  useEffect(()=>{ const t=setTimeout(()=>setD(val), ms); return ()=>clearTimeout(t) }, [val, ms])
  return d
}

// 품목/어셈블리 코드 검색 (기준코드·품명·어셈블리코드)
async function searchCodes(customerId, term) {
  const q = (term||'').replace(/[,()%]/g,' ').trim()
  if (q.length < 2) return []
  const like = `%${q}%`
  const [{ data: items }, { data: projs }] = await Promise.all([
    supabase.from('items').select('std_code,name,type').or(`std_code.ilike.${like},name.ilike.${like}`).limit(15),
    customerId
      ? supabase.from('projects').select('code,name').eq('customer_id',customerId).or(`code.ilike.${like},name.ilike.${like}`).limit(10)
      : Promise.resolve({ data: [] }),
  ])
  const asm = (projs||[]).map(p=>({ code:p.code, name:p.name||'', kind:'어셈블리' }))
  const it  = (items||[]).map(i=>({ code:i.std_code, name:i.name||'', kind:i.type||'품목' }))
  return [...asm, ...it]
}

// 구분 — 구매발주와 동일한 catOf() 사용 (DB 구분: 전장/가공/자재 등)
function catLabel(r) {
  return catOf(r) || r.category || r.type || ''
}

const COL_DEFAULTS = {
  code:180, category:72, mfg:130, dept:78, vendor:95, lt:52, unit:52,
  need:80, stock:66, pending:104, order_need:90,
}
const COLS = [
  {key:'code', label:'기준코드·품명', sort:'std_code'},
  {key:'category', label:'구분', sort:'category'},
  {key:'mfg', label:'제조사·품번', sort:'manufacturer'},
  {key:'dept', label:'관리부서', sort:'dept'},
  {key:'vendor', label:'구매처', sort:'vendor'},
  {key:'lt', label:'LT', sort:'lt_weeks', align:'right'},
  {key:'unit', label:'단위', sort:'unit'},
  {key:'need', label:'총소요량', sort:'total_need', align:'right'},
  {key:'stock', label:'현재고', sort:'stock', align:'right'},
  {key:'pending', label:'구매발주미입고', sort:'pending', align:'right'},
  {key:'order_need', label:'발주필요', sort:'order_need', align:'right'},
]
function sortVal(r, key) {
  switch(key){
    case 'category': return catLabel(r)
    case 'vendor': return r.vendor?.name || ''
    case 'manufacturer': return r.manufacturer || ''
    case 'lt_weeks': return r.lt_weeks||0
    case 'total_need': return r.total_need||0
    case 'stock': return r.stock||0
    case 'pending': return r.pending||0
    case 'order_need': return r.order_need||0
    default: return r[key] ?? ''
  }
}

async function fetchProjects(customerId) {
  const { data } = await supabase.from('projects').select('id,code,name,rev').eq('customer_id', customerId).order('code')
  return data || []
}

async function fetchVendors() {
  const { data } = await supabase.from('vendors').select('id,name').order('name')
  return data || []
}

async function genPoNumber() {
  const d = new Date()
  const yy = String(d.getFullYear()).slice(2)
  const mm = String(d.getMonth()+1).padStart(2,'0')
  const dd = String(d.getDate()).padStart(2,'0')
  const prefix = `JS-${yy}${mm}${dd}-`
  const { data } = await supabase.from('purchase_orders').select('po_number').like('po_number',`${prefix}%`)
  const nums = (data||[]).map(r=>parseInt(r.po_number?.replace(prefix,''))||0)
  const seq = (nums.length ? Math.max(...nums) : 0) + 1
  return `${prefix}${String(seq).padStart(2,'0')}`
}

async function createPurchaseOrders({ items, csId, vendorId, promiseDate, poNumber }) {
  const finalPoNumber = poNumber || await genPoNumber()
  const inserts = items.map(item=>({
    customer_id:csId,
    item_id:item.item_id,
    vendor_id: vendorId || item.vendor?.id || null,
    order_type:'purchase', type:item.type,
    qty_ordered:item.order_qty, qty_received:0,
    unit_price: item.purchase_price ?? null,
    po_number:finalPoNumber, promise_date:promiseDate||null, status:'진행중',
  }))
  const { error } = await supabase.from('purchase_orders').insert(inserts)
  if (error) throw error
}

async function fetchReqBOM(customerId, projectIds, manualItems) {
  if (!projectIds.length && !manualItems.length) return []

  let rows = []

  // 프로젝트 선택 방식
  if (projectIds.length) {
    const poRows = await fetchAll(() => supabase
      .from('purchase_orders').select('project_id,qty_remaining')
      .eq('customer_id', customerId).eq('order_type','customer_po').neq('status','완료')
      .in('project_id', projectIds))

    const { data: bomRows } = await supabase
      .from('bom')
      .select('*, items!bom_item_id_fkey(id,std_code,name,type,js_code,unit,lt_weeks,manufacturer,manufacturer_code,dept,category,purchase_price)')
      .eq('customer_id', customerId).in('project_id', projectIds)

    const cpoMap = {}
    ;(poRows||[]).forEach(r=>{ if(r.project_id) cpoMap[r.project_id]=(cpoMap[r.project_id]||0)+(r.qty_remaining||0) })

    rows = (bomRows||[]).map(b=>({
      item_id: b.item_id,
      std_code: b.items?.std_code,
      name: b.items?.name,
      type: b.items?.type,
      unit: b.items?.unit,
      lt_weeks: b.items?.lt_weeks||0,
      dept: b.items?.dept,
      js_code: b.items?.js_code||'',
      category: b.items?.category||'',
      manufacturer: b.items?.manufacturer||'',
      manufacturer_code: b.items?.manufacturer_code||'',
      purchase_price: b.items?.purchase_price,
      need: Math.round(((cpoMap[b.project_id]||0) * b.qty_per_unit) * 100) / 100,
      source: 'bom',
    }))
  }

  // 수동 품번 입력 방식
  if (manualItems.length) {
    const codes = manualItems.map(m=>m.code).filter(Boolean)
    if (codes.length) {
      // 어셈블리(프로젝트)인 코드 판별 → 어셈블리면 BOM 전개, 단품이면 그대로
      const { data: projs } = await supabase.from('projects')
        .select('id,code').eq('customer_id', customerId).in('code', codes)
      const projByCode = {}; (projs||[]).forEach(p=>{ projByCode[p.code]=p.id })
      const asmCodes = codes.filter(c=>projByCode[c])
      const singleCodes = codes.filter(c=>!projByCode[c])

      // 1) 어셈블리 → 하위품목 전개 (소요량 = 입력수량 × qty_per_unit)
      if (asmCodes.length) {
        const projIds = asmCodes.map(c=>projByCode[c])
        const { data: bomRows } = await supabase.from('bom')
          .select('project_id,qty_per_unit,item_id, items!bom_item_id_fkey(id,std_code,name,type,js_code,unit,lt_weeks,manufacturer,manufacturer_code,dept,category,purchase_price)')
          .eq('customer_id', customerId).in('project_id', projIds)
        const qtyByProj = {}
        asmCodes.forEach(c=>{ const m=manualItems.find(x=>x.code===c); qtyByProj[projByCode[c]]=Number(m?.qty)||0 })
        ;(bomRows||[]).forEach(b=>{
          rows.push({
            item_id: b.item_id, std_code: b.items?.std_code, name: b.items?.name,
            type: b.items?.type, unit: b.items?.unit, lt_weeks: b.items?.lt_weeks||0,
            dept: b.items?.dept, js_code: b.items?.js_code||'', category: b.items?.category||'', manufacturer: b.items?.manufacturer||'', manufacturer_code: b.items?.manufacturer_code||'',
            purchase_price: b.items?.purchase_price,
            need: Math.round(((qtyByProj[b.project_id]||0) * b.qty_per_unit) * 100) / 100, source: 'bom',
          })
        })
      }

      // 2) 단품 → items 직접 조회
      if (singleCodes.length) {
        const { data: items } = await supabase.from('items')
          .select('id,std_code,name,type,js_code,unit,lt_weeks,manufacturer,manufacturer_code,dept,category,purchase_price')
          .in('std_code', singleCodes)
        ;(items||[]).forEach(item=>{
          const manual = manualItems.find(m=>m.code===item.std_code)
          rows.push({
            item_id: item.id, std_code: item.std_code, name: item.name,
            type: item.type, unit: item.unit, lt_weeks: item.lt_weeks||0,
            dept: item.dept, js_code: item.js_code||'', category: item.category||'', manufacturer: item.manufacturer||'', manufacturer_code: item.manufacturer_code||'',
            purchase_price: item.purchase_price,
            need: Number(manual?.qty)||0, source: 'manual',
          })
        })
      }
    }
  }

  // 집계
  const itemMap = {}
  rows.forEach(r=>{
    if (!itemMap[r.item_id]) itemMap[r.item_id] = { ...r, total_need: 0 }
    itemMap[r.item_id].total_need += r.need
  })

  const itemIds = Object.keys(itemMap)
  const { data: invRows } = itemIds.length
    ? await supabase.from('inventory').select('item_id,qty').in('item_id', itemIds)
    : { data: [] }
  const { data: purchaseRows } = itemIds.length
    ? { data: await fetchAll(() => supabase.from('purchase_orders').select('item_id,qty_remaining')
      .eq('customer_id', customerId).eq('order_type','purchase').neq('status','완료').in('item_id', itemIds)) }
    : { data: [] }

  const invMap = {}; (invRows||[]).forEach(r=>{invMap[r.item_id]=r.qty})
  const purchaseMap = {}; (purchaseRows||[]).forEach(r=>{purchaseMap[r.item_id]=(purchaseMap[r.item_id]||0)+(r.qty_remaining||0)})

  // 구매처(벤더) — items.vendor_id 가 있으면 vendors 이름 매핑. 스키마에 없으면 조용히 생략.
  const vendorByItem = {}
  if (itemIds.length) {
    const { data: itemVendors } = await supabase.from('items').select('id,vendor_id').in('id', itemIds)
    const vids = [...new Set((itemVendors||[]).map(x=>x.vendor_id).filter(Boolean))]
    const { data: vRows } = vids.length
      ? await supabase.from('vendors').select('id,name').in('id', vids)
      : { data: [] }
    const vName = {}; (vRows||[]).forEach(v=>{ vName[v.id]=v.name })
    ;(itemVendors||[]).forEach(x=>{ if(x.vendor_id) vendorByItem[x.id]={ id:x.vendor_id, name:vName[x.vendor_id]||'' } })
  }

  return Object.values(itemMap).map(r=>({
    ...r,
    stock: invMap[r.item_id]||0,
    pending: purchaseMap[r.item_id]||0,
    vendor: vendorByItem[r.item_id] || null,
    lack: Math.round((r.total_need - (invMap[r.item_id]||0)) * 100) / 100,
    order_need: Math.max(0, Math.round((r.total_need - (invMap[r.item_id]||0) - (purchaseMap[r.item_id]||0)) * 100) / 100),
  })).sort((a,b)=>b.order_need-a.order_need)
}

export default function ReqBOM() {
  const { customerId: csCode } = useParams()
  const qc = useQueryClient()
  const [mainTab, setMainTab] = useState('req')
  const [deptFilter, setDeptFilter] = useState('전체')
  const [sortKey, setSortKey] = useState('order_need')
  const [sortDir, setSortDir] = useState('desc')
  const { widths, startResize, resetWidths } = useResizableColumns('reqbom_cols', COL_DEFAULTS)
  const [manualItems, setManualItems] = useState([{ code:'', qty:'' }])
  const [submitted, setSubmitted] = useState(false)
  const [activeManual, setActiveManual] = useState([])
  // 체크박스 → 구매발주
  const [checked, setChecked] = useState({})
  const [showOrderForm, setShowOrderForm] = useState(false)
  const [selVendor, setSelVendor] = useState('')
  const [promiseDate, setPromiseDate] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [orderQtys, setOrderQtys] = useState({})  // 발주수량(품목별)

  const { data: cs } = useCustomer(csCode)
  const { data: projects=[] } = useQuery({
    queryKey:['projects',cs?.id], queryFn:()=>fetchProjects(cs?.id), enabled:!!cs?.id,
  })
  const { data: rows=[], isLoading } = useQuery({
    queryKey:['reqbom',cs?.id,activeManual],
    queryFn:()=>fetchReqBOM(cs?.id, [], activeManual),
    enabled:!!cs?.id&&activeManual.length>0,
  })
  const { data: vendors=[] } = useQuery({ queryKey:['vendors'], queryFn:fetchVendors })

  const orderMut = useMutation({
    mutationFn:(items)=>createPurchaseOrders({items,csId:cs?.id,vendorId:selVendor,promiseDate,poNumber}),
    onSuccess:()=>{
      refreshProcurement(qc)
      setChecked({}); setShowOrderForm(false); setPoNumber(''); setSelVendor(''); setPromiseDate('')
      toastSuccess('구매발주 생성 완료')
    },
    onError:(e)=>toastError('오류: '+e.message),
  })

  const depts = ['전체',...new Set(rows.map(r=>r.dept||'미지정').filter(Boolean))]
  const filteredBase = deptFilter==='전체' ? rows : rows.filter(r=>(r.dept||'미지정')===deptFilter)
  const filtered = [...filteredBase].sort((a,b)=>{
    const av=sortVal(a,sortKey), bv=sortVal(b,sortKey)
    const cmp = (typeof av==='number'&&typeof bv==='number') ? av-bv : String(av).localeCompare(String(bv),'ko')
    return sortDir==='asc'?cmp:-cmp
  })
  function toggleSort(key){ if(!key) return; if(sortKey===key) setSortDir(d=>d==='asc'?'desc':'asc'); else { setSortKey(key); setSortDir('desc') } }

  const needOrder = filtered.filter(r=>r.order_need>0)
  const checkedItems = filtered.filter(r=>checked[r.item_id]&&r.order_need>0)
  const allChecked = needOrder.length>0 && needOrder.every(r=>checked[r.item_id])
  const toggleCheck = (id,val)=>setChecked(p=>({...p,[id]:val}))

  function handlePaste(e, i){
    const text = (e.clipboardData||window.clipboardData).getData('text')
    if(!text || !/[\n\t,]/.test(text)) return   // 단일 값이면 기본 동작
    e.preventDefault()
    const codes = text.split(/[\n\t,]+/).map(x=>x.trim()).filter(Boolean)
    setManualItems(prev=>{
      const next=[...prev]
      codes.forEach((code,k)=>{ const idx=i+k; if(next[idx]) next[idx]={...next[idx],code}; else next[idx]={code,qty:''} })
      return next
    })
  }
  function addManualRow() { setManualItems(prev=>[...prev,{code:'',qty:''}]) }
  function updateManual(i,k,v) { setManualItems(prev=>prev.map((m,idx)=>idx===i?{...m,[k]:v}:m)) }
  function removeManualRow(i) { setManualItems(prev=>prev.filter((_,idx)=>idx!==i)) }

  function handleSubmit() {
    const valid = manualItems.filter(m=>m.code.trim()&&m.qty)
    setActiveManual(valid)
    setSubmitted(true)
    setChecked({})
  }

  function exportExcel() {
    const data = filtered.map(r=>({
      '기준코드':r.std_code,'품명':r.name,
      '제조사':r.manufacturer||'','제조사품번':r.manufacturer_code||'',
      '구분':catLabel(r),'관리부서':r.dept||'','구매처':r.vendor?.name||'',
      '단위':r.unit,'LT(주)':r.lt_weeks,'총소요량':r.total_need,'현재고':r.stock,
      '부족':r.lack>0?-r.lack:0,'구매발주미입고':r.pending,'발주필요':r.order_need,
    }))
    const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),'소요량조회')
    XLSX.writeFile(wb,`소요량조회_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <CustomerTabs />
      <ShortageTabs cs={csCode} />
      {/* 탭 */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[['req','📊 소요량 조회'],['explode','🔍 역전개 (상위 찾기)']].map(([k,l])=>(
          <button key={k} onClick={()=>setMainTab(k)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${mainTab===k?'bg-white text-slate-900 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{l}</button>
        ))}
      </div>

      {mainTab==='explode' && <ReverseExplode csId={cs?.id} csCode={csCode} />}

      {mainTab==='req' && <>
      {/* 다품목 키인 */}
      <div className="rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-700">품번 입력 (여러 품목 한 번에)</p>
          <div className="flex gap-2">
            <button onClick={addManualRow} className="text-xs text-indigo-500 hover:text-indigo-700 font-semibold">+ 행 추가</button>
            <button onClick={()=>setManualItems(Array.from({length:Math.max(5,manualItems.length)},(_,i)=>manualItems[i]||({code:'',qty:''})))}
              className="text-xs text-slate-400 hover:text-slate-600 font-semibold">5행</button>
          </div>
        </div>
        <p className="text-[11px] text-slate-400">엑셀에서 코드 여러 개 복사 → 첫 칸에 붙여넣으면 자동으로 행이 나뉩니다</p>
        <div className="space-y-2">
          {manualItems.map((item,i)=>(
            <div key={i} className="flex items-center gap-2">
              <span className="text-[11px] text-slate-300 w-5 text-right">{i+1}</span>
              <CodeAutocomplete
                value={item.code}
                onChange={v=>updateManual(i,'code',v)}
                onPaste={e=>handlePaste(e,i)}
                customerId={cs?.id}
                placeholder="기준코드·품명·어셈블리 (2글자↑ 검색)"/>
              <input type="number" value={item.qty} onChange={e=>updateManual(i,'qty',e.target.value)}
                placeholder="수량"
                className="w-24 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
              {manualItems.length>1&&(
                <button onClick={()=>removeManualRow(i)} className="text-slate-400 hover:text-red-400 text-sm">✕</button>
              )}
            </div>
          ))}
        </div>
        <button onClick={handleSubmit}
          disabled={!manualItems.some(m=>m.code.trim()&&m.qty)}
          className="w-full py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
          소요량 조회
        </button>
      </div>

      {activeManual.length>0 && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              {depts.map(d=>(
                <button key={d} onClick={()=>setDeptFilter(d)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${deptFilter===d?'bg-white text-slate-900 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{d}</button>
              ))}
            </div>
            <div className="flex-1"/>
            {checkedItems.length>0&&(
              <button onClick={()=>{ const init={}; checkedItems.forEach(r=>{init[r.item_id]=r.order_need}); setOrderQtys(init); setShowOrderForm(true) }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
                📋 선택 {checkedItems.length}건 구매발주
              </button>
            )}
            <button onClick={resetWidths} className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1.5 border border-slate-200 rounded-lg">열 초기화</button>
            {rows.length>0&&<button onClick={exportExcel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">
              📥 엑셀 추출
            </button>}
          </div>

          {/* 구매발주 일괄 생성 폼 */}
          {showOrderForm&&(
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
              <p className="text-xs font-bold text-slate-700">구매발주 일괄 생성 — {checkedItems.length}개 품목</p>
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden max-h-48 overflow-y-auto">
                <table className="w-full text-xs"><thead><tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2 text-left font-bold text-slate-400">기준코드</th>
                  <th className="px-3 py-2 text-left font-bold text-slate-400">품명</th>
                  <th className="px-3 py-2 text-right font-bold text-slate-400">발주필요</th>
                  <th className="px-3 py-2 text-right font-bold text-slate-400">발주수량</th>
                  <th className="px-3 py-2 text-right font-bold text-slate-400">단가</th>
                  <th className="px-3 py-2 text-right font-bold text-slate-400">금액</th>
                </tr></thead><tbody>
                  {checkedItems.map(r=>(
                    <tr key={r.item_id} className="border-b border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs text-indigo-600">{r.std_code}</td>
                      <td className="px-3 py-2 text-slate-700">{r.name}</td>
                      <td className="px-3 py-2 text-right font-semibold text-red-600">{r.order_need}</td>
                      <td className="px-3 py-2 text-right">
                        <input type="number" value={orderQtys[r.item_id] ?? r.order_need}
                          onChange={e=>setOrderQtys(p=>({...p,[r.item_id]:Number(e.target.value)}))}
                          className="w-20 px-2 py-1 text-xs border border-slate-200 rounded text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"/>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500">{r.purchase_price?('₩'+Math.round(r.purchase_price).toLocaleString()):<span className="text-amber-500" title="단가 미등록">미등록</span>}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-800">{r.purchase_price?('₩'+Math.round(r.purchase_price*(orderQtys[r.item_id] ?? r.order_need)).toLocaleString()):<span className="text-slate-300">-</span>}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
              <div className="flex justify-end items-baseline gap-2 text-xs">
                <span className="font-bold text-slate-500">발주 총액</span>
                <span className="text-base font-bold text-indigo-600">₩{Math.round(checkedItems.reduce((a,r)=>a+(r.purchase_price||0)*(orderQtys[r.item_id] ?? r.order_need),0)).toLocaleString()}</span>
                {checkedItems.some(r=>!r.purchase_price)&&<span className="text-amber-500 font-semibold">· 단가 미등록 품목 제외</span>}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="block text-xs font-bold text-slate-500 mb-1">발주번호</label>
                  <input value={poNumber} onChange={e=>setPoNumber(e.target.value)} placeholder="비우면 자동부여"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
                <div><label className="block text-xs font-bold text-slate-500 mb-1">구매처</label>
                  <select value={selVendor} onChange={e=>setSelVendor(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">선택 (비우면 품목별 기본 구매처)</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
                  </select></div>
                <div><label className="block text-xs font-bold text-slate-500 mb-1">납기 약속일</label>
                  <input type="date" value={promiseDate} onChange={e=>setPromiseDate(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={()=>setShowOrderForm(false)} className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">취소</button>
                <button onClick={()=>orderMut.mutate(checkedItems.map(r=>({...r,order_qty:orderQtys[r.item_id] ?? r.order_need})))} disabled={orderMut.isPending}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                  {orderMut.isPending?'생성 중...':'⚡ 구매발주 생성'}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">전체 품목</p><p className="text-xl font-bold text-slate-900">{filtered.length}</p></div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-3"><p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-1">발주필요</p><p className="text-xl font-bold text-red-600">{filtered.filter(r=>r.order_need>0).length}</p></div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-bold text-amber-500 uppercase tracking-wide mb-1">입력 품목</p><p className="text-xl font-bold text-amber-700">{activeManual.length}개</p></div>
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3"><p className="text-xs font-bold text-indigo-400 uppercase tracking-wide mb-1">선택됨</p><p className="text-xl font-bold text-indigo-600">{checkedItems.length}</p></div>
          </div>

          {isLoading ? <div className="text-center py-12 text-slate-400 text-sm">계산 중...</div> : (<>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="text-xs" style={{tableLayout:'fixed',width:COLS.reduce((a,c)=>a+(widths[c.key]||COL_DEFAULTS[c.key]||80),44)+'px'}}>
                  <colgroup>
                    <col style={{width:'44px'}}/>
                    {COLS.map(c=><col key={c.key} style={{width:(widths[c.key]||COL_DEFAULTS[c.key]||80)+'px'}}/>)}
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2.5 w-8">
                        <input type="checkbox" checked={allChecked} onChange={e=>{
                          if(e.target.checked){const n={};needOrder.forEach(r=>{n[r.item_id]=true});setChecked(n)}else setChecked({})
                        }} className="w-3.5 h-3.5 accent-indigo-600"/>
                      </th>
                      {COLS.map(c=>(
                        <th key={c.key} onClick={()=>toggleSort(c.sort)}
                          className={`relative group/th px-2 py-2.5 font-bold text-slate-400 text-xs uppercase tracking-wide whitespace-nowrap overflow-hidden cursor-pointer select-none hover:text-slate-600 ${c.align==='right'?'text-right':'text-left'}`}>
                          {c.label}{sortKey===c.sort && <span className="ml-0.5 text-indigo-500">{sortDir==='asc'?'▲':'▼'}</span>}
                          <span data-rh onMouseDown={e=>{e.stopPropagation(); startResize(e,c.key)}} onClick={e=>e.stopPropagation()}
                            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-indigo-400 opacity-0 group-hover/th:opacity-100 transition-opacity" style={{userSelect:'none'}}/>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length===0 ? (
                      <tr><td colSpan={COLS.length+1} className="text-center py-10 text-slate-400">데이터가 없습니다</td></tr>
                    ) : filtered.map(r=>(
                      <tr key={r.item_id} className={`border-b border-slate-100 hover:bg-slate-50 ${r.order_need>0?'bg-red-50/10':''}`}>
                        <td className="px-3 py-2">
                          {r.order_need>0&&<input type="checkbox" checked={!!checked[r.item_id]} onChange={e=>toggleCheck(r.item_id,e.target.checked)} className="w-3.5 h-3.5 accent-indigo-600"/>}
                        </td>
                        <td className="px-2 py-2 overflow-hidden">
                          <div className="font-mono text-xs text-indigo-600 truncate">{r.std_code}</div>
                          <div className="text-[11px] text-slate-500 truncate">{r.name||''}</div>
                        </td>
                        <td className="px-2 py-2 overflow-hidden">
                          {catLabel(r)
                            ? <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold truncate ${PROC_CATS.has(catLabel(r))?'bg-violet-50 text-violet-700':'bg-blue-50 text-blue-600'}`}>{catLabel(r)}</span>
                            : <span className="text-slate-300">-</span>}
                        </td>
                        <td className="px-2 py-2 overflow-hidden">
                          <div className="text-xs text-slate-700 truncate">{r.manufacturer||'-'}</div>
                          <div className="font-mono text-[11px] text-slate-400 truncate">{r.manufacturer_code||''}</div>
                        </td>
                        <td className="px-2 py-2 overflow-hidden truncate">{r.dept?<span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600">{r.dept}</span>:<span className="text-slate-300">-</span>}</td>
                        <td className="px-2 py-2 text-slate-500 text-xs overflow-hidden truncate">{r.vendor?.name||<span className="text-slate-300">-</span>}</td>
                        <td className="px-2 py-2 text-right"><span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600">{r.lt_weeks}W</span></td>
                        <td className="px-2 py-2 text-slate-500 overflow-hidden truncate">{r.unit}</td>
                        <td className="px-2 py-2 text-right font-bold text-slate-900">{r.total_need}</td>
                        <td className="px-2 py-2 text-right text-slate-600">{r.stock}</td>
                        <td className="px-2 py-2 text-right">{r.pending>0?<span className="text-emerald-600 font-semibold">+{r.pending}</span>:<span className="text-slate-300">-</span>}</td>
                        <td className="px-2 py-2 text-right font-bold">{r.order_need>0?<span className="text-red-600">{r.order_need} {r.unit}</span>:<span className="text-emerald-600">충족</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-xs text-slate-400">💡 헤더 클릭 → 정렬(다시 클릭 시 오름/내림 전환) · 헤더 오른쪽 끝 드래그 → 열 너비 조절 · 구분은 DB 등록값 기준</p>
            </>
          )}
        </>
      )}

      {activeManual.length===0&&!submitted&&(
        <div className="text-center py-16 text-slate-400">
          <p className="text-2xl mb-2">📋</p>
          <p className="text-sm">품번을 입력하고 소요량을 조회하세요</p>
        </div>
      )}
      </>}
    </div>
  )
}

// ── 역전개: 하위 파트 검색 → 이 파트를 쓰는 상위 어셈블리 목록 → 상위 클릭 시 BOM으로 ──
function ReverseExplode({ csId, csCode }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [submitted, setSubmitted] = useState('')

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['reverseExplode', csId, submitted],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_where_used', { cs_id: csId, q: submitted })
      if (error) throw error
      return data || []
    },
    enabled: !!csId && submitted.trim().length > 0,
  })

  function goBOM(projectCode) {
    // BOM 화면으로 이동 (어셈블리 코드 쿼리로 전달)
    navigate(`/customer/${csCode}/bom?assembly=${encodeURIComponent(projectCode)}`)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 p-4 space-y-2">
        <p className="text-xs font-bold text-slate-700">하위 파트로 상위 어셈블리 찾기</p>
        <p className="text-[11px] text-slate-400">부품(기준코드·제조사품번·품명)을 입력하면, 그 부품이 들어가는 상위 품번이 모두 나옵니다</p>
        <div className="flex gap-2">
          <input value={q} onChange={e=>setQ(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') setSubmitted(q) }}
            placeholder="기준코드 / 제조사품번 / 품명"
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
          <button onClick={()=>setSubmitted(q)} disabled={!q.trim()}
            className="px-5 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">검색</button>
        </div>
      </div>

      {submitted.trim() && (
        isLoading ? <div className="text-center py-10 text-slate-400 text-sm">검색 중...</div>
        : rows.length === 0
          ? <div className="text-center py-12 text-slate-400 text-sm">이 부품을 쓰는 상위 어셈블리가 없습니다</div>
          : (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs whitespace-nowrap">
                  <thead><tr className="bg-slate-50 border-b border-slate-200 text-slate-400">
                    {['하위 파트','상위 품번 (클릭 → BOM)','상위 품명','소요수량','레벨'].map(h=>
                      <th key={h} className="px-3 py-2.5 text-left font-bold">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {rows.map((r,i)=>(
                      <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <div className="font-mono text-indigo-600">{r.child_code}</div>
                          <div className="text-[11px] text-slate-400">{r.child_name}</div>
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={()=>goBOM(r.parent_code)}
                            className="font-mono text-xs font-bold text-indigo-600 hover:underline">
                            {r.parent_code} ↗
                          </button>
                        </td>
                        <td className="px-3 py-2 text-slate-600 max-w-[240px] truncate">{r.parent_name}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-800">{r.qty}</td>
                        <td className="px-3 py-2 text-slate-400">L{r.level ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
      )}
    </div>
  )
}

// ── 코드 자동완성 입력 ──
function CodeAutocomplete({ value, onChange, onPaste, customerId, placeholder }) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1)
  const term = useDebounced(value, 250)
  const { data: results = [] } = useQuery({
    queryKey: ['codeSearch', customerId, term],
    queryFn: () => searchCodes(customerId, term),
    enabled: open && !!term && String(term).trim().length >= 2,
  })
  function pick(code){ onChange(code); setOpen(false); setHi(-1) }
  return (
    <div className="relative flex-1">
      <input
        value={value}
        onChange={e=>{ onChange(e.target.value); setOpen(true); setHi(-1) }}
        onPaste={onPaste}
        onFocus={()=>{ if(String(value||'').trim().length>=2) setOpen(true) }}
        onBlur={()=>setTimeout(()=>setOpen(false), 150)}
        onKeyDown={e=>{
          if(!open || !results.length) return
          if(e.key==='ArrowDown'){ e.preventDefault(); setHi(h=>Math.min(h+1, results.length-1)) }
          else if(e.key==='ArrowUp'){ e.preventDefault(); setHi(h=>Math.max(h-1, 0)) }
          else if(e.key==='Enter' && hi>=0){ e.preventDefault(); pick(results[hi].code) }
          else if(e.key==='Escape'){ setOpen(false) }
        }}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
      {open && results.length>0 && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
          {results.map((r,i)=>(
            <button key={r.code+'_'+i} type="button"
              onMouseDown={e=>{ e.preventDefault(); pick(r.code) }}
              className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-indigo-50 ${i===hi?'bg-indigo-50':''}`}>
              <span className="font-mono text-indigo-600 shrink-0">{r.code}</span>
              <span className="text-slate-500 truncate flex-1">{r.name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${r.kind==='어셈블리'?'bg-violet-100 text-violet-600':'bg-slate-100 text-slate-500'}`}>{r.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
