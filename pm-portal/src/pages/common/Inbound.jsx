import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

const CUSTOMERS = [
  { id: 'ax', name: 'AXCELIS' }, { id: 'ed', name: 'Edwards' },
  { id: 'vm', name: 'VM' },      { id: 'csk', name: 'CSK' },
]

async function fetchCustomers() {
  const { data } = await supabase.from('customers').select('id, code, name').order('name')
  return data || []
}

async function fetchOpenPOs(customerId) {
  if (!customerId) return []
  const { data } = await supabase
    .from('purchase_orders')
    .select('id, po_number, qty_ordered, qty_received, qty_remaining, type, promise_date, items(std_code, name)')
    .eq('customer_id', customerId)
    .neq('status', '완료')
    .gt('qty_remaining', 0)
    .order('promise_date')
  return data || []
}

async function processInbound({ poId, qty, unitPrice, memo, processedBy }) {
  const { error } = await supabase.from('stock_movements').insert({
    po_id: poId,
    movement_type: '입고',
    qty: Number(qty),
    unit_price: unitPrice ? Number(unitPrice) : null,
    memo,
    processed_by: processedBy || null,
    processed_at: new Date().toISOString(),
  })
  if (error) throw error
}

async function fetchRecentInbound() {
  const { data } = await supabase
    .from('stock_movements')
    .select('*, items(std_code, name), customers(name)')
    .eq('movement_type', '입고')
    .order('processed_at', { ascending: false })
    .limit(30)
  return data || []
}

