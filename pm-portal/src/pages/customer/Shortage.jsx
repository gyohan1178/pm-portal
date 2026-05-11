import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import * as XLSX from 'xlsx'

async function fetchCustomerId(code) {
  const { data } = await supabase.from('customers').select('id').eq('code', code).single()
  return data?.id
}

async function fetchShortage(customerId) {
  // BOM 소요량
  const { data: bomRows } = await supabase
    .from('bom')
    .select('*, items(id, std_code, name, type, lt_weeks, safety_stock)')
    .eq('customer_id', customerId)

  if (!bomRows?.length) return []

  const itemIds = [...new Set(bomRows.map(b => b.item_id))]

  // 재고
  const { data: invRows } = await supabase
    .from('inventory')
    .select('item_id, qty')
    .in('item_id', itemIds)

  // 미입고 구매발주 (우리가 발주한 것, 입고 안 된 것)
  const { data: poRows } = await supabase
    .from('purchase_orders')
    .select('item_id, qty_remaining')
    .eq('customer_id', customerId)
    .neq('status', '완료')

  const invMap = {}
  ;(invRows || []).forEach(r => { invMap[r.item_id] = r.qty })

  const poMap = {}
  ;(poRows || []).forEach(r => {
    poMap[r.item_id] = (poMap[r.item_id] || 0) + (r.qty_remaining || 0)
  })

  // BOM 기준으로 계산
  // 현재 PO잔량을 별도로 가져와야 하지만 지금은 BOM qty_per_unit 기준으로 계산
  return bomRows.map(b => {
    const stock    = invMap[b.item_id] || 0
    const poOrd    = poMap[b.item_id] || 0  // 구매 발주 미입고
    const need     = b.qty_per_unit           // BOM 소요량 (PO잔량은 연동 후)
    const lack     = need - stock
    const orderNeed = Math.max(0, lack - poOrd)
    return {
      id: b.id,
      item_id: b.item_id,
      std_code: b.items?.std_code,
      name: b.items?.name,
      type: b.items?.type,
      lt_weeks: b.items?.lt_weeks || 0,
      bom_qty: b.qty_per_unit,
      stock,
      lack,
      po_pending: poOrd,
      order_need: orderNeed,
    }
  }).sort((a, b) => b.order_need - a.order_need)
}

function exportToExcel(rows) {
  const data = rows.map(r => ({
    '기준코드': r.std_code,
    '품명': r.name,
    '구분': r.type,
    'LT(주)': r.lt_weeks,
    'BOM소요량': r.bom_qty,
    '현재고': r.stock,
    '부족자재': r.lack > 0 ? -r.lack : 0,
    '구매발주미입고': r.po_pending,
    '발주필요수량': r.order_need,
  }))
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(data)
  XLSX.utils.book_append_sheet(wb, ws, '부족자재')
  XLSX.writeFile(wb, `부족자재_${new Date().toISOString().split('T')[0]}.xlsx`)
}

export default function Shortage() {
  const { customerId: csCode } = useParams()
  const [typeTab, setTypeTab] = useState('전체')

  const { data: csId } = useQuery({
    queryKey: ['csId', csCode],
    queryFn: () => fetchCustomerId(csCode),
  })

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['shortage', csId],
    queryFn: () => fetchShortage(csId),
    enabled: !!csId,
  })

  const filtered = typeTab === '전체' ? rows : rows.filter(r => r.type === typeTab)
  const needOrder = filtered.filter(r => r.order_need > 0)
  const lacking   = filtered.filter(r => r.lack > 0)

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {['전체', '가공', '자재'].map(t => (
            <button key={t} onClick={() => setTypeTab(t)}
              className={`px-3 py-1 text-xs font-600 rounded-md transition-all
                ${typeTab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => exportToExcel(filtered)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-600 rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">
          📥 발주목록 추출
        </button>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-[10px] font-700 text-red-400 uppercase tracking-widest mb-1">발주필요 품목</p>
          <p className="text-xl font-700 text-red-600">{needOrder.length}</p>
          <p className="text-[11px] text-red-400 mt-1">즉시 발주 필요</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-[10px] font-700 text-amber-500 uppercase tracking-widest mb-1">부족 품목</p>
          <p className="text-xl font-700 text-amber-700">{lacking.length}</p>
          <p className="text-[11px] text-amber-400 mt-1">현재고 기준</p>
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-[10px] font-700 text-slate-400 uppercase tracking-widest mb-1">구매발주 미입고</p>
          <p className="text-xl font-700 text-slate-900">{filtered.reduce((a, r) => a + r.po_pending, 0)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-[10px] font-700 text-slate-400 uppercase tracking-widest mb-1">총 발주필요수량</p>
          <p className="text-xl font-700 text-slate-900">{filtered.reduce((a, r) => a + r.order_need, 0)}</p>
        </div>
      </div>

      {/* 테이블 */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-400 text-sm">계산 중...</div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2.5 text-left font-700 text-slate-400 text-[10px] uppercase tracking-wide">기준코드</th>
                  <th className="px-3 py-2.5 text-left font-700 text-slate-400 text-[10px] uppercase tracking-wide">품명</th>
                  <th className="px-3 py-2.5 text-left font-700 text-slate-400 text-[10px] uppercase tracking-wide">구분</th>
                  <th className="px-3 py-2.5 text-right font-700 text-slate-400 text-[10px] uppercase tracking-wide">LT</th>
                  <th className="px-3 py-2.5 text-right font-700 text-slate-400 text-[10px] uppercase tracking-wide">BOM소요</th>
                  <th className="px-3 py-2.5 text-right font-700 text-slate-400 text-[10px] uppercase tracking-wide">현재고</th>
                  <th className="px-3 py-2.5 text-right font-700 text-[10px] uppercase tracking-wide" style={{background:'#FFF7ED',color:'#92400E'}}>부족자재</th>
                  <th className="px-3 py-2.5 text-right font-700 text-[10px] uppercase tracking-wide" style={{background:'#F0FDF4',color:'#065F46'}}>구매발주미입고</th>
                  <th className="px-3 py-2.5 text-right font-700 text-[10px] uppercase tracking-wide" style={{background:'#FEF2F2',color:'#991B1B'}}>발주필요수량</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-10 text-slate-400">BOM 데이터를 먼저 등록하세요</td></tr>
                ) : filtered.map(r => (
                  <tr key={r.id} className={`border-b border-slate-100 hover:bg-slate-50 ${r.order_need > 0 ? 'bg-red-50/20' : ''}`}>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{r.std_code}</td>
                    <td className="px-3 py-2 font-600 text-slate-800">{r.name}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-700
                        ${r.type === '가공' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>
                        {r.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-600 bg-slate-100 text-slate-600">
                        {r.lt_weeks}W
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-600 text-slate-700">{r.bom_qty}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{r.stock}</td>
                    <td className="px-3 py-2 text-right font-700" style={{background:'#FFF7ED'}}>
                      {r.lack > 0
                        ? <span className="text-amber-700">-{r.lack}</span>
                        : <span className="text-emerald-600">충족</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-700" style={{background:'#F0FDF4'}}>
                      {r.po_pending > 0
                        ? <span className="text-emerald-700">+{r.po_pending}</span>
                        : <span className="text-slate-400">-</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-700" style={{background: r.order_need > 0 ? '#FEF2F2' : '#F0FDF4'}}>
                      {r.order_need > 0
                        ? <span className="text-red-600">{r.order_need} EA</span>
                        : <span className="text-emerald-600">충족</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
