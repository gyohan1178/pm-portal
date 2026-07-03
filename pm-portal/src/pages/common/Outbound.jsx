import { useState, useEffect, useMemo } from 'react'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useCustomers } from '../../hooks/useCustomers'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import * as XLSX from 'xlsx'

function monthAgoStr() {
  const d = new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().split('T')[0]
}

async function fetchProjects(customerId) {
  const { data } = await supabase.from('projects').select('id,code,name,rev').eq('customer_id', customerId).order('code')
  return data || []
}
async function fetchActiveCPOs(customerId, projectId) {
  if (!customerId) return []
  let q = supabase.from('purchase_orders')
    .select('id,po_number,qty_ordered,qty_remaining,items!purchase_orders_item_id_fkey(std_code,name,unit),projects(code,name)')
    .eq('customer_id', customerId).eq('order_type','customer_po').neq('status','완료')
  if (projectId) q = q.eq('project_id', projectId)
  const { data } = await q.order('created_at', { ascending: false })
  return data || []
}
async function fetchBOMItems(customerId, projectId) {
  if (!customerId || !projectId) return []
  const { data } = await supabase.from('bom')
    .select('*, items!bom_item_id_fkey(id,std_code,name,unit)')
    .eq('customer_id', customerId).eq('project_id', projectId)
  return data || []
}
async function fetchOutboundHistory({ from, to, customerId }) {
  let q = supabase.from('stock_movements')
    .select('*, items(std_code,name,unit), purchase_orders(po_number,customer_id,customers(name,code),projects(code,name))')
    .eq('movement_type','출고')
    .gte('movement_date', from)
    .lte('movement_date', to)
    .order('movement_date', { ascending: false })
  const { data, error } = await q.limit(200)
  if (error) throw error
  let rows = data || []
  if (customerId) rows = rows.filter(r=>r.purchase_orders?.customer_id===customerId)
  return rows
}

