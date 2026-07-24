import { useState } from 'react'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useCustomer } from '../../hooks/useCustomers'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { ResizableTable } from '../../components/ResizableTable'
import CustomerPOUpload from './CustomerPOUpload'
import CustomerTabs from '../../components/CustomerTabs'
import { downloadSheet } from '../../lib/exportSheet'

async function fetchCustomerPOs(csId, showAll) {
  if (!csId) return []
  const today = new Date().toISOString().split('T')[0]
  const make = () => {
    let qb = supabase
      .from('purchase_orders')
      .select('*, items!purchase_orders_item_id_fkey(std_code,name,type,lt_weeks), projects(code,name)')
      .eq('customer_id', csId).eq('order_type','customer_po')
    if (!showAll) qb = qb.neq('status','완료')
    return qb.order('promise_date', { ascending: true })
  }
  const data = await fetchAll(make)
  return (data||[]).map(p=>({ ...p, isDelayed: p.promise_date&&p.promise_date<today }))
}

// ── 도면 REV 대조 ──────────────────────────────────
// REV 순서값: 1글자 A~Z = 1~26, 2글자 AA~ZZ = 27~ (스캐너 규칙과 동일)
function revRank(rev) {
  const r = String(rev ?? '').trim().toUpperCase()
  if (!/^[A-Z]{1,2}$/.test(r)) return null
  return r.length === 1
    ? r.charCodeAt(0) - 64
    : (r.charCodeAt(0) - 64) * 26 + (r.charCodeAt(1) - 64) + 26
}

// 도면이 존재하는 품번대만 대조 (11 조립도 / 12 모듈 / 16 하네스 / 17 가공물)
// 볼트(44*)·부품(5*)까지 대조하면 "도면 없음"이 도배됨
const hasDrawingCode = (code) => {
  const d = String(code || '').replace(/^AX-/, '')
  return d.length >= 8 && ['11', '12', '16', '17'].includes(d.slice(0, 2))
}

// 품번별 최신 도면 1건 맵
async function fetchDrawingRevs(codes) {
  const map = {}
  for (let i = 0; i < codes.length; i += 200) {
    const chunk = codes.slice(i, i + 200)
    const rows = await fetchAll(() => supabase
      .from('pm_drawings')
      .select('std_code,rev,edition,rev_order,file_path,file_mtime')
      .in('std_code', chunk)
      .is('missing_since', null)
      .eq('is_latest', true))
    for (const r of rows) {
      const cur = map[r.std_code]
      if (!cur || r.rev_order > cur.rev_order) map[r.std_code] = r
    }
  }
  return map
}

// 대조 결과 4종
const REV_STATE = {
  match: { dot:'🟢', label:'일치',      cls:'bg-emerald-50 text-emerald-700 border-emerald-200' },
  ask:   { dot:'🟠', label:'도면 요청',  cls:'bg-orange-50 text-orange-700 border-orange-300' },
  old:   { dot:'🟡', label:'PO 구버전',  cls:'bg-amber-50 text-amber-700 border-amber-200' },
  none:  { dot:'🔴', label:'도면 없음',  cls:'bg-rose-50 text-rose-600 border-rose-200' },
}

// PO REV vs NAS 최신 REV
//   같으면 일치 / PO가 높으면 신도면 미수령(요청 필요) / PO가 낮으면 PO 구버전
function compareRev(poRev, dw) {
  if (!dw) return 'none'
  const a = revRank(poRev), b = revRank(dw.rev)
  if (a === null || b === null) return null   // 비교 불가 → 배지 없음
  if (a === b) return 'match'
  return a > b ? 'ask' : 'old'
}

const COLS = [
  {key:'po_number', label:'PO번호', defaultWidth:100},
  {key:'ccn', label:'CCN', defaultWidth:90},
  {key:'lines', label:'오더/DEL', defaultWidth:80},
  {key:'division', label:'구분', defaultWidth:60},
  {key:'std_code', label:'기준코드·품명', defaultWidth:160},
  {key:'item_rev', label:'REV 대조', defaultWidth:110},
  {key:'parent', label:'프로젝트', defaultWidth:95},
  {key:'qty_ordered', label:'발주량', defaultWidth:60},
  {key:'promise_date', label:'납기(약속일)', defaultWidth:100},
  {key:'changes', label:'변경', defaultWidth:55},
  {key:'status', label:'상태', defaultWidth:60},
  {key:'actions', label:'', defaultWidth:150},
]

