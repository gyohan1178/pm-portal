import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { ResizableTable } from '../../components/ResizableTable'

const MP_COLS = [
  { key:'pn',     label:'품번',      defaultWidth:120 },
  { key:'hogi',   label:'호기',      defaultWidth:70  },
  { key:'part',   label:'결품 품목', defaultWidth:220 },
  { key:'need',   label:'필요',      defaultWidth:70, style:{textAlign:'right'} },
  { key:'stock',  label:'재고',      defaultWidth:70, style:{textAlign:'right'} },
  { key:'status', label:'상태',      defaultWidth:100 },
]

async function fetchMissing() {
  const { data: prod, error } = await supabase.from('production')
    .select('id,pn,hogi,name,missing_parts,req_date')
    .eq('customer_code', 'AX')
  if (error) throw error
  const rows = []
  for (const p of (prod || [])) {
    const mp = Array.isArray(p.missing_parts) ? p.missing_parts : []
    for (const m of mp) {
      rows.push({
        prodId: p.id, pn: p.pn, hogi: p.hogi, prodName: p.name, reqDate: p.req_date,
        item_id: m.item_id, std_code: m.std_code, name: m.name, need: Number(m.qty) || 0,
      })
    }
  }
  const ids = [...new Set(rows.map(r => r.item_id).filter(Boolean))]
  let invMap = {}
  if (ids.length) {
    for (let i = 0; i < ids.length; i += 300) {
      const { data: inv } = await supabase.from('inventory').select('item_id,qty').in('item_id', ids.slice(i, i + 300))
      ;(inv || []).forEach(x => { invMap[x.item_id] = Number(x.qty) || 0 })
    }
  }
  return rows.map(r => {
    const stock = invMap[r.item_id] ?? 0
    return { ...r, stock, ready: stock >= r.need && r.need > 0 }
  })
}

export default function MissingParts() {
  const { data: rows = [], isLoading } = useQuery({ queryKey: ['missingParts'], queryFn: fetchMissing })

  const sorted = useMemo(() =>
    [...rows].sort((a, b) => (b.ready - a.ready) || String(a.pn).localeCompare(String(b.pn))), [rows])
  const readyCnt = rows.filter(r => r.ready).length
  const hogiCnt = new Set(rows.map(r => r.prodId)).size

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-800">결품 현황</h1>
        <p className="text-xs text-slate-400 mt-0.5">불출 못 한 부품 모아보기 · 재불출은 출고 작업 화면에서</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-50 text-red-600">결품 {rows.length}건</span>
        <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-500">호기 {hogiCnt}대</span>
        <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700">입고됨 · 재불출 가능 {readyCnt}건</span>
      </div>

      {isLoading ? (
        <div className="border border-slate-200 rounded-xl"><p className="px-3 py-8 text-center text-sm text-slate-400">불러오는 중…</p></div>
      ) : rows.length === 0 ? (
        <div className="border border-slate-200 rounded-xl"><p className="px-3 py-8 text-center text-sm text-slate-400">결품이 없습니다 👍</p></div>
      ) : (
        <ResizableTable cols={MP_COLS} storageKey="missing_cols">
          {() => (
            <tbody>
              {sorted.map((r, i) => (
                <tr key={i} className={`border-t border-slate-100 ${r.ready ? 'bg-emerald-50/40' : ''}`}>
                  <td className="px-3 py-2 font-mono text-slate-500 overflow-hidden truncate">{r.pn}</td>
                  <td className="px-3 py-2 font-mono font-bold text-indigo-600 overflow-hidden truncate">{r.hogi}</td>
                  <td className="px-3 py-2 overflow-hidden truncate"><span className="font-mono font-semibold text-slate-700">{r.std_code}</span> <span className="text-slate-500">{r.name}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.need}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.stock <= 0 ? 'text-red-500' : 'text-slate-600'}`}>{r.stock}</td>
                  <td className="px-3 py-2">
                    {r.ready
                      ? <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700">재불출 가능</span>
                      : <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700">입고 대기</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </ResizableTable>
      )}
    </div>
  )
}
