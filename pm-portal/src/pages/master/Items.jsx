import { useState, useRef } from 'react'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useCustomers } from '../../hooks/useCustomers'
import { catOf } from '../../lib/utils'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { ResizableTable } from '../../components/ResizableTable'
import VendorPicker from '../../components/VendorPicker'
import * as XLSX from 'xlsx'

const EMPTY = { std_code:'', name:'', type:'자재', unit:'EA', spec:'', lt_weeks:'', safety_stock:'', manufacturer:'', manufacturer_code:'', purchase_price:'', dept:'', vendor_id:'', memo:'', prod_managed:false, stock_managed:true, proc_order:false }

// JS코드 prefix → 세부 분류명
const CAT_LIST = ['케이블','와이어','커넥터','차단기','전장','판금','어셈블리','하네스','하드웨어','기타']
const CAT_BADGE = { '어셈블리':'bg-emerald-50 text-emerald-700', '하네스':'bg-violet-50 text-violet-700', '판금':'bg-slate-100 text-slate-600' }
const badgeOf = cat => CAT_BADGE[cat] || 'bg-blue-50 text-blue-600'

async function fetchItems(search, type, field = '전체') {
  // 검색어에 * 가 있으면 와일드카드로 (17* → 17로 시작). 없으면 부분일치(%검색%)
  let pattern = ''
  if (search) {
    const s = search.trim()
    pattern = s.includes('*') ? s.replace(/\*/g, '%') : `%${s}%`
  }

  // 구매처(협력사)명으로도 검색 — vendors는 조인이라 먼저 매칭되는 vendor_id를 구함
  let vendorIds = []
  if (search && (field === '전체' || field === '구매처')) {
    const { data: vs } = await supabase.from('vendors').select('id').ilike('name', pattern)
    vendorIds = (vs || []).map(v => v.id)
  }

  // 필드별 검색 조건 구성
  function buildOr() {
    if (field === '코드') return `std_code.ilike.${pattern}`
    if (field === '품명') return `name.ilike.${pattern}`
    if (field === '규격') return `spec.ilike.${pattern},manufacturer.ilike.${pattern},manufacturer_code.ilike.${pattern}`
    if (field === '구매처') return vendorIds.length ? `vendor_id.in.(${vendorIds.join(',')})` : 'id.eq.00000000-0000-0000-0000-000000000000'
    // 전체
    const conds = [
      `name.ilike.${pattern}`,
      `std_code.ilike.${pattern}`,
      `manufacturer.ilike.${pattern}`,
      `manufacturer_code.ilike.${pattern}`,
      `spec.ilike.${pattern}`,
    ]
    if (vendorIds.length) conds.push(`vendor_id.in.(${vendorIds.join(',')})`)
    return conds.join(',')
  }

  // Supabase 1000행 제한 대응 — 전체 페이징 로딩
  const all = []
  for (let from = 0; ; from += 1000) {
    let q = supabase.from('items')
      .select('*, vendors(id,name), customer_item_codes(id,customer_code,customer_id)')
      .order('std_code')
      .range(from, from + 999)
    if (search) q = q.or(buildOr())
    if (type !== '전체') q = q.eq('type', type)
    const { data, error } = await q
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return all
}
async function fetchVendorList() {
  const { data } = await supabase.from('vendors').select('id,name').order('name')
  return data || []
}

const COLS = [
  { key:'std_code',     label:'기준코드',   defaultWidth:100 },
  { key:'name',         label:'품명',       defaultWidth:180 },
  { key:'type',         label:'구분',       defaultWidth:55  },
  { key:'unit',         label:'단위',       defaultWidth:45  },
  { key:'lt',           label:'LT',         defaultWidth:45  },
  { key:'safety',       label:'안전재고',   defaultWidth:70  },
  { key:'price',        label:'매입가',     defaultWidth:80  },
  { key:'dept',         label:'관리부서',   defaultWidth:80  },
  { key:'stock_mgmt',   label:'재고관리',   defaultWidth:70  },
  { key:'spec',         label:'규격',       defaultWidth:180 },
  { key:'vendor',       label:'구매처',     defaultWidth:90  },
  { key:'cs_codes',     label:'고객사 코드',defaultWidth:180 },
  { key:'actions',      label:'',           defaultWidth:80  },
]

export default function Items() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [searchField, setSearchField] = useState('전체')  // 전체/코드/품명/규격/구매처
  const [catFilter, setCatFilter] = useState('전체')
  const [query, setQuery] = useState({ search:'', type:'전체', field:'전체' })
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [codeModal, setCodeModal] = useState(null)
  const [codeForm, setCodeForm] = useState({ customer_id:'', customer_code:'', customer_name:'' })
  const [bulkMode, setBulkMode] = useState(false)
  const [visibleCount, setVisibleCount] = useState(300)
  const [selected, setSelected] = useState(() => new Set())
  const [bulkForm, setBulkForm] = useState({ lt_weeks:'', safety_stock:'', dept:'', prod_managed:'', stock_managed:'' })

  const { data: items=[], isLoading } = useQuery({
    queryKey:['items',query], queryFn:()=>fetchItems(query.search, query.type, query.field)
  })
  const { data: customers=[] } = useCustomers()
  const custName = (id) => customers.find(c=>c.id===id)?.name || ''
  const { data: vendorList=[] } = useQuery({ queryKey:['vendorList'], queryFn:fetchVendorList })

  // 세부 분류(구분) 필터 — js_code 기준 클라이언트 필터
  const shown = catFilter === '전체' ? items : items.filter(i => catOf(i) === catFilter)

  const saveMut = useMutation({
    mutationFn: async (data) => {
      const payload = {
        std_code: data.std_code,
        name: data.name,
        type: data.type,
        unit: data.unit,
        spec: data.spec || null,
        lt_weeks: data.lt_weeks ? Number(data.lt_weeks) : 0,
        safety_stock: data.safety_stock ? Number(data.safety_stock) : 0,
        manufacturer: data.manufacturer || null,
        manufacturer_code: data.manufacturer_code || null,
        purchase_price: data.purchase_price ? Number(data.purchase_price) : null,
        dept: data.dept || null,
        vendor_id: data.vendor_id || null,
        memo: data.memo || null,
        prod_managed: !!data.prod_managed,
        stock_managed: data.stock_managed !== false,
        proc_order: !!data.proc_order,
      }
      if (editId) {
        const { error } = await supabase.from('items').update(payload).eq('id', editId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('items').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => { qc.invalidateQueries(['items']); setForm(EMPTY); setShowForm(false); setEditId(null) },
    onError: (e) => toastError('오류: ' + e.message),
  })

  const deleteMut = useMutation({
    mutationFn: async (id) => { const { error } = await supabase.from('items').delete().eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries(['items']),
  })

  const addCodeMut = useMutation({
    mutationFn: async ({ itemId, customer_id, customer_code, customer_name }) => {
      const { error } = await supabase.from('customer_item_codes')
        .upsert({ item_id:itemId, customer_id, customer_code, customer_name }, { onConflict:'customer_id,customer_code' })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries(['items']); setCodeModal(null); setCodeForm({ customer_id:'', customer_code:'', customer_name:'' }) },
    onError: (e) => toastError('오류: ' + e.message),
  })

  const deleteCodeMut = useMutation({
    mutationFn: async (id) => { const { error } = await supabase.from('customer_item_codes').delete().eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries(['items']),
  })

  const bulkMut = useMutation({
    mutationFn: async () => {
      const patch = {}
      if (bulkForm.lt_weeks !== '') patch.lt_weeks = Number(bulkForm.lt_weeks)
      if (bulkForm.safety_stock !== '') patch.safety_stock = Number(bulkForm.safety_stock)
      if (bulkForm.dept.trim() !== '') patch.dept = bulkForm.dept.trim()
      if (bulkForm.prod_managed !== '') patch.prod_managed = bulkForm.prod_managed === 'true'
      if (bulkForm.stock_managed !== '') patch.stock_managed = bulkForm.stock_managed === 'true'
      if (Object.keys(patch).length === 0 || selected.size === 0) return
      const ids = [...selected]
      for (let i = 0; i < ids.length; i += 200) {
        const { error } = await supabase.from('items').update(patch).in('id', ids.slice(i, i + 200))
        if (error) throw error
      }
    },
    onSuccess: () => { qc.invalidateQueries(['items']); setSelected(new Set()); setBulkForm({ lt_weeks:'', safety_stock:'', dept:'', prod_managed:'', stock_managed:'' }) },
  })

  function toggleSel(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function handleEdit(item) {
    setForm({
      std_code: item.std_code||'', name: item.name||'', type: item.type||'자재',
      proc_order: !!item.proc_order,
      unit: item.unit||'EA', spec: item.spec||'',
      lt_weeks: item.lt_weeks||'', safety_stock: item.safety_stock||'',
      manufacturer: item.manufacturer||'', manufacturer_code: item.manufacturer_code||'',
      purchase_price: item.purchase_price||'', dept: item.dept||'',
      vendor_id: item.vendor_id||'', memo: item.memo||'', prod_managed: !!item.prod_managed, stock_managed: item.stock_managed !== false,
    })
    setEditId(item.id); setShowForm(true)
  }

  const [vendorImport, setVendorImport] = useState(null)
  const vendorFileRef = useRef(null)

  async function handleVendorFile(e) {
    const file = e.target.files?.[0]; if (e.target) e.target.value = ''
    if (!file) return
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
      const parsed = rows.map(r => ({
        std_code: String(r['기준코드'] ?? r['코드'] ?? '').trim(),
        vendorName: String(r['구매처'] ?? '').trim(),
      })).filter(r => r.std_code && r.vendorName)
      if (!parsed.length) { toastError('기준코드+구매처가 채워진 행이 없습니다'); return }
      const codes = [...new Set(parsed.map(r => r.std_code))]
      const imap = {}
      for (let i = 0; i < codes.length; i += 300) {
        const { data } = await supabase.from('items').select('id,std_code,vendor_id,vendors(name)').in('std_code', codes.slice(i, i + 300))
        ;(data || []).forEach(x => { imap[x.std_code] = { id: x.id, vendor_id: x.vendor_id, cur: x.vendors?.name || '' } })
      }
      const vmap = {}
      vendorList.forEach(v => { vmap[String(v.name).trim().toLowerCase()] = v.id })
      const toUpdate = [], itemNF = new Set(), vendorNF = new Set(); let nochange = 0
      for (const r of parsed) {
        const it = imap[r.std_code]
        const vid = vmap[r.vendorName.toLowerCase()]
        if (!it) { itemNF.add(r.std_code); continue }
        if (!vid) { vendorNF.add(r.vendorName); continue }
        if (it.vendor_id === vid) { nochange++; continue }
        toUpdate.push({ std_code: r.std_code, vendor_id: vid, vendorName: r.vendorName, cur: it.cur })
      }
      setVendorImport({ toUpdate, itemNF: [...itemNF], vendorNF: [...vendorNF], nochange, total: parsed.length })
    } catch (err) { toastError('파일 읽기 오류: ' + (err?.message || err)) }
  }

  const applyVendorMut = useMutation({
    mutationFn: async () => {
      const byVendor = {}
      for (const u of vendorImport.toUpdate) { (byVendor[u.vendor_id] ||= []).push(u.std_code) }
      for (const [vid, list] of Object.entries(byVendor)) {
        for (let i = 0; i < list.length; i += 200) {
          const { error } = await supabase.from('items').update({ vendor_id: vid }).in('std_code', list.slice(i, i + 200))
          if (error) throw error
        }
      }
    },
    onSuccess: () => { qc.invalidateQueries(['items']); const n = vendorImport.toUpdate.length; setVendorImport(null); toastSuccess(`구매처 일괄 업데이트 완료 — ${n}건`) },
    onError: (e) => toastError('업데이트 오류: ' + e.message),
  })

  function exportExcel() {
    const data = shown.map(item => ({
      '기준코드':item.js_code || item.std_code || '',
      'STD코드':item.std_code || '',
      '고객사코드':(item.customer_item_codes||[]).map(c=>c.customer_code).filter(Boolean).join(', '),
      '품명':item.name, '구분':catOf(item), '자재구분':item.type, '단위':item.unit,
      'LT(주)':item.lt_weeks, '안전재고':item.safety_stock, '매입가':item.purchase_price||'',
      '관리부서':item.dept||'', '재고관리':item.stock_managed!==false?'관리':'제외', '규격':item.spec||'', '구매처':item.vendors?.name||'',
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), '기준코드DB')
    XLSX.writeFile(wb, `기준코드DB_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  const f = k => e => setForm(prev => ({...prev, [k]: e.target.value}))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={searchField} onChange={e=>{ setSearchField(e.target.value); setQuery({search, type:'전체', field:e.target.value}) }}
          className="px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
          {['전체','코드','품명','규격','구매처'].map(f=><option key={f} value={f}>{f}</option>)}
        </select>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          onKeyDown={e=>{ if(e.key==='Enter') setQuery({search, type:'전체', field:searchField}) }}
          placeholder={searchField==='전체' ? "코드·품명·제조사·구매처 검색 (17* = 17로 시작)" : `${searchField}(으)로 검색 (17* = 17로 시작)`}
          className="w-full sm:w-64 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
        <select value={catFilter} onChange={e=>setCatFilter(e.target.value)}
          className="px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
          <option value="전체">구분 전체</option>
          {CAT_LIST.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <div className="flex-1"/>
        <span className="text-xs text-slate-400 font-semibold">{shown.length}개{shown.length>visibleCount && ` (${visibleCount}개 표시)`}</span>
        <button onClick={exportExcel}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">
          📥 엑셀 추출
        </button>
        <button onClick={()=>vendorFileRef.current?.click()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">
          📤 구매처 일괄매칭
        </button>
        <input ref={vendorFileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleVendorFile} />
        <button onClick={()=>{ setBulkMode(v=>!v); setSelected(new Set()) }}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border ${bulkMode?'bg-amber-500 text-white border-amber-500':'border-slate-200 text-slate-600 bg-white hover:bg-slate-50'}`}>
          ✏️ 일괄수정
        </button>
        <button onClick={()=>{ setForm(EMPTY); setEditId(null); setShowForm(!showForm) }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
          ➕ 품목 추가
        </button>
      </div>

      {vendorImport && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50/40 p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-bold text-emerald-800">📤 구매처 일괄매칭 미리보기 <span className="text-slate-400 font-normal">· 파일 {vendorImport.total}행</span></p>
            <div className="flex gap-2">
              <button onClick={()=>setVendorImport(null)} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-500 bg-white hover:bg-slate-50">취소</button>
              <button onClick={()=>applyVendorMut.mutate()} disabled={applyVendorMut.isPending || !vendorImport.toUpdate.length}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
                {applyVendorMut.isPending ? '적용 중...' : `⚡ ${vendorImport.toUpdate.length}건 적용`}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 font-bold">변경 {vendorImport.toUpdate.length}건</span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 font-semibold">변동없음 {vendorImport.nochange}건</span>
            {vendorImport.vendorNF.length>0 && <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-700 font-bold">미등록 구매처 {vendorImport.vendorNF.length}개</span>}
            {vendorImport.itemNF.length>0 && <span className="px-2.5 py-1 rounded-lg bg-rose-100 text-rose-600 font-semibold">품목없음 {vendorImport.itemNF.length}개</span>}
          </div>
          {vendorImport.vendorNF.length>0 && (
            <div className="rounded-lg border border-amber-200 bg-white p-3">
              <p className="text-xs font-bold text-amber-700 mb-1">⚠️ 협력사 DB에 없는 구매처 — 매칭에서 제외됨 (협력사에 먼저 등록하거나 이름 확인 필요)</p>
              <p className="text-xs text-slate-600 leading-relaxed">{vendorImport.vendorNF.join(' · ')}</p>
            </div>
          )}
          {vendorImport.itemNF.length>0 && (
            <details className="rounded-lg border border-rose-200 bg-white p-3">
              <summary className="text-xs font-bold text-rose-600 cursor-pointer">품목 DB에 없는 기준코드 {vendorImport.itemNF.length}개</summary>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{vendorImport.itemNF.join(' · ')}</p>
            </details>
          )}
          {vendorImport.toUpdate.length>0 && (
            <details className="rounded-lg border border-emerald-200 bg-white p-3">
              <summary className="text-xs font-bold text-emerald-700 cursor-pointer">변경 대상 {vendorImport.toUpdate.length}건 미리보기</summary>
              <div className="mt-2 max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-400 border-b border-slate-100">
                    <tr><th className="text-left py-1 px-1 font-semibold">기준코드</th><th className="text-left py-1 px-1 font-semibold">기존 구매처</th><th className="text-left py-1 px-1 font-semibold">→ 새 구매처</th></tr>
                  </thead>
                  <tbody>
                    {vendorImport.toUpdate.slice(0,200).map((u,i)=>(
                      <tr key={i} className="border-b border-slate-50">
                        <td className="py-1 px-1 font-mono text-indigo-600">{u.std_code}</td>
                        <td className="py-1 px-1 text-slate-400">{u.cur || '—'}</td>
                        <td className="py-1 px-1 font-semibold text-emerald-700">{u.vendorName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {vendorImport.toUpdate.length>200 && <p className="text-[11px] text-slate-400 mt-1.5">… 외 {vendorImport.toUpdate.length-200}건 (적용 시 전부 반영)</p>}
              </div>
            </details>
          )}
        </div>
      )}

      {bulkMode && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-amber-700">일괄수정</span>
            <span className="text-xs text-slate-500">선택 {selected.size}건</span>
            <button onClick={()=>setSelected(new Set(shown.map(i=>i.id)))}
              className="px-2 py-1 text-xs font-semibold rounded border border-amber-300 text-amber-700 bg-white hover:bg-amber-100">검색결과 전체선택</button>
            <button onClick={()=>setSelected(new Set())}
              className="px-2 py-1 text-xs font-semibold rounded border border-slate-200 text-slate-500 bg-white hover:bg-slate-50">해제</button>
            <span className="text-[11px] text-slate-400">· 값 입력한 항목만 변경 (빈칸은 유지) · 행 체크로 선택</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">LT (주)</label>
              <input type="number" value={bulkForm.lt_weeks} onChange={e=>setBulkForm(f=>({...f,lt_weeks:e.target.value}))} placeholder="변경 안 함"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">안전재고</label>
              <input type="number" value={bulkForm.safety_stock} onChange={e=>setBulkForm(f=>({...f,safety_stock:e.target.value}))} placeholder="변경 안 함"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">관리부서</label>
              <input value={bulkForm.dept} onChange={e=>setBulkForm(f=>({...f,dept:e.target.value}))} placeholder="변경 안 함"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">생산관리 대상 🏭</label>
              <select value={bulkForm.prod_managed} onChange={e=>setBulkForm(f=>({...f,prod_managed:e.target.value}))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white">
                <option value="">변경 안 함</option>
                <option value="true">대상으로 지정</option>
                <option value="false">대상 해제</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">재고관리 대상 📦</label>
              <select value={bulkForm.stock_managed} onChange={e=>setBulkForm(f=>({...f,stock_managed:e.target.value}))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white">
                <option value="">변경 안 함</option>
                <option value="true">대상으로 지정</option>
                <option value="false">대상 해제 (부족자재 제외)</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={()=>bulkMut.mutate()}
              disabled={selected.size===0 || (bulkForm.lt_weeks===''&&bulkForm.safety_stock===''&&bulkForm.dept.trim()===''&&bulkForm.prod_managed===''&&bulkForm.stock_managed==='') || bulkMut.isPending}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40">
              {bulkMut.isPending ? '수정 중...' : `선택 ${selected.size}건 일괄수정`}
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
          <p className="text-xs font-bold text-slate-700">{editId ? '품목 수정' : '신규 품목 등록'}</p>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">기준코드 *</label>
              <input value={form.std_code} onChange={f('std_code')} placeholder="기준코드"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-bold text-slate-500 mb-1">품명 *</label>
              <input value={form.name} onChange={f('name')} placeholder="품명"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">구분</label>
              <select value={form.type} onChange={f('type')}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option>자재</option><option>가공</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">단위</label>
              <input value={form.unit} onChange={f('unit')} placeholder="EA"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">LT (주)</label>
              <input type="number" value={form.lt_weeks} onChange={f('lt_weeks')} placeholder="0"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">안전재고</label>
              <input type="number" value={form.safety_stock} onChange={f('safety_stock')} placeholder="0"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">매입가</label>
              <input type="number" value={form.purchase_price} onChange={f('purchase_price')} placeholder="단가"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">관리부서</label>
              <input value={form.dept} onChange={f('dept')} placeholder="구매팀/하네스팀"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">구매처</label>
              <VendorPicker value={form.vendor_id} onChange={id=>setForm(p=>({...p, vendor_id:id}))} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-bold text-slate-500 mb-1">규격 (제조사 + 제조사품번)</label>
              <input value={form.spec} onChange={f('spec')} placeholder="제조사 + 제조사품번"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <input type="checkbox" checked={!!form.prod_managed} onChange={e=>setForm(p=>({...p,prod_managed:e.target.checked}))}/>
                생산관리 대상 🏭 <span className="font-normal text-slate-400">(PO 시 호기 자동등록)</span>
              </label>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <input type="checkbox" checked={form.stock_managed !== false} onChange={e=>setForm(p=>({...p,stock_managed:e.target.checked}))}/>
                재고관리 대상 📦 <span className="font-normal text-slate-400">(해제 시 부족자재 제외)</span>
              </label>
            </div>
            <div className="col-span-2 flex items-end pb-2">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <input type="checkbox" checked={!!form.proc_order} onChange={e=>setForm(p=>({...p,proc_order:e.target.checked}))}/>
                발주 시 판금 취급 🔧 <span className="font-normal text-slate-400">(분류는 그대로, BOM 발주 "판금만"에 같이 포함)</span>
              </label>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={()=>{ setShowForm(false); setForm(EMPTY); setEditId(null) }}
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">취소</button>
            <button onClick={()=>saveMut.mutate(form)}
              disabled={!form.std_code.trim()||!form.name.trim()||saveMut.isPending}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
              {saveMut.isPending ? '저장 중...' : editId ? '수정 완료' : '등록'}
            </button>
          </div>
        </div>
      )}

      {/* 고객사 코드 추가 모달 */}
      {codeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={()=>setCodeModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-96 p-5" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-bold text-slate-900">고객사 코드 추가</p>
                <p className="text-xs text-slate-400 mt-0.5">{codeModal.itemName}</p>
              </div>
              <button onClick={()=>setCodeModal(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">고객사 *</label>
                <select value={codeForm.customer_id} onChange={e=>setCodeForm(f=>({...f,customer_id:e.target.value}))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">선택</option>
                  {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">고객사 코드 *</label>
                <input value={codeForm.customer_code} onChange={e=>setCodeForm(f=>({...f,customer_code:e.target.value}))}
                  placeholder="고객사 품번"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">고객사 품명 (선택)</label>
                <input value={codeForm.customer_name} onChange={e=>setCodeForm(f=>({...f,customer_name:e.target.value}))}
                  placeholder="고객사 품명"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={()=>setCodeModal(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">취소</button>
              <button onClick={()=>addCodeMut.mutate({itemId:codeModal.itemId,...codeForm})}
                disabled={!codeForm.customer_id||!codeForm.customer_code||addCodeMut.isPending}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                {addCodeMut.isPending ? '추가 중...' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!isLoading && shown.length > visibleCount && (
        <div className="text-center -mb-2">
          <button onClick={()=>setVisibleCount(v=>v+500)}
            className="px-4 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500 bg-white hover:bg-slate-50">
            더 보기 ({visibleCount.toLocaleString()} / {shown.length.toLocaleString()})
          </button>
        </div>
      )}
      {isLoading ? <div className="text-center py-12 text-slate-400 text-sm">불러오는 중...</div> : (
        <ResizableTable cols={COLS} storageKey="items_cols">
          {() => (
            <tbody>
              {shown.length===0
                ? <tr><td colSpan={COLS.length} className="text-center py-10 text-slate-400">품목을 추가해주세요</td></tr>
                : shown.slice(0, visibleCount).map(item=>(
                  <tr key={item.id} onDoubleClick={()=>handleEdit(item)}
                    className={`border-b border-slate-100 hover:bg-slate-50 group cursor-pointer ${selected.has(item.id)?'bg-amber-50':''}`}>
                    {/* 1. 기준코드 */}
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-indigo-600 overflow-hidden truncate">
                      {bulkMode && <input type="checkbox" checked={selected.has(item.id)} onChange={()=>toggleSel(item.id)} onClick={e=>e.stopPropagation()} className="mr-2 align-middle"/>}
                      {item.js_code
                        ? <span className="text-violet-700">{item.js_code}</span>
                        : item.std_code}
                      {item.prod_managed && <span title="생산관리 대상" className="ml-1">🏭</span>}{item.stock_managed === false && <span title="재고관리 제외" className="ml-1 text-[10px] px-1 rounded bg-slate-100 text-slate-400 font-bold">재고X</span>}
                    </td>
                    {/* 2. 품명 */}
                    <td className="px-3 py-2 font-semibold text-slate-800 overflow-hidden truncate">{item.name}</td>
                    {/* 3. 구분 */}
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold
                        ${badgeOf(catOf(item))}`}>{catOf(item)}</span>
                    </td>
                    {/* 4. 단위 */}
                    <td className="px-3 py-2 text-slate-500">{item.unit}</td>
                    {/* 5. LT */}
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600">{item.lt_weeks||0}W</span>
                    </td>
                    {/* 6. 안전재고 */}
                    <td className="px-3 py-2 text-right text-slate-600">{item.safety_stock||0}</td>
                    {/* 7. 매입가 */}
                    <td className="px-3 py-2 text-right text-slate-600">
                      {item.purchase_price ? Number(item.purchase_price).toLocaleString() : '-'}
                    </td>
                    {/* 8. 관리부서 */}
                    <td className="px-3 py-2">
                      {item.dept
                        ? <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-600">{item.dept}</span>
                        : <span className="text-slate-300">-</span>}
                    </td>
                    {/* 재고관리 여부 */}
                    <td className="px-3 py-2 text-center">
                      {item.stock_managed !== false
                        ? <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600">📦 관리</span>
                        : <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-400">제외</span>}
                    </td>
                    {/* 9. 규격 */}
                    <td className="px-3 py-2 text-slate-500 overflow-hidden truncate">{item.spec||'-'}</td>
                    {/* 10. 구매처 */}
                    <td className="px-3 py-2 text-slate-500 overflow-hidden truncate">
                      {item.vendors?.name
                        ? <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700">{item.vendors.name}</span>
                        : <span className="text-slate-300">-</span>}
                    </td>
                    {/* 11. 고객사 코드 */}
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1 items-center">
                        {item.js_code && (
                          <span className="inline-flex items-center text-xs px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 font-mono font-semibold">
                            {item.std_code}
                          </span>
                        )}
                        {(item.customer_item_codes||[]).map((c,i)=>(
                          <span key={i} className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 group/code">
                            <span className="text-slate-300 text-xs">{custName(c.customer_id)}</span>
                            {c.customer_code}
                            <button onClick={()=>deleteCodeMut.mutate(c.id)}
                              className="opacity-0 group-hover/code:opacity-100 text-slate-300 hover:text-red-400 transition-opacity ml-0.5">×</button>
                          </span>
                        ))}
                        <button
                          onClick={()=>{ setCodeModal({itemId:item.id,itemName:item.name}); setCodeForm({customer_id:'',customer_code:'',customer_name:''}) }}
                          className="opacity-0 group-hover:opacity-100 text-xs text-indigo-400 hover:text-indigo-600 transition-opacity px-1">
                          +코드
                        </button>
                      </div>
                    </td>
                    {/* 12. 액션 */}
                    <td className="px-3 py-2">
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={()=>handleEdit(item)}
                          className="px-2 py-1 text-xs font-semibold rounded border border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600">수정</button>
                        <button onClick={()=>{ if(window.confirm('삭제할까요?')) deleteMut.mutate(item.id) }}
                          className="px-2 py-1 text-xs font-semibold rounded border border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-500">삭제</button>
                      </div>
                    </td>
                  </tr>
                ))
              }
            </tbody>
          )}
        </ResizableTable>
      )}
    </div>
  )
}
