import { useState, useMemo, useRef, useEffect } from 'react'
import { useDebounced } from '../../hooks/useDebounced'
import { useCustomer } from '../../hooks/useCustomers'
import { PROC_CATS, catOf, todayISO } from '../../lib/utils'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useRowSelect } from '../../hooks/useRowSelect'
import { logActivity } from '../../lib/activityLog'
import { fetchAll } from '../../lib/paginate'
import { ResizableTable } from '../../components/ResizableTable'
import * as XLSX from 'xlsx'
import CustomerTabs from '../../components/CustomerTabs'


function monthAgoStr() {
  const d = new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().split('T')[0]
}

async function fetchVendors() {
  const { data } = await supabase.from('vendors').select('id,name,ecount_code').order('name')
  return data || []
}
async function fetchPurchases(csId) {
  if (!csId) return []
  const today = new Date().toISOString().split('T')[0]
  const data = await fetchAll(() => supabase
    .from('purchase_orders')
    .select('*, items!purchase_orders_item_id_fkey(std_code,name,type,js_code,lt_weeks,manufacturer,manufacturer_code), vendors(name,ecount_code,payment_terms), projects(code,name)')
    .eq('customer_id', csId).eq('order_type','purchase').not('status','in','(완료,취소)')
    .order('promise_date', { ascending: true }))
  return (data||[]).map(p=>({ ...p, isDelayed: p.promise_date && p.promise_date < today }))
}
async function fetchPurchaseHistory(csId, from, to) {
  if (!csId) return []
  const { data, error } = await supabase.from('stock_movements')
    .select('*, items(std_code,name,unit), purchase_orders(po_number,unit_price,vendor_id,project_id,vendors(name),projects(code,name))')
    .eq('movement_type','입고')
    .gte('movement_date', from)
    .lte('movement_date', to)
    .order('movement_date', { ascending: false })
    .limit(2000)   // 발주가 쌓이므로 넉넉히. 화면 표시는 더 보기로 나눈다
  if (error) throw error
  // customer_id 필터 (purchase_orders 통해서)
  const poIds = (data||[]).filter(r=>r.purchase_orders).map(r=>r.purchase_orders)
  // customer_id 직접 필터 안 되므로 별도 조회
  const myPOs = await fetchAll(() => supabase.from('purchase_orders').select('id').eq('customer_id', csId).eq('order_type','purchase'))
  const myPOIds = new Set((myPOs||[]).map(p=>p.id))
  return (data||[]).filter(r=>myPOIds.has(r.po_id)).map(r=>({
    ...r,
    movement_date: r.movement_date,
    supply: r.qty * (r.purchase_orders?.unit_price||0),
  }))
}

async function genPoNumber(dateStr) {
  // 발주일 기준으로 번호를 만든다 (과거 날짜로 등록해도 그 날짜 번호가 나오도록)
  const d = dateStr ? new Date(dateStr) : new Date()
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

  // 거래처코드 + 발주일자 순 정렬 (같은 묶음끼리 인접)
  const sorted = [...items].sort((a, b) => {
    const va = vendorMap[a.vendor_id]?.ecount_code || ''
    const vb = vendorMap[b.vendor_id]?.ecount_code || ''
    if (va !== vb) return va.localeCompare(vb)
    return String(a.order_date||'').localeCompare(String(b.order_date||''))
  })

  // 순번: (거래처코드 + 발주일자) 조합 같으면 동일 순번
  const seqMap = {}; let seq = 0
  const rows = sorted.map((po) => {
    const vendor = po.vendor_id ? vendorMap[po.vendor_id] : null
    const orderYmd = (po.order_date || '').replace(/-/g, '')
    const gkey = `${vendor?.ecount_code||''}|${orderYmd}`
    if (!(gkey in seqMap)) { seq += 1; seqMap[gkey] = seq }
    const qty = po.qty_ordered||0, price = po.unit_price||0
    const supply = Math.round(qty*price), vat = Math.round(supply*0.1)
    const spec = [po.items?.manufacturer, po.items?.manufacturer_code].filter(Boolean).join(' ')  // 규격 = 제조사 제조사품번
    //          일자          순번          납기일자                        거래처코드              거래처명 담당자   거래유형 입고창고 통화 환율  프로젝트  배송지 메모        품목코드              품목명              규격  수량 단가  외화 공급가  부가세 적요
    return [orderYmd || yyyymmdd, String(seqMap[gkey]), po.promise_date?.replace(/-/g,'')||'', vendor?.ecount_code||'', '', '', '00022', '', '00009', '', '', '00012', '', po.memo||'', po.items?.std_code||'', po.items?.name||'', spec, qty, price, '', supply, vat, '']
    //                                                                                          거래처명↑ 담당자↑00022      입고창고↑00009        프로젝트↑00012
  })
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  // 모든 셀을 텍스트 형식으로 (00022, 앞자리 0 보존)
  const range = XLSX.utils.decode_range(ws['!ref'])
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C })
      const cell = ws[addr]
      if (cell) { cell.t = 's'; cell.v = cell.v == null ? '' : String(cell.v); cell.z = '@' }
    }
  }
  ws['!cols'] = headers.map(()=>({width:14}))
  XLSX.utils.book_append_sheet(wb, ws, '발주서')
  XLSX.writeFile(wb, `이카운트발주서_${yyyymmdd}.xlsx`)
}