export default function Outbound() {
  const qc = useQueryClient()
  const [tab, setTab] = useState('process')
  const [excluded, setExcluded] = useState(new Set()) // 불출표 제외 대상 (item_id)
  // 출고 처리
  const [selCustomer, setSelCustomer] = useState('')
  const [selProject, setSelProject] = useState('')
  const [projSearch, setProjSearch] = useState('')
  const [outUnits, setOutUnits] = useState(1)
  const [selCPO, setSelCPO] = useState(null)
  const [outQtys, setOutQtys] = useState({})
  const [note, setNote] = useState('')
  const [result, setResult] = useState(null)
  const [stockWarning, setStockWarning] = useState(null)
  // 출고 현황
  const [hFrom, setHFrom] = useState(monthAgoStr())
  const [hTo, setHTo] = useState(new Date().toISOString().split('T')[0])
  const [hCustomer, setHCustomer] = useState('')
  const [hQuery, setHQuery] = useState({ from: monthAgoStr(), to: new Date().toISOString().split('T')[0], customerId:'' })

  const { data: customers=[] } = useCustomers()
  const { data: projects=[] } = useQuery({
    queryKey:['projects',selCustomer], queryFn:()=>fetchProjects(selCustomer), enabled:!!selCustomer,
  })
  const { data: cpos=[] } = useQuery({
    queryKey:['activeCPOs',selCustomer,selProject], queryFn:()=>fetchActiveCPOs(selCustomer,selProject||null), enabled:!!selCustomer,
  })
  const { data: bomItems=[] } = useQuery({
    queryKey:['bomForOut',selCustomer,selProject], queryFn:()=>fetchBOMItems(selCustomer,selProject), enabled:!!selCustomer&&!!selProject,
  })
  const { data: history=[], isLoading: histLoading } = useQuery({
    queryKey:['outboundHistory', hQuery],
    queryFn:()=>fetchOutboundHistory({ from:hQuery.from, to:hQuery.to, customerId:hQuery.customerId }),
    enabled: tab==='history',
  })

  const outMut = useMutation({
    mutationFn: async ({ mode }) => {
      const lines = bomItems
        .map(b=>({ item_id:b.item_id, name:b.items?.name||'', qty:Number(outQtys[b.item_id]||0) }))
        .filter(l=>l.qty>0)
      const { data, error } = await supabase.rpc('pm_process_outbound', {
        p_lines: lines, p_po_id: selCPO?.id||null, p_note: note||null, p_mode: mode,
      })
      if (error) throw error
      return data
    },
    onSuccess: (res) => {
      if (res?.aborted) { setStockWarning({ errors: res.warnings||[] }); return }
      const w = res?.warnings||[]
      setStockWarning(null)
      setResult(`출고 처리 완료 (${res?.processed||0}건)` + (w.length?` · 부족 ${w.length}건 제외`:''))
      setOutQtys({}); setNote('')
      qc.invalidateQueries(['inventory'])
      qc.invalidateQueries(['outboundHistory'])
    },
    onError: (e) => toastError('오류: ' + e.message),
  })

  function autoFillFromBOM(qty) {
    const qtys = {}
    bomItems.forEach(b=>{ qtys[b.item_id] = b.qty_per_unit * (qty||1) })
    setOutQtys(qtys)
  }

  // BOM 로드되거나 대수 바뀌면 출고수량 = BOM/대 × 대수 자동
  useEffect(()=>{ if(bomItems.length) autoFillFromBOM(outUnits) }, [bomItems, outUnits])

  // 프로젝트 검색 필터
  const projFiltered = projects.filter(p=>{
    if(!projSearch) return true
    const s = projSearch.toLowerCase()
    return `${p.code} ${p.name||''}`.toLowerCase().includes(s)
  })

  // 제조사·제조사품번 조회 (BOM 품목들)
  const outItemIds = [...new Set(bomItems.map(b=>b.item_id).filter(Boolean))]
  const { data: makerMeta = {} } = useQuery({
    queryKey: ['outMakerMeta', outItemIds.join(',')],
    enabled: outItemIds.length>0,
    queryFn: async () => {
      const { data } = await supabase.from('items').select('id,manufacturer,manufacturer_code').in('id', outItemIds)
      return Object.fromEntries((data||[]).map(i=>[i.id, i]))
    },
  })

  const outItems = useMemo(() => bomItems.map(b=>({
    item_id:b.item_id, std_code:b.items?.std_code, name:b.items?.name,
    unit:b.items?.unit, bom_qty:b.qty_per_unit, outQty:outQtys[b.item_id]||'',
    maker: makerMeta[b.item_id]?.manufacturer || '',
    makerPn: makerMeta[b.item_id]?.manufacturer_code || '',
  })).sort((a,b)=>
    String(a.maker).localeCompare(String(b.maker),'ko') ||
    String(a.makerPn).localeCompare(String(b.makerPn),'ko') ||
    String(a.std_code).localeCompare(String(b.std_code))
  ), [bomItems, outQtys, makerMeta])

  // 자재 불출표 인쇄 (제외 뺀 것 · 제조사→제조사품번 순 · 키팅 확인란)
  function printIssueSheet() {
    const rows = outItems.filter(r => !excluded.has(r.item_id) && Number(r.outQty)>0)
    if (!rows.length) { toastError('출력할 품목이 없습니다 (출고수량 입력 + 제외 해제 확인)'); return }
    const csName = selCustomer ? (customers.find(c=>c.id===selCustomer)?.name || '') : ''
    const projName = selProject ? (projects.find(p=>p.id===selProject)?.code || '') : ''
    const today = new Date().toLocaleDateString('ko-KR')
    const body = rows.map((r,i)=>`<tr>
      <td class="c">${i+1}</td><td>${r.maker||'-'}</td><td class="mono">${r.makerPn||'-'}</td>
      <td class="mono">${r.std_code||''}</td><td>${r.name||''}</td>
      <td class="c b">${r.outQty}</td><td>${r.unit||''}</td><td class="chk"></td>
    </tr>`).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>자재 불출표</title>
    <style>*{font-family:'Malgun Gothic',sans-serif;box-sizing:border-box}body{padding:24px;color:#111}
    .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #333;padding-bottom:8px}
    h1{font-size:20px;margin:0}.meta{font-size:12px;color:#555;text-align:right;line-height:1.6}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}
    th,td{border:1px solid #999;padding:5px 6px;text-align:left}th{background:#f0f0f0;font-size:11px}
    .c{text-align:center}.b{font-weight:bold}.mono{font-family:consolas,monospace}.chk{width:44px}
    tr{page-break-inside:avoid}.sign{margin-top:18px;font-size:12px;display:flex;gap:40px}
    .sign span{border-top:1px solid #999;padding-top:4px;min-width:120px;text-align:center}
    @media print{body{padding:0}}</style></head><body>
    <div class="head"><h1>자재 불출표</h1>
    <div class="meta">고객사: <b>${csName}</b> · 프로젝트: ${projName} · ${outUnits}대<br>출력일: ${today} · 총 ${rows.length}품목</div></div>
    <table><thead><tr>
      <th class="c" style="width:36px">No</th><th style="width:110px">제조사</th><th style="width:130px">제조사품번</th>
      <th style="width:120px">기준코드</th><th>품명</th><th class="c" style="width:56px">수량</th><th style="width:44px">단위</th><th class="chk">키팅<br>확인</th>
    </tr></thead><tbody>${body}</tbody></table>
    <div class="sign"><span>작성</span><span>불출</span><span>확인</span></div>
    </body></html>`
    const w = window.open('','_blank')
    if(!w){ toastError('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return }
    w.document.write(html); w.document.close(); w.onload=()=>{ w.focus(); w.print() }
  }

  const histTotal = history.reduce((a,r)=>a+r.qty,0)

  function exportHistory() {
    const data = history.map(r=>({
      '출고일':r.movement_date, '기준코드':r.items?.std_code, '품명':r.items?.name,
      '단위':r.items?.unit, '수량':r.qty,
      '고객사PO':r.purchase_orders?.po_number||'',
      '고객사':r.purchase_orders?.customers?.name||'',
      '프로젝트':r.purchase_orders?.projects?.code||'', '비고':r.note||'',
    }))
    const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),'출고현황')
    XLSX.writeFile(wb,`출고현황_${hQuery.from}_${hQuery.to}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {[['process','📤 출고 처리'],['history','📋 출고 현황']].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${tab===k?'bg-white text-slate-900 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{l}</button>
        ))}
      </div>

      {tab==='process' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <p className="text-xs font-bold text-slate-700">출고 설정</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">고객사</label>
                <select value={selCustomer} onChange={e=>{ setSelCustomer(e.target.value); setSelProject(''); setSelCPO(null); setOutQtys({}); setProjSearch('') }}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">선택</option>
                  {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">프로젝트 {projects.length>0&&<span className="text-slate-300 font-normal">({projFiltered.length}/{projects.length})</span>}</label>
                <input value={projSearch} onChange={e=>setProjSearch(e.target.value)} disabled={!selCustomer}
                  placeholder="프로젝트 검색"
                  className="w-full mb-1 px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50"/>
                <select value={selProject} onChange={e=>{ setSelProject(e.target.value); setSelCPO(null) }}
                  disabled={!selCustomer}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50">
                  <option value="">전체</option>
                  {projFiltered.map(p=><option key={p.id} value={p.id}>{p.code}{p.name?` - ${p.name}`:''}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">고객사 PO <span className="text-slate-300 font-normal">(선택 시 대수 자동)</span></label>
                <select value={selCPO?.id||''} onChange={e=>{
                  const cpo=cpos.find(c=>c.id===e.target.value)
                  setSelCPO(cpo||null)
                  if(cpo) setOutUnits(cpo.qty_remaining||1)
                }} disabled={!selCustomer}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50">
                  <option value="">선택 안 함</option>
                  {cpos.map(c=><option key={c.id} value={c.id}>{c.po_number||c.id.slice(0,8)} — {c.items?.name||''} (잔량:{c.qty_remaining})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">출고 대수</label>
                <input type="number" min="1" value={outUnits}
                  onChange={e=>setOutUnits(Math.max(1, Number(e.target.value)||1))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-indigo-600"/>
              </div>
            </div>
          </div>

          {stockWarning && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <p className="text-xs font-bold text-amber-700">⚠️ 재고 부족 품목</p>
              <ul className="space-y-1">{stockWarning.errors.map((e,i)=><li key={i} className="text-xs text-amber-600">• {e}</li>)}</ul>
              <div className="flex gap-2">
                <button onClick={()=>setStockWarning(null)} className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">취소</button>
                <button onClick={()=>{ setStockWarning(null); outMut.mutate({mode:'skip'}) }} className="px-4 py-2 text-xs font-bold rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100">부족 제외 출고</button>
                <button onClick={()=>{ setStockWarning(null); outMut.mutate({mode:'force'}) }} className="px-4 py-2 text-xs font-bold rounded-lg bg-rose-600 text-white hover:bg-rose-700">강제 출고</button>
              </div>
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 font-semibold flex items-center">
              ✅ {result}
              <button onClick={()=>setResult(null)} className="ml-auto text-emerald-400">✕</button>
            </div>
          )}

          {selCustomer && (
            <div className="space-y-3">
              {bomItems.length>0&&(
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-600">BOM 연동 — {bomItems.length}개 품목
                    <span className="text-slate-400 font-normal ml-2">({outUnits}대 기준)</span>
                  </p>
                  <div className="flex gap-2">
                    <button onClick={()=>autoFillFromBOM(outUnits)} className="text-xs text-indigo-500 hover:text-indigo-700 font-semibold">🔄 재계산</button>
                    <button onClick={printIssueSheet} title="제외 체크 뺀 품목을 제조사→제조사품번 순으로 불출표 인쇄 (키팅 확인란 포함)" className="text-xs font-bold text-white bg-indigo-600 px-2.5 py-1 rounded hover:bg-indigo-700">🖨 불출표 출력</button>
                  </div>
                </div>
              )}
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    {['No','제조사','제조사품번','기준코드','품명','단위','BOM/대','출고수량','제외'].map(h=>(
                      <th key={h} className="px-3 py-2.5 text-left font-bold text-slate-400 text-xs uppercase tracking-wide">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {outItems.length===0
                      ? <tr><td colSpan={9} className="text-center py-8 text-slate-400">{!selProject?'프로젝트를 선택하면 BOM이 자동으로 불러와집니다':'BOM 데이터가 없습니다'}</td></tr>
                      : outItems.map((item,idx)=>{
                        const ex = excluded.has(item.item_id)
                        return (
                        <tr key={item.item_id} className={`border-b border-slate-100 ${ex?'opacity-40 bg-slate-50':''}`}>
                          <td className="px-3 py-2 text-center text-slate-400">{idx+1}</td>
                          <td className="px-3 py-2 text-slate-500 max-w-[100px] truncate">{item.maker||'—'}</td>
                          <td className="px-3 py-2 font-mono text-xs text-violet-600 max-w-[130px] truncate">{item.makerPn||'—'}</td>
                          <td className="px-3 py-2 font-mono text-xs text-indigo-600">{item.std_code}</td>
                          <td className="px-3 py-2 font-semibold text-slate-800 max-w-[160px] truncate">{item.name}</td>
                          <td className="px-3 py-2 text-slate-500">{item.unit}</td>
                          <td className="px-3 py-2 text-right text-slate-600">{item.bom_qty}</td>
                          <td className="px-3 py-2">
                            <input type="number" min={0}
                              value={outQtys[item.item_id]??''}
                              onChange={e=>setOutQtys(prev=>({...prev,[item.item_id]:e.target.value}))}
                              className="w-24 px-2 py-1 text-xs border border-slate-200 rounded text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"/>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input type="checkbox" checked={ex} title="불출표에서 제외"
                              onChange={()=>setExcluded(p=>{ const n=new Set(p); n.has(item.item_id)?n.delete(item.item_id):n.add(item.item_id); return n })}/>
                          </td>
                        </tr>
                      )})
                    }
                  </tbody>
                </table>
              </div>
              {outItems.length>0&&(
                <div className="space-y-2">
                  <input value={note} onChange={e=>setNote(e.target.value)} placeholder="출고 비고 (선택)"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                  <button onClick={()=>outMut.mutate({mode:'strict'})}
                    disabled={outMut.isPending||Object.values(outQtys).every(q=>!q||Number(q)<=0)}
                    className="w-full py-2 text-xs font-bold rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40">
                    {outMut.isPending?'처리 중...':'📤 출고 처리'}
                  </button>
                </div>
              )}
            </div>
          )}
          {!selCustomer&&(
            <div className="text-center py-16 text-slate-400">
              <p className="text-2xl mb-2">📤</p>
              <p className="text-sm">고객사를 선택하세요</p>
            </div>
          )}
        </div>
      )}

      {tab==='history' && (
        <div className="space-y-4">
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
              <label className="block text-xs font-bold text-slate-500 mb-1">고객사</label>
              <select value={hCustomer} onChange={e=>setHCustomer(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="">전체</option>
                {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <button onClick={()=>setHQuery({from:hFrom,to:hTo,customerId:hCustomer})}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">조회</button>
            {history.length>0&&(
              <button onClick={exportHistory}
                className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">📥 엑셀</button>
            )}
            <div className="ml-auto text-xs text-slate-400 self-center">총 {history.length}건</div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">총 출고 건수</p><p className="text-xl font-bold text-slate-900">{history.length}</p></div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3"><p className="text-xs font-bold text-rose-400 uppercase tracking-wide mb-1">총 출고 수량</p><p className="text-xl font-bold text-rose-700">{histTotal.toLocaleString()}</p></div>
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3"><p className="text-xs font-bold text-indigo-400 uppercase tracking-wide mb-1">품목 수</p><p className="text-xl font-bold text-indigo-700">{new Set(history.map(r=>r.item_id)).size}</p></div>
          </div>

          {histLoading ? <div className="text-center py-10 text-slate-400 text-sm">불러오는 중...</div> : (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    {['출고일','기준코드','품명','수량','단위','고객사 PO','고객사','프로젝트','비고'].map(h=>(
                      <th key={h} className="px-3 py-2.5 text-left font-bold text-slate-400 text-xs uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {history.length===0
                      ? <tr><td colSpan={9} className="text-center py-10 text-slate-400">출고 이력이 없습니다</td></tr>
                      : history.map(r=>(
                        <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-3 py-2 font-semibold text-slate-700">{r.movement_date}</td>
                          <td className="px-3 py-2 font-mono text-xs text-indigo-600">{r.items?.std_code}</td>
                          <td className="px-3 py-2 font-semibold text-slate-800">{r.items?.name}</td>
                          <td className="px-3 py-2 text-right font-bold text-rose-700">{r.qty}</td>
                          <td className="px-3 py-2 text-slate-500">{r.items?.unit}</td>
                          <td className="px-3 py-2 font-mono text-slate-500">{r.purchase_orders?.po_number||'-'}</td>
                          <td className="px-3 py-2 text-slate-500">{r.purchase_orders?.customers?.name||'-'}</td>
                          <td className="px-3 py-2 text-slate-500">{r.purchase_orders?.projects?.code||'-'}</td>
                          <td className="px-3 py-2 text-slate-400">{r.note||'-'}</td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