const EMPTY = { po_number:'', ccn:'', order_line:'', del_line:'', item_rev:'', division:'전장', type:'자재', qty_ordered:'', required_date:'', promise_date:'', memo:'' }

export default function CustomerPO() {
  const { customerId: csCode } = useParams()
  const qc = useQueryClient()
  const [divTab, setDivTab] = useState('전체')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [chgModal, setChgModal] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [hideIssued, setHideIssued] = useState(false)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState({})
  const [chgTab, setChgTab] = useState(false)
  const [revTab, setRevTab] = useState(false)

  const { data: cs } = useCustomer(csCode)
  const { data: pos=[], isLoading, error } = useQuery({
    queryKey:['cpo',cs?.id,showAll], queryFn:()=>fetchCustomerPOs(cs?.id,showAll), enabled:!!cs?.id,
  })

  // 도면 최신 REV 맵 (PO 목록의 품번만 1회 조회)
  const { data: revMap = {} } = useQuery({
    queryKey: ['cpoDrawings', cs?.id, showAll],
    enabled: !!cs?.id && pos.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchDrawingRevs(
      [...new Set(pos.map(p => p.items?.std_code).filter(c => c && hasDrawingCode(c)))]
    ),
  })

  const [exporting, setExporting] = useState(false)

  // 지금 화면에 보이는 목록(filtered)을 그대로 엑셀로.
  // 필터를 바꾸면 내보내는 내용도 따라 바뀐다.
  async function exportList() {
    setExporting(true)
    try {
      const rows = filtered.map((p) => {
        const st = revOf(p)
        const dw = revMap[p.items?.std_code]
        return {
          'PO번호': p.po_number || '',
          'CCN': p.ccn || '',
          '오더라인': p.order_line || '',
          'DEL라인': p.del_line || '',
          '구분': p.division || '',
          '기준코드': p.items?.std_code || '',
          '품명': p.items?.name || '',
          'PO REV': p.item_rev || '',
          'NAS 최신 REV': dw?.rev || '',
          '도면대조': st ? REV_STATE[st].label : '',
          '도면경로': st && st !== 'none' ? (dw?.file_path || '') : '',
          '프로젝트': p.projects?.code || '',
          '발주량': Number(p.qty_ordered) || 0,
          '입고량': Number(p.qty_received) || 0,
          '잔량': Number(p.qty_remaining ?? 0),
          '요청일': p.required_date || '',
          '약속일': p.promise_date || '',
          '납기지연': p.isDelayed ? 'Y' : '',
          '상태': p.status || '',
          '변경건수': Array.isArray(p.changes) ? p.changes.length : 0,
          '자재불출': p.material_issued ? 'Y' : '',
          '메모': p.memo || '',
        }
      })

      const cond = [['구분', divTab]]
      if (search.trim()) cond.push(['검색', search.trim()])
      if (chgTab) cond.push(['필터', '변경 이력만'])
      if (revTab) cond.push(['필터', '도면 요청만'])
      if (hideIssued) cond.push(['필터', '불출완료 제외'])
      cond.push(['건수', `${rows.length}건`])
      cond.push(['추출일시', new Date().toLocaleString('ko-KR')])

      const tag = revTab ? '_도면요청' : chgTab ? '_변경이력' : ''
      await downloadSheet({
        rows,
        sheetName: '고객사PO',
        title: `고객사 PO 목록${revTab ? ' — 도면 요청 필요' : chgTab ? ' — 변경 이력' : ''}`,
        meta: cond,
        fileName: `고객사PO${tag}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      })
    } catch (e) {
      toastError('내보내기 실패: ' + e.message)
    } finally { setExporting(false) }
  }

  const saveMut = useMutation({
    mutationFn: async (data) => {
      const payload = { ...data, qty_ordered: Number(data.qty_ordered) }
      if (editId) { const{error}=await supabase.from('purchase_orders').update(payload).eq('id',editId); if(error) throw error }
      else { const{error}=await supabase.from('purchase_orders').insert({...payload, customer_id:cs?.id, order_type:'customer_po', qty_received:0, status:'진행중'}); if(error) throw error }
    },
    onSuccess: () => { qc.invalidateQueries(['cpo']); qc.invalidateQueries(['shortage']); setForm(EMPTY); setShowForm(false); setEditId(null) },
    onError: (e) => toastError('오류: '+e.message),
  })
  const deleteMut = useMutation({
    mutationFn: async (id) => { const{error}=await supabase.from('purchase_orders').delete().eq('id',id); if(error) throw error },
    onSuccess: () => qc.invalidateQueries(['cpo']),
  })
  const issueMut = useMutation({
    mutationFn: async (id) => {
      const{error}=await supabase.from('purchase_orders').update({issued:true,issued_at:new Date().toISOString(),status:'완료'}).eq('id',id); if(error) throw error
      // 납품(완료) 시 연결된 생산 호기(po_id)도 완료 처리
      const{error:e2}=await supabase.from('production').update({status:'완료',updated_at:new Date().toISOString()}).eq('po_id',id); if(e2) throw e2
    },
    onSuccess: () => { qc.invalidateQueries(['cpo']); qc.invalidateQueries(['shortage']); qc.invalidateQueries(['production']) },
  })
  const unissueMut = useMutation({
    mutationFn: async (id) => {
      const{error}=await supabase.from('purchase_orders').update({issued:false,issued_at:null,status:'진행중'}).eq('id',id); if(error) throw error
      // 되돌리기 시 연결된 생산 호기는 납품대기로
      const{error:e2}=await supabase.from('production').update({status:'납품대기',updated_at:new Date().toISOString()}).eq('po_id',id); if(e2) throw e2
    },
    onSuccess: () => { qc.invalidateQueries(['cpo']); qc.invalidateQueries(['shortage']); qc.invalidateQueries(['production']) },
  })
  const materialMut = useMutation({
    mutationFn: async ({id,val}) => {
      const{error}=await supabase.from('purchase_orders').update({material_issued:val}).eq('id',id); if(error) throw error
      // 연결된 생산 호기(po_id) 전장불출 체크 동기화 — PD BOX 토글과 동일한 boolean
      const{error:e2}=await supabase.from('production').update({part_issue:val}).eq('po_id',id); if(e2) throw e2
    },
    onSuccess: () => { qc.invalidateQueries(['cpo']); qc.invalidateQueries(['shortage']); qc.invalidateQueries(['production']) },
  })
  const pickMut = useMutation({
    mutationFn: async (pos) => {
      const rows = []
      for (const p of pos) {
        const qty = (p.qty_remaining ?? p.qty_ordered) || 1
        // 어셈블리 프로젝트 찾기: project_id 우선, 없으면 품목코드로 프로젝트 조회
        let projId = p.project_id
        if (!projId && p.items?.std_code) {
          const { data: pj } = await supabase.from('projects').select('id').eq('code', p.items.std_code).maybeSingle()
          projId = pj?.id
        }
        if (projId) {
          const { data: bom } = await supabase.from('bom')
            .select('qty_per_unit,item_id, items!bom_item_id_fkey(std_code,name,unit)').eq('project_id', projId)
          for (const b of (bom || [])) {
            if (!b.item_id) continue
            rows.push({ customer_id: cs?.id, item_id: b.item_id, std_code: b.items?.std_code, name: b.items?.name, unit: b.items?.unit, qty: (Number(b.qty_per_unit) || 0) * qty, issue_qty: (Number(b.qty_per_unit) || 0) * qty, source: 'direct', po_id: p.id, issued: true })
          }
        } else if (p.item_id) {
          rows.push({ customer_id: cs?.id, item_id: p.item_id, std_code: p.items?.std_code, name: p.items?.name, unit: p.items?.unit, qty, issue_qty: qty, source: 'direct', po_id: p.id, issued: true })
        }
      }
      if (!rows.length) throw new Error('전개된 부품이 없습니다 — 선택한 PO에 BOM이 등록돼 있는지 확인하세요')
      const { error } = await supabase.from('pm_picking').insert(rows); if (error) throw error
    },
    onSuccess: () => { setPicked({}); toastError('장바구니에 담았습니다. \'출고 작업(불출)\' 화면에서 처리하세요.') },
    onError: e => toastError('담기 오류: ' + e.message),
  })

  function handleEdit(p) {
    setForm({po_number:p.po_number||'',ccn:p.ccn||'',order_line:p.order_line||'',del_line:p.del_line||'',item_rev:p.item_rev||'',division:p.division||'전장',type:p.type,qty_ordered:p.qty_ordered,required_date:p.required_date||'',promise_date:p.promise_date||'',memo:p.memo||''})
    setEditId(p.id); setShowForm(true)
  }

  let filtered = divTab==='전체' ? pos : pos.filter(p=>(p.division||'전장')===divTab)
  if (search.trim()) {
    const q = search.toLowerCase()
    filtered = filtered.filter(p =>
      (p.po_number||'').toLowerCase().includes(q) ||
      (p.ccn||'').toLowerCase().includes(q) ||
      (p.items?.std_code||'').toLowerCase().includes(q) ||
      (p.items?.name||'').toLowerCase().includes(q) ||
      (p.item_rev||'').toLowerCase().includes(q))
  }
  // 변경 이력 있는 PO만 (대시보드용)
  const changedPOs = pos.filter(p => Array.isArray(p.changes) && p.changes.length > 0)
  if (chgTab) filtered = changedPOs.filter(p => divTab==='전체' || (p.division||'전장')===divTab)
  if (hideIssued) filtered = filtered.filter(p => !p.material_issued)

  // 도면 REV 대조 — 대상 품번만 판정, 그 외는 null(배지 없음)
  const revOf = (p) => {
    const code = p.items?.std_code
    if (!code || !hasDrawingCode(code)) return null
    return compareRev(p.item_rev, revMap[code])
  }
  const askCount = pos.filter(p => revOf(p) === 'ask').length
  if (revTab) filtered = filtered.filter(p => revOf(p) === 'ask')
  const today = new Date().toISOString().split('T')[0]
  const f = k => e => setForm(prev=>({...prev,[k]:e.target.value}))

  if (error) return <div className="text-center py-12 text-red-500 text-sm">오류: {error.message}</div>

  return (
    <div className="space-y-4">
      <CustomerTabs />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {['전체','전장','하네스','구매품'].map(t=>(
            <button key={t} onClick={()=>setDivTab(t)}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${divTab===t?'bg-white text-slate-900 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{t}</button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold cursor-pointer whitespace-nowrap">
          <input type="checkbox" checked={showAll} onChange={e=>setShowAll(e.target.checked)} /> 완료 포함
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold cursor-pointer whitespace-nowrap">
          <input type="checkbox" checked={hideIssued} onChange={e=>setHideIssued(e.target.checked)} /> 불출완료 제외
        </label>
        <div className="flex-1"/>
        {Object.values(picked).some(Boolean) && (
          <button onClick={()=>pickMut.mutate(filtered.filter(p=>picked[p.id]))} disabled={pickMut.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-teal-300 text-teal-700 bg-teal-50 hover:bg-teal-100 whitespace-nowrap disabled:opacity-40">🧺 장바구니 담기 ({Object.values(picked).filter(Boolean).length})</button>
        )}
        <button onClick={()=>setShowUpload(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-200 text-indigo-600 bg-white hover:bg-indigo-50 whitespace-nowrap">📤 PO 업로드</button>
        <button onClick={()=>{setForm(EMPTY);setEditId(null);setShowForm(!showForm)}}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 whitespace-nowrap">➕ PO 추가</button>
      </div>

      {showForm&&(
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
          <p className="text-xs font-bold text-slate-700">{editId?'PO 수정':'고객사 PO 추가'}</p>
          <div className="grid grid-cols-4 gap-3">
            <div><label className="block text-xs font-bold text-slate-500 mb-1">PO 번호</label><input value={form.po_number} onChange={f('po_number')} placeholder="PO 번호" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">전장/하네스</label>
              <select value={form.division} onChange={f('division')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option>전장</option><option>하네스</option><option>구매품</option></select></div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">수량</label><input type="number" value={form.qty_ordered} onChange={f('qty_ordered')} placeholder="수량" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">요청일</label><input type="date" value={form.required_date} onChange={f('required_date')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">약속일</label><input type="date" value={form.promise_date} onChange={f('promise_date')} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
            <div className="col-span-2"><label className="block text-xs font-bold text-slate-500 mb-1">메모</label><input value={form.memo} onChange={f('memo')} placeholder="메모" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">CCN</label><input value={form.ccn} onChange={f('ccn')} placeholder="CCN" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">오더라인</label><input value={form.order_line} onChange={f('order_line')} placeholder="오더라인" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">DEL라인</label><input value={form.del_line} onChange={f('del_line')} placeholder="DEL라인" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
            <div><label className="block text-xs font-bold text-slate-500 mb-1">REV</label><input value={form.item_rev} onChange={f('item_rev')} placeholder="REV" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={()=>{setShowForm(false);setEditId(null)}} className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">취소</button>
            <button onClick={()=>saveMut.mutate(form)} disabled={!form.qty_ordered||saveMut.isPending} className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">{saveMut.isPending?'저장 중...':editId?'수정 완료':'저장'}</button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="PO번호·CCN·기준코드·품명·REV 검색"
          className="w-full sm:w-72 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
        <button onClick={()=>setChgTab(v=>!v)}
          className={`px-3 py-2 text-xs font-bold rounded-lg border ${chgTab?'border-amber-300 bg-amber-50 text-amber-600':'border-slate-200 text-slate-500 bg-white hover:bg-slate-50'}`}>
          ⚡ 변경 이력만 {changedPOs.length>0 && `(${changedPOs.length})`}
        </button>
        <button onClick={()=>setRevTab(v=>!v)} title="PO의 REV가 NAS 최신 도면보다 높음 = 신도면 미수령"
          className={`px-3 py-2 text-xs font-bold rounded-lg border ${revTab?'border-orange-300 bg-orange-50 text-orange-600':'border-slate-200 text-slate-500 bg-white hover:bg-slate-50'}`}>
          🟠 도면 요청만 {askCount>0 && `(${askCount})`}
        </button>
        <button onClick={exportList} disabled={exporting || !filtered.length}
          title="지금 화면에 보이는 목록을 그대로 엑셀로 내보냅니다"
          className="px-3 py-2 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40">
          📑 {exporting ? '생성 중…' : `내보내기 (${filtered.length})`}
        </button>
        <span className="text-[11px] text-slate-400 whitespace-nowrap">
          🟢 일치 · 🟠 도면 요청 · 🟡 PO 구버전 · 🔴 도면 없음
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">전체 PO</p><p className="text-xl font-bold text-slate-900">{filtered.length}</p></div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-3"><p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-1">납기 지연</p><p className="text-xl font-bold text-red-600">{filtered.filter(p=>p.isDelayed).length}</p></div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-bold text-amber-500 uppercase tracking-wide mb-1">납기 변경</p><p className="text-xl font-bold text-amber-700">{changedPOs.filter(p=>p.changes.some(c=>c.field==='promise_date')).length}</p></div>
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3"><p className="text-xs font-bold text-violet-500 uppercase tracking-wide mb-1">REV 변경</p><p className="text-xl font-bold text-violet-700">{changedPOs.filter(p=>p.changes.some(c=>c.field==='item_rev')).length}</p></div>
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-3"><p className="text-xs font-bold text-orange-500 uppercase tracking-wide mb-1">도면 요청</p><p className="text-xl font-bold text-orange-700">{askCount}</p></div>
      </div>

      {isLoading ? <div className="text-center py-12 text-slate-400 text-sm">불러오는 중...</div> : (
        <ResizableTable cols={COLS} storageKey="cpo_cols">
          {()=>(
            <tbody>
              {filtered.length===0 ? <tr><td colSpan={COLS.length} className="text-center py-10 text-slate-400">고객사 PO가 없습니다</td></tr>
              : filtered.map(p=>(
                <tr key={p.id} className={`border-b border-slate-100 hover:bg-slate-50 group ${p.isDelayed?'bg-red-50/30':''}`}>
                  <td className="px-3 py-2 font-mono text-slate-500 overflow-hidden truncate">{(p.item_id||p.project_id) && <input type="checkbox" checked={!!picked[p.id]} onChange={()=>setPicked(s=>({...s,[p.id]:!s[p.id]}))} onClick={e=>e.stopPropagation()} className="mr-1.5 align-middle accent-indigo-600"/>}{p.po_number||'-'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500 overflow-hidden truncate">{p.ccn||'-'}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{(p.order_line||'-')}/{(p.del_line||'-')}</td>
                  <td className="px-3 py-2"><span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold ${p.division==='하네스'?'bg-teal-50 text-teal-600':p.division==='구매품'?'bg-slate-100 text-slate-500':'bg-purple-50 text-purple-600'}`}>{p.division||'전장'}</span></td>
                  <td className="px-3 py-2 overflow-hidden">
                    <div className="font-mono text-xs text-indigo-600 truncate">{p.items?.std_code||'-'}</div>
                    <div className="text-[11px] text-slate-500 truncate">{p.items?.name||''}</div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {(()=>{ const st=revOf(p); const dw=revMap[p.items?.std_code]
                      if(!st) return <span className="font-mono text-xs text-slate-600">{p.item_rev||'-'}</span>
                      const s2=REV_STATE[st]
                      return (
                        <span title={st==='none'?'NAS에 도면 없음':`PO ${p.item_rev||'-'} / NAS ${dw?.rev||'-'} · ${s2.label}`}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-bold font-mono ${s2.cls}`}>
                          <span>{s2.dot}</span>
                          <span>{p.item_rev||'-'}</span>
                          {st!=='match' && st!=='none' && <span className="opacity-60">→{dw?.rev}</span>}
                        </span>
                      ) })()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-400">{p.projects?.code||'-'}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-900">{p.qty_ordered}</td>
                  <td className="px-3 py-2 text-slate-500">{p.promise_date||p.required_date||'-'}</td>
                  <td className="px-3 py-2 text-center">
                    {Array.isArray(p.changes)&&p.changes.length>0
                      ? <button onClick={()=>setChgModal(p)} title="변경 이력 보기"
                          className="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 text-[10px] font-bold hover:bg-amber-100">{p.changes.length}건</button>
                      : <span className="text-slate-200">-</span>}
                  </td>
                  <td className="px-3 py-2"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${p.isDelayed?'bg-red-50 text-red-600':'bg-blue-50 text-blue-600'}`}>{p.isDelayed?'지연':p.status}</span>{p.material_issued&&<span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-600" title="자재불출됨 · 부족계산 제외">불출</span>}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={()=>handleEdit(p)} className="px-2 py-1 text-xs font-semibold rounded border border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600">수정</button>
                      {p.material_issued
                        ? <button onClick={()=>materialMut.mutate({id:p.id,val:false})} title="자재불출 해제" className="px-2 py-1 text-xs font-semibold rounded border border-teal-200 text-teal-600 bg-teal-50 hover:bg-teal-100">불출됨</button>
                        : <button onClick={()=>materialMut.mutate({id:p.id,val:true})} title="자재불출 처리(부족계산서 제외, PO는 진행중 유지)" className="px-2 py-1 text-xs font-semibold rounded border border-slate-200 text-slate-500 hover:border-teal-300 hover:text-teal-600">자재불출</button>}
                      {p.status==='완료'
                        ? <button onClick={()=>{if(window.confirm('진행중으로 되돌릴까요?'))unissueMut.mutate(p.id)}} className="px-2 py-1 text-xs font-semibold rounded border border-slate-200 text-amber-500 hover:border-amber-300">되돌리기</button>
                        : <button onClick={()=>{if(window.confirm('이 PO를 완료처리할까요? (목록에서 숨겨집니다)'))issueMut.mutate(p.id)}} className="px-2 py-1 text-xs font-semibold rounded border border-slate-200 text-slate-500 hover:border-emerald-300 hover:text-emerald-600">완료처리</button>}
                      <button onClick={()=>{if(window.confirm('삭제할까요?'))deleteMut.mutate(p.id)}} className="px-2 py-1 text-xs font-semibold rounded border border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-500">삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </ResizableTable>
      )}

      {/* 변경 이력 모달 */}
      {showUpload && <CustomerPOUpload csId={cs?.id} csCode={csCode} onClose={()=>setShowUpload(false)} />}

      {chgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={()=>setChgModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={e=>e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-800">변경 이력</p>
                <p className="text-xs text-slate-400 font-mono">{chgModal.po_number} · {chgModal.items?.std_code}</p>
              </div>
              <button onClick={()=>setChgModal(null)} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
            </div>
            <div className="overflow-y-auto p-4 space-y-2">
              {(chgModal.changes||[]).slice().reverse().map((c,i)=>(
                <div key={i} className="rounded-lg border border-slate-200 p-3 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-slate-700">{c.field==='promise_date'?'납기 변경':c.field==='item_rev'?'REV 변경':c.field==='qty_ordered'?'수량 변경':c.field==='division'?'구분 변경':c.field}</span>
                    <span className="text-slate-400">{c.at?.slice(0,10)||''}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-red-50 text-red-500 line-through">{c.from??'-'}</span>
                    <span className="text-slate-300">→</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 font-semibold">{c.to??'-'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
