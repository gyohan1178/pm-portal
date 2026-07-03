import { useState, useMemo, useCallback, useRef, memo } from 'react'
import { refreshProcurement } from '../../lib/refresh'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useCustomer } from '../../hooks/useCustomers'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useResizableColumns } from '../../hooks/useResizableColumns'
import * as XLSX from 'xlsx'
import CustomerTabs from '../../components/CustomerTabs'
import VendorPicker from '../../components/VendorPicker'
import ShortageTabs from '../../components/ShortageTabs'
import ShortageMonthly, { fetchMonthly } from './ShortageMonthly'
import { getCategoryCode, ITEM_CATEGORIES } from '../../lib/utils'

function fmtNum(v) {
  const r = Math.round((v||0)*100)/100
  return r%1===0 ? r.toLocaleString() : r.toFixed(2)
}

async function fetchShortage(csId) {
  if (!csId) return []
  // 서버측 집계 RPC — 부족분만 반환 (충족 품목 제외, 로딩 고속화)
  // RPC도 Supabase 기본 1000행 제한에 걸림 → range로 전체 페이징
  // (안전 전제: get_shortage가 ORDER BY item_id 로 정렬되어 있어야 함)
  const PAGE = 1000
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .rpc('get_shortage', { cs_id: csId })
      .range(from, from + PAGE - 1)
    if (error) throw error
    const batch = data || []
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  return rows.map(r => {
    const stock = Number(r.stock) || 0
    const effStock = Math.max(0, stock)
    const need = Math.round(Number(r.total_need) * 100) / 100
    const pending = Number(r.pending) || 0
    const lack = Math.round((need - effStock) * 100) / 100
    const orderNeed = Math.max(0, Math.round((lack - pending) * 100) / 100)
    const others = (r.other_names || '').split(',').map(x=>x.trim()).filter(Boolean)
    return {
      item_id: r.item_id,
      std_code: r.std_code, name: r.name, type: r.type, unit: r.unit,
      lt_weeks: r.lt_weeks || 0, dept: r.dept,
      manufacturer: r.manufacturer || '', manufacturer_code: r.manufacturer_code || '',
      total_need: need, stock, pending, lack, orderNeed,
      vendor: r.vendor_id ? { id: r.vendor_id, name: r.vendor_name } : null,
      parents: (r.parents || '').split(',').map(x=>x.trim()).filter(Boolean),
      otherPOs: others.map(n => ({ customer: n, qty: '' })),
      otherQty: Number(r.other_qty) || 0,
    }
  }).sort((a,b)=>b.orderNeed-a.orderNeed)
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
    vendor_id: vendorId || item.item_vendor_id || null,
    order_type:'purchase', type:item.type,
    qty_ordered:item.order_qty, qty_received:0,
    po_number:finalPoNumber, promise_date:promiseDate||null, status:'진행중',
  }))
  const { error } = await supabase.from('purchase_orders').insert(inserts)
  if (error) throw error
}

const COL_DEFAULTS = {
  std_code:150, type:60, mfg:130, dept:70, vendor:80, lt:50,
  need:65, stock:60, lack:70, pending:70, other:70, order_need:80, parents:140
}

function ResizeHandle({ onMouseDown }) {
  return <span onMouseDown={onMouseDown} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-indigo-400 opacity-0 group-hover/th:opacity-100 transition-opacity" style={{userSelect:'none'}}/>
}

