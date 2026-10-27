import { useState, useEffect } from 'react'
import PageHead from '../../components/PageHead'
import { useVisibleRows, MoreRows } from '../../hooks/useVisibleRows'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useResizableColumns } from '../../hooks/useResizableColumns'
import { useCustomer } from '../../hooks/useCustomers'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { explodeProjects } from '../../lib/bomSupply'
import * as XLSX from 'xlsx'
import CustomerTabs from '../../components/CustomerTabs'
import ShortageTabs from '../../components/ShortageTabs'
import { getCategoryCode, ITEM_CATEGORIES, catOf, PROC_CATS, todayISO } from '../../lib/utils'
import PoCart, { addItemsToCart, fetchCart } from '../common/PoCart'
import { SkeletonRows } from '../../components/ux/Skeleton'
import { useConfirm } from '../../components/ux/ConfirmDialog'
import InfoTip from '../../components/ux/InfoTip'
import Spin from '../../components/ux/Spin'

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
  // 상위품번이 1,000개를 넘으면 뒷부분이 목록에 아예 안 나온다 (고를 수가 없다)
  return await fetchAll(() => supabase.from('projects')
    .select('id,code,name,rev').eq('customer_id', customerId)
    .order('code').order('id'))
}





// BOM → 상위품번 1대당 소요 (2026-09-30)
//   부족자재와 같은 규칙(pm_bom_explode): 상위품목 구매/자작 표시 · 하위 수량 × 상위 수량.
//   SQL(pm_bom_supply_260930.sql) 을 아직 안 돌렸으면 예전처럼 BOM 줄을 그대로 쓴다.
const ITEM_COLS = 'id,std_code,name,type,js_code,unit,lt_weeks,manufacturer,manufacturer_code,dept,category,purchase_price'
async function bomRowsFor(customerId, projIds) {
  const ex = await explodeProjects(customerId, projIds)
  if (ex === null) {
    // ⚠ BOM 은 상위품번 몇 개만 골라도 1,000행을 쉽게 넘는다 — 끝까지 · 정렬해서
    return fetchAll(() => supabase.from('bom')
      .select(`project_id,qty_per_unit,item_id,id, items!bom_item_id_fkey(${ITEM_COLS})`)
      .eq('customer_id', customerId).in('project_id', projIds)
      .order('id'))
  }
  const ids = [...new Set(ex.map(r => r.item_id))]
  const itemMap = {}
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await supabase.from('items').select(ITEM_COLS).in('id', ids.slice(i, i + 300))
    if (error) throw error
    ;(data || []).forEach(x => { itemMap[x.id] = x })
  }
  return ex.map(r => ({ ...r, items: itemMap[r.item_id] }))
}