const PO_COLS = [
  {key:'check',         label:'',         defaultWidth:36, sortable:false},
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
  {key:'memo',          label:'메모',     defaultWidth:110},
  {key:'status',        label:'상태',     defaultWidth:65},
  {key:'actions',       label:'',         defaultWidth:80, sortable:false},
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

const EMPTY = { po_number:'', type:'자재', qty_ordered:'', order_date:'', promise_date:'', unit_price:'', memo:'' }
const freshForm = () => ({ ...EMPTY, order_date: todayISO() })

// 발주 저장 시 최근 매입단가를 items.purchase_price에 반영
async function updateItemPrices(rows) {
  const seen = {}
  for (const r of rows) {
    const price = Number(r.unit_price)
    if (r.item_id && price > 0 && !seen[r.item_id]) {
      seen[r.item_id] = true
      await supabase.from('items').update({ purchase_price: price }).eq('id', r.item_id)
    }
  }
}

export default function PurchasePage() {
  const { customerId: csCode } = useParams()
  const qc = useQueryClient()
  const [tab, setTab] = useState('po') // po | history
  const [typeTab, setTypeTab] = useState('전체')
  const [search, setSearch] = useState('')  // 거래처·제조사·품번 검색
  // 발주가 수천 건이라 한 글자마다 필터·정렬을 다시 돌리면 입력이 멈춘다.
  // 입력은 즉시 반영하되(타이핑 끊김 없음) 실제 필터는 멈춘 뒤에 한 번만.
  const dq = useDebounced(search, 250)
  const [filterOrderDate, setFilterOrderDate] = useState('')  // 발주일자 필터 (이카운트 발주서용)
  // 납기 필터 — 임박 건을 골라 일괄 이월할 때 쓴다
  const [dueFilter, setDueFilter] = useState('')       // '' | over | d7 | d14 | month | next | range
  // 목록이 수백 건이면 폼에 글자 하나 칠 때마다 전부 다시 그려져 입력이 밀린다.
  // 기본 200건만 그리고 '더 보기'로 늘린다.
  const [visibleCount, setVisibleCount] = useState(200)
  const [dueFrom, setDueFrom] = useState('')
  const [dueTo, setDueTo] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(freshForm)
  const [editId, setEditId] = useState(null)
  const [itemSearch, setItemSearch] = useState('')
  const [itemResults, setItemResults] = useState([])
  const [selItem, setSelItem] = useState(null)
  const [selVendor, setSelVendor] = useState('')
  const [vendorSearch, setVendorSearch] = useState('')
  const [vendorOpen, setVendorOpen] = useState(false)
  const [checked, setChecked] = useState({})
  const [bulkPo, setBulkPo] = useState('')
  const [sort, setSort] = useState({ key:null, dir:'asc' })
  const [bulkOrderDate, setBulkOrderDate] = useState('')
  const [bulkPromiseDate, setBulkPromiseDate] = useState('')
  const [lines, setLines] = useState([])  // 다품목 담기
  const [showBulk, setShowBulk] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [showBom, setShowBom] = useState(false)
  const [bomProject, setBomProject] = useState(null)
  const [bomProjSearch, setBomProjSearch] = useState('')
  const [procOnly, setProcOnly] = useState(true)
  const [bomQtys, setBomQtys] = useState({})
  const [bomUnits, setBomUnits] = useState(1)  // 상위품번 제작 대수
  const [bomChecked, setBomChecked] = useState({})
  // 현황
  const [hFrom, setHFrom] = useState(monthAgoStr())
  const [hTo, setHTo] = useState(new Date().toISOString().split('T')[0])
  const [hQuery, setHQuery] = useState({ from:monthAgoStr(), to:new Date().toISOString().split('T')[0] })
  const [hItem, setHItem] = useState('')
  const [proposalMeta, setProposalMeta] = useState({})  // po.id -> {pay, note}
  const [overview, setOverview] = useState('')
  const [propSort, setPropSort] = useState({ key:null, dir:'asc' })

  const { data: cs } = useCustomer(csCode)
  const { data: vendors=[] } = useQuery({ queryKey:['vendors'], queryFn:fetchVendors })
  const { data: purchases=[], isLoading, error } = useQuery({
    queryKey:['purchase',cs?.id], queryFn:()=>fetchPurchases(cs?.id), enabled:!!cs?.id,
  })
  const { data: history=[], isLoading:histLoading } = useQuery({
    queryKey:['purchaseHist',cs?.id,hQuery],
    queryFn:()=>fetchPurchaseHistory(cs?.id, hQuery.from, hQuery.to),
    enabled:!!cs?.id && tab==='history',
  })
  const { rowProps } = useRowSelect(setChecked)

  const propItemIds = useMemo(()=>[...new Set(purchases.filter(p=>checked[p.id]).map(p=>p.item_id).filter(Boolean))], [purchases, checked])
  const { data: projHist={} } = useQuery({
    queryKey:['projHist', propItemIds.slice().sort().join(',')],
    queryFn: async () => {
      const { data } = await supabase.from('purchase_orders')
        .select('item_id, order_date, projects(code,name)')
        .in('item_id', propItemIds).not('project_id','is',null).order('order_date',{ascending:false})
      const map={}
      ;(data||[]).forEach(r=>{ if(!r.projects?.code) return; (map[r.item_id]=map[r.item_id]||[]).push(r.projects.code) })
      Object.keys(map).forEach(k=>{ map[k]=[...new Set(map[k])] })
      return map
    },
    enabled: tab==='proposal' && propItemIds.length>0,
  })
  const { data: projects=[] } = useQuery({
    queryKey:['pp-projects', cs?.id],
    queryFn: async () => { const { data } = await supabase.from('projects').select('id,code,name').eq('customer_id', cs?.id).order('code'); return data||[] },
    enabled: !!cs?.id,
  })
  const { data: bomRows=[], isLoading:bomLoading } = useQuery({
    queryKey:['pp-bom', cs?.id, bomProject?.id],
    queryFn: async () => {
      const { data } = await supabase.from('bom')
        .select('item_id, qty_per_unit, items!bom_item_id_fkey(std_code,name,type,js_code,unit,manufacturer,manufacturer_code,purchase_price,proc_order,vendor_id,vendors(name))')
        .eq('customer_id', cs?.id).eq('project_id', bomProject?.id)
      return data||[]
    },
    enabled: !!cs?.id && !!bomProject?.id,
  })

  const saveMut = useMutation({
    mutationFn: async (data) => {
      // 발주번호를 비워두면 자동 부여한다.
      //   같은 업체·같은 발주일 건이 이미 있으면 그 번호를 재사용해 한 발주서로 묶는다.
      //   (ecount 에 등록할 때 이 번호를 그대로 쓰면 양쪽이 맞춰진다)
      let poNum = data.po_number?.trim() || null
      if (!poNum && !editId && data.order_date) {
        // 업체·발주일·납기가 모두 같으면 한 발주서로 보고 기존 번호를 재사용한다.
        // 납기가 다르면 다른 발주서이므로 새 번호를 받는다.
        let q = supabase.from('purchase_orders')
          .select('po_number')
          .eq('vendor_id', selVendor || null)
          .eq('order_date', data.order_date)
          .not('po_number', 'is', null)
        q = data.promise_date ? q.eq('promise_date', data.promise_date) : q.is('promise_date', null)
        const { data: same } = await q.limit(1)
        poNum = same?.[0]?.po_number || await genPoNumber(data.order_date)
      }
      const payload = { vendor_id:selVendor||null, po_number:poNum, type:data.type, qty_ordered:Number(data.qty_ordered), order_date:data.order_date||null, promise_date:data.promise_date||null, unit_price:data.unit_price?Number(data.unit_price):null, memo:data.memo||null }
      if (editId) { const{error}=await supabase.from('purchase_orders').update(payload).eq('id',editId); if(error) throw error }
      else { const{error}=await supabase.from('purchase_orders').insert({...payload,customer_id:cs?.id,item_id:selItem?.id,order_type:'purchase',qty_received:0,status:'진행중'}); if(error) throw error }
    },
    onSuccess:()=>{ qc.invalidateQueries(['purchase']); setForm(freshForm()); setSelItem(null); setSelVendor(''); setVendorSearch(''); setShowForm(false); setEditId(null) },
    onError:(e)=>alert('오류: '+e.message),
  })
  const buildInsert = (ln) => ({
    customer_id: cs?.id, item_id: ln.item_id, vendor_id: ln.vendor_id||null,
    po_number: ln.po_number?.trim()||null, type: ln.type, qty_ordered: Number(ln.qty_ordered),
    order_date: ln.order_date||null, promise_date: ln.promise_date||null,
    unit_price: ln.unit_price?Number(ln.unit_price):null, memo: ln.memo||null,
    order_type:'purchase', qty_received:0, status:'진행중',
  })
  const saveMultiMut = useMutation({
    mutationFn: async (rows) => { const { error } = await supabase.from('purchase_orders').insert(rows.map(buildInsert)); if (error) throw error },
    onSuccess:()=>{ qc.invalidateQueries(['purchase']); setLines([]); setForm(EMPTY); setSelItem(null); setSelVendor(''); setVendorSearch(''); setItemSearch(''); setShowForm(false) },
    onError:(e)=>alert('오류: '+e.message),
  })
  const deleteMut = useMutation({
    mutationFn:async(id)=>{
      const po = purchases.find(p=>p.id===id)
      const{error}=await supabase.from('purchase_orders').delete().eq('id',id); if(error) throw error
      logActivity('delete','purchase_orders', po?.po_number || id,
        `${po?.items?.std_code||''} ${po?.vendors?.name||''} ${(po?.qty_ordered||0).toLocaleString()}개`, null, cs?.name)
    },
    onSuccess:()=>qc.invalidateQueries(['purchase']),
  })
  const bulkPoMut = useMutation({
    mutationFn:async({ids,poNo})=>{
      const{error}=await supabase.from('purchase_orders').update({po_number:poNo}).in('id',ids); if(error) throw error
      logActivity('update','purchase_orders', poNo, `발주번호 일괄 부여 ${ids.length}건`, null, cs?.name)
    },
    onSuccess:()=>{ qc.invalidateQueries(['purchase']); setBulkPo(''); setChecked({}) },
    onError:(e)=>alert('오류: '+e.message),
  })
  const bulkDateMut = useMutation({
    mutationFn:async({ids,field,value})=>{
      const{error}=await supabase.from('purchase_orders').update({[field]:value||null}).in('id',ids); if(error) throw error
      logActivity('update','purchase_orders', null,
        `${field==='promise_date'?'납기':'발주일'} 일괄 변경 ${ids.length}건 → ${value||'(비움)'}`, null, cs?.name)
    },
    onSuccess:()=>{ qc.invalidateQueries(['purchase']); setBulkOrderDate(''); setBulkPromiseDate(''); setChecked({}) },
    onError:(e)=>alert('오류: '+e.message),
  })

  function addLine() {
    if (!selItem || !form.qty_ordered) { alert('품목과 수량을 입력하세요'); return }
    setLines(prev => {
      const idx = prev.findIndex(l => l.item_id === selItem.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx],
          qty_ordered: Number(next[idx].qty_ordered||0) + Number(form.qty_ordered||0),
          unit_price: form.unit_price || next[idx].unit_price,
          memo: form.memo || next[idx].memo }
        return next
      }
      return [...prev, {
        item_id: selItem.id, name: selItem.name, std_code: selItem.std_code,
        maker: selItem.manufacturer || '', makerPn: selItem.manufacturer_code || '',
        vendor_id: selVendor||null, vendorName: vendors.find(v=>v.id===selVendor)?.name||'',
        type: selItem.type||form.type, qty_ordered: form.qty_ordered, unit_price: form.unit_price,
        order_date: form.order_date, promise_date: form.promise_date, po_number: form.po_number, memo: form.memo,
      }]
    })
    setSelItem(null); setItemSearch(''); setItemResults([])
    setForm(prev => ({ ...prev, qty_ordered:'', unit_price:'', memo:'' }))
  }
  async function addBulkPaste() {
    const parsed = bulkText.split(/\r?\n/).map(l=>l.trim()).filter(Boolean)
      .map(l=>l.split(/[\t,]/).map(x=>x.trim()))
      .map(c=>({ code:c[0], qty:Number(c[1])||0, price:(c[2]!=null&&c[2]!=='')?Number(c[2]):null }))
      .filter(r=>r.code)
    if (!parsed.length) { alert('붙여넣은 내용이 없어요'); return }
    const codes = [...new Set(parsed.map(r=>r.code))]
    const { data: items } = await supabase.from('items')
      .select('id,std_code,name,type,purchase_price,vendor_id,manufacturer,manufacturer_code,vendors(name)').in('std_code', codes)
    const byCode = {}; (items||[]).forEach(it=>{ byCode[it.std_code]=it })
    const notFound = []
    setLines(prev => {
      const next = [...prev]
      for (const r of parsed) {
        const it = byCode[r.code]
        if (!it) { notFound.push(r.code); continue }
        const qty = r.qty>0 ? r.qty : 1
        const price = r.price!=null ? r.price : (it.purchase_price ?? '')
        const idx = next.findIndex(l=>l.item_id===it.id)
        if (idx>=0) {
          next[idx] = { ...next[idx], qty_ordered: Number(next[idx].qty_ordered||0)+qty,
            unit_price: r.price!=null ? r.price : next[idx].unit_price }
        } else {
          next.push({ item_id:it.id, name:it.name, std_code:it.std_code,
            maker: it.manufacturer || '', makerPn: it.manufacturer_code || '',
            vendor_id: selVendor||it.vendor_id||null,
            vendorName: selVendor ? (vendors.find(v=>v.id===selVendor)?.name||'') : (it.vendors?.name||''),
            type: it.type||'자재', qty_ordered:qty, unit_price:price,
            order_date:form.order_date, promise_date:form.promise_date, po_number:form.po_number, memo:form.memo })
        }
      }
      return next
    })
    setBulkText(''); setShowBulk(false)
    if (notFound.length) alert('못 찾은 코드 '+notFound.length+'건: '+notFound.join(', '))
  }
  function submitForm() {
    if (editId) { saveMut.mutate(form); return }
    const cur = (selItem && form.qty_ordered) ? [{
      item_id:selItem.id, vendor_id:selVendor||null, type:selItem.type||form.type, qty_ordered:form.qty_ordered,
      unit_price:form.unit_price, order_date:form.order_date, promise_date:form.promise_date,
      po_number:form.po_number, memo:form.memo,
    }] : []
    const all = [...lines, ...cur]
    if (!all.length) { alert('담은 품목이 없습니다'); return }
    saveMultiMut.mutate(all)
  }
  const bomShown = useMemo(() => {
    const filtered = (bomRows||[]).filter(b => procOnly ? (catOf(b.items)==='판금' || b.items?.proc_order) : true)
    const map = {}
    for (const b of filtered) {
      const id = b.item_id; if (!id) continue
      if (!map[id]) map[id] = { item_id:id, items:b.items, qty_per_unit:0 }
      map[id].qty_per_unit += Number(b.qty_per_unit)||0
    }
    return Object.values(map)
  }, [bomRows, procOnly])
  function addBomToLines() {
    const picked = bomShown.filter(b => bomChecked[b.item_id])
    if (!picked.length) { alert('담을 가공품을 체크하세요'); return }
    const topVendorName = vendors.find(v=>v.id===selVendor)?.name || ''
    setLines(prev => {
      const next = [...prev]
      for (const b of picked) {
        const qty = bomQtys[b.item_id] ?? Math.round((b.qty_per_unit||0)*bomUnits) ?? 1
        const vId = selVendor || b.items?.vendor_id || null
        const vName = selVendor ? topVendorName : (b.items?.vendors?.name||'')
        const idx = next.findIndex(l => l.item_id===b.item_id)
        if (idx>=0) {
          next[idx] = { ...next[idx], qty_ordered: Number(next[idx].qty_ordered||0)+Number(qty||0) }
        } else {
          next.push({
            item_id:b.item_id, name:b.items?.name, std_code:b.items?.std_code,
            maker: b.items?.manufacturer || '', makerPn: b.items?.manufacturer_code || '',
            vendor_id:vId, vendorName:vName, type:'가공',
            qty_ordered:qty, unit_price: b.items?.purchase_price ?? '',
            order_date:form.order_date, promise_date:form.promise_date, po_number:form.po_number,
            memo: bomProject?.code?`[${bomProject.code}]`:'',
          })
        }
      }
      return next
    })
    setBomChecked({}); setShowBom(false)
  }
  function updateLine(i, field, value) {
    setLines(prev => prev.map((l,j)=> j===i ? {...l, [field]: value} : l))
  }
  function exportStatusExcel() {
    try {
      const rows = sorted
      if (!rows.length) { alert('내보낼 현황이 없습니다'); return }
      const header = ['발주일자','코드','품명','제조사','제조사품번','발주수량','미입고수량','단가','공급가','납기약속일','상태','업체확인일자']
      const aoa = [header]
      for (const p of rows) {
        aoa.push([
          p.order_date||'', p.items?.std_code||'', p.items?.name||'', p.items?.manufacturer||'', p.items?.manufacturer_code||'',
          Number(p.qty_ordered)||0, Number(p.qty_remaining)||0, Number(p.unit_price)||0, (Number(p.qty_ordered)||0)*(Number(p.unit_price)||0),
          p.promise_date||'', p.isDelayed?'지연':'진행중', ''
        ])
      }
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      ws['!cols'] = [{wch:11},{wch:14},{wch:28},{wch:14},{wch:16},{wch:10},{wch:11},{wch:11},{wch:13},{wch:11},{wch:9},{wch:14}]
      ws['!autofilter'] = { ref: `A1:L${aoa.length}` }
      const R = XLSX.utils.decode_range(ws['!ref'])
      const numCols = new Set([5,6,7,8])
      for (let r=1; r<=R.e.r; r++) {
        for (const c of numCols) {
          const cell = ws[XLSX.utils.encode_cell({r,c})]
          if (cell && typeof cell.v === 'number') cell.z = '#,##0'
        }
      }
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '발주현황')
      const tag = (search||'').trim() ? `_${search.trim().replace(/[\\/:*?"<>|]/g,'')}` : ''
      XLSX.writeFile(wb, `발주현황${tag}_${todayISO()}.xlsx`)
    } catch (e) {
      alert('엑셀 생성 오류: ' + (e?.message || e))
    }
  }
  function handleEdit(p) {
    setForm({po_number:p.po_number||'',type:p.type,qty_ordered:p.qty_ordered,order_date:p.order_date||'',promise_date:p.promise_date||'',unit_price:p.unit_price||'',memo:p.memo||''})
    setSelVendor(p.vendor_id||''); setVendorSearch(vendors.find(v=>v.id===p.vendor_id)?.name||''); setSelItem(p.items?{id:p.item_id,name:p.items.name,std_code:p.items.std_code}:null)
    setItemSearch(p.items?.name||''); setEditId(p.id); setShowForm(true)
    setTimeout(()=>document.getElementById('po-form')?.scrollIntoView({behavior:'smooth',block:'center'}), 60)
  }
  // 품목 검색 — 한 글자마다 DB 를 때리면 타이핑이 밀린다.
  // 입력은 즉시 반영하고, 조회는 입력이 멈춘 뒤 한 번만.
  // 이전 요청이 늦게 도착해 결과를 덮어쓰지 않도록 순번으로 막는다.
  const itemSearchTimer = useRef(null)
  const itemSearchSeq = useRef(0)
  async function searchItems(val) {
    setItemSearch(val)
    clearTimeout(itemSearchTimer.current)
    if (val.trim().length < 1) { setItemResults([]); return }
    const seq = ++itemSearchSeq.current
    itemSearchTimer.current = setTimeout(async () => {
      const v = val.trim()
      const { data } = await supabase.from('items')
        .select('id,std_code,name,type,lt_weeks,vendor_id,manufacturer,manufacturer_code,purchase_price,unit,vendors(name)')
        .or(`name.ilike.%${v}%,std_code.ilike.%${v}%,manufacturer.ilike.%${v}%,manufacturer_code.ilike.%${v}%`)
        .limit(8)
      if (seq !== itemSearchSeq.current) return   // 더 최근 입력이 있으면 버린다
      setItemResults(data || [])
    }, 250)
  }

  // 구매처 드롭다운 — 매 렌더마다 전체를 거르지 않도록
  const vendorFiltered = useMemo(() => {
    const v = vendorSearch.trim().toLowerCase()
    return v ? vendors.filter(x => x.name.toLowerCase().includes(v)) : vendors
  }, [vendors, vendorSearch])

  // 조회 조건이 바뀌면 표시 건수를 처음으로 되돌린다
  useEffect(() => { setVisibleCount(200) },
    [typeTab, dq, filterOrderDate, dueFilter, dueFrom, dueTo])

  const q = dq.trim().toLowerCase()
  const filtered = useMemo(() => purchases.filter(p => {
    if (typeTab !== '전체' && p.type !== typeTab) return false
    if (filterOrderDate && (p.order_date||'').slice(0,10) !== filterOrderDate) return false

    // 납기 필터 — 미입고 건만 대상 (이미 들어온 건 이월할 필요 없음)
    if (dueFilter) {
      const due = (p.promise_date||'').slice(0,10)
      if (!due) return false
      const today = new Date(); today.setHours(0,0,0,0)
      const d = new Date(due)
      const days = Math.round((d - today) / 86400000)
      if (dueFilter === 'over'  && !(days < 0)) return false
      if (dueFilter === 'd7'    && !(days >= 0 && days <= 7)) return false
      if (dueFilter === 'd14'   && !(days >= 0 && days <= 14)) return false
      if (dueFilter === 'month') {
        const ym = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`
        if (!due.startsWith(ym)) return false
      }
      if (dueFilter === 'next') {
        const n = new Date(today.getFullYear(), today.getMonth()+1, 1)
        const ym = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`
        if (!due.startsWith(ym)) return false
      }
      if (dueFilter === 'range') {
        if (dueFrom && due < dueFrom) return false
        if (dueTo   && due > dueTo)   return false
      }
    }
    if (!q) return true
    const it = p.items || {}
    return [p.po_number, it.std_code, it.name, it.manufacturer, it.manufacturer_code, p.vendors?.name, p.projects?.code]
      .some(x => (x || '').toLowerCase().includes(q))
  }), [purchases, typeTab, filterOrderDate, q, dueFilter, dueFrom, dueTo])
  const today = new Date().toISOString().split('T')[0]
  const sortVal = (p,k)=>({
    po_number:p.po_number||'', order_date:p.order_date||'', std_code:p.items?.std_code||'',
    mfg:p.items?.manufacturer||'', type:catOf(p.items), parent:p.projects?.code||'',
    lt:p.items?.lt_weeks||0, qty_ordered:p.qty_ordered||0, qty_received:p.qty_received||0,
    qty_remaining:p.qty_remaining||0, unit_price:p.unit_price||0,
    supply:(p.qty_ordered||0)*(p.unit_price||0), promise_date:p.promise_date||'',
    vendor:p.vendors?.name||'', memo:p.memo||'', status:p.isDelayed?1:0,
  }[k] ?? '')
  const NUM_SORT = ['lt','qty_ordered','qty_received','qty_remaining','unit_price','supply','status']
  const sorted = useMemo(() => sort.key
    ? [...filtered].sort((a,b)=>{
        const va=sortVal(a,sort.key), vb=sortVal(b,sort.key)
        const c = NUM_SORT.includes(sort.key) ? (Number(va)||0)-(Number(vb)||0) : String(va).localeCompare(String(vb),'ko')
        return sort.dir==='asc'?c:-c
      })
    : filtered, [filtered, sort.key, sort.dir])
  const onSort = k => setSort(prev => prev.key===k ? {key:k,dir:prev.dir==='asc'?'desc':'asc'} : {key:k,dir:'asc'})
  const checkedPOs = filtered.filter(p=>checked[p.id])
  const histTotalSupply = history.reduce((a,r)=>a+(r.supply||0),0)
  const f = k => e => setForm(prev=>({...prev,[k]:e.target.value}))

  // ── 품의서 ──
  const PAYS = ['정기 결제','선급 결제','카드 결제','해외 송금']
  // 결제방식 우선순위: 품의서에서 직접 고른 값 > 협력사에 등록된 결제조건 > 카드 결제
  const payOf = (id) => {
    if (proposalMeta[id]?.pay) return proposalMeta[id].pay
    const po = purchases.find(p => p.id === id)
    const t = po?.vendors?.payment_terms
    return PAYS.includes(t) ? t : '카드 결제'
  }
  const noteOf = id => proposalMeta[id]?.note || ''
  const setMeta = (id,k,v) => setProposalMeta(prev=>({...prev,[id]:{...prev[id],[k]:v}}))
  const propMonths = [...new Set(checkedPOs.map(p=>(p.order_date||'').slice(0,7)).filter(Boolean))].sort()
  const propSum = {}; PAYS.forEach(pay=>propSum[pay]={})
  checkedPOs.forEach(p=>{
    const m=(p.order_date||'').slice(0,7); if(!m) return
    const amt=Math.round((p.qty_ordered||0)*(p.unit_price||0))
    propSum[payOf(p.id)][m]=(propSum[payOf(p.id)][m]||0)+amt
  })
  const propMonthTotal = m => PAYS.reduce((a,pay)=>a+(propSum[pay][m]||0),0)
  const propGrand = checkedPOs.reduce((a,p)=>a+Math.round((p.qty_ordered||0)*(p.unit_price||0)),0)
  const PROP_SORT = {
    '발주일자':p=>p.order_date||'', '입고요청일':p=>p.promise_date||'', '공급업체':p=>p.vendors?.name||'',
    '품목코드':p=>p.items?.std_code||'', '제조사':p=>p.items?.manufacturer||'', '제조사품번':p=>p.items?.manufacturer_code||'',
    '수량':p=>p.qty_ordered||0, '발주금액':p=>p.unit_price||0, '단위':p=>p.items?.unit||'',
    '합계금액':p=>(p.qty_ordered||0)*(p.unit_price||0), '결제방식':p=>payOf(p.id),
    '프로젝트 이력':p=>(projHist[p.item_id]||[]).join(','), '비고':p=>noteOf(p.id),
  }
  const PROP_NUM = new Set(['수량','발주금액','합계금액'])
  const propSorted = (propSort.key && PROP_SORT[propSort.key])
    ? [...checkedPOs].sort((a,b)=>{ const va=PROP_SORT[propSort.key](a), vb=PROP_SORT[propSort.key](b); const c=PROP_NUM.has(propSort.key)?(Number(va)||0)-(Number(vb)||0):String(va).localeCompare(String(vb),'ko'); return propSort.dir==='asc'?c:-c })
    : checkedPOs
  const onPropSort = k => setPropSort(prev=>prev.key===k?{key:k,dir:prev.dir==='asc'?'desc':'asc'}:{key:k,dir:'asc'})
  function exportProposal() {
    const aoa = []
    aoa.push(['구매 품의서']); aoa.push([])
    aoa.push(['1. 개요']); (overview||'').split('\n').forEach(l=>aoa.push([l])); aoa.push([])
    aoa.push(['2. 월별 매입 합계']); 
    aoa.push(['결제구분', ...propMonths.map(m=>m.slice(5)+'월')])
    PAYS.forEach(pay=>aoa.push([pay, ...propMonths.map(m=>propSum[pay][m]||0)]))
    aoa.push(['합계', ...propMonths.map(m=>propMonthTotal(m))]); aoa.push([])
    aoa.push(['3. 세부 품목'])
    aoa.push(['발주일자','입고요청일','공급업체','품목코드','제조사','제조사품번','수량','발주금액','단위','합계금액','결제방식','프로젝트이력','비고'])
    propSorted.forEach(p=>{
      const amt=Math.round((p.qty_ordered||0)*(p.unit_price||0))
      aoa.push([p.order_date||'', p.promise_date||'', p.vendors?.name||'', p.items?.std_code||'',
        p.items?.manufacturer||'', p.items?.manufacturer_code||'', p.qty_ordered||0, p.unit_price||0,
        p.items?.unit||'', amt, payOf(p.id), (projHist[p.item_id]||[]).join(', '), noteOf(p.id)])
    })
    aoa.push(['','','','','','','','','합계',propGrand,'','',''])
    const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '품의서')
    XLSX.writeFile(wb, `구매품의서_${new Date().toISOString().split('T')[0]}.xlsx`)
  }
  function printProposal() {
    const esc = v => String(v??'').replace(/[<>&]/g, c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))
    const monthCols = propMonths.map(m=>`<th>${m.slice(5)}월</th>`).join('')
    const sumRows = PAYS.map(pay=>`<tr><td class="lbl">${pay}</td>${propMonths.map(m=>`<td class="num">${propSum[pay][m]?propSum[pay][m].toLocaleString():'-'}</td>`).join('')}</tr>`).join('')
    const totalRow = `<tr class="tot"><td class="lbl">합계</td>${propMonths.map(m=>`<td class="num">${propMonthTotal(m).toLocaleString()}</td>`).join('')}</tr>`
    const detailRows = propSorted.map(p=>{
      const amt=Math.round((p.qty_ordered||0)*(p.unit_price||0))
      return `<tr><td>${esc(p.order_date)}</td><td>${esc(p.promise_date)}</td><td>${esc(p.vendors?.name)}</td>`
        +`<td>${esc(p.items?.std_code)}</td><td>${esc(p.items?.manufacturer)}</td><td>${esc(p.items?.manufacturer_code)}</td>`
        +`<td class="num">${(p.qty_ordered||0).toLocaleString()}</td><td class="num">${p.unit_price?Number(p.unit_price).toLocaleString():''}</td>`
        +`<td>${esc(p.items?.unit)}</td><td class="num">${amt.toLocaleString()}</td>`
        +`<td>${esc(payOf(p.id))}</td><td>${esc((projHist[p.item_id]||[]).join(', '))}</td><td>${esc(noteOf(p.id))}</td></tr>`
    }).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>구매 품의서</title><style>
      *{box-sizing:border-box}body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;color:#000;padding:18px;font-size:12px}
      h2{font-size:13px;font-weight:700;margin:14px 0 5px}
      .ov{border:1px solid #999;min-height:60px;padding:8px;white-space:pre-wrap;line-height:1.5;font-size:12px}
      table{border-collapse:collapse}
      th,td{border:1px solid #999;padding:3px 8px;font-size:12px}
      th{background:#d9d9d9;font-weight:700;text-align:center}
      .num{text-align:right}.lbl{font-weight:600}
      .mtbl{width:auto}.mtbl td,.mtbl th{min-width:90px}.mtbl td:first-child,.mtbl th:first-child{min-width:110px;text-align:left}
      .dtbl{width:100%}.dtbl th,.dtbl td{padding:2px 6px;white-space:nowrap}
      .tot td{font-weight:700;background:#f2f2f2}
      @page{size:A4 landscape;margin:10mm}
    </style></head><body>
      <h2>1. 개요</h2><div class="ov">${esc(overview)||''}</div>
      <h2>2. 월별 매입 합계</h2>
      <table class="mtbl"><thead><tr><th>결제구분</th>${monthCols}</tr></thead><tbody>${sumRows}${totalRow}</tbody></table>
      <h2>3. 세부 품목</h2>
      <table class="dtbl"><thead><tr><th>발주일자</th><th>입고요청일</th><th>공급업체</th><th>품목코드</th><th>제조사</th><th>제조사품번</th><th>수량</th><th>발주금액</th><th>단위</th><th>합계금액</th><th>결제방식</th><th>프로젝트이력</th><th>비고</th></tr></thead><tbody>${detailRows}<tr class="tot"><td colspan="9" class="num">합계</td><td class="num">${propGrand.toLocaleString()}</td><td colspan="3"></td></tr></tbody></table>
    </body></html>`
    const w = window.open('', '_blank')
    if (!w) { alert('팝업이 차단되었어요. 팝업 허용 후 다시 시도해줘.'); return }
    w.document.write(html); w.document.close(); w.focus()
    setTimeout(()=>{ w.print() }, 350)
  }

  const histShown = (history||[]).filter(r=>!hItem || `${r.items?.std_code||''} ${r.items?.name||''}`.toLowerCase().includes(hItem.toLowerCase()))

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
          {[['po','📋 구매발주'],['history','📊 구매현황'],['proposal','📝 품의서']].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${tab===k?'bg-white text-slate-900 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{l}</button>
          ))}
        </div>
        {tab==='po' && <>
          {/* ── 1줄: 조회 조건 ── */}
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

          {/* 납기 필터 — 임박 건을 골라 일괄 이월할 때 */}
          <div className="inline-flex items-center gap-1">
            <span className="text-[11px] font-semibold text-slate-500">납기</span>
            <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5">
              {[['','전체'],['over','지남'],['d7','7일'],['d14','14일'],['month','이달'],['next','다음달'],['range','기간']].map(([k,l])=>(
                <button key={k} onClick={()=>setDueFilter(k)}
                  className={`px-2 py-1 text-[11px] font-semibold rounded-md ${dueFilter===k
                    ? (k==='over' ? 'bg-rose-500 text-white' : 'bg-white text-slate-900 shadow-sm')
                    : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
              ))}
            </div>
            {dueFilter==='range' && (
              <>
                <input type="date" value={dueFrom} onChange={e=>setDueFrom(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg"/>
                <span className="text-slate-400 text-xs">~</span>
                <input type="date" value={dueTo} onChange={e=>setDueTo(e.target.value)}
                  className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg"/>
              </>
            )}
          </div>

          <div className="inline-flex items-center gap-1">
            <span className="text-[11px] font-semibold text-slate-500">발주일</span>
            <input type="date" value={filterOrderDate} onChange={e=>setFilterOrderDate(e.target.value)}
              title="발주일자로 필터 (이카운트 발주서 뽑을 때)"
              className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            {filterOrderDate&&<button onClick={()=>setFilterOrderDate('')} className="text-slate-400 hover:text-slate-600 text-xs px-1">✕</button>}
          </div>

          <button onClick={()=>{
            const allOn = sorted.length>0 && sorted.every(p=>checked[p.id])
            if (allOn) setChecked({})
            else setChecked(Object.fromEntries(sorted.map(p=>[p.id,true])))
          }} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 text-slate-600 bg-white hover:bg-slate-50">
            {sorted.length>0 && sorted.every(p=>checked[p.id]) ? '☐ 전체해제' : '☑ 전체선택'}
            {checkedPOs.length>0 ? ` (${checkedPOs.length})` : ''}
          </button>
          <button onClick={exportStatusExcel} title="현재 목록(검색/필터 적용)을 엑셀로 — 구매처 피드백 요청용"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">
            📥 현황 엑셀
          </button>
          <div className="flex-1"/>
          <button onClick={()=>{setForm({...EMPTY,order_date:new Date().toISOString().split('T')[0]});setEditId(null);setSelItem(null);setSelVendor('');setVendorSearch('');setItemSearch('');setLines([]);setShowBom(false);setBomProject(null);setShowForm(!showForm)}}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
            ➕ 구매발주 추가
          </button>
        </>}
      </div>

      {/* ── 2줄: 선택한 건에 대한 일괄 작업 (선택했을 때만 나타남) ── */}
      {tab==='po' && checkedPOs.length>0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-indigo-200 bg-indigo-50/60 px-3 py-2">
          <span className="text-xs font-bold text-indigo-700">
            {checkedPOs.length}건 선택됨
          </span>
          <button onClick={()=>setChecked({})}
            className="text-[11px] text-slate-500 hover:text-slate-700 underline">선택 해제</button>

          <div className="w-px h-5 bg-indigo-200 mx-1"/>

          {/* 납기 일괄 — 이월할 때 가장 많이 쓰므로 앞에 */}
          <div className="inline-flex items-center gap-1">
            <input type="date" value={bulkPromiseDate} onChange={e=>setBulkPromiseDate(e.target.value)}
              className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"/>
            <button onClick={()=>bulkDateMut.mutate({ids:checkedPOs.map(p=>p.id),field:'promise_date',value:bulkPromiseDate})}
              disabled={!bulkPromiseDate||bulkDateMut.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:opacity-40">
              📅 납기 이월 ({checkedPOs.length})
            </button>
          </div>

          <div className="inline-flex items-center gap-1">
            <input type="date" value={bulkOrderDate} onChange={e=>setBulkOrderDate(e.target.value)}
              className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"/>
            <button onClick={()=>bulkDateMut.mutate({ids:checkedPOs.map(p=>p.id),field:'order_date',value:bulkOrderDate})}
              disabled={!bulkOrderDate||bulkDateMut.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-100 disabled:opacity-40">
              📅 발주일자
            </button>
          </div>

          <div className="w-px h-5 bg-indigo-200 mx-1"/>

          <div className="inline-flex items-center gap-1">
            <input value={bulkPo} onChange={e=>setBulkPo(e.target.value)} placeholder="이카운트 발주번호"
              className="w-36 px-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white"/>
            <button onClick={()=>bulkPoMut.mutate({ids:checkedPOs.map(p=>p.id),poNo:bulkPo.trim()})}
              disabled={!bulkPo.trim()||bulkPoMut.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-300 text-indigo-700 bg-white hover:bg-indigo-100 disabled:opacity-40">
              🔖 발주번호 부여
            </button>
          </div>

          <button onClick={()=>exportEcount(checkedPOs,vendors)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-100">
            📑 이카운트 발주서
          </button>
        </div>
      )}

      {tab==='po' && (
        <>
          {showForm&&(
            <div id="po-form" className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
              <p className="text-xs font-bold text-slate-700">{editId?'✏️ 구매발주 수정':'구매발주 등록'} <span className="text-slate-400 font-normal">· 발주번호는 이카운트 값 직접 입력(체크 후 일괄부여도 가능)</span></p>
              {/* 공통값 — 담는 모든 품목에 적용 */}
              <div className="rounded-lg border border-indigo-200 bg-white p-3">
                <p className="text-[11px] font-bold text-indigo-500 mb-2">📌 공통 · 담는 모든 품목에 함께 적용</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">발주일자</label>
                    <input type="date" value={form.order_date} onChange={f('order_date')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">구매처</label>
                    <div className="relative">
                      <input value={vendorSearch}
                        onChange={e=>{ setVendorSearch(e.target.value); setVendorOpen(true); setSelVendor('') }}
                        onFocus={()=>setVendorOpen(true)} onBlur={()=>setTimeout(()=>setVendorOpen(false),150)}
                        placeholder="구매처 검색·선택"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                      {vendorOpen && (()=>{ const fv = vendorFiltered; return (
                        <div className="absolute z-20 mt-1 w-full max-h-48 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg">
                          {fv.slice(0,50).map(v=>(
                            <button key={v.id} type="button"
                              onMouseDown={()=>{ setSelVendor(v.id); setVendorSearch(v.name); setVendorOpen(false) }}
                              className={`block w-full text-left px-3 py-1.5 text-sm hover:bg-indigo-50 ${selVendor===v.id?'bg-indigo-50 font-semibold text-indigo-700':'text-slate-700'}`}>
                              {v.name}
                            </button>
                          ))}
                          {fv.length===0 && <div className="px-3 py-2 text-xs text-slate-400">검색 결과 없음</div>}
                        </div>
                      )})()}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">납기 약속일</label>
                    <input type="date" value={form.promise_date} onChange={f('promise_date')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">발주번호는 등록 후 체크 → 상단 "발주번호 부여"로 이카운트 값 일괄 입력</p>
              </div>

              {/* 품목 담기(신규) / 품목 정보(수정) */}
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-[11px] font-bold text-slate-500 mb-2">🧩 품목 {editId?'정보':'담기 · 여러 개 담을 수 있어요'}</p>
                <div className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-5 relative">
                    <label className="block text-xs font-bold text-slate-500 mb-1">품목 {!editId&&'*'}</label>
                    <input value={itemSearch} onChange={e=>searchItems(e.target.value)} placeholder="품명·기준코드·제조사품번" disabled={!!editId}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50"/>
                    {itemResults.length>0&&(
                      <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                        {itemResults.map(item=>(
                          <button key={item.id} onClick={()=>{setSelItem(item);setItemSearch(item.name);setItemResults([]);if(item.vendor_id&&!selVendor){setSelVendor(item.vendor_id);setVendorSearch(item.vendors?.name||'')};setForm(prev=>({...prev,unit_price:(item.purchase_price??prev.unit_price)||'',type:item.type||prev.type}))}}
                            className="w-full text-left px-3 py-2 hover:bg-indigo-50 border-b border-slate-100 last:border-0 text-xs">
                            <div className="font-semibold text-slate-800">{item.name}</div>
                            <div className="text-slate-400 font-mono text-xs flex gap-2">
                              <span>{item.std_code}</span>
                              {item.manufacturer_code&&<span className="text-violet-500">· {item.manufacturer_code}</span>}
                              {item.purchase_price?<span className="text-indigo-500">· ₩{Math.round(item.purchase_price).toLocaleString()}</span>:null}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {selItem&&<p className="text-xs text-emerald-600 mt-1">✓ {selItem.name} <span className="ml-1 px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 font-bold">{catOf(selItem)||selItem.type}</span></p>}
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-slate-500 mb-1">수량 *</label>
                    <input type="number" value={form.qty_ordered} onChange={f('qty_ordered')} onKeyDown={e=>{if(e.key==='Enter'&&!editId&&selItem&&form.qty_ordered){e.preventDefault();addLine()}}} placeholder="수량" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-slate-500 mb-1">단가 <span className="text-indigo-400 font-normal">자동</span></label>
                    <input type="number" value={form.unit_price} onChange={f('unit_price')} onKeyDown={e=>{if(e.key==='Enter'&&!editId&&selItem&&form.qty_ordered){e.preventDefault();addLine()}}} placeholder="단가" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                  </div>
                  <div className={editId?'col-span-1':'col-span-2'}>
                    <label className="block text-xs font-bold text-slate-500 mb-1">메모</label>
                    <input value={form.memo} onChange={f('memo')} placeholder="메모" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                  </div>
                  {editId ? (
                    <div className="col-span-2">
                      <label className="block text-xs font-bold text-slate-500 mb-1">구분</label>
                      <select value={form.type} onChange={f('type')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"><option>자재</option><option>가공</option></select>
                    </div>
                  ) : (
                    <div className="col-span-1 flex items-end h-full">
                      <button onClick={addLine} disabled={!selItem||!form.qty_ordered} title="목록에 담기 (Enter)"
                        className="w-full px-2 py-2 text-xs font-bold rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40">➕ 담기</button>
                    </div>
                  )}
                </div>
                {!editId && <p className="text-[11px] text-slate-400 mt-1.5">💡 품목 선택 시 최근 단가 자동입력 · 수량 입력 후 Enter로 바로 담기 · 같은 품목은 수량 합산 · 구분은 품목에서 자동</p>}
                {!editId && (
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <button onClick={()=>setShowBulk(v=>!v)} className="text-xs font-bold text-indigo-600 hover:underline">📋 엑셀 붙여넣기로 여러 품목 담기 {showBulk?'▲':'▼'}</button>
                    {showBulk && (
                      <div className="mt-2 space-y-2">
                        <p className="text-[11px] text-slate-400">엑셀에서 <b>기준코드 · 수량 · 단가(선택)</b> 열을 복사해 붙여넣기 (탭/쉼표 구분, 한 줄에 한 품목). 단가 비우면 등록단가 자동.</p>
                        <p className="text-[11px] text-indigo-500 font-semibold">위 구매처를 비워두면 품목별 기본 구매처로 자동 배정되어, 업체별로 나뉘어 발주됩니다.</p>
                        <textarea value={bulkText} onChange={e=>setBulkText(e.target.value)} rows={5}
                          placeholder={"AX-510000540\t100\nAX-500001501\t50\t1200"}
                          className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                        <div className="flex justify-end">
                          <button onClick={addBulkPaste} disabled={!bulkText.trim()} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">일괄 담기 →</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {!editId && (
                <div className="border-t border-indigo-100 pt-3">
                  <button onClick={()=>setShowBom(v=>!v)} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100">
                    📦 제품 BOM에서 가공품 불러오기 {showBom?'▲':'▼'}
                  </button>
                  {showBom && (
                    <div className="mt-2 rounded-lg border border-violet-200 bg-white p-3 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <input value={bomProjSearch} onChange={e=>setBomProjSearch(e.target.value)} placeholder="제품 검색"
                          className="px-2 py-1.5 text-xs border border-slate-200 rounded w-44 focus:outline-none focus:ring-2 focus:ring-violet-400"/>
                        <select value={bomProject?.id||''} onChange={e=>{ const pr=projects.find(x=>x.id===e.target.value); setBomProject(pr||null); setBomChecked({}); setBomQtys({}) }}
                          className="px-2 py-1.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-violet-400">
                          <option value="">제품 선택</option>
                          {projects.filter(pr=>!bomProjSearch||`${pr.code} ${pr.name||''}`.toLowerCase().includes(bomProjSearch.toLowerCase())).map(pr=>(
                            <option key={pr.id} value={pr.id}>{pr.code}{pr.name?` - ${pr.name}`:''}</option>
                          ))}
                        </select>
                        <label className="inline-flex items-center gap-1 text-xs text-slate-600">
                          <input type="checkbox" checked={procOnly} onChange={e=>setProcOnly(e.target.checked)}/> 판금만
                        </label>
                        <label className="inline-flex items-center gap-1 text-xs font-bold text-slate-600">
                          대수
                          <input type="number" min="1" value={bomUnits} onChange={e=>{ setBomUnits(Math.max(1,Number(e.target.value)||1)); setBomQtys({}) }}
                            className="w-16 px-2 py-1.5 text-xs border border-slate-200 rounded text-indigo-600 font-bold focus:outline-none focus:ring-2 focus:ring-violet-400"/>
                        </label>
                      </div>
                      {!bomProject ? <p className="text-xs text-slate-400">제품을 고르면 하위 가공품이 나와요.</p>
                       : bomLoading ? <p className="text-xs text-slate-400">불러오는 중...</p>
                       : bomShown.length===0 ? <p className="text-xs text-slate-400">해당 제품에 {procOnly?'판금 품목이':'품목이'} 없어요.</p>
                       : (<>
                          <div className="flex items-center gap-2">
                            <button onClick={()=>setBomChecked(Object.fromEntries(bomShown.map(b=>[b.item_id,true])))} className="text-xs text-indigo-500 hover:underline">전체선택</button>
                            <button onClick={()=>setBomChecked({})} className="text-xs text-slate-400 hover:underline">해제</button>
                            <span className="text-xs text-slate-400">· {bomShown.length}개</span>
                          </div>
                          <div className="max-h-56 overflow-auto border border-slate-100 rounded">
                            <table className="w-full text-xs">
                              <thead className="bg-slate-50"><tr>
                                <th className="px-2 py-1 w-6"></th><th className="px-2 py-1 text-left">품번</th><th className="px-2 py-1 text-left">품명</th>
                                <th className="px-2 py-1 text-left">분류</th><th className="px-2 py-1 text-right">소요량</th><th className="px-2 py-1 text-right">발주수량</th>
                              </tr></thead>
                              <tbody>
                                {bomShown.map(b=>(
                                  <tr key={b.item_id} className="border-t border-slate-50">
                                    <td className="px-2 py-1"><input type="checkbox" checked={!!bomChecked[b.item_id]} onChange={e=>setBomChecked(c=>({...c,[b.item_id]:e.target.checked}))}/></td>
                                    <td className="px-2 py-1 font-mono text-indigo-600">{b.items?.std_code}</td>
                                    <td className="px-2 py-1 truncate max-w-[160px]">{b.items?.name}</td>
                                    <td className="px-2 py-1"><span className="px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 text-[10px] font-bold">{catOf(b.items)}</span>{b.items?.proc_order && catOf(b.items)!=='판금' && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold">🔧발주판금</span>}</td>
                                    <td className="px-2 py-1 text-right text-slate-500">{b.qty_per_unit}</td>
                                    <td className="px-2 py-1 text-right"><input type="number" min="0" value={bomQtys[b.item_id] ?? Math.round((b.qty_per_unit||0)*bomUnits)} onChange={e=>setBomQtys(q=>({...q,[b.item_id]:Number(e.target.value)}))} className="w-16 px-1 py-0.5 text-right border border-slate-200 rounded"/></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <button onClick={addBomToLines} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700">선택 담기 →</button>
                        </>)}
                    </div>
                  )}
                </div>
              )}
              {!editId && lines.length>0 && (
                <div className="rounded-lg border border-indigo-200 bg-white p-2 space-y-1">
                  <p className="text-xs font-bold text-indigo-600">담은 품목 {lines.length}건</p>
                  {/* 업체별 요약 — 저장하면 업체 수만큼 발주가 나뉜다 */}
                  {(() => {
                    const by = {}
                    lines.forEach(ln => {
                      const k = vendors.find(v => v.id === ln.vendor_id)?.name || '(업체없음)'
                      by[k] = (by[k] || 0) + 1
                    })
                    const keys = Object.keys(by)
                    if (keys.length < 2) return null
                    return (
                      <div className="flex flex-wrap gap-1 pb-1 border-b border-slate-100">
                        {keys.sort().map(k => (
                          <span key={k}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              k === '(업체없음)' ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-700'}`}>
                            {k} {by[k]}
                          </span>
                        ))}
                      </div>
                    )
                  })()}
                  {lines.map((ln,i)=>(
                    <div key={i} className="flex items-center gap-2 text-xs border-b border-slate-50 last:border-0 py-1">
                      <span className="font-mono text-indigo-600 w-24 shrink-0 truncate">{ln.std_code||'-'}</span>
                      <span className="flex-1 min-w-0">
                        <span className="text-slate-700 block truncate">{ln.name}</span>
                        {(ln.maker || ln.makerPn) && (
                          <span className="block text-[10px] text-slate-400 truncate">
                            {ln.maker}
                            {ln.maker && ln.makerPn ? ' · ' : ''}
                            <span className="font-mono">{ln.makerPn}</span>
                          </span>
                        )}
                      </span>
                      {/* 구매처는 담은 뒤에도 바꿀 수 있다.
                          비딩이 그 사이에 바뀌는 일이 잦기 때문이다. */}
                      <select value={ln.vendor_id || ''}
                        onChange={e => updateLine(i, 'vendor_id', e.target.value || null)}
                        className={`shrink-0 max-w-[110px] px-1 py-0.5 rounded text-[10px] font-bold border-0 cursor-pointer ${
                          ln.vendor_id ? 'bg-slate-100 text-slate-600' : 'bg-rose-50 text-rose-500'}`}>
                        <option value="">업체없음</option>
                        {vendors.map(v => (
                          <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-slate-400">수량
                        <input type="number" min="0" value={ln.qty_ordered} onChange={e=>updateLine(i,'qty_ordered',Number(e.target.value))}
                          className="w-16 px-1 py-0.5 text-right border border-slate-200 rounded text-slate-700"/>
                      </label>
                      <label className="flex items-center gap-1 text-slate-400">단가
                        <input type="number" min="0" value={ln.unit_price} onChange={e=>updateLine(i,'unit_price',e.target.value)} placeholder="-"
                          className="w-20 px-1 py-0.5 text-right border border-slate-200 rounded text-slate-700"/>
                      </label>
                      <span className="w-24 text-right font-semibold text-slate-700 shrink-0">₩{Math.round((Number(ln.qty_ordered)||0)*(Number(ln.unit_price)||0)).toLocaleString()}</span>
                      <input value={ln.memo||''} onChange={e=>updateLine(i,'memo',e.target.value)} placeholder="메모"
                        className="w-24 px-1 py-0.5 border border-slate-200 rounded text-slate-600 shrink-0"/>
                      <button onClick={()=>setLines(prev=>prev.filter((_,j)=>j!==i))} className="text-red-400 hover:text-red-600 font-bold">✕</button>
                    </div>
                  ))}
                  <div className="flex justify-end items-baseline gap-2 pt-1 mt-1 border-t border-indigo-100">
                    <span className="text-xs font-bold text-slate-500">발주 총액</span>
                    <span className="text-sm font-bold text-indigo-600">₩{Math.round(lines.reduce((a,l)=>a+(Number(l.qty_ordered)||0)*(Number(l.unit_price)||0),0)).toLocaleString()}</span>
                  </div>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <button onClick={()=>{setShowForm(false);setEditId(null);setLines([]);setShowBom(false)}} className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">취소</button>
                <button onClick={submitForm} disabled={saveMut.isPending||saveMultiMut.isPending||(editId?!form.qty_ordered:(lines.length===0&&(!selItem||!form.qty_ordered)))}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                  {saveMut.isPending||saveMultiMut.isPending?'저장 중...':editId?'수정 완료':(()=>{const n=lines.length+((selItem&&form.qty_ordered)?1:0);return n>1?`발주 등록 (${n}건)`:'발주 등록'})()}
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
            <ResizableTable cols={PO_COLS} storageKey="purchase_cols" sortKey={sort.key} sortDir={sort.dir} onSort={onSort}>
              {()=>(
                <tbody>
                  {filtered.length===0
                    ? <tr><td colSpan={PO_COLS.length} className="text-center py-10 text-slate-400">구매 발주가 없습니다</td></tr>
                    : sorted.slice(0, visibleCount).map(p=>{
                      const diff=p.promise_date?Math.round((new Date(p.promise_date)-new Date(today))/86400000):null
                      const supply=Math.round((p.qty_ordered||0)*(p.unit_price||0))
                      return (
                        <tr key={p.id} {...rowProps(p.id, !!checked[p.id])}
                          className={`border-b border-slate-100 group cursor-pointer select-none ${
                            checked[p.id] ? 'bg-indigo-50' : p.isDelayed ? 'bg-red-50/30 hover:bg-red-50/50' : 'hover:bg-slate-50'}`}>
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
                          <td className="px-3 py-2"><span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold ${PROC_CATS.has(catOf(p.items))?'bg-violet-50 text-violet-700':'bg-blue-50 text-blue-600'}`}>{catOf(p.items)}</span></td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-400 overflow-hidden truncate">{p.projects?.code||'-'}</td>
                          <td className="px-3 py-2 text-slate-500">{p.items?.lt_weeks?`${p.items.lt_weeks}W`:'-'}</td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-700">{p.qty_ordered}</td>
                          <td className="px-3 py-2 text-right text-emerald-600">{p.qty_received}</td>
                          <td className="px-3 py-2 text-right font-bold text-slate-900">{p.qty_remaining}</td>
                          <td className="px-3 py-2 text-right text-slate-500">{p.unit_price?Number(p.unit_price).toLocaleString():'-'}</td>
                          <td className="px-3 py-2 text-right text-slate-500">{supply?supply.toLocaleString():'-'}</td>
                          <td className="px-3 py-2"><span className={`${diff!==null&&diff<0?'text-red-600 font-bold':diff!==null&&diff<=7?'text-amber-700 font-semibold':'text-slate-600'}`}>{p.promise_date||'-'}</span></td>
                          <td className="px-3 py-2 text-slate-500 overflow-hidden truncate">{p.vendors?.name||'-'}</td>
                          <td className="px-3 py-2 text-slate-500 overflow-hidden truncate" title={p.memo||''}>{p.memo||'-'}</td>
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
          {sorted.length > visibleCount && (
            <div className="flex items-center justify-center gap-3 py-3">
              <span className="text-xs text-slate-400">
                {visibleCount.toLocaleString()} / {sorted.length.toLocaleString()}건 표시
              </span>
              <button onClick={()=>setVisibleCount(v=>v+200)}
                className="px-4 py-1.5 text-xs font-bold rounded-lg border border-slate-300 text-slate-600 bg-white hover:bg-slate-50">
                더 보기 (+200)
              </button>
              <button onClick={()=>setVisibleCount(sorted.length)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg text-slate-400 hover:text-slate-600">
                전체 보기
              </button>
            </div>
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
            <div><label className="block text-xs font-bold text-slate-500 mb-1">품번 검색</label>
              <input value={hItem} onChange={e=>setHItem(e.target.value)} placeholder="기준코드·품명"
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"/></div>
            {history.length>0&&<button onClick={exportHistory}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">📥 엑셀</button>}
            <div className="ml-auto text-xs text-slate-400 self-center">총 {histShown.length}건</div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">입고 건수</p><p className="text-xl font-bold text-slate-900">{histShown.length}</p></div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-xs font-bold text-emerald-500 uppercase tracking-wide mb-1">총 입고 수량</p><p className="text-xl font-bold text-emerald-700">{histShown.reduce((a,r)=>a+r.qty,0).toLocaleString()}</p></div>
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3"><p className="text-xs font-bold text-indigo-400 uppercase tracking-wide mb-1">총 공급가</p><p className="text-xl font-bold text-indigo-700">{Math.round(histShown.reduce((a,r)=>a+(r.supply||0),0)/10000).toLocaleString()}만원</p></div>
          </div>

          {histLoading ? <div className="text-center py-10 text-slate-400 text-sm">불러오는 중...</div> : (
            <ResizableTable cols={HIST_COLS} storageKey="purchase_hist_cols">
              {()=>(
                <tbody>
                  {histShown.length===0
                    ? <tr><td colSpan={HIST_COLS.length} className="text-center py-10 text-slate-400">입고 이력이 없습니다</td></tr>
                    : histShown.map(r=>(
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

      {tab==='proposal' && (
        <div className="space-y-4">
          {checkedPOs.length===0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              📋 <span className="font-semibold">구매발주</span> 탭에서 품의할 발주를 체크한 뒤 품의서 탭으로 오세요.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm font-bold text-slate-700">구매 품의서 <span className="text-slate-400 font-normal">· 선택 {checkedPOs.length}건</span></p>
                <div className="flex gap-2">
                  <button onClick={printProposal} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">🖨 인쇄 / PDF</button>
                  <button onClick={exportProposal} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">📥 엑셀</button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-bold text-slate-600 mb-2">1. 개요</p>
                <textarea value={overview} onChange={e=>setOverview(e.target.value)} rows={3}
                  placeholder="예) 1번 품목은 멀티탭 ASSY 사양변경으로 인한 신규 추가품목이며, 사양변경전 불용재고는 없습니다."
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
              </div>

              <div className="rounded-xl border border-slate-200 p-4 overflow-x-auto">
                <p className="text-xs font-bold text-slate-600 mb-2">2. 월별 매입 합계 <span className="text-slate-400 font-normal">(원)</span></p>
                <table className="text-xs w-auto">
                  <thead><tr className="bg-slate-50">
                    <th className="px-2 py-1 text-left font-bold text-slate-500">결제구분</th>
                    {propMonths.map(m=><th key={m} className="px-2 py-1 text-right font-bold text-slate-500">{m.slice(5)}월</th>)}
                  </tr></thead>
                  <tbody>
                    {PAYS.map(pay=>(
                      <tr key={pay} className="border-t border-slate-100">
                        <td className="px-2 py-1 font-semibold text-slate-700">{pay}</td>
                        {propMonths.map(m=><td key={m} className="px-2 py-1 text-right text-slate-600">{propSum[pay][m]?propSum[pay][m].toLocaleString():'-'}</td>)}
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-200 bg-slate-50">
                      <td className="px-2 py-1 font-bold text-slate-800">합계</td>
                      {propMonths.map(m=><td key={m} className="px-2 py-1 text-right font-bold text-slate-900">{propMonthTotal(m).toLocaleString()}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="rounded-xl border border-slate-200 overflow-x-auto">
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-200"><p className="text-xs font-bold text-slate-600">3. 세부 품목 <span className="text-slate-400 font-normal">· 결제방식·비고는 직접 선택/입력</span></p></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="bg-slate-50 border-b border-slate-200">
                      {['발주일자','입고요청일','공급업체','품목코드','제조사','제조사품번','수량','발주금액','단위','합계금액','결제방식','프로젝트 이력','비고'].map(h=>(
                        <th key={h} onClick={()=>onPropSort(h)}
                          className="px-2 py-2 text-left font-bold text-slate-400 whitespace-nowrap cursor-pointer select-none hover:text-slate-600">
                          {h}{propSort.key===h?(propSort.dir==='asc'?' ▲':' ▼'):''}
                        </th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {propSorted.map(p=>{
                        const amt=Math.round((p.qty_ordered||0)*(p.unit_price||0))
                        return (
                          <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="px-2 py-1.5 whitespace-nowrap">{p.order_date||'-'}</td>
                            <td className="px-2 py-1.5 whitespace-nowrap">{p.promise_date||'-'}</td>
                            <td className="px-2 py-1.5 whitespace-nowrap">{p.vendors?.name||'-'}</td>
                            <td className="px-2 py-1.5 font-mono text-indigo-600 whitespace-nowrap">{p.items?.std_code||'-'}</td>
                            <td className="px-2 py-1.5 whitespace-nowrap">{p.items?.manufacturer||'-'}</td>
                            <td className="px-2 py-1.5 font-mono text-slate-500 whitespace-nowrap">{p.items?.manufacturer_code||'-'}</td>
                            <td className="px-2 py-1.5 text-right">{Number(p.qty_ordered||0).toLocaleString()}</td>
                            <td className="px-2 py-1.5 text-right">{p.unit_price?Number(p.unit_price).toLocaleString():'-'}</td>
                            <td className="px-2 py-1.5">{p.items?.unit||'-'}</td>
                            <td className="px-2 py-1.5 text-right font-semibold text-slate-800">{amt.toLocaleString()}</td>
                            <td className="px-2 py-1.5">
                              <select value={payOf(p.id)} onChange={e=>setMeta(p.id,'pay',e.target.value)} className="px-1 py-0.5 text-xs border border-slate-200 rounded">
                                {PAYS.map(pay=><option key={pay}>{pay}</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-1.5 text-violet-600 whitespace-nowrap max-w-[140px] truncate" title={(projHist[p.item_id]||[]).join(', ')}>{(projHist[p.item_id]||[]).join(', ')||'-'}</td>
                            <td className="px-2 py-1.5">
                              <input value={noteOf(p.id)} onChange={e=>setMeta(p.id,'note',e.target.value)} placeholder="비고" className="w-24 px-1 py-0.5 text-xs border border-slate-200 rounded"/>
                            </td>
                          </tr>
                        )
                      })}
                      <tr className="bg-slate-50 font-bold">
                        <td colSpan={9} className="px-2 py-1.5 text-right text-slate-600">합계금액</td>
                        <td className="px-2 py-1.5 text-right text-slate-900">{propGrand.toLocaleString()}</td>
                        <td colSpan={3}></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