export default function Inbound() {
  const qc = useQueryClient()
  const [selCustomer, setSelCustomer] = useState('')
  const [selPO, setSelPO] = useState('')
  const [qty, setQty] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [memo, setMemo] = useState('')
  const [tab, setTab] = useState('new')

  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: fetchCustomers })
  const csId = customers.find(c => c.code === selCustomer)?.id

  const { data: openPOs = [] } = useQuery({
    queryKey: ['openPOs', csId],
    queryFn: () => fetchOpenPOs(csId),
    enabled: !!csId,
  })

  const { data: recentRows = [] } = useQuery({
    queryKey: ['recentInbound'],
    queryFn: fetchRecentInbound,
  })

  const mutation = useMutation({
    mutationFn: processInbound,
    onSuccess: () => {
      qc.invalidateQueries(['recentInbound'])
      qc.invalidateQueries(['openPOs', csId])
      qc.invalidateQueries(['dashboard'])
      setSelPO(''); setQty(''); setUnitPrice(''); setMemo('')
      alert('입고 처리 완료')
    },
    onError: (e) => alert('오류: ' + e.message),
  })

  const selectedPO = openPOs.find(p => p.id === selPO)

  function handleSubmit() {
    if (!selPO || !qty) { alert('발주건과 수량을 입력하세요'); return }
    if (Number(qty) > (selectedPO?.qty_remaining || 0)) {
      if (!window.confirm(`잔량(${selectedPO?.qty_remaining})보다 많습니다. 계속할까요?`)) return
    }
    mutation.mutate({ poId: selPO, qty, unitPrice, memo })
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[['new','입고 처리'],['history','입고 이력']].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-1.5 text-xs font-600 rounded-md transition-all
              ${tab===k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'new' ? (
        <div className="grid grid-cols-2 gap-5">
          {/* 입고 폼 */}
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <h3 className="text-xs font-700 text-slate-700">① 고객사 선택</h3>
              <div className="grid grid-cols-2 gap-2">
                {customers.map(c => (
                  <button key={c.code} onClick={() => { setSelCustomer(c.code); setSelPO('') }}
                    className={`py-2 text-xs font-600 rounded-lg border transition-all
                      ${selCustomer === c.code
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <h3 className="text-xs font-700 text-slate-700">② 발주건 선택</h3>
              {!selCustomer ? (
                <p className="text-xs text-slate-400 text-center py-4">고객사를 먼저 선택하세요</p>
              ) : openPOs.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">미입고 발주건이 없습니다</p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {openPOs.map(p => (
                    <button key={p.id} onClick={() => setSelPO(p.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg border text-xs transition-all
                        ${selPO === p.id
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-slate-200 hover:border-slate-300'}`}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-600 text-slate-800">{p.items?.name}</span>
                        <span className={`text-[10px] font-700 px-1.5 py-0.5 rounded-full
                          ${p.type === '가공' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>
                          {p.type}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-500">
                        <span className="font-mono">{p.items?.std_code}</span>
                        <span>PO: {p.po_number || '-'}</span>
                        <span>잔량: <b className="text-slate-800">{p.qty_remaining}</b></span>
                        <span>약속일: {p.promise_date || '-'}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <h3 className="text-xs font-700 text-slate-700">③ 수량 및 단가</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-700 text-slate-500 mb-1">입고수량 *</label>
                  <input type="number" value={qty} onChange={e => setQty(e.target.value)}
                    placeholder={selectedPO ? `최대 ${selectedPO.qty_remaining}` : '수량'}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-700 text-slate-500 mb-1">단가 (선택)</label>
                  <input type="number" value={unitPrice} onChange={e => setUnitPrice(e.target.value)}
                    placeholder="단가"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-700 text-slate-500 mb-1">메모</label>
                <input type="text" value={memo} onChange={e => setMemo(e.target.value)}
                  placeholder="메모 (선택)"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>

            <button onClick={handleSubmit} disabled={mutation.isPending || !selPO || !qty}
              className="w-full py-2.5 text-sm font-700 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {mutation.isPending ? '처리 중...' : '입고 처리'}
            </button>
          </div>

          {/* 선택된 PO 요약 */}
          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-xs font-700 text-slate-700 mb-3">선택된 발주건</h3>
            {!selectedPO ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
                <p className="text-2xl">📦</p>
                <p className="text-xs">발주건을 선택하세요</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-slate-50 rounded-lg p-3 space-y-2">
                  {[
                    ['품명', selectedPO.items?.name],
                    ['기준코드', selectedPO.items?.std_code],
                    ['PO번호', selectedPO.po_number || '-'],
                    ['구분', selectedPO.type],
                    ['발주량', selectedPO.qty_ordered],
                    ['기입고', selectedPO.qty_received],
                    ['잔량', selectedPO.qty_remaining],
                    ['약속일', selectedPO.promise_date || '-'],
                  ].map(([k,v]) => (
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-slate-500">{k}</span>
                      <span className="font-600 text-slate-800">{v}</span>
                    </div>
                  ))}
                </div>
                {qty && (
                  <div className="bg-indigo-50 rounded-lg p-3 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-indigo-600">입고 후 잔량</span>
                      <span className="font-700 text-indigo-700">{selectedPO.qty_remaining - Number(qty)}</span>
                    </div>
                    {unitPrice && (
                      <div className="flex justify-between">
                        <span className="text-indigo-600">금액</span>
                        <span className="font-700 text-indigo-700">{(Number(qty) * Number(unitPrice)).toLocaleString()}원</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* 입고 이력 */
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['처리일시','고객사','기준코드','품명','수량','단가','금액','메모'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-700 text-slate-400 text-[10px] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentRows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-slate-400">입고 이력이 없습니다</td></tr>
              ) : recentRows.map(r => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-500">{new Date(r.processed_at).toLocaleString('ko-KR', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
                  <td className="px-3 py-2 font-600 text-slate-700">{r.customers?.name || '-'}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{r.items?.std_code || '-'}</td>
                  <td className="px-3 py-2 text-slate-700">{r.items?.name || '-'}</td>
                  <td className="px-3 py-2 text-right font-600 text-slate-900">{r.qty}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{r.unit_price ? Number(r.unit_price).toLocaleString() : '-'}</td>
                  <td className="px-3 py-2 text-right font-600 text-slate-700">{r.unit_price ? (r.qty * r.unit_price).toLocaleString() : '-'}</td>
                  <td className="px-3 py-2 text-slate-500">{r.memo || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