// 행 단위 메모이즈 — 제외/체크 클릭 시 바뀐 행만 다시 그림(표 전체 재렌더 방지)
const ShortageRow = memo(function ShortageRow({ r, isExcluded, isChecked, onExclude, onToggleCheck, timingShort }) {
  return (
    <tr className={`border-b border-slate-100 hover:bg-slate-50 ${isExcluded?'opacity-40':''} ${r.orderNeed>0?'bg-red-50/10':''}`}>
      <td className="px-3 py-2">
        {r.orderNeed>0&&<input type="checkbox" checked={isChecked} onChange={e=>onToggleCheck(r.item_id,e.target.checked)} className="w-3.5 h-3.5 accent-indigo-600"/>}
      </td>
      <td className="px-2 py-2 overflow-hidden">
        <div className="font-mono text-xs text-indigo-600 truncate">{r.std_code}</div>
        <div className="text-[11px] text-slate-500 truncate">{r.name||''}</div>
        <div className="mt-0.5">
          {isExcluded ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-400" title="새로고침하면 목록에서 빠집니다">제외됨 ✓</span>
          ) : (
            <button onClick={()=>onExclude(r.item_id, r.std_code)}
              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 hover:bg-rose-100 hover:text-rose-500 transition-colors"
              title="재고관리 대상에서 제외 (새로고침 시 반영)">제외</button>
          )}
        </div>
      </td>
      <td className="px-2 py-2"><span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold ${r.type==='가공'?'bg-indigo-50 text-indigo-600':'bg-blue-50 text-blue-600'}`}>{r.type}</span></td>
      <td className="px-2 py-2 overflow-hidden">
        <div className="text-xs text-slate-700 truncate">{r.manufacturer||'-'}</div>
        <div className="font-mono text-[11px] text-slate-400 truncate">{r.manufacturer_code||''}</div>
      </td>
      <td className="px-2 py-2 overflow-hidden truncate">{r.dept?<span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600">{r.dept}</span>:<span className="text-slate-300">-</span>}</td>
      <td className="px-2 py-2 text-slate-500 text-xs overflow-hidden truncate">{r.vendor?.name||<span className="text-slate-300">-</span>}</td>
      <td className="px-2 py-2"><span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600">{r.lt_weeks}W</span></td>
      <td className="px-2 py-2 text-right font-bold text-slate-900">{fmtNum(r.total_need)}</td>
      <td className={`px-2 py-2 text-right ${r.stock<0?'text-red-500 font-bold':'text-slate-600'}`}>{fmtNum(r.stock)}{r.stock<0&&<span title="음수재고 — 계산상 0 취급" className="ml-0.5">⚠</span>}</td>
      <td className="px-2 py-2 text-right font-bold" style={{background:'#FFF7ED'}}>
        {r.lack>0?<span className="text-amber-700">-{r.lack}</span>:<span className="text-emerald-600">충족</span>}
      </td>
      <td className="px-2 py-2 text-right font-bold" style={{background:'#F0FDF4'}}>
        {r.pending>0?<span className="text-emerald-700">+{r.pending}</span>:<span className="text-slate-400">-</span>}
      </td>
      <td className="px-2 py-2 text-right" style={{background:'#EEF2FF'}}>
        {r.otherQty>0?(
          <div className="group relative inline-block">
            <span className="text-indigo-600 font-bold cursor-help">{r.otherQty}</span>
            <div className="hidden group-hover:block absolute right-0 bottom-full z-20 bg-white border border-slate-200 rounded-lg shadow-lg p-2 min-w-32 mb-1">
              {r.otherPOs.map((o,i)=><div key={i} className="text-xs text-slate-600 whitespace-nowrap">{o.customer}</div>)}
            </div>
          </div>
        ):<span className="text-slate-300">-</span>}
      </td>
      <td className="px-2 py-2 text-right font-bold" style={{background:r.orderNeed>0?'#FEF2F2':(timingShort?'#FFFBEB':'#F0FDF4')}}>
        {r.orderNeed>0
          ? <span className="text-red-600">{fmtNum(r.orderNeed)}</span>
          : timingShort
            ? <span className="text-amber-600" title={`총량은 충족이나 ${timingShort} 시점에 입고 전 부족 — '월별 소요' 탭에서 확인`}>충족 <span className="text-[10px]">⚠{timingShort.slice(2)}</span></span>
            : <span className="text-emerald-600">충족</span>}
      </td>
      <td className="px-2 py-2 overflow-hidden">
        <div className="flex flex-wrap gap-0.5">
          {r.parents.map((p,i)=><span key={i} className="inline-flex text-xs px-1 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">{p}</span>)}
        </div>
      </td>
    </tr>
  )
})

export default function Shortage() {
  const { customerId: csCode } = useParams()
  const qc = useQueryClient()
  const [typeTab, setTypeTab] = useState('전체')
  const [deptFilter, setDeptFilter] = useState('전체')
  const [vendorFilter, setVendorFilter] = useState('전체')
  const [parentFilter, setParentFilter] = useState('전체')
  const [catSel, setCatSel] = useState(() => new Set())
  const [sortBy, setSortBy] = useState('order_need')
  const [checked, setChecked] = useState({})
  const [showOrderForm, setShowOrderForm] = useState(false)
  const [selVendor, setSelVendor] = useState('')
  const [promiseDate, setPromiseDate] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [excluded, setExcluded] = useState(() => new Set())  // 방금 제외한 항목(새로고침 전까지 표시)
  const [view, setView] = useState('monthly')  // monthly(통합) | list(발주 상세)

  const { widths, startResize, resetWidths } = useResizableColumns('shortage_cols', COL_DEFAULTS)
  const { data: cs } = useCustomer(csCode)
  const { data: rows=[], isLoading } = useQuery({
    queryKey:['shortage',cs?.id], queryFn:()=>fetchShortage(cs?.id), enabled:!!cs?.id,
  })

  // 시점 부족(쇼티지) — 월별 소요(PO×BOM, 약속일 -1개월)로 첫 부족월 계산. 월별 소요 탭과 캐시 공유.
  const { data: monthlyRows=[] } = useQuery({
    queryKey:['shortageMonthly',cs?.id], queryFn:()=>fetchMonthly(cs?.id), enabled:!!cs?.id,
  })
  const timingMap = useMemo(()=>{
    const m={}
    monthlyRows.forEach(r=>{
      if(!m[r.item_id]) m[r.item_id]={stock:Number(r.current_stock)||0,cells:{}}
      m[r.item_id].cells[r.year_month]={d:Number(r.demand)||0,i:Number(r.incoming)||0}
    })
    const out={}
    Object.entries(m).forEach(([id,it])=>{
      let bal=it.stock, first=null
      Object.keys(it.cells).sort().forEach(mo=>{ const c=it.cells[mo]; bal=bal+c.i-c.d; if(bal<0&&!first) first=mo })
      if(first) out[id]=first
    })
    return out
  },[monthlyRows])

  const orderMut = useMutation({
    mutationFn:(items)=>createPurchaseOrders({items,csId:cs?.id,vendorId:selVendor,promiseDate,poNumber}),
    onSuccess:()=>{
      refreshProcurement(qc)
      setChecked({}); setShowOrderForm(false); toastSuccess('구매발주 생성 완료')
    },
    onError:(e)=>toastError('오류: '+e.message),
  })

  // 재고관리 대상 제외 — useCallback([])로 고정해 행 memo가 깨지지 않게 함
  const excludedRef = useRef(excluded)
  excludedRef.current = excluded
  const handleExclude = useCallback((itemId, stdCode) => {
    if (excludedRef.current.has(itemId)) return
    if (!window.confirm(`${stdCode}를 재고관리 대상에서 제외할까요?\n목록을 새로고침하면 부족자재에서 빠집니다.\n(기준코드 DB에서 다시 관리대상으로 되돌릴 수 있음)`)) return
    setExcluded(prev => new Set(prev).add(itemId))
    supabase.from('items').update({ stock_managed: false }).eq('id', itemId)
      .then(({ error }) => {
        if (error) {
          toastError('제외 실패: ' + error.message)
          setExcluded(prev => { const n = new Set(prev); n.delete(itemId); return n })
        }
      })
  }, [])
  const handleToggleCheck = useCallback((itemId, val) => {
    setChecked(p => ({ ...p, [itemId]: val }))
  }, [])

  const depts = useMemo(()=>['전체',...new Set(rows.map(r=>r.dept||'미지정'))],[rows])
  const vendorNames = useMemo(()=>['전체',...new Set(rows.map(r=>r.vendor?.name||'미지정'))],[rows])
  const allParents = useMemo(()=>['전체',...new Set(rows.flatMap(r=>r.parents))],[rows])
  const availableCats = useMemo(()=>{
    const present = new Set(rows.map(r=>getCategoryCode(r.std_code)).filter(Boolean))
    return ITEM_CATEGORIES.filter(c=>present.has(c.code))
  },[rows])
  const toggleCat = (code)=>setCatSel(prev=>{ const n=new Set(prev); n.has(code)?n.delete(code):n.add(code); return n })

  const filtered = useMemo(()=>{
    let r = typeTab==='전체' ? rows : rows.filter(x=>x.type===typeTab)
    if(deptFilter!=='전체') r=r.filter(x=>(x.dept||'미지정')===deptFilter)
    if(vendorFilter!=='전체') r=r.filter(x=>(x.vendor?.name||'미지정')===vendorFilter)
    if(parentFilter!=='전체') r=r.filter(x=>x.parents.includes(parentFilter))
    if(catSel.size) r=r.filter(x=>catSel.has(getCategoryCode(x.std_code)))
    return [...r].sort((a,b)=>{
      if(sortBy==='vendor') return (a.vendor?.name||'').localeCompare(b.vendor?.name||'')
      if(sortBy==='lt') return b.lt_weeks-a.lt_weeks
      if(sortBy==='dept') return (a.dept||'').localeCompare(b.dept||'')
      return b.orderNeed-a.orderNeed
    })
  },[rows,typeTab,deptFilter,vendorFilter,parentFilter,catSel,sortBy])

  const needOrder=filtered.filter(r=>r.orderNeed>0)
  const checkedItems=filtered.filter(r=>checked[r.item_id]&&r.orderNeed>0)
  const allChecked=needOrder.length>0&&needOrder.every(r=>checked[r.item_id])

  function exportExcel() {
    const data=filtered.map(r=>({
      '기준코드':r.std_code,'품명':r.name,'제조사':r.manufacturer||'','제조사품번':r.manufacturer_code||'','구분':r.type,'관리부서':r.dept||'',
      '구매처':r.vendor?.name||'','LT(주)':r.lt_weeks,'단위':r.unit,
      '총필요수량':r.total_need,'현재고':r.stock,'부족':r.lack>0?-r.lack:0,
      '구매발주미입고':r.pending,'타고객사PO':r.otherQty||0,'발주필요':r.orderNeed,
      '상위품목':r.parents.join(', '),
    }))
    const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),'부족자재')
    XLSX.writeFile(wb,`부족자재_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  const COLS = [
    {key:'std_code',label:'기준코드·품명'},{key:'type',label:'구분'},
    {key:'mfg',label:'제조사·품번'},
    {key:'dept',label:'관리부서'},{key:'vendor',label:'구매처'},{key:'lt',label:'LT'},
    {key:'need',label:'필요수량'},{key:'stock',label:'현재고'},
    {key:'lack',label:'부족',style:{background:'#FFF7ED',color:'#92400E'}},
    {key:'pending',label:'미입고',style:{background:'#F0FDF4',color:'#065F46'}},
    {key:'other',label:'타고객사PO',style:{background:'#EEF2FF',color:'#3730A3'}},
    {key:'order_need',label:'발주필요',style:{background:'#FEF2F2',color:'#991B1B'}},
    {key:'parents',label:'상위품목'},
  ]

  return (
    <div className="space-y-4">
      <CustomerTabs />
      <ShortageTabs cs={csCode} />

      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[['monthly','🎯 쇼티지 (통합)'],['list','📋 발주 상세']].map(([k,l])=>(
          <button key={k} onClick={()=>setView(k)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${view===k?'bg-white text-slate-900 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{l}</button>
        ))}
      </div>

      {view==='monthly' && <ShortageMonthly csId={cs?.id} />}

      {view==='list' && (<>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {['전체','가공','자재'].map(t=>(
            <button key={t} onClick={()=>setTypeTab(t)}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${typeTab===t?'bg-white text-slate-900 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{t}</button>
          ))}
        </div>
        <select value={deptFilter} onChange={e=>setDeptFilter(e.target.value)} className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none">
          {depts.map(d=><option key={d}>{d}</option>)}
        </select>
        <select value={vendorFilter} onChange={e=>setVendorFilter(e.target.value)} className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none">
          {vendorNames.map(v=><option key={v}>{v}</option>)}
        </select>
        <select value={parentFilter} onChange={e=>setParentFilter(e.target.value)} className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none">
          {allParents.map(p=><option key={p}>{p}</option>)}
        </select>
        <select value={sortBy} onChange={e=>setSortBy(e.target.value)} className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none">
          <option value="order_need">발주필요순</option>
          <option value="vendor">구매처별</option>
          <option value="dept">부서별</option>
          <option value="lt">LT순</option>
        </select>
        <button onClick={resetWidths} className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1.5 border border-slate-200 rounded-lg">열 초기화</button>
        {excluded.size>0&&(
          <button onClick={()=>{ qc.invalidateQueries(['shortage',cs?.id]); setExcluded(new Set()) }}
            className="text-xs font-semibold text-rose-500 hover:text-rose-600 px-2 py-1.5 border border-rose-200 bg-rose-50 rounded-lg">
            제외 {excluded.size}건 반영 ↻
          </button>
        )}
        <div className="flex-1"/>
        {checkedItems.length>0&&(
          <button onClick={()=>setShowOrderForm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
            📋 선택 {checkedItems.length}건 구매발주
          </button>
        )}
        <button onClick={exportExcel} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">📥 엑셀 추출</button>
      </div>

      {/* 카테고리 다중선택 (JS- 코드 전환 후 자동 표시) */}
      {availableCats.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-slate-400 font-semibold mr-1">카테고리</span>
          {availableCats.map(c => {
            const on = catSel.has(c.code)
            return (
              <button key={c.code} onClick={() => toggleCat(c.code)} title={c.desc}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-full border transition-colors ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                {c.name}
              </button>
            )
          })}
          {catSel.size > 0 && (
            <button onClick={() => setCatSel(new Set())} className="px-2 py-1 text-[11px] text-slate-400 hover:text-slate-600">초기화</button>
          )}
        </div>
      )}

      {showOrderForm&&(
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
          <p className="text-xs font-bold text-slate-700">구매발주 일괄 생성 — {checkedItems.length}개 품목</p>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden max-h-48 overflow-y-auto">
            <table className="w-full text-xs"><thead><tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-3 py-2 text-left font-bold text-slate-400">기준코드</th>
              <th className="px-3 py-2 text-left font-bold text-slate-400">품명</th>
              <th className="px-3 py-2 text-right font-bold text-slate-400">발주필요</th>
              <th className="px-3 py-2 text-right font-bold text-slate-400">발주수량</th>
            </tr></thead><tbody>
              {checkedItems.map(r=>(
                <tr key={r.item_id} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs text-indigo-600">{r.std_code}</td>
                  <td className="px-3 py-2 text-slate-700">{r.name}</td>
                  <td className="px-3 py-2 text-right font-semibold text-red-600">{r.orderNeed}</td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" defaultValue={r.orderNeed} onChange={e=>{r.order_qty=Number(e.target.value)}}
                      className="w-20 px-2 py-1 text-xs border border-slate-200 rounded text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"/>
                  </td>
                </tr>
              ))}
            </tbody></table>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs font-bold text-slate-500 mb-1">발주번호</label>
              <input value={poNumber} onChange={e=>setPoNumber(e.target.value)} placeholder="비우면 자동부여"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">구매처</label>
              <VendorPicker value={selVendor} onChange={id=>setSelVendor(id)} />
            </div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">납기 약속일</label>
              <input type="date" value={promiseDate} onChange={e=>setPromiseDate(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={()=>setShowOrderForm(false)} className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">취소</button>
            <button onClick={()=>orderMut.mutate(checkedItems.map(r=>({...r,order_qty:r.order_qty||r.orderNeed})))} disabled={orderMut.isPending}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
              {orderMut.isPending?'생성 중...':'⚡ 구매발주 생성'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-xl border border-red-200 bg-red-50 p-3"><p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-1">발주필요</p><p className="text-xl font-bold text-red-600">{needOrder.length}</p></div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-bold text-amber-500 uppercase tracking-wide mb-1">부족 품목</p><p className="text-xl font-bold text-amber-700">{filtered.filter(r=>r.lack>0).length}</p></div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-xs font-bold text-emerald-500 uppercase tracking-wide mb-1">미입고</p><p className="text-xl font-bold text-emerald-700">{filtered.reduce((a,r)=>a+r.pending,0)}</p></div>
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3"><p className="text-xs font-bold text-indigo-400 uppercase tracking-wide mb-1">선택됨</p><p className="text-xl font-bold text-indigo-600">{checkedItems.length}</p></div>
      </div>

      {isLoading ? <div className="text-center py-12 text-slate-400 text-sm">계산 중...</div> : (
        <>
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
                    <th key={c.key} className="relative group/th px-2 py-2.5 text-left font-bold text-slate-400 text-xs uppercase tracking-wide whitespace-nowrap overflow-hidden" style={c.style||{}}>
                      {c.label}
                      <ResizeHandle onMouseDown={e=>startResize(e,c.key)}/>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length===0 ? (
                  <tr><td colSpan={COLS.length+1} className="text-center py-10 text-slate-400">BOM 또는 고객사 PO 데이터를 먼저 등록하세요</td></tr>
                ) : filtered.map(r=>(
                  <ShortageRow key={r.item_id} r={r}
                    isExcluded={excluded.has(r.item_id)} isChecked={!!checked[r.item_id]}
                    timingShort={timingMap[r.item_id]}
                    onExclude={handleExclude} onToggleCheck={handleToggleCheck} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-xs text-slate-400">💡 열 헤더 오른쪽 끝을 드래그하면 너비를 조절할 수 있어요 · 상위품목 필터로 특정 어셈블리만 볼 수 있어요</p>
        </>
      )}
      </>)}
    </div>
  )
}
