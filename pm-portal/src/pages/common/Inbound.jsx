import { useState, useMemo, useEffect, useCallback } from 'react'
import { useVisibleRows, MoreRows } from '../../hooks/useVisibleRows'
import { useDebounced } from '../../hooks/useDebounced'
import { refreshProcurement } from '../../lib/refresh'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useCustomers } from '../../hooks/useCustomers'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCanEdit } from '../../hooks/useProfile'
import { supabase } from '../../lib/supabase'
import { useRowSelect } from '../../hooks/useRowSelect'
import { logActivity } from '../../lib/activityLog'
import AutoInput from '../../components/AutoInput'
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
      .eq('order_type','purchase').not('status','in','(완료,취소)')
    if (customerId) q = q.eq('customer_id', customerId)
    if (vendorId) q = q.eq('vendor_id', vendorId)
    return q.order('order_date', { ascending: true }).order('id', { ascending: true })
  }
  return await fetchAll(make)
}
async function fetchInboundHistory({ from, to, customerId, vendorId }) {
  // movement_date가 null인 경우 created_at 기준으로 대체 조회
  // po_id로 발주(purchase_orders)를 조인해 발주 당시 구매처(vendor)를 가져옴
  // (item의 기본 vendor가 아니라, 실제 발주한 구매처를 표시하기 위함)
  // 500건에서 잘리던 것을 5,000건까지 넓혔다.
  // 그 이상은 기간을 좁히는 것이 맞고, 화면 표시는 '더 보기'로 나눈다.
  const CAP = 5000
  const PAGE = 1000
  let data = []
  for (let off = 0; off < CAP; off += PAGE) {
    const { data: batch, error } = await supabase.from('stock_movements')
      .select('*, items(std_code,name,unit,manufacturer,manufacturer_code), customers(name,code), purchase_orders(po_number, vendors(name), projects(code))')
      .eq('movement_type','입고')
      .gte('movement_date', from)
      .lte('movement_date', to)
      .order('movement_date', { ascending: false }).order('id', { ascending: true })
      .range(off, off + PAGE - 1)
    if (error) throw error
    data = data.concat(batch || [])
    if (!batch || batch.length < PAGE) break
  }
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
  logActivity('create', 'stock_movements', null,
    `입고 처리 ${lines.length}건 · ${inboundDate}${note ? ` · ${note}` : ''}`)
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
  // 발주 목록이 많으면 한 글자마다 다시 거르느라 입력이 멈춘다
  const dRowSearch = useDebounced(rowSearch, 250)
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
  const [cartOpen, setCartOpen] = useState(true)   // 담은 품목 패널
  const [hVendorText, setHVendorText] = useState('')
  const [hItem, setHItem] = useState('')
  // 입력이 멈춘 뒤 거른다 — 한 글자마다 전체를 훑으면 느려진다
  const dHVendor = useDebounced(hVendorText, 250)
  const dHItem = useDebounced(hItem, 250)
  const [hQuery, setHQuery] = useState({ from: monthAgoStr(), to: todayStr(), customerId:'', vendorId:'' })
  const [selHist, setSelHist] = useState(new Set())

  const { data: customers=[] } = useCustomers()
  // 발주외 품목 자동완성 (공용 AutoInput 사용)
  const fetchDirectSuggest = async (q) => {
    const { data } = await supabase.from('items').select('id,std_code,name,unit,manufacturer_code')
      .or(`std_code.ilike.%${q}%,name.ilike.%${q}%,manufacturer_code.ilike.%${q}%,manufacturer.ilike.%${q}%,spec.ilike.%${q}%`).limit(20)
    return data || []
  }
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
  // 다시 불러오는 동안에도 이전 목록을 그대로 보여준다.
  //   담아둔 품목이 사라졌다가 돌아오면 입력하던 흐름이 끊긴다.
  const { data: pendingPOs=[], isLoading, refetch } = useQuery({
    queryKey:['pendingPOs',selCustomer],
    queryFn:()=>fetchPendingPOs(selCustomer||null, null),
    placeholderData: (prev) => prev,
  })
  const { data: history=[], isLoading: histLoading } = useQuery({
    queryKey:['inboundHistory', hQuery],
    queryFn:()=>fetchInboundHistory({ from:hQuery.from, to:hQuery.to, customerId:hQuery.customerId, vendorId:hQuery.vendorId }),
    enabled: tab==='history',
    placeholderData: (prev) => prev,
  })

  const inboundMut = useMutation({
    mutationFn: () => { if (!guardEdit()) throw new Error('__READONLY__'); return processInbound({ items: checkedRows, inboundData, note, inboundDate }) },
    onSuccess: () => {
      setResult(`입고 처리 완료 (${inboundDate}) — ${checkedRows.length}건`)
      // 검색어도 함께 지운다. 다음 명세표로 넘어갈 때 매번 지우는 수고를 던다.
      setInboundData({}); setChecked({}); setNote(''); setRowSearch('')
      refreshProcurement(qc)
      // 입고 현황 캐시 명시적 갱신 (hQuery 포함 키까지 확실히 무효화)
      qc.invalidateQueries({ queryKey:['inboundHistory'], exact:false })
      refetch()
    },
    onError: (e) => { if (e.message !== '__READONLY__') toastError('오류: ' + e.message) },
  })

  // 입고일만 바꾼다. 8월에 잡은 것을 9월로 이월하는 경우가 있다.
  //   지웠다 다시 넣으면 재고가 두 번 움직여 위험하므로 날짜만 고친다.
  const [dateForm, setDateForm] = useState(null)   // { date, memo }

  const dateMut = useMutation({
    mutationFn: async ({ ids, date, memo }) => {
      if (!guardEdit()) throw new Error('__READONLY__')
      const { data, error } = await supabase.rpc('pm_movement_date_change',
        { p_ids: ids, p_date: date, p_memo: memo || null })
      if (error) throw error
      return Array.isArray(data) ? data[0] : data
    },
    onSuccess: (r) => {
      if (Number(r?.skipped) > 0) toastError(`${r.updated}건 변경 · ${r.note || ''}`)
      else toastSuccess(`${r?.updated ?? 0}건 입고일 변경`)
      setDateForm(null); setSelHist(new Set())
      qc.invalidateQueries({ queryKey:['inboundHistory'], exact:false })
      refetch()
    },
    onError: (e) => { if (e.message !== '__READONLY__') toastError('입고일 변경 오류: ' + e.message) },
  })

  const delHistMut = useMutation({
    mutationFn: async (ids) => {
      if (!guardEdit()) throw new Error('__READONLY__')
      // 지우기 전에 기록을 남긴다. 재고까지 함께 바뀌어 되돌리기 어렵기 때문이다.
      const { data, error } = await supabase.rpc('pm_movement_delete_safe', { p_ids: ids })
      if (error) throw error
      return Array.isArray(data) ? data[0] : data
    },
    onSuccess: (r) => {
      if (r?.snap_id) toastSuccess(`${r.cnt}건 삭제 — 되돌리려면 복구 기록 #${r.snap_id}`)
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
    const q = dRowSearch.trim().toLowerCase()
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
  }, [pendingPOs, dRowSearch, vendorText, sort])

  // 발주가 수천 건이면 검색·체크 조작이 밀린다
  const vis = useVisibleRows(rows, 150, [dRowSearch, vendorText, sort])
  // 행을 끌어 여러 건을 한 번에 고를 수 있게 한다.
  // 선택될 때 입고 수량 기본값(잔량)을 함께 채운다.
  const { rowProps } = useRowSelect(useCallback((updater) => {
    setChecked(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      const added = Object.keys(next).filter(id => next[id] && !prev[id])
      if (added.length) {
        setInboundData(d => {
          const nd = { ...d }
          added.forEach(id => {
            if (!nd[id]) {
              const po = rows.find(r => r.id === id)
              if (po) nd[id] = { qty: po.qty_remaining || 0, unit_price: po.unit_price || '' }
            }
          })
          return nd
        })
      }
      return next
    })
  }, [rows]))

  function toggleRow(po) {
    setChecked(prev => ({ ...prev, [po.id]: !prev[po.id] }))
    setInboundData(prev => prev[po.id] ? prev : ({ ...prev, [po.id]: { qty: po.qty_remaining||0, unit_price: po.unit_price||'' } }))
  }
  // 지금 보이는 것만 토글한다. 검색 밖에서 담아둔 건은 건드리지 않는다.
  function toggleAll() {
    const allOn = rows.length > 0 && rows.every(r => checked[r.id])
    setChecked(prev => {
      const next = { ...prev }
      rows.forEach(r => { if (allOn) delete next[r.id]; else next[r.id] = true })
      return next
    })
    if (!allOn) {
      setInboundData(prev => {
        const d = { ...prev }
        rows.forEach(r => {
          if (!d[r.id]) d[r.id] = { qty: r.qty_remaining || 0, unit_price: r.unit_price || '' }
        })
        return d
      })
    }
  }
  function updateData(id, field, val) {
    setInboundData(prev => ({ ...prev, [id]: { ...prev[id], [field]: val } }))
  }

  // 검색 결과(rows)가 아니라 전체(pendingPOs)에서 고른다.
  // 검색어를 바꿔도 앞서 체크한 건이 사라지지 않아야
  // 여러 품목을 찾아가며 담을 수 있다.
  const checkedRows = pendingPOs.filter(r => checked[r.id])
  const hasInput = checkedRows.some(r => inboundData[r.id]?.qty && Number(inboundData[r.id].qty) > 0)

  // 선택한 건의 공급가 합계 — 명세표와 대조할 때 쓴다.
  // 단가를 안 넣었으면 발주 단가를 쓴다.
  const checkedAmt = checkedRows.reduce((sum, r) => {
    const d = inboundData[r.id] || {}
    const qty = Number(d.qty) || 0
    // 빈 문자열은 ?? 로 안 걸러진다. 값이 실제로 있을 때만 쓴다.
    const price = Number(
      d.unit_price !== '' && d.unit_price != null ? d.unit_price : r.unit_price
    ) || 0
    return sum + qty * price
  }, 0)
  // 검색은 디바운스된 값으로 거른다.
  // 한 글자마다 전체를 훑으면 건수가 많을 때 입력이 밀린다.
  const histShown = useMemo(() => {
    const vq = dHVendor.trim().toLowerCase()
    const iq = dHItem.trim().toLowerCase()
    if (!vq && !iq) return history || []
    return (history || []).filter(r => {
      const vname = (r.purchase_orders?.vendors?.name || r.items?.vendors?.name || '').toLowerCase()
      if (vq && !vname.includes(vq)) return false
      if (iq) {
        // 기준코드·품명뿐 아니라 제조사·제조사품번으로도 찾는다
        const hay = `${r.items?.std_code || ''} ${r.items?.name || ''} ${r.items?.manufacturer || ''} ${r.items?.manufacturer_code || ''}`.toLowerCase()
        if (!hay.includes(iq)) return false
      }
      return true
    })
  }, [history, dHVendor, dHItem])
  const histTotal = histShown.reduce((a,r)=>a+r.qty,0)
  // 화면에는 200건씩 그린다. 수천 건을 한 번에 그리면 검색이 밀린다.
  const hVis = useVisibleRows(histShown, 200, [dHVendor, dHItem, hQuery])

  function exportHistory() {
    const data = histShown.map(r=>({
      '입고일':r.movement_date, '기준코드':r.items?.std_code, '품명':r.items?.name,
      '단위':r.items?.unit, '수량':r.qty,
      '단가':Number(r.unit_price)||0,
      '금액':(Number(r.qty)||0) * (Number(r.unit_price)||0),
      '발주번호':r.purchase_orders?.po_number||'',
      '구매처':r.purchase_orders?.vendors?.name||'', '고객사':r.customers?.name||'',
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
          <CsTabs sel={selCustomer} onSel={setSelCustomer} customers={customers} />
          {/* 위가 길면 표가 그만큼 밀린다. 라벨을 빼고 한 줄로 눕힌다. */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 flex-wrap">
            <input value={vendorText} onChange={e=>setVendorText(e.target.value)} placeholder="구매처명 검색"
              className="w-44 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            <span className="text-xs text-slate-400">입고일</span>
            <input type="date" value={inboundDate} onChange={e=>setInboundDate(e.target.value)}
              className={`px-2.5 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                inboundDate !== todayStr() ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white'}`}/>
            {inboundDate !== todayStr() && (
              <button onClick={()=>setInboundDate(todayStr())}
                className="text-xs text-indigo-500 hover:text-indigo-700 font-semibold">오늘로</button>
            )}
            <div className="ml-auto text-xs text-slate-400 self-center whitespace-nowrap">
              미입고 {rows.length}건
              {checkedRows.length > 0 && ` · 선택 ${checkedRows.length}`}
              {checkedAmt > 0 && (
                <> · <b className="text-slate-600">{checkedAmt.toLocaleString('ko-KR')}</b>원</>
              )}
            </div>
          </div>

          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 font-semibold flex items-center">
              ✅ {result}
              <button onClick={()=>setResult(null)} className="ml-auto text-emerald-400">✕</button>
            </div>
          )}

          {/* 담아둔 것 — 검색을 바꿔도 남아 있어야 여러 품목을 찾아가며 담을 수 있다 */}
          {/* 담을 때마다 이 칸이 커지면 아래 표가 밀려 누르던 자리가 어긋난다.
              네 줄 높이를 미리 잡아 두고 그 안에서만 늘어나게 한다. */}
          <div className={`rounded-xl border-2 overflow-hidden ${
            checkedRows.length > 0 ? 'border-indigo-300 bg-indigo-50/50' : 'border-slate-200 bg-slate-50'}`}>
              <div className={`px-3.5 py-2.5 flex items-center gap-2 flex-wrap ${
                checkedRows.length > 0 ? 'border-b border-indigo-200' : ''}`}>
                <span className={`text-xs font-bold ${checkedRows.length > 0 ? 'text-indigo-700' : 'text-slate-400'}`}>
                  {checkedRows.length > 0 ? `담은 품목 ${checkedRows.length}건` : '담은 품목 없음 — 아래에서 체크하세요'}
                </span>
                {checkedAmt > 0 && (
                  <span className="text-xs font-bold text-slate-700">
                    {checkedAmt.toLocaleString('ko-KR')}원
                  </span>
                )}
                {checkedRows.length > 0 && (<>
                  <button onClick={() => setCartOpen(v => !v)}
                    className="text-[11px] text-indigo-600 font-semibold hover:underline">
                    {cartOpen ? '접기 ▲' : '펼치기 ▼'}
                  </button>
                  <button onClick={() => { setChecked({}); setInboundData({}) }}
                    className="ml-auto text-[11px] text-slate-400 hover:text-rose-500">
                    전체 해제
                  </button>
                </>)}
              </div>

              {cartOpen && (
                <div className="h-[148px] overflow-y-auto divide-y divide-indigo-100">
                  {checkedRows.map(r => {
                    const d = inboundData[r.id] || {}
                    const qty = Number(d.qty) || 0
                    const price = Number(
                      d.unit_price !== '' && d.unit_price != null ? d.unit_price : r.unit_price
                    ) || 0
                    return (
                      <div key={r.id} className="px-3.5 py-2 flex items-center gap-2 text-xs bg-white/60">
                        <span className="font-mono text-indigo-600 w-28 flex-shrink-0 truncate">
                          {r.items?.std_code || '-'}
                        </span>
                        <span className="text-slate-600 flex-1 min-w-0 truncate">
                          {r.items?.name}
                          {r.memo && (
                            <span className="ml-1 px-1 rounded bg-amber-50 text-amber-700 text-[10px]" title={r.memo}>{r.memo}</span>
                          )}
                        </span>
                        <span className="text-slate-400 w-20 flex-shrink-0 truncate text-right">
                          {r.vendors?.name || ''}
                        </span>
                        {/* 검색을 바꾸면 그 건이 표에서 사라져 수량을 고칠 수 없다.
                            부분 입고가 흔하므로 여기서 바로 고치게 한다. */}
                        <span className="flex items-center gap-0.5 flex-shrink-0">
                          <input type="number" min="0" value={d.qty ?? ''}
                            onChange={e => updateData(r.id, 'qty', e.target.value)}
                            className="w-14 px-1 py-0.5 text-right font-bold border border-slate-200 rounded" />
                          <span className="text-slate-400 w-8">/{r.qty_remaining}</span>
                        </span>
                        <span className="w-20 flex-shrink-0 text-right text-slate-600">
                          {(qty * price).toLocaleString('ko-KR')}
                        </span>
                        <button onClick={() => {
                            setChecked(prev => { const n = { ...prev }; delete n[r.id]; return n })
                          }}
                          className="text-slate-300 hover:text-rose-500 px-1 flex-shrink-0">✕</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">미입고 발주 — 들어온 품목 체크 후 일괄 입고</p>
              <input value={rowSearch} onChange={e=>setRowSearch(e.target.value)}
                placeholder="제조사·제조사품번·기준코드·품명 검색"
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
              <span className="ml-auto text-xs text-slate-400">정렬: {(PROC_COLS.find(c=>c.key===sort.key)?.label)||''} {sort.dir==='asc'?'▲':'▼'} · {rows.length}건</span>
            </div>

            {isLoading && !pendingPOs.length ? <div className="text-center py-8 text-slate-400 text-xs">불러오는 중...</div>
            : rows.length === 0
              ? <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-400 text-xs">
                  미입고 발주가 없습니다
                </div>
              : (
                <div className="rounded-xl border border-slate-200 overflow-x-auto">
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
                        {vis.shown.map(po=>{
                          const on = !!checked[po.id]
                          const delayed = po.promise_date && po.promise_date < today
                          return (
                            <tr key={po.id} {...rowProps(po.id, on)}
                              className={`border-b border-slate-100 cursor-pointer select-none ${on?'bg-indigo-50':'hover:bg-slate-50'}`}>
                              <td className="px-2 py-2 text-center" onClick={e=>e.stopPropagation()}>
                                <input type="checkbox" checked={on} onChange={()=>toggleRow(po)} />
                              </td>
                              <td className="px-3 py-2 text-slate-500">{po.order_date||'-'}</td>
                              <td className="px-3 py-2 text-slate-500">{po.promise_date||'-'}{delayed && <span className="ml-1 text-red-500 font-bold">지연</span>}</td>
                              <td className="px-3 py-2">
                                <div className="font-mono text-indigo-600 truncate max-w-[160px]">{po.items?.std_code}</div>
                                <div className="text-[11px] text-slate-500 truncate max-w-[160px]">{po.items?.name||''}</div>
                                {/* 발주할 때 적어 둔 메모. 입고 때도 봐야 한다. */}
                                {po.memo && (
                                  <div className="text-[11px] text-amber-700 bg-amber-50 rounded px-1 mt-0.5 truncate max-w-[160px]"
                                    title={po.memo}>{po.memo}</div>
                                )}
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
                    <MoreRows {...vis} />
                  </div>

                  <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center gap-3 flex-wrap">
                    <input value={note} onChange={e=>setNote(e.target.value)} placeholder="입고 비고 (선택)"
                      className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                    <p className="text-xs text-slate-400 whitespace-nowrap">
                      입고일 <span className="font-semibold text-indigo-600">{inboundDate}</span>
                      {' · 선택 '}<span className="font-semibold text-indigo-600">{checkedRows.length}</span>건
                      {checkedAmt > 0 && (
                        <>
                          {' · '}
                          <span className="font-bold text-slate-700">{checkedAmt.toLocaleString('ko-KR')}</span>
                          <span className="text-slate-400">원</span>
                        </>
                      )}
                    </p>
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
                <AutoInput value={dSearch} setValue={setDSearch} buttonLabel={null}
                  fetchSuggest={fetchDirectSuggest} keyName="directItemSuggest"
                  onPick={it => setDItem(it)}
                  placeholder="기준코드·품명·제조사품번 검색 (2글자↑)"
                  renderSuggest={it => (<>
                    <div className="font-mono text-xs text-indigo-600">{it.std_code}</div>
                    <div className="text-[11px] text-slate-500 truncate">{it.name}{it.manufacturer_code ? ` · ${it.manufacturer_code}` : ''}</div>
                  </>)} />
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
          <CsTabs sel={hCustomer} onSel={setHCustomer} customers={customers} />
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
              <label className="block text-xs font-bold text-slate-500 mb-1">구매처 검색</label>
              <input value={hVendorText} onChange={e=>setHVendorText(e.target.value)} placeholder="구매처명 입력"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">품번 검색</label>
              <input value={hItem} onChange={e=>setHItem(e.target.value)} placeholder="기준코드·품명·제조사·제조사품번"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>
            <button onClick={()=>setHQuery({from:hFrom,to:hTo,customerId:hCustomer,vendorId:null})}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">조회</button>
            {histShown.length>0&&(
              <button onClick={exportHistory}
                className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">📥 엑셀</button>
            )}
            {selHist.size>0&&(<>
              <button onClick={()=>setDateForm({ date:'', memo:'' })}
                title="수량·단가·재고는 그대로 두고 날짜만 바꿉니다"
                className="px-3 py-2 text-xs font-bold rounded-lg border border-indigo-200 text-indigo-600 bg-white hover:bg-indigo-50">
                📅 입고일 변경 {selHist.size}건</button>
              <button onClick={()=>{
                  if(window.confirm(`선택한 입고 이력 ${selHist.size}건을 삭제할까요?\n재고와 입고수량(qty_received)도 그만큼 되돌립니다.`))
                    delHistMut.mutate([...selHist])
                }} disabled={delHistMut.isPending}
                className="px-3 py-2 text-xs font-bold rounded-lg border border-red-200 text-red-600 bg-white hover:bg-red-50 disabled:opacity-40">
                🗑 선택 {selHist.size}건 삭제</button>
            </>)}
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
            <div className="rounded-xl border border-slate-200 overflow-x-auto">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2.5 w-8">
                      <input type="checkbox"
                        checked={histShown.length>0 && selHist.size===histShown.length}
                        onChange={e=>setSelHist(e.target.checked ? new Set(histShown.map(r=>r.id)) : new Set())}/>
                    </th>
                    {['입고일','기준코드','품명','수량','단위','단가','금액','발주번호','상위품목','구매처','고객사','비고'].map(h=>(
                      <th key={h} className="px-3 py-2.5 text-left font-bold text-slate-400 text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {histShown.length===0
                      ? <tr><td colSpan={13} className="text-center py-10 text-slate-400">입고 이력이 없습니다</td></tr>
                      : hVis.shown.map(r=>(
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
                          <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">
                            {r.unit_price ? Number(r.unit_price).toLocaleString('ko-KR') : '-'}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-700 whitespace-nowrap">
                            {r.unit_price ? (Number(r.qty) * Number(r.unit_price)).toLocaleString('ko-KR') : '-'}
                          </td>
                          <td className="px-3 py-2">{r.po_id ? <span className="font-mono text-slate-500">{r.purchase_orders?.po_number||'-'}</span> : <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 text-[10px] font-bold">발주외</span>}</td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-400">{r.purchase_orders?.projects?.code||'-'}</td>
                          <td className="px-3 py-2 text-slate-500">{r.purchase_orders?.vendors?.name||'-'}</td>
                          <td className="px-3 py-2 text-slate-500">{r.customers?.name||'-'}</td>
                          <td className="px-3 py-2 text-slate-400">{r.memo||r.note||'-'}</td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
                <MoreRows {...hVis} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 입고일 변경 — 날짜만 바꾼다 */}
      {dateForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={()=>setDateForm(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3"
            onClick={e=>e.stopPropagation()}>
            <div>
              <h3 className="text-base font-bold text-slate-900">📅 입고일 변경</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {selHist.size}건. 수량·단가·재고는 그대로 두고 날짜만 바꿉니다.
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">바꿀 입고일 *</label>
              <input type="date" value={dateForm.date}
                onChange={e=>setDateForm(v=>({ ...v, date:e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {[['오늘',0],['이번 달 1일','m0'],['지난달 말일','mEnd']].map(([l,k])=>(
                  <button key={l}
                    onClick={()=>{
                      const d=new Date(); let x
                      if(k===0) x=d
                      else if(k==='m0') x=new Date(d.getFullYear(), d.getMonth(), 1)
                      else x=new Date(d.getFullYear(), d.getMonth(), 0)
                      const p=n=>String(n).padStart(2,'0')
                      setDateForm(v=>({ ...v,
                        date:`${x.getFullYear()}-${p(x.getMonth()+1)}-${p(x.getDate())}` }))
                    }}
                    className="px-2 py-1 text-[11px] font-bold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">사유 (선택)</label>
              <input value={dateForm.memo}
                onChange={e=>setDateForm(v=>({ ...v, memo:e.target.value }))}
                placeholder="예: 9월로 이월"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              바꾼 내역은 기록에 남습니다. 입고가 아닌 줄이 섞여 있으면 처리되지 않습니다.
            </p>

            <div className="flex gap-2">
              <button onClick={()=>setDateForm(null)}
                className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600">
                취소
              </button>
              <button
                onClick={()=>{
                  if(!dateForm.date){ toastError('바꿀 날짜를 넣으세요'); return }
                  dateMut.mutate({ ids:[...selHist], date:dateForm.date, memo:dateForm.memo.trim() })
                }}
                disabled={dateMut.isPending}
                className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                {dateMut.isPending ? '처리 중…' : `${selHist.size}건 변경`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// 고객사 탭. 구매발주와 같은 모양으로 맞춘다.
//   드롭다운은 지금 뭘 보고 있는지 한눈에 안 들어온다.
const CS_COLOR = { ax: '#8b5cf6', ed: '#3b82f6', vm: '#10b981', csk: '#f59e0b' }

function CsTabs({ sel, onSel, customers }) {
  return (
    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit mb-3">
      <button onClick={() => onSel('')}
        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
          !sel ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
        전체
      </button>
      {customers.map(c => (
        <button key={c.id} onClick={() => onSel(c.id)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
            sel === c.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          <span className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: CS_COLOR[String(c.code || '').toLowerCase()] || '#94a3b8' }} />
          {c.name}
        </button>
      ))}
    </div>
  )
}
