import { refreshProcurement } from '../../lib/refresh'
import ItemLink from '../../components/ItemLink'
import { useState, useMemo } from 'react'
import { useVisibleRows, MoreRows } from '../../hooks/useVisibleRows'
import { PROC_CATS, catOf, todayISO } from '../../lib/utils'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRowSelect } from '../../hooks/useRowSelect'
import { supabase } from '../../lib/supabase'
import QrScanner from '../../components/QrScanner'
import StockPaste from '../../components/StockPaste'
import AuditApplyModal from '../../components/AuditApplyModal'
import { useNavigate } from 'react-router-dom'
import { ResizableTable } from '../../components/ResizableTable'
import * as XLSX from 'xlsx'

const catBadge = c => PROC_CATS.has(c) ? 'bg-violet-50 text-violet-700' : (c==='기타'||c==='-' ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-600')
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { logActivity } from '../../lib/activityLog'
import { useCanEdit } from '../../hooks/useProfile'
import { useCompact } from '../../hooks/useCompact'
import { useUndo } from '../../components/UndoBar'

async function fetchInventory() {
  // 전체 페이징 (1000행 제한 회피)
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('inventory')
      .select('*, items(std_code,name,type,js_code,unit,safety_stock,lt_weeks,manufacturer,manufacturer_code,purchase_price,dept,stock_managed,customer_item_codes(customer_code,customers(name,code)))')
      .order('updated_at', { ascending: false }).order('item_id')
      .range(from, from + 999)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return all
}
// 검색은 화면에서 거른다 — 예전엔 검색할 때마다 재고 전체(수천 행)를 다시 받아 왔다.
function filterInventory(all, search) {
  if (!search) return all
  const s = search.toLowerCase()
  return all.filter(r=>{
    const csCodes=(r.items?.customer_item_codes||[]).map(c=>c.customer_code?.toLowerCase()).join(' ')
    return r.items?.std_code?.toLowerCase().includes(s)||r.items?.name?.toLowerCase().includes(s)
      ||r.items?.manufacturer?.toLowerCase().includes(s)||r.items?.manufacturer_code?.toLowerCase().includes(s)||csCodes.includes(s)
  })
}

const COLS = [
  {key:'std_code', label:'기준코드', defaultWidth:100},
  {key:'name', label:'품명', defaultWidth:160},
  {key:'manufacturer', label:'제조사', defaultWidth:100},
  {key:'manufacturer_code', label:'제조사품번', defaultWidth:120},
  {key:'type', label:'구분', defaultWidth:75},
  {key:'unit', label:'단위', defaultWidth:45},
  {key:'qty', label:'현재고', defaultWidth:65},
  {key:'purchase_price', label:'매입가', defaultWidth:75},
  {key:'value', label:'재고금액', defaultWidth:90},
  {key:'safety_stock', label:'안전재고', defaultWidth:70},
  {key:'status', label:'상태', defaultWidth:75},
  {key:'stock_managed', label:'재고관리', defaultWidth:75},
  {key:'cs_codes', label:'고객사 코드', defaultWidth:160},
  {key:'location', label:'보관위치', defaultWidth:80},
]

export default function Inventory() {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('전체')
  const [brandFilter, setBrandFilter] = useState('전체')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [scanOpen, setScanOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)   // QR 칸 실사 → 재고 반영
  // 반영 안 된 칸 실사 건수 (숫자만 받는다)
  const { data: pendingAudit = 0 } = useQuery({
    queryKey: ['pendingAuditCount'],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { count, error } = await supabase.from('pm_stock_audit')
        .select('id', { count: 'exact', head: true }).eq('applied', false)
      if (error) throw error
      return count || 0
    },
  })
  const navTo = useNavigate()
  const [showNeg, setShowNeg] = useState(false)
  const [hideExcluded, setHideExcluded] = useState(true)   // 재고관리 제외 품목 숨김(기본)
  const [checked, setChecked] = useState({})
  // 행을 눌러 고르고 끌어서 여러 줄을 한 번에
  const rowSel = useRowSelect(setChecked)
  const [showAudit, setShowAudit] = useState(false)
  const [auditRows, setAuditRows] = useState([])
  const qc = useQueryClient()

  // 되돌리기 (v4.58.0) — 직접 고친 재고를 고치기 전 수량으로
  const { remember, bar: undoBar } = useUndo()
  // backs: [{ id, code, from, to }] — 지금 수량이 내가 바꾼 값(to)과 다르면 (그사이 입고 · 출고) 한 번 묻는다
  async function undoQty(backs, label) {
    const ids = backs.map(b => b.id)
    const { data: cur, error: e0 } = await supabase.from('inventory').select('id,qty').in('id', ids)
    if (e0) throw e0
    const now = new Map((cur || []).map(r => [r.id, Number(r.qty) || 0]))
    const moved = backs.filter(b => now.has(b.id) && now.get(b.id) !== Number(b.to))
    if (moved.length && !window.confirm(`그사이 재고가 바뀐 품목이 있습니다 (입고 · 출고):\n${moved.slice(0, 8).map(b => `${b.code} ${b.to} → 지금 ${now.get(b.id)}`).join('\n')}${moved.length > 8 ? '\n…' : ''}\n\n그래도 고치기 전 수량으로 덮어쓸까요?`)) throw new Error('취소했습니다')
    for (const b of backs) {
      const { error } = await supabase.from('inventory').update({ qty: b.from, updated_at: new Date().toISOString() }).eq('id', b.id)
      if (error) throw error
    }
    logActivity('update', 'inventory', backs.length === 1 ? backs[0].code : `${backs.length}건`,
      `재고 수정 되돌리기 (${label}) ` + backs.slice(0, 12).map(b => `${b.code} ${b.to}→${b.from}`).join(', '))
    return `되돌렸습니다 — ${backs.length === 1 ? `${backs[0].code} 재고 ${backs[0].from}` : `${backs.length}건`}`
  }
  const afterUndoQty = () => { setChecked({}); refreshProcurement(qc) }

  const zeroMut = useMutation({
    mutationFn: async (ids) => {
      // 선택된 음수재고 inventory 행을 0으로 — 되돌리기용으로 바꾸기 전 수량을 떠 둔다
      const { data: cur } = await supabase.from('inventory').select('id,qty,item_id').in('id', ids)
      const byId = new Map((allRows || []).map(r => [r.id, r]))
      const backs = (cur || []).map(r => ({ id: r.id, code: byId.get(r.id)?.items?.std_code || r.item_id, from: Number(r.qty) || 0, to: 0 }))
      for (const id of ids) {
        const { error } = await supabase.from('inventory').update({ qty: 0 }).eq('id', id)
        if (error) throw error
      }
      return backs
    },
    onSuccess: (backs) => {
      setChecked({}); qc.invalidateQueries(['inventory'])
      if (backs?.length) remember(`음수 재고 ${backs.length}건 → 0`, () => undoQty(backs, '음수 → 0'), { after: afterUndoQty })
    },
    onError: (e) => toastError('변경 오류: ' + e.message),
  })

  // 재고현황에서 바로 재고 수정 (2026-10-14) — 칸을 눌러 숫자를 고치고 Enter
  //   실사와 같은 방식: inventory 수량을 덮어쓰고, 누가 얼마를 얼마로 바꿨는지 작업 기록에 남긴다.
  //   ⚠ 화면을 연 사이 입고 · 출고로 DB 수량이 바뀌었으면 덮어쓰기 전에 한 번 묻는다.
  const canEdit = useCanEdit()
  const compact = useCompact()
  const qtyMut = useMutation({
    mutationFn: async ({ row, qty }) => {
      // 음수 재고는 받지 않는다 (v4.57.0) — 출고 기록이 빠졌으면 출고 화면에서 바로잡는다
      if (!(Number(qty) >= 0)) throw new Error('재고는 0 이상으로 적어 주세요')
      const { data: cur, error: e1 } = await supabase.from('inventory').select('qty').eq('id', row.id).maybeSingle()
      if (e1) throw e1
      const dbQty = Number(cur?.qty) || 0
      if (dbQty !== (Number(row.qty) || 0) &&
          !window.confirm(`${row.items?.std_code} 재고가 화면을 연 뒤 ${row.qty} → ${dbQty} 로 바뀌었습니다 (입고·출고).\n\n그래도 ${qty} 로 덮어쓸까요?`)) return null
      const { error } = await supabase.from('inventory').update({ qty, updated_at: new Date().toISOString() }).eq('id', row.id)
      if (error) throw error
      logActivity('update', 'inventory', row.items?.std_code || row.item_id, `재고 수정 (재고현황) ${dbQty} → ${qty}`)
      return { id: row.id, code: row.items?.std_code, from: dbQty, to: Number(qty) }
    },
    onSuccess: (r) => {
      if (!r) return
      toastSuccess(`${r.code} 재고 ${r.from} → ${r.to}`)
      remember(`${r.code} 재고 ${r.from} → ${r.to}`, () => undoQty([r], '재고현황'), { after: afterUndoQty })
      // 재고가 바뀌면 부족자재 · 소요량도 다시 계산되게 (예전엔 재고현황만 갱신했다) (v4.57.0)
      refreshProcurement(qc)
    },
    onError: (e) => toastError('재고 수정 실패: ' + e.message),
  })

  const stockMgmtMut = useMutation({
    mutationFn: async ({ itemId, value }) => {
      const { error } = await supabase.from('items').update({ stock_managed: value }).eq('id', itemId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['inventory']),
    onError: (e) => toastError('변경 오류: ' + e.message),
  })

  // 재고 실사 — 엑셀 업로드(기준코드/품번 + 실사수량 + 보관위치) → 현재고·위치 덮어쓰기
  function onAuditFile(e) {
    const f = e.target.files?.[0]; if (!f) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target.result, { type: 'binary' })
      const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
      const rows = json.map(j => {
        const code = j['기준코드'] ?? j['품번'] ?? j['std_code'] ?? j['코드']
        const raw = j['실사수량'] ?? j['실사'] ?? j['수량'] ?? j['재고'] ?? j['qty']
        // 실사수량이 비어있으면 건너뜀(덮어쓰지 않음) — 브랜드별 일부 실사 안전
        if (code == null || raw == null || String(raw).trim() === '') return null
        // 보관위치는 실사양식이 앞쪽에 내보내는 칸이다. 현장에서 고쳐 오면 그 값이 맞다.
        //   비었거나 「(미지정)」이면 건드리지 않는다 — 있던 위치를 지우면 안 된다.
        const locRaw = String(j['보관위치'] ?? j['위치'] ?? j['location'] ?? '').trim()
        const location = !locRaw || locRaw === '(미지정)' ? null : locRaw
        // 「1,200」 처럼 쉼표가 든 값이나 글자가 섞인 값을 0 으로 덮던 문제 — 쉼표 · 공백은 걷어 내고,
        //   그래도 숫자가 아니면 건너뛴다(미리보기에 빨갛게 표시).
        const n = Number(String(raw).replace(/[,\s]/g, ''))
        if (!Number.isFinite(n)) return { std_code: String(code).trim(), qty: null, raw: String(raw), bad: true, location }
        return { std_code: String(code).trim(), qty: n, location }
      }).filter(Boolean)
      setAuditRows(rows); setShowAudit(true)
    }
    reader.readAsBinaryString(f)
    e.target.value = ''
  }
  const auditMut = useMutation({
    mutationFn: async (allAudit) => {
      const bad = allAudit.filter(r => r.bad)
      const rows = allAudit.filter(r => !r.bad)
      const codes = [...new Set(rows.map(r => r.std_code))]
      // item id 매핑 (청크 조회)
      const idMap = {}
      for (let i = 0; i < codes.length; i += 300) {
        const { data: its, error } = await supabase.from('items').select('id,std_code').in('std_code', codes.slice(i, i + 300))
        if (error) throw error
        ;(its || []).forEach(it => { idMap[it.std_code] = it.id })
      }
      // item_id별 최종 값 (중복 std_code는 마지막 줄이 이긴다) + 미매칭 수집
      const byId = {}; const skipped = []
      for (const r of rows) {
        const itemId = idMap[r.std_code]
        if (!itemId) { skipped.push(r.std_code); continue }
        byId[itemId] = r
      }
      const payload = Object.entries(byId).map(([item_id, r]) => ({
        item_id, qty: r.qty, fileLoc: r.location ?? null,
      }))

      // upsert 는 빠뜨린 컬럼을 null 로 덮어써 위치가 지워진다.
      //   기존 위치를 미리 읽어 함께 넣으면, 한 번에 보내면서도 위치가 남는다.
      //   (한 줄씩 update 하면 2,000 건에 2,000 번 오간다)
      const ids = payload.map(p => p.item_id)
      const locMap = new Map()
      const qtyMap = new Map()   // 바뀌기 전 수량 — 작업 기록에 남긴다
      for (let i = 0; i < ids.length; i += 300) {
        // ⚠ 읽기 실패를 넘기면 위치가 전부 비어 덮어써진다. 실패하면 멈춘다.
        const { data, error } = await supabase.from('inventory')
          .select('item_id,location,qty').in('item_id', ids.slice(i, i + 300))
        if (error) throw error
        ;(data || []).forEach(r => { locMap.set(r.item_id, r.location ?? null); qtyMap.set(r.item_id, Number(r.qty) || 0) })
      }
      //   파일에 위치가 적혀 있으면 그 값으로 바꾸고, 비어 있으면 있던 위치를 지킨다.
      let locChanged = 0
      const merged = payload.map(p => {
        const dbLoc = locMap.has(p.item_id) ? locMap.get(p.item_id) : null
        const location = p.fileLoc != null ? p.fileLoc : dbLoc
        if (p.fileLoc != null && p.fileLoc !== dbLoc) locChanged += 1
        return { item_id: p.item_id, qty: p.qty, location }
      })

      let applied = 0
      for (let i = 0; i < merged.length; i += 500) {
        const chunk = merged.slice(i, i + 500)
        const { error } = await supabase.from('inventory').upsert(chunk, { onConflict: 'item_id' })
        if (error) throw error
        applied += chunk.length
      }
      // 조정 이력 — 누가 언제 얼마를 얼마로 바꿨는지 작업 기록에 남긴다
      const codeOf = {}; Object.entries(idMap).forEach(([c, id]) => { codeOf[id] = c })
      const changed = merged.filter(m => (qtyMap.get(m.item_id) ?? 0) !== m.qty)
      logActivity('update', 'inventory', `실사 ${applied}건`,
        `재고 실사 반영 ${applied}건 · 수량 변동 ${changed.length}건` +
        (changed.length ? ': ' + changed.slice(0, 12).map(m => `${codeOf[m.item_id] || m.item_id} ${qtyMap.get(m.item_id) ?? 0}→${m.qty}`).join(', ') + (changed.length > 12 ? ' 외' : '') : ''))
      return { applied, skipped, locChanged, bad: bad.length, changed: changed.length }
    },
    onSuccess: ({ applied, skipped, locChanged, bad, changed }) => {
      qc.invalidateQueries(['inventory'])
      toastSuccess(`실사 반영 완료: ${applied}건 (수량 변동 ${changed}건)`
        + (locChanged ? ` · 위치 ${locChanged}건 변경` : '')
        + (skipped.length ? ` · 미매칭 ${skipped.length}건 제외` : '')
        + (bad ? ` · 숫자 아님 ${bad}건 제외` : ''))
      setShowAudit(false); setAuditRows([])
    },
    onError: (e) => toastError('실사 반영 실패: ' + e.message),
  })

  const { data: invAll, isLoading, error } = useQuery({
    queryKey:['inventory','all'], queryFn:()=>fetchInventory(),
  })
  const allRows = useMemo(() => filterInventory(invAll || [], appliedSearch), [invAll, appliedSearch])

  const baseRows = useMemo(() => (typeFilter==='전체' ? allRows : allRows.filter(r=>r.items?.type===typeFilter))
    .filter(r => hideExcluded ? (r.items?.stock_managed !== false) : true), [allRows, typeFilter, hideExcluded])
  const brandCounts = {}; baseRows.forEach(r=>{ const b=r.items?.manufacturer; if(b) brandCounts[b]=(brandCounts[b]||0)+1 })
  const brands = Object.keys(brandCounts).sort()
  const rows = useMemo(() => brandFilter==='전체' ? baseRows : baseRows.filter(r => (r.items?.manufacturer||'') === brandFilter), [baseRows, brandFilter])
  // 수천 줄을 한 번에 그리면 체크 · 입력이 밀린다. 300줄씩 그리고 「더 보기」로 늘린다.
  const vis = useVisibleRows(rows, 300, [appliedSearch, typeFilter, brandFilter, hideExcluded])
  const zeroStock=rows.filter(r=>r.qty===0).length
  const belowSafety=rows.filter(r=>r.qty<(r.items?.safety_stock||0)&&r.items?.safety_stock>0).length
  const totalValue=rows.reduce((a,r)=>a+(r.qty*(r.items?.purchase_price||0)),0)
  const negRows=allRows.filter(r=>r.qty<0)
  const checkedIds=Object.keys(checked).filter(k=>checked[k])

  function exportExcel() {
    const data=rows.map(r=>({'기준코드':r.items?.std_code,'품명':r.items?.name,'제조사':r.items?.manufacturer||'','제조사품번':r.items?.manufacturer_code||'','구분':catOf(r.items),'자재구분':r.items?.type,'단위':r.items?.unit,'현재고':r.qty,'매입가':r.items?.purchase_price||0,'재고금액':r.qty*(r.items?.purchase_price||0),'안전재고':r.items?.safety_stock,'보관위치':r.location||'','최종업데이트':r.updated_at?.split('T')[0]}))
    const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),'재고현황')
    XLSX.writeFile(wb,`재고현황_${todayISO()}.xlsx`)
  }

  // 브랜드별 실사 양식 — 현재 필터된 품목으로 실사수량 빈칸 엑셀 생성
  function downloadAuditTemplate() {
    if (!rows.length) { toastError('대상 품목이 없습니다.'); return }
    // 보관위치를 앞쪽에 둔다 — 실사는 위치를 찾아가서 하는 일이다
    const data=[...rows]
      .sort((a,b)=>String(a.location||'ㅎ').localeCompare(String(b.location||'ㅎ'))
                 || String(a.items?.std_code||'').localeCompare(String(b.items?.std_code||'')))
      .map(r=>({'보관위치':r.location||'(미지정)','기준코드':r.items?.std_code,'품명':r.items?.name,'세부구분':catOf(r.items),'제조사':r.items?.manufacturer||'','제조사품번':r.items?.manufacturer_code||'','단위':r.items?.unit,'현재고(참고)':r.qty,'실사수량':'','비고':''}))
    const ws=XLSX.utils.json_to_sheet(data)
    ws['!cols']=[{wch:12},{wch:18},{wch:34},{wch:10},{wch:16},{wch:20},{wch:6},{wch:12},{wch:10},{wch:20}]
    const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,ws,'실사')
    const tag = brandFilter==='전체' ? '전체' : brandFilter
    XLSX.writeFile(wb,`실사양식_${tag}_${todayISO()}.xlsx`)
  }

  if (error) return <div className="text-center py-12 text-red-500 text-sm">오류: {error.message}</div>

  return (
    <div className="space-y-4">
      {pasteOpen && <StockPaste onClose={()=>setPasteOpen(false)} />}
      {auditOpen && <AuditApplyModal onClose={()=>setAuditOpen(false)} />}
      {undoBar}

      {scanOpen && (
        <QrScanner onClose={()=>setScanOpen(false)}
          onScan={(loc)=>{ setScanOpen(false); navTo(`/cell/${loc}`) }} />
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <input value={search} onChange={e=>setSearch(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter')setAppliedSearch(search)}}
          placeholder="기준코드 / 품명 / 고객사코드 검색 후 Enter"
          className="w-full sm:w-72 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
        <button onClick={()=>setAppliedSearch(search)} className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">검색</button>
        {appliedSearch&&<button onClick={()=>{setSearch('');setAppliedSearch('')}} className="text-xs text-slate-400 hover:text-slate-600">✕ 초기화</button>}
        <button onClick={()=>setPasteOpen(true)} title="엑셀에서 품번·수량을 복사해 붙여넣어 실사 결과를 반영합니다"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 whitespace-nowrap">
          📋 실사 붙여넣기
        </button>
        <button onClick={()=>setAuditOpen(true)} title="QR 로 칸을 찍어 기록한 실사를 재고에 반영합니다 (차이만큼)"
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border whitespace-nowrap ${pendingAudit>0 ? 'border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100' : 'border-slate-200 text-slate-500 bg-white hover:bg-slate-50'}`}>
          📋 칸 실사 반영{pendingAudit>0 ? ` (${pendingAudit})` : ''}
        </button>
        <button onClick={()=>setScanOpen(true)} title="랙 위치 태그를 스캔해 그 칸의 재고를 확인·실사합니다"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-900 text-white hover:bg-slate-800 whitespace-nowrap">
          📷 QR 스캔
        </button>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {['전체','가공','자재'].map(t=>(
            <button key={t} onClick={()=>setTypeFilter(t)}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${typeFilter===t?'bg-white text-slate-900 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{t}</button>
          ))}
        </div>
        <select value={brandFilter} onChange={e=>setBrandFilter(e.target.value)}
          className="px-2 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white max-w-[180px]">
          <option value="전체">브랜드(제조사) 전체</option>
          {brands.map(b=><option key={b} value={b}>{b} ({brandCounts[b]})</option>)}
        </select>
        <button onClick={()=>setHideExcluded(v=>!v)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${hideExcluded?'border-slate-200 text-slate-500 bg-white hover:bg-slate-50':'border-amber-300 text-amber-700 bg-amber-50'}`}>
          {hideExcluded?'관리대상만':'제외 포함'}
        </button>
        <div className="flex-1"/>
        <button onClick={downloadAuditTemplate} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-200 text-emerald-700 bg-white hover:bg-emerald-50">📋 실사양식{brandFilter!=='전체' && ` · ${brandFilter}`}</button>
        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-indigo-200 text-indigo-600 bg-white hover:bg-indigo-50 cursor-pointer">📤 실사 업로드<input type="file" accept=".xlsx,.xls,.csv" onChange={onAuditFile} className="hidden"/></label>
        <button onClick={exportExcel} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">📥 보고용 추출</button>
      </div>

      {/* 지표 — 노트북 화면이면 한 줄 칩으로 얇게 (v4.64.0) */}
      {compact ? (
        <div data-kpi-compact className="flex flex-wrap gap-1.5 text-xs">
          <span className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500">전체 품목 <b className="text-slate-900 text-sm">{rows.length}</b></span>
          <span className="px-2.5 py-1 rounded-lg border border-red-200 bg-red-50 text-red-400">재고 없음 <b className="text-red-600 text-sm">{zeroStock}</b></span>
          <button onClick={()=>setShowNeg(v=>!v)} title="클릭해서 정리" className={`px-2.5 py-1 rounded-lg border text-rose-500 ${showNeg?'border-rose-400 bg-rose-100':'border-rose-200 bg-rose-50 hover:bg-rose-100'}`}>⚠ 음수 재고 <b className="text-rose-600 text-sm">{negRows.length}</b></button>
          <span className="px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-500">안전재고 미달 <b className="text-amber-700 text-sm">{belowSafety}</b></span>
          <span className="px-2.5 py-1 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-400" title={`${totalValue.toLocaleString()}원`}>재고 금액 <b className="text-indigo-700 text-sm">{(totalValue/1000000).toFixed(1)}M</b></span>
        </div>
      ) : (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">전체 품목</p><p className="text-xl font-bold text-slate-900">{rows.length}</p></div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-3"><p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-1">재고 없음</p><p className="text-xl font-bold text-red-600">{zeroStock}</p></div>
        <button onClick={()=>setShowNeg(v=>!v)} className={`text-left rounded-xl border p-3 transition-all ${showNeg?'border-rose-400 bg-rose-100':'border-rose-200 bg-rose-50 hover:bg-rose-100'}`}>
          <p className="text-xs font-bold text-rose-500 uppercase tracking-wide mb-1">⚠ 음수 재고</p><p className="text-xl font-bold text-rose-600">{negRows.length}</p>
          <p className="text-[10px] text-rose-400 mt-0.5">클릭해서 정리</p>
        </button>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-bold text-amber-500 uppercase tracking-wide mb-1">안전재고 미달</p><p className="text-xl font-bold text-amber-700">{belowSafety}</p></div>
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3"><p className="text-xs font-bold text-indigo-400 uppercase tracking-wide mb-1">재고 금액</p><p className="text-xl font-bold text-indigo-700">{(totalValue/1000000).toFixed(1)}M</p><p className="text-xs text-indigo-400 mt-1">{totalValue.toLocaleString()}원</p></div>
      </div>
      )}

      {/* 재고 실사 미리보기 */}
      {showAudit && (() => {
        const curMap = {}; allRows.forEach(r => { if (r.items?.std_code) curMap[r.items.std_code] = r.qty })
        return (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-sm font-bold text-indigo-700">📤 재고 실사 미리보기 — {auditRows.length}건</p>
                <p className="text-[11px] text-slate-400 mt-0.5">현재고를 실사수량으로 덮어씁니다. 엑셀 열: <b>기준코드</b>(또는 품번) + <b>실사수량</b>(또는 수량/재고) + <b>보관위치</b>(선택)</p>
                <p className="text-[11px] text-slate-400">보관위치가 적혀 있으면 그 값으로 바꾸고, 비었거나 「(미지정)」이면 있던 위치를 그대로 둡니다.</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setShowAudit(false); setAuditRows([]) }} className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-500 bg-white hover:bg-slate-50">취소</button>
                <button onClick={() => { if (auditRows.length && window.confirm(`${auditRows.length}건의 현재고를 실사값으로 덮어쓸까요?`)) auditMut.mutate(auditRows) }}
                  disabled={!auditRows.length || auditMut.isPending}
                  className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                  {auditMut.isPending ? '반영 중...' : `${auditRows.length}건 덮어쓰기`}
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-indigo-100 bg-white max-h-80 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-indigo-50 z-10"><tr className="border-b border-indigo-100 text-indigo-400">
                  <th className="px-3 py-2 text-left font-bold">기준코드</th>
                  <th className="px-3 py-2 text-left font-bold">보관위치</th>
                  <th className="px-3 py-2 text-right font-bold">현재고</th>
                  <th className="px-3 py-2 text-right font-bold">실사수량</th>
                  <th className="px-3 py-2 text-right font-bold">차이</th>
                </tr></thead>
                <tbody>
                  {auditRows.map((r, i) => {
                    const cur = curMap[r.std_code]; const known = cur !== undefined; const diff = known && !r.bad ? r.qty - cur : null
                    return (
                      <tr key={i} className="border-t border-slate-50">
                        <td className="px-3 py-1.5 font-mono font-semibold text-slate-700">{r.std_code}{!known && <span className="ml-1 text-[10px] text-amber-500">신규/미매칭</span>}</td>
                        <td className="px-3 py-1.5 font-mono text-slate-500">{r.location || <span className="text-slate-300">유지</span>}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{known ? cur : '-'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{r.bad ? <span data-audit-bad className="text-red-500" title="숫자가 아니라 건너뜁니다">{r.raw} ✕</span> : r.qty}</td>
                        <td className={`px-3 py-1.5 text-right tabular-nums ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-rose-500' : 'text-slate-300'}`}>{diff === null ? '-' : (diff > 0 ? '+' + diff : diff)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      {/* 음수재고 정리 패널 */}
      {showNeg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/30 p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-sm font-bold text-rose-700">⚠ 음수 재고 정리 — {negRows.length}건</p>
              <p className="text-[11px] text-slate-400 mt-0.5">검토 후 0으로 만들 항목을 선택하세요. 실재고가 있는 항목은 체크 해제하고 두면 됩니다.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={()=>{const all={};negRows.forEach(r=>all[r.id]=true);setChecked(all)}}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">전체 선택</button>
              <button onClick={()=>setChecked({})}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-500 bg-white hover:bg-slate-50">해제</button>
              <button onClick={()=>{if(checkedIds.length&&window.confirm(`${checkedIds.length}건을 0으로 변경할까요?`))zeroMut.mutate(checkedIds)}}
                disabled={!checkedIds.length||zeroMut.isPending}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40">
                {zeroMut.isPending?'변경 중...':`선택 ${checkedIds.length}건 → 0으로`}
              </button>
            </div>
          </div>
          <div className="rounded-xl border border-rose-100 bg-white max-h-80 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-rose-50 z-10">
                <tr className="border-b border-rose-100 text-rose-400">
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2 text-left font-bold">기준코드</th>
                  <th className="px-3 py-2 text-left font-bold">품명</th>
                  <th className="px-3 py-2 text-left font-bold">위치</th>
                  <th className="px-3 py-2 text-right font-bold">현재고</th>
                </tr>
              </thead>
              <tbody>
                {negRows.map(r=>(
                  <tr key={r.id}
                    onMouseDown={e => rowSel.start(r.id, e, !!checked[r.id])}
                    onMouseEnter={e => rowSel.over(r.id, e)}
                    className={`border-b border-slate-50 select-none cursor-pointer ${checked[r.id]?'bg-rose-50':'hover:bg-slate-50'}`}>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" checked={!!checked[r.id]} onChange={e=>setChecked(c=>({...c,[r.id]:e.target.checked}))}/>
                    </td>
                    <td className="px-3 py-2 font-mono text-indigo-600"><ItemLink code={r.items?.std_code} /></td>
                    <td className="px-3 py-2 text-slate-700 max-w-[280px] truncate">{r.items?.name}</td>
                    <td className="px-3 py-2 text-slate-400">{r.location||'-'}</td>
                    <td className="px-3 py-2 text-right font-bold text-rose-600">{r.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isLoading ? <div className="text-center py-12 text-slate-400 text-sm">불러오는 중...</div> : (
        <ResizableTable cols={COLS} storageKey="inventory_cols" fill fillMin={360} after={<MoreRows {...vis} />}>
          {() => (
            <tbody>
              {rows.length===0 ? <tr><td colSpan={COLS.length} className="text-center py-10 text-slate-400">재고 데이터가 없습니다</td></tr>
              : vis.shown.map(r=>{
                const safety=r.items?.safety_stock||0
                const status=r.qty===0?'zero':r.qty<safety&&safety>0?'low':'ok'
                const itemValue=r.qty*(r.items?.purchase_price||0)
                return (
                  <tr key={r.id} className={`border-b border-slate-100 hover:bg-slate-50 ${status==='zero'?'bg-red-50/20':status==='low'?'bg-amber-50/20':''}`}>
                    <td className="px-3 py-2 font-mono text-xs text-indigo-600 overflow-hidden truncate"><ItemLink code={r.items?.std_code} /></td>
                    <td className="px-3 py-2 font-semibold text-slate-800 overflow-hidden truncate">{r.items?.name}</td>
                    <td className="px-3 py-2 text-slate-500 overflow-hidden truncate">{r.items?.manufacturer||'-'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400 overflow-hidden truncate">{r.items?.manufacturer_code||'-'}</td>
                    <td className="px-3 py-2"><span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold ${catBadge(catOf(r.items))}`}>{catOf(r.items)}</span></td>
                    <td className="px-3 py-2 text-slate-500">{r.items?.unit}</td>
                    <QtyCell row={r} canEdit={canEdit} onSave={(qty)=>qtyMut.mutateAsync({ row:r, qty })}
                      cls={status==='zero'?'text-red-600':status==='low'?'text-amber-700':'text-slate-900'} />
                    <td className="px-3 py-2 text-right text-slate-500">{r.items?.purchase_price?Number(r.items.purchase_price).toLocaleString():'-'}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-700">{itemValue>0?itemValue.toLocaleString():'-'}</td>
                    <td className="px-3 py-2 text-right text-slate-400">{safety||'-'}</td>
                    <td className="px-3 py-2">
                      {status==='zero'&&<span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-50 text-red-600">재고없음</span>}
                      {status==='low'&&<span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700">안전재고↓</span>}
                      {status==='ok'&&<span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700">정상</span>}
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={()=>stockMgmtMut.mutate({itemId:r.item_id,value:!(r.items?.stock_managed??true)})}
                        disabled={stockMgmtMut.isPending}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${(r.items?.stock_managed??true)?'bg-emerald-50 text-emerald-600 hover:bg-emerald-100':'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                        title="클릭해서 재고관리 대상 전환">
                        {(r.items?.stock_managed??true)?'📦 관리':'제외'}
                      </button>
                    </td>
                    <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{(r.items?.customer_item_codes||[]).map((c,i)=><span key={i} className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500"><span className="text-slate-300">{c.customers?.name}</span>{c.customer_code}</span>)}</div></td>
                    <td className="px-3 py-2 text-slate-400">{r.location||'-'}</td>
                  </tr>
                )
              })}
            </tbody>
          )}
        </ResizableTable>
      )}
    </div>
  )
}

// 현재고 칸 — 누르면 숫자 입력, Enter 저장 · Esc 취소 (수정 권한이 있을 때만)
function QtyCell({ row, canEdit, onSave, cls }) {
  const [edit, setEdit] = useState(null)   // null = 보기
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const v = String(edit ?? '').replace(/,/g, '').trim()
    if (v === '' || v === String(row.qty)) { setEdit(null); return }
    const n = Number(v)
    if (!Number.isFinite(n)) { toastError('숫자를 넣어 주세요'); return }
    setBusy(true)
    try { await onSave(n); setEdit(null) } catch { /* 알림은 onError */ } finally { setBusy(false) }
  }
  if (edit === null) {
    return (
      <td data-inv-qty={row.items?.std_code}
        onClick={() => canEdit && setEdit(String(row.qty ?? 0))}
        title={canEdit ? '눌러서 재고 수정 (Enter 저장 · Esc 취소)' : ''}
        className={`px-3 py-2 text-right font-bold text-lg ${cls} ${canEdit ? 'cursor-pointer hover:bg-indigo-50 hover:underline decoration-dotted' : ''}`}>{row.qty}</td>
    )
  }
  return (
    <td className="px-1 py-1 text-right">
      <input autoFocus value={edit} disabled={busy} data-inv-qty-input
        onChange={(e) => setEdit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEdit(null) }}
        onBlur={() => { if (!busy) setEdit(null) }}
        inputMode="decimal"
        className="w-20 px-1.5 py-1 text-right font-bold border-2 border-indigo-400 rounded focus:outline-none" />
    </td>
  )
}

