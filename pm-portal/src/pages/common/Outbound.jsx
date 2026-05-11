import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import * as XLSX from 'xlsx'

async function fetchCustomers() {
  const { data } = await supabase.from('customers').select('id, code, name')
  return data || []
}
async function fetchProjects(customerId) {
  if (!customerId) return []
  const { data } = await supabase.from('projects').select('id, code, name').eq('customer_id', customerId).eq('status', '진행중')
  return data || []
}
async function fetchBOMForProject(projectId, customerId) {
  if (!projectId) return []
  const { data: bom } = await supabase
    .from('bom')
    .select('*, items(id, std_code, name, type, lt_weeks)')
    .eq('project_id', projectId)
    .eq('customer_id', customerId)
  const itemIds = (bom || []).map(b => b.item_id)
  if (!itemIds.length) return []
  const { data: inv } = await supabase.from('inventory').select('item_id, qty').in('item_id', itemIds)
  const invMap = {}
  ;(inv || []).forEach(r => { invMap[r.item_id] = r.qty })
  return (bom || []).map(b => ({
    ...b,
    stock: invMap[b.item_id] || 0,
    outQty: b.qty_per_unit,
    checked: true,
  }))
}
async function processBulkOutbound({ rows, customerId, projectId }) {
  const inserts = rows.filter(r => r.checked && r.outQty > 0).map(r => ({
    item_id: r.item_id,
    customer_id: customerId,
    project_id: projectId,
    movement_type: '출고',
    qty: Number(r.outQty),
    processed_at: new Date().toISOString(),
  }))
  if (!inserts.length) throw new Error('출고 항목이 없습니다')
  const { error } = await supabase.from('stock_movements').insert(inserts)
  if (error) throw error
}