async function fetchReqBOM(customerId, projectIds, manualItems) {
  // meta — 무엇이 몇 행 반영됐는지 화면에 보여 주기 위한 것.
  //   BOM 이 말없이 잘려 자재가 빠진 적이 있어(v3.84), 눈으로 확인할 수 있어야 한다.
  const meta = { parents: [], bomRows: 0, singles: [], notFound: [], items: 0 }
  if (!projectIds.length && !manualItems.length) return { items: [], meta }

  let rows = []

  // 프로젝트 선택 방식
  if (projectIds.length) {
    const poRows = await fetchAll(() => supabase
      .from('purchase_orders').select('project_id,qty_remaining')
      .eq('customer_id', customerId).eq('order_type','customer_po').not('status','in','(완료,취소)')
      .in('project_id', projectIds))

    // ⚠ BOM 은 상위품번 몇 개만 골라도 1,000행을 쉽게 넘는다.
    //   그냥 조회하면 말없이 잘리고 오류도 안 난다 (실제로 1,452행 중 452행이 빠졌다).
    //   정렬이 없으면 어느 1,000행이 올지도 매번 달라진다.
    const bomRows = await bomRowsFor(customerId, projectIds)

    const cpoMap = {}
    ;(poRows||[]).forEach(r=>{ if(r.project_id) cpoMap[r.project_id]=(cpoMap[r.project_id]||0)+(r.qty_remaining||0) })

    // 상위품번마다 BOM 이 몇 행 들어왔는지 남긴다
    const cntByProj = {}
    ;(bomRows||[]).forEach(b=>{ cntByProj[b.project_id]=(cntByProj[b.project_id]||0)+1 })
    projectIds.forEach(pid=>{ meta.parents.push({ id: pid, code: null, bom: cntByProj[pid]||0 }) })
    meta.bomRows += (bomRows||[]).length

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
        const bomRows = await bomRowsFor(customerId, projIds)
        const qtyByProj = {}
        asmCodes.forEach(c=>{ const m=manualItems.find(x=>x.code===c); qtyByProj[projByCode[c]]=Number(m?.qty)||0 })
        // 상위품번마다 몇 행이 반영됐는지 남긴다
        const cntByProj = {}
        ;(bomRows||[]).forEach(b=>{ cntByProj[b.project_id]=(cntByProj[b.project_id]||0)+1 })
        asmCodes.forEach(c=>{
          meta.parents.push({ id: projByCode[c], code: c,
                              qty: Number(manualItems.find(x=>x.code===c)?.qty)||0,
                              bom: cntByProj[projByCode[c]]||0 })
        })
        meta.bomRows += (bomRows||[]).length
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
        const { data: items, error: ie } = await supabase.from('items')
          .select('id,std_code,name,type,js_code,unit,lt_weeks,manufacturer,manufacturer_code,dept,category,purchase_price')
          .in('std_code', singleCodes)
        if (ie) throw ie
        // 상위품번도 아니고 품목에도 없는 것 — 지금까지 조용히 사라지고 있었다
        const found = new Set((items||[]).map(x=>x.std_code))
        meta.singles = singleCodes.filter(c=>found.has(c))
        meta.notFound = singleCodes.filter(c=>!found.has(c))
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

  // ⚠ BOM 을 다 가져오면 품목이 1,000종을 넘을 수 있다.
  //   .in() 에 한꺼번에 넣으면 결과가 잘리고 주소도 너무 길어진다.
  //   300개씩 나눠 부른다 (이 파일 위쪽 품목 조회와 같은 방식).
  const chunk = (arr, size = 300) => {
    const out = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
  }

  const invRows = []
  for (const ids of chunk(itemIds)) {
    const { data, error } = await supabase.from('inventory').select('item_id,qty').in('item_id', ids)
    if (error) throw error
    invRows.push(...(data || []))
  }

  const purchaseRows = []
  for (const ids of chunk(itemIds)) {
    purchaseRows.push(...await fetchAll(() => supabase.from('purchase_orders')
      .select('id,item_id,qty_remaining')
      .eq('customer_id', customerId).eq('order_type','purchase')
      .not('status','in','(완료,취소)').in('item_id', ids)
      .order('id')))
  }

  const invMap = {}; (invRows||[]).forEach(r=>{invMap[r.item_id]=r.qty})
  const purchaseMap = {}; (purchaseRows||[]).forEach(r=>{purchaseMap[r.item_id]=(purchaseMap[r.item_id]||0)+(r.qty_remaining||0)})

  // 구매처(벤더) — items.vendor_id 가 있으면 vendors 이름 매핑. 스키마에 없으면 조용히 생략.
  const vendorByItem = {}
  if (itemIds.length) {
    const itemVendors = []
    for (const ids of chunk(itemIds)) {
      const { data } = await supabase.from('items').select('id,vendor_id').in('id', ids)
      itemVendors.push(...(data || []))
    }
    const vids = [...new Set(itemVendors.map(x=>x.vendor_id).filter(Boolean))]
    const vRows = []
    for (const ids of chunk(vids)) {
      const { data } = await supabase.from('vendors').select('id,name').in('id', ids)
      vRows.push(...(data || []))
    }
    const vName = {}; vRows.forEach(v=>{ vName[v.id]=v.name })
    itemVendors.forEach(x=>{ if(x.vendor_id) vendorByItem[x.id]={ id:x.vendor_id, name:vName[x.vendor_id]||'' } })
  }

  meta.items = Object.keys(itemMap).length

  const out = Object.values(itemMap).map(r=>({
    ...r,
    stock: invMap[r.item_id]||0,
    pending: purchaseMap[r.item_id]||0,
    vendor: vendorByItem[r.item_id] || null,
    lack: Math.round((r.total_need - (invMap[r.item_id]||0)) * 100) / 100,
    order_need: Math.max(0, Math.round((r.total_need - (invMap[r.item_id]||0) - (purchaseMap[r.item_id]||0)) * 100) / 100),
  })).sort((a,b)=>b.order_need-a.order_need)

  return { items: out, meta }
}

// 통합검색 탭에서도 같은 화면을 쓴다.
//   주소에 고객사가 없으므로 밖에서 넘겨받는다.
//   같은 컴포넌트를 재사용하므로 한쪽만 고쳐져 어긋날 일이 없다.
export default function ReqBOM({ csCodeProp = null, embedded = false }) {
  const params = useParams()
  const csCode = csCodeProp ?? params.customerId
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
  const [ask, confirmEl] = useConfirm()   // v4.104.0 — 담기함 중복 확인 창

  const { data: cs } = useCustomer(csCode)
  const { data: projects=[] } = useQuery({
    queryKey:['projects',cs?.id], queryFn:()=>fetchProjects(cs?.id), enabled:!!cs?.id,
  })
  const { data: reqData, isLoading } = useQuery({
    queryKey:['reqbom',cs?.id,activeManual],
    queryFn:()=>fetchReqBOM(cs?.id, [], activeManual),
    enabled:!!cs?.id&&activeManual.length>0,
  })
  const rows = reqData?.items || []
  const meta = reqData?.meta || null

  // 발주 담기함 — 자재요청과 같은 담기함 (나만 보임). 여러 번 조회해 담아 두고 구매처별로 한꺼번에 등록 (v4.72.0)
  const [cartOpen, setCartOpen] = useState(false)
  const [carting, setCarting] = useState(false)
  const { data: cartRows = [] } = useQuery({ queryKey: ['poCart'], queryFn: fetchCart, staleTime: 30 * 1000 })
  const cartQtyOf = {}
  cartRows.forEach(c => { cartQtyOf[c.item_id] = (cartQtyOf[c.item_id] || 0) + (Number(c.qty) || 0) })
  // 발주 비고 — 어느 상위품번 몫인지 (예: 소요량 AX-110219638×2, AX-110158840×1)
  const reqMemo = activeManual.length ? ('소요량 ' + activeManual.map(m => `${m.code}×${m.qty}`).join(', ')).slice(0, 200) : ''

  const depts = ['전체',...new Set(rows.map(r=>r.dept||'미지정').filter(Boolean))]
  const filteredBase = deptFilter==='전체' ? rows : rows.filter(r=>(r.dept||'미지정')===deptFilter)
  const filtered = [...filteredBase].sort((a,b)=>{
    const av=sortVal(a,sortKey), bv=sortVal(b,sortKey)
    const cmp = (typeof av==='number'&&typeof bv==='number') ? av-bv : String(av).localeCompare(String(bv),'ko')
    return sortDir==='asc'?cmp:-cmp
  })
  function toggleSort(key){ if(!key) return; if(sortKey===key) setSortDir(d=>d==='asc'?'desc':'asc'); else { setSortKey(key); setSortDir('desc') } }

  // BOM 이 1만 건을 넘으면 검색·정렬 조작이 밀린다
  const vis = useVisibleRows(filtered, 200, [filtered.length, sortKey])

  const needOrder = filtered.filter(r=>r.order_need>0)
  // 충족 품목도 골라 추가 발주할 수 있다 (v4.72.0) — 수량은 직접 넣는다
  const checkedItems = filtered.filter(r=>checked[r.item_id])
  // 발주 담기 — 자재요청처럼 바로 담기함에 담는다 (v4.84.0)
  //   수량 = 발주필요 (충족 · 추가로 고른 품목은 0 → 담기함에서 넣는다) · 구매처 = 품목 기본 구매처 · 비고 = 어느 상위품번 몫인지
  //   구매처 · 납기 · 수량은 🛒 담기함에서 고쳐 구매처별로 한꺼번에 등록한다
  const qtyOf = (r) => (Number(r.order_need) > 0 ? Number(r.order_need) : 0)
  async function putInCart() {
    if (!checkedItems.length) return
    const dup = checkedItems.filter(r => cartQtyOf[r.item_id] > 0)
    if (dup.length && !(await ask({
      title: `담기함에 이미 있는 품목 ${dup.length}개 — 계속 담을까요?`,
      desc: '담으면 같은 품목 줄이 하나 더 생깁니다. 🛒 담기함에서 합치거나 빼세요.',
      items: dup.slice(0, 5).map(r => `${r.std_code} · ${r.name || ''} · 담기함 ${cartQtyOf[r.item_id]}`), more: Math.max(0, dup.length - 5),
      okText: '계속 담기',
    }))) return
    setCarting(true)
    try {
      const zero = checkedItems.filter(r => !(qtyOf(r) > 0)).length
      const { added } = await addItemsToCart(checkedItems.map(r => ({
        item_id: r.item_id, customer_id: cs?.id, qty: qtyOf(r), memo: reqMemo,
      })))
      qc.invalidateQueries({ queryKey: ['poCart'] })
      setChecked({})
      toastSuccess(`${added}개 품목을 담았습니다${zero ? ` · 수량 없는 ${zero}개는 담기함에서 수량을 넣으세요` : ''} — 🛒 담기함에서 구매처별로 묶어 등록`)
    } catch (e) { toastError('담기 실패: ' + e.message) }
    finally { setCarting(false) }
  }
  const allChecked = needOrder.length>0 && needOrder.every(r=>checked[r.item_id])
  const toggleCheck = (id,val)=>setChecked(p=>({...p,[id]:val}))

  // 엑셀에서 품번·수량 두 열을 복사해 붙여넣는다.
  //   예전에는 탭·줄바꿈을 다 같은 것으로 쪼개서
  //   "품번 [탭] 수량" 을 넣으면 수량이 다음 행의 품번 자리로 들어갔다.
  //   줄을 먼저 나누고, 줄 안에서 품번과 수량을 가른다.
  function handlePaste(e, i){
    const text = (e.clipboardData||window.clipboardData).getData('text')
    if(!text || !/[\n\t,]/.test(text)) return   // 단일 값이면 기본 동작
    e.preventDefault()

    // 탭이 있으면 탭만 열 구분으로 본다.
    //   쉼표를 함께 쪼개면 '1,780' 이 1 과 780 으로 갈려 수량이 780 이 된다.
    //   엑셀에서 복사하면 항상 탭이 온다.
    const sep = text.includes('\t') ? /\t/ : /,/

    const parsed = text.split(/\r?\n/).map(line => {
      const cells = line.split(sep).map(x=>x.trim()).filter(x=>x!=='')
      if(!cells.length) return null
      // 마지막 칸이 숫자면 수량으로 본다. 아니면 품번만 있는 것이다.
      const last = cells[cells.length-1].replace(/,/g,'')
      const hasQty = cells.length>1 && last!=='' && !isNaN(Number(last))
      return {
        code: cells[0],
        qty: hasQty ? String(Number(last)) : '',
      }
    }).filter(r => r && r.code)

    if(!parsed.length) return
    setManualItems(prev=>{
      const next=[...prev]
      parsed.forEach((row,k)=>{
        const idx=i+k
        // 수량을 안 붙여넣었으면 원래 칸에 적어 둔 값을 지우지 않는다
        if(next[idx]) next[idx]={ ...next[idx], code:row.code, qty: row.qty || next[idx].qty }
        else next[idx]=row
      })
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
    XLSX.writeFile(wb,`소요량조회_${todayISO()}.xlsx`)
  }

  return (
    <div className="space-y-4">
      {confirmEl}
      {/* 통합검색 안에서는 고객사 탭이 어울리지 않아 숨긴다 */}
      {!embedded && <>
        <PageHead crumb="소요 · 부족" title="소요량 조회"
          desc="상위 품번과 수량을 넣으면 BOM 을 전개해 필요한 부품 수량을 계산합니다. 역전개로 이 부품이 어디에 쓰이는지도 찾습니다." />
        <CustomerTabs /><ShortageTabs cs={csCode} />
      </>}
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
        <p className="text-[11px] text-slate-400">엑셀에서 <b>품번·수량 두 열</b>을 복사 → 첫 칸에 붙여넣으면 행이 나뉘고 수량까지 채워집니다 (품번만 복사해도 됩니다)</p>
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
              <button data-req-order onClick={putInCart} disabled={carting}
                title="담기함에 담습니다 — 수량 · 구매처 · 납기는 🛒 담기함에서 고쳐 구매처별로 한꺼번에 발주 등록 (자재요청과 같은 담기함)"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                {carting ? <><Spin />담는 중…</> : `🛒 선택 ${checkedItems.length}건 발주 담기`}
              </button>
            )}
            {(
              <button data-req-cart onClick={()=>setCartOpen(true)} title="자재요청 · 소요량 조회에서 담아 둔 것 — 구매처별로 묶어 한꺼번에 발주 등록"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100">
                🛒 담기함{cartRows.length>0 && <span className="px-1.5 rounded-full bg-indigo-600 text-white text-[10px]">{cartRows.length}</span>}
              </button>
            )}
            <button onClick={resetWidths} className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1.5 border border-slate-200 rounded-lg">열 초기화</button>
            {rows.length>0&&<button onClick={exportExcel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">
              📥 엑셀 추출
            </button>}
          </div>

          {/* 무엇이 몇 행 반영됐는지.
              BOM 이 1,000행에서 말없이 잘려 자재가 빠진 적이 있어(v3.84),
              결과를 믿어도 되는지 눈으로 확인할 수 있게 한다. */}
          {meta && !isLoading && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2">
              <p className="text-xs font-bold text-slate-600">
                📥 조회 반영 내역 — 상위품번 {meta.parents.length}개 · BOM {meta.bomRows.toLocaleString('ko-KR')}행
                {meta.singles.length > 0 && ` · 단품 ${meta.singles.length}개`}
                {' → 품목 '}{meta.items.toLocaleString('ko-KR')}종
              </p>

              {meta.parents.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {meta.parents.map(p => (
                    <span key={p.id}
                      className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
                        p.bom > 0
                          ? 'border-slate-200 bg-white text-slate-600'
                          : 'border-red-300 bg-red-50 text-red-600'}`}>
                      <span className="font-mono">{p.code || p.id}</span>
                      {p.qty ? <span className="text-slate-400"> ×{p.qty}</span> : null}
                      {' '}{p.bom > 0 ? `${p.bom}행` : 'BOM 없음'}
                    </span>
                  ))}
                </div>
              )}

              {meta.singles.length > 0 && (
                <p className="text-[11px] text-slate-500">
                  단품으로 처리 (BOM 전개 안 함): <span className="font-mono">{meta.singles.join(', ')}</span>
                </p>
              )}

              {meta.notFound.length > 0 && (
                <p className="text-xs font-bold text-red-600">
                  ⚠️ 못 찾은 품번 {meta.notFound.length}개 — 결과에 빠져 있습니다:{' '}
                  <span className="font-mono">{meta.notFound.join(', ')}</span>
                </p>
              )}

              {meta.parents.some(p => p.bom === 0) && (
                <p className="text-xs font-bold text-red-600">
                  ⚠️ BOM 이 한 행도 없는 상위품번이 있습니다 — BOM 등록을 확인하세요.
                </p>
              )}
            </div>
          )}

          <div className="kpi-grid grid grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-1">전체 품목<InfoTip text="입력한 상위 품번의 BOM 을 전개(단품은 그대로)해 나온 부품 종류 수. 위에서 관리부서를 고르면 그 부서 것만 셉니다." /></p><p className="text-xl font-bold text-slate-900">{filtered.length}</p></div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-3"><p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-1 flex items-center gap-1">발주필요<InfoTip text="총소요량 − 현재고 − 구매발주 미입고 가 0보다 큰 부품 수. 구매발주 미입고 = 이 고객사의 구매 발주 중 완료 · 취소가 아닌 것의 남은 수량. 관리부서 필터를 따릅니다." /></p><p className="text-xl font-bold text-red-600">{filtered.filter(r=>r.order_need>0).length}</p></div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-bold text-amber-500 uppercase tracking-wide mb-1 flex items-center gap-1">입력 품목<InfoTip align="right" text="「소요량 조회」를 누를 때 품번과 수량이 둘 다 들어 있던 입력 줄 수." /></p><p className="text-xl font-bold text-amber-700">{activeManual.length}개</p></div>
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3"><p className="text-xs font-bold text-indigo-400 uppercase tracking-wide mb-1 flex items-center gap-1">선택됨<InfoTip align="right" text="아래 표에서 체크한 부품 수 (지금 고른 관리부서 안에서). 「🛒 발주 담기」로 담기함에 담깁니다." /></p><p className="text-xl font-bold text-indigo-600">{checkedItems.length}</p></div>
          </div>

          {isLoading ? (
            <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
              <table className="w-full text-xs"><tbody><SkeletonRows cols={COLS.length + 1} rows={8} first={1} two={[1]} /></tbody></table>
            </div>
          ) : (<>
            <div className="rounded-xl border border-slate-200 overflow-x-auto">
              <div className="overflow-x-auto">
                <table className="text-xs" style={{tableLayout:'fixed',width:COLS.reduce((a,c)=>a+(widths[c.key]||COL_DEFAULTS[c.key]||80),44)+'px'}}>
                  <colgroup>
                    <col style={{width:'44px'}}/>
                    {COLS.map(c=><col key={c.key} style={{width:(widths[c.key]||COL_DEFAULTS[c.key]||80)+'px'}}/>)}
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2.5 w-8">
                        <input type="checkbox" checked={allChecked} title="발주필요 품목 전체 선택 · 충족 품목은 줄마다 골라 추가 발주" onChange={e=>{
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
                    ) : vis.shown.map(r=>(
                      <tr key={r.item_id} className={`border-b border-slate-100 hover:bg-slate-50 ${r.order_need>0?'bg-red-50/10':''}`}>
                        <td className="px-3 py-2">
                          <input type="checkbox" data-req-check={r.std_code} checked={!!checked[r.item_id]} onChange={e=>toggleCheck(r.item_id,e.target.checked)}
                            title={r.order_need>0?undefined:'충족 — 골라서 추가 발주할 수 있습니다'}
                            className={`w-3.5 h-3.5 accent-indigo-600 ${r.order_need>0?'':'opacity-50 hover:opacity-100 checked:opacity-100'}`}/>
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
                        <td className="px-2 py-2 text-right font-bold">{r.order_need>0?<span className="text-red-600">{r.order_need} {r.unit}</span>:<span className="text-emerald-600">충족</span>}
                          {cartQtyOf[r.item_id]>0 && <div data-in-cart className="text-[10px] font-semibold text-indigo-500" title="발주 담기함에 담아 둔 수량 (아직 발주 전 — 발주필요 계산에는 안 들어감)">🛒 {cartQtyOf[r.item_id]} 담김</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <MoreRows {...vis} />
              </div>
            </div>
            <p className="text-xs text-slate-400">💡 헤더 클릭 → 정렬(다시 클릭 시 오름/내림 전환) · 헤더 오른쪽 끝 드래그 → 열 너비 조절 · 구분은 DB 등록값 기준 · 충족 품목도 체크해 추가 발주 · 여러 상위품번은 한 번에 입력해 조회해야 재고를 나눠 계산합니다</p>
            </>
          )}
        </>
      )}

      <PoCart open={cartOpen} onClose={()=>setCartOpen(false)} />
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
        isLoading ? (
          <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
            <table className="w-full text-xs"><tbody><SkeletonRows cols={5} rows={6} /></tbody></table>
          </div>
        )
        : rows.length === 0
          ? <div className="text-center py-12 text-slate-400 text-sm">이 부품을 쓰는 상위 어셈블리가 없습니다</div>
          : (
            <div className="rounded-xl border border-slate-200 overflow-x-auto">
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
