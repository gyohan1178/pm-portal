import { useState } from 'react'
import { PROC_CATS, catOf } from '../../lib/utils'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { ResizableTable } from '../../components/ResizableTable'
import * as XLSX from 'xlsx'

const catBadge = c => PROC_CATS.has(c) ? 'bg-violet-50 text-violet-700' : (c==='기타'||c==='-' ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-600')
import { toast, toastError, toastSuccess } from '../../lib/toast'

async function fetchInventory(search) {
  // 전체 페이징 (1000행 제한 회피)
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('inventory')
      .select('*, items(std_code,name,type,js_code,unit,safety_stock,lt_weeks,manufacturer,manufacturer_code,purchase_price,dept,stock_managed,customer_item_codes(customer_code,customers(name,code)))')
      .order('updated_at', { ascending: false })
      .range(from, from + 999)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < 1000) break
  }
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
  const [showNeg, setShowNeg] = useState(false)
  const [hideExcluded, setHideExcluded] = useState(true)   // 재고관리 제외 품목 숨김(기본)
  const [checked, setChecked] = useState({})
  const [showAudit, setShowAudit] = useState(false)
  const [auditRows, setAuditRows] = useState([])
  const qc = useQueryClient()

  const zeroMut = useMutation({
    mutationFn: async (ids) => {
      // 선택된 음수재고 inventory 행을 0으로
      for (const id of ids) {
        const { error } = await supabase.from('inventory').update({ qty: 0 }).eq('id', id)
        if (error) throw error
      }
    },
    onSuccess: () => { setChecked({}); qc.invalidateQueries(['inventory']) },
    onError: (e) => toastError('변경 오류: ' + e.message),
  })

  const stockMgmtMut = useMutation({
    mutationFn: async ({ itemId, value }) => {
      const { error } = await supabase.from('items').update({ stock_managed: value }).eq('id', itemId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['inventory']),
    onError: (e) => toastError('변경 오류: ' + e.message),
  })

  // 재고 실사 — 엑셀 업로드(기준코드/품번 + 실사수량) → 현재고 덮어쓰기
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
        return { std_code: String(code).trim(), qty: Number(raw) || 0 }
      }).filter(Boolean)
      setAuditRows(rows); setShowAudit(true)
    }
    reader.readAsBinaryString(f)
    e.target.value = ''
  }
  const auditMut = useMutation({
    mutationFn: async (rows) => {
      const codes = [...new Set(rows.map(r => r.std_code))]
      // item id 매핑 (청크 조회)
      const idMap = {}
      for (let i = 0; i < codes.length; i += 300) {
        const { data: its, error } = await supabase.from('items').select('id,std_code').in('std_code', codes.slice(i, i + 300))
        if (error) throw error
        ;(its || []).forEach(it => { idMap[it.std_code] = it.id })
      }
      // item_id별 최종 수량 (중복 std_code는 마지막 값) + 미매칭 수집
      const byId = {}; const skipped = []
      for (const r of rows) {
        const itemId = idMap[r.std_code]
        if (!itemId) { skipped.push(r.std_code); continue }
        byId[itemId] = r.qty
      }
      const payload = Object.entries(byId).map(([item_id, qty]) => ({ item_id, qty }))
      // upsert 배치 (item_id 충돌 시 qty만 갱신, location 보존)
      let applied = 0
      for (let i = 0; i < payload.length; i += 500) {
        const chunk = payload.slice(i, i + 500)
        const { error } = await supabase.from('inventory').upsert(chunk, { onConflict: 'item_id' })
        if (error) throw error
        applied += chunk.length
      }
      return { applied, skipped }
    },
    onSuccess: ({ applied, skipped }) => {
      qc.invalidateQueries(['inventory'])
      toastSuccess(`실사 반영 완료: ${applied}건` + (skipped.length ? ` · 미매칭 ${skipped.length}건 제외` : ''))
      setShowAudit(false); setAuditRows([])
    },
  })

  const { data: allRows=[], isLoading, error } = useQuery({
    queryKey:['inventory',appliedSearch], queryFn:()=>fetchInventory(appliedSearch),
  })

  const baseRows = (typeFilter==='전체' ? allRows : allRows.filter(r=>r.items?.type===typeFilter))
    .filter(r => hideExcluded ? (r.items?.stock_managed !== false) : true)
  const brandCounts = {}; baseRows.forEach(r=>{ const b=r.items?.manufacturer; if(b) brandCounts[b]=(brandCounts[b]||0)+1 })
  const brands = Object.keys(brandCounts).sort()
  const rows = brandFilter==='전체' ? baseRows : baseRows.filter(r => (r.items?.manufacturer||'') === brandFilter)
  const zeroStock=rows.filter(r=>r.qty===0).length
  const belowSafety=rows.filter(r=>r.qty<(r.items?.safety_stock||0)&&r.items?.safety_stock>0).length
  const totalValue=rows.reduce((a,r)=>a+(r.qty*(r.items?.purchase_price||0)),0)
  const negRows=allRows.filter(r=>r.qty<0)
  const checkedIds=Object.keys(checked).filter(k=>checked[k])

  function exportExcel() {
    const data=rows.map(r=>({'기준코드':r.items?.std_code,'품명':r.items?.name,'제조사':r.items?.manufacturer||'','제조사품번':r.items?.manufacturer_code||'','구분':catOf(r.items),'자재구분':r.items?.type,'단위':r.items?.unit,'현재고':r.qty,'매입가':r.items?.purchase_price||0,'재고금액':r.qty*(r.items?.purchase_price||0),'안전재고':r.items?.safety_stock,'보관위치':r.location||'','최종업데이트':r.updated_at?.split('T')[0]}))
    const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),'재고현황')
    XLSX.writeFile(wb,`재고현황_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  // 브랜드별 실사 양식 — 현재 필터된 품목으로 실사수량 빈칸 엑셀 생성
  function downloadAuditTemplate() {
    if (!rows.length) { toastError('대상 품목이 없습니다.'); return }
    const data=rows.map(r=>({'기준코드':r.items?.std_code,'품명':r.items?.name,'세부구분':catOf(r.items),'제조사':r.items?.manufacturer||'','제조사품번':r.items?.manufacturer_code||'','단위':r.items?.unit,'현재고(참고)':r.qty,'실사수량':''}))
    const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),'실사')
    const tag = brandFilter==='전체' ? '전체' : brandFilter
    XLSX.writeFile(wb,`실사양식_${tag}_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  if (error) return <div className="text-center py-12 text-red-500 text-sm">오류: {error.message}</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <input value={search} onChange={e=>setSearch(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter')setAppliedSearch(search)}}
          placeholder="기준코드 / 품명 / 고객사코드 검색 후 Enter"
          className="w-full sm:w-72 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
        <button onClick={()=>setAppliedSearch(search)} className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">검색</button>
        {appliedSearch&&<button onClick={()=>{setSearch('');setAppliedSearch('')}} className="text-xs text-slate-400 hover:text-slate-600">✕ 초기화</button>}
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

      {/* 재고 실사 미리보기 */}
      {showAudit && (() => {
        const curMap = {}; allRows.forEach(r => { if (r.items?.std_code) curMap[r.items.std_code] = r.qty })
        return (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-sm font-bold text-indigo-700">📤 재고 실사 미리보기 — {auditRows.length}건</p>
                <p className="text-[11px] text-slate-400 mt-0.5">현재고를 실사수량으로 덮어씁니다. 엑셀 열: <b>기준코드</b>(또는 품번) + <b>실사수량</b>(또는 수량/재고)</p>
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
            <div className="rounded-xl border border-indigo-100 bg-white overflow-hidden max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-indigo-50 z-10"><tr className="border-b border-indigo-100 text-indigo-400">
                  <th className="px-3 py-2 text-left font-bold">기준코드</th>
                  <th className="px-3 py-2 text-right font-bold">현재고</th>
                  <th className="px-3 py-2 text-right font-bold">실사수량</th>
                  <th className="px-3 py-2 text-right font-bold">차이</th>
                </tr></thead>
                <tbody>
                  {auditRows.map((r, i) => {
                    const cur = curMap[r.std_code]; const known = cur !== undefined; const diff = known ? r.qty - cur : null
                    return (
                      <tr key={i} className="border-t border-slate-50">
                        <td className="px-3 py-1.5 font-mono font-semibold text-slate-700">{r.std_code}{!known && <span className="ml-1 text-[10px] text-amber-500">신규/미매칭</span>}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{known ? cur : '-'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{r.qty}</td>
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
          <div className="rounded-xl border border-rose-100 bg-white overflow-hidden max-h-80 overflow-y-auto">
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
                  <tr key={r.id} className={`border-b border-slate-50 ${checked[r.id]?'bg-rose-50':'hover:bg-slate-50'}`}>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" checked={!!checked[r.id]} onChange={e=>setChecked(c=>({...c,[r.id]:e.target.checked}))}/>
                    </td>
                    <td className="px-3 py-2 font-mono text-indigo-600">{r.items?.std_code}</td>
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
        <ResizableTable cols={COLS} storageKey="inventory_cols">
          {() => (
            <tbody>
              {rows.length===0 ? <tr><td colSpan={COLS.length} className="text-center py-10 text-slate-400">재고 데이터가 없습니다</td></tr>
              : rows.map(r=>{
                const safety=r.items?.safety_stock||0
                const status=r.qty===0?'zero':r.qty<safety&&safety>0?'low':'ok'
                const itemValue=r.qty*(r.items?.purchase_price||0)
                return (
                  <tr key={r.id} className={`border-b border-slate-100 hover:bg-slate-50 ${status==='zero'?'bg-red-50/20':status==='low'?'bg-amber-50/20':''}`}>
                    <td className="px-3 py-2 font-mono text-xs text-indigo-600 overflow-hidden truncate">{r.items?.std_code}</td>
                    <td className="px-3 py-2 font-semibold text-slate-800 overflow-hidden truncate">{r.items?.name}</td>
                    <td className="px-3 py-2 text-slate-500 overflow-hidden truncate">{r.items?.manufacturer||'-'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400 overflow-hidden truncate">{r.items?.manufacturer_code||'-'}</td>
                    <td className="px-3 py-2"><span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold ${catBadge(catOf(r.items))}`}>{catOf(r.items)}</span></td>
                    <td className="px-3 py-2 text-slate-500">{r.items?.unit}</td>
                    <td className={`px-3 py-2 text-right font-bold text-lg ${status==='zero'?'text-red-600':status==='low'?'text-amber-700':'text-slate-900'}`}>{r.qty}</td>
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
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold transition-colors ${(r.items?.stock_managed??true)?'bg-emerald-50 text-emerald-600 hover:bg-emerald-100':'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
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