export default function Outbound() {
  const qc = useQueryClient()
  const [selCs, setSelCs] = useState('')
  const [selProj, setSelProj] = useState('')
  const [bomRows, setBomRows] = useState([])
  const [tab, setTab] = useState('new')
  const [step, setStep] = useState(1)

  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: fetchCustomers })
  const csObj = customers.find(c => c.code === selCs)

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', csObj?.id],
    queryFn: () => fetchProjects(csObj?.id),
    enabled: !!csObj?.id,
  })

  const { data: fetchedBOM = [], isLoading: bomLoading } = useQuery({
    queryKey: ['bom-outbound', selProj],
    queryFn: async () => {
      const proj = projects.find(p => p.id === selProj)
      const rows = await fetchBOMForProject(selProj, csObj?.id)
      setBomRows(rows.map(r => ({ ...r, checked: true, outQty: r.qty_per_unit })))
      return rows
    },
    enabled: !!selProj && !!csObj?.id,
  })

  const mutation = useMutation({
    mutationFn: processBulkOutbound,
    onSuccess: () => {
      qc.invalidateQueries(['dashboard'])
      alert('일괄 출고 처리 완료')
      setStep(1); setSelCs(''); setSelProj(''); setBomRows([])
    },
    onError: (e) => alert('오류: ' + e.message),
  })

  function exportList() {
    const data = bomRows.filter(r => r.checked).map(r => ({
      '기준코드': r.items?.std_code,
      '품명': r.items?.name,
      '구분': r.items?.type,
      '소요량': r.qty_per_unit,
      '출고수량': r.outQty,
      '현재고': r.stock,
      '출고후재고': r.stock - Number(r.outQty),
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), '자재불출')
    XLSX.writeFile(wb, `자재불출_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  function toggleRow(id) {
    setBomRows(prev => prev.map(r => r.id === id ? { ...r, checked: !r.checked } : r))
  }
  function updateQty(id, val) {
    setBomRows(prev => prev.map(r => r.id === id ? { ...r, outQty: val } : r))
  }

  const { data: history = [] } = useQuery({
    queryKey: ['outbound-history'],
    queryFn: async () => {
      const { data } = await supabase
        .from('stock_movements')
        .select('*, items(std_code, name), customers(name), projects(name)')
        .eq('movement_type', '출고')
        .order('processed_at', { ascending: false })
        .limit(30)
      return data || []
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[['new','출고 처리'],['history','출고 이력']].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-1.5 text-xs font-600 rounded-md transition-all
              ${tab===k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
        ))}
      </div>

      {tab === 'new' ? (
        <div className="space-y-4">
          {/* Step 1 */}
          <div className={`rounded-xl border p-4 space-y-3 ${step >= 1 ? 'border-slate-200' : 'border-slate-100 opacity-50'}`}>
            <h3 className="text-xs font-700 text-slate-700">① 고객사 + 프로젝트 선택</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid grid-cols-2 gap-2">
                {customers.map(c => (
                  <button key={c.code} onClick={() => { setSelCs(c.code); setSelProj(''); setBomRows([]) }}
                    className={`py-2 text-xs font-600 rounded-lg border transition-all
                      ${selCs === c.code ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                    {c.name}
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                {!selCs ? <p className="text-xs text-slate-400 text-center pt-4">고객사 선택 후 프로젝트 표시</p>
                : projects.length === 0 ? <p className="text-xs text-slate-400 text-center pt-4">진행중 프로젝트 없음</p>
                : projects.map(p => (
                  <button key={p.id} onClick={() => { setSelProj(p.id); setStep(2) }}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-all
                      ${selProj === p.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 hover:border-slate-300'}`}>
                    <span className="font-600">{p.code}</span>
                    {p.name && <span className="text-slate-500 ml-2">{p.name}</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Step 2 - 소요량 조회 */}
          {step >= 2 && selProj && (
            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-700 text-slate-700">② 소요량 조회 및 출고수량 확인</h3>
                <div className="flex gap-2">
                  <button onClick={exportList}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-600 rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">
                    📄 자재불출 출력
                  </button>
                  <button
                    onClick={() => mutation.mutate({ rows: bomRows, customerId: csObj?.id, projectId: selProj })}
                    disabled={mutation.isPending || bomRows.filter(r=>r.checked).length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-700 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                    {mutation.isPending ? '처리 중...' : '⚡ 일괄 출고처리'}
                  </button>
                </div>
              </div>

              {bomLoading ? (
                <p className="text-xs text-slate-400 text-center py-6">BOM 불러오는 중...</p>
              ) : bomRows.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">등록된 BOM이 없습니다</p>
              ) : (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-3 py-2 w-8"></th>
                        {['기준코드','품명','구분','BOM소요','현재고','출고수량','출고후재고'].map(h => (
                          <th key={h} className="px-3 py-2 text-left font-700 text-slate-400 text-[10px] uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bomRows.map(r => {
                        const afterStock = r.stock - Number(r.outQty || 0)
                        return (
                          <tr key={r.id} className={`border-b border-slate-100 ${!r.checked ? 'opacity-40' : ''}`}>
                            <td className="px-3 py-2">
                              <input type="checkbox" checked={r.checked} onChange={() => toggleRow(r.id)}
                                className="w-3.5 h-3.5 accent-indigo-600" />
                            </td>
                            <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{r.items?.std_code}</td>
                            <td className="px-3 py-2 font-600 text-slate-800">{r.items?.name}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-700
                                ${r.items?.type === '가공' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>
                                {r.items?.type}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right font-600 text-slate-700">{r.qty_per_unit}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{r.stock}</td>
                            <td className="px-3 py-2">
                              <input type="number" value={r.outQty} onChange={e => updateQty(r.id, e.target.value)}
                                className="w-16 px-2 py-1 text-xs border border-slate-200 rounded text-right focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                            </td>
                            <td className={`px-3 py-2 text-right font-700 ${afterStock < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                              {afterStock}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['처리일시','고객사','프로젝트','기준코드','품명','수량'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-700 text-slate-400 text-[10px] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-slate-400">출고 이력이 없습니다</td></tr>
              ) : history.map(r => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-500">{new Date(r.processed_at).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
                  <td className="px-3 py-2 font-600 text-slate-700">{r.customers?.name||'-'}</td>
                  <td className="px-3 py-2 text-slate-500">{r.projects?.name||'-'}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{r.items?.std_code||'-'}</td>
                  <td className="px-3 py-2 text-slate-700">{r.items?.name||'-'}</td>
                  <td className="px-3 py-2 text-right font-600 text-slate-900">{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
