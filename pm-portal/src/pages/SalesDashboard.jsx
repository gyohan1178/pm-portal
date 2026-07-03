import { useMemo, useState } from 'react'
import AnalysisTabs from '../components/AnalysisTabs'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { ResizableTable } from '../components/ResizableTable'
import { useTableSort } from '../hooks/useTableSort'

// 매출 대시보드 — 고객사 PO(order_type='customer_po') 기반 월별·고객사별 매출 현황
const CS_COLOR = { AXCELIS:'#4F46E5', Edwards:'#3B82F6', VM:'#059669', CSK:'#D97706' }
const csColor = n => CS_COLOR[n] || '#94a3b8'
const fmtEok = v => (v/1e8).toFixed(2)

async function fetchSales() {
  const [{ data: pos }, { data: css }] = await Promise.all([
    supabase.from('purchase_orders')
      .select('id,customer_id,qty_ordered,unit_price,promise_date,order_date,status,issued')
      .eq('order_type','customer_po').limit(20000),
    supabase.from('customers').select('id,name'),
  ])
  const csMap = Object.fromEntries((css||[]).map(c=>[c.id,c.name]))
  return (pos||[]).map(p=>({
    ...p,
    csName: csMap[p.customer_id]||'기타',
    month: (p.promise_date||p.order_date||'').slice(0,7),
    amount: (Number(p.qty_ordered)||0) * (Number(p.unit_price)||0),
  })).filter(p=>p.month)
}

export default function SalesDashboard() {
  const { data: rows = [], isLoading } = useQuery({ queryKey:['salesDash'], queryFn: fetchSales })
  const [range, setRange] = useState(12) // 최근 N개월

  const d = useMemo(()=>{
    const csSet = [...new Set(rows.map(r=>r.csName))].sort()
    const byMonth = {}
    rows.forEach(r=>{
      byMonth[r.month] ??= { month:r.month, total:0, qty:0, done:0, cnt:0 }
      csSet.forEach(cs=>{ byMonth[r.month][cs] ??= 0 })
      byMonth[r.month][r.csName] += r.amount
      byMonth[r.month].total += r.amount
      byMonth[r.month].qty += Number(r.qty_ordered)||0
      byMonth[r.month].cnt += 1
      if (r.issued || r.status==='완료') byMonth[r.month].done += r.amount
    })
    const months = Object.values(byMonth).sort((a,b)=>a.month.localeCompare(b.month)).slice(-range)
      .map(m=>({ ...m, label:m.month.slice(2,4)+'.'+m.month.slice(5,7) }))
    const noPrice = rows.filter(r=>!r.unit_price).length
    const total = months.reduce((a,m)=>a+m.total,0)
    return { csSet, months, noPrice, total }
  },[rows,range])

  const tableRows = useMemo(()=>d.months.map(m=>({
    month:m.month, cnt:m.cnt, qty:m.qty, total:m.total, done:m.done, rate: m.total>0? Math.round(m.done/m.total*100):0
  })),[d])
  const { sorted, sortKey, sortDir, onSort } = useTableSort(tableRows, { defaultKey:'month', defaultDir:'desc' })

  const COLS = [
    { key:'month', label:'월',        defaultWidth:90 },
    { key:'cnt',   label:'PO 건수',   defaultWidth:80,  style:{textAlign:'right'} },
    { key:'qty',   label:'수량',      defaultWidth:90,  style:{textAlign:'right'} },
    { key:'total', label:'매출(억)',  defaultWidth:100, style:{textAlign:'right'} },
    { key:'done',  label:'완료(억)',  defaultWidth:100, style:{textAlign:'right'} },
    { key:'rate',  label:'완료율',    defaultWidth:80,  style:{textAlign:'right'} },
  ]

  if (isLoading) return <div className="p-8 text-center text-sm text-slate-400">불러오는 중...</div>

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4 print-root">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 6mm; }
          aside, header, nav { display:none !important; }
          main { padding:0 !important; overflow:visible !important; }
          body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
          .no-print { display:none !important; }
          .print-root { zoom:0.72; }
          .print-root .p-4 { padding:8px !important; }
          .print-root .p-3 { padding:6px !important; }
          .print-root table { font-size:9px !important; }
          .print-root td, .print-root th { padding:2px 6px !important; }
          .print-root .recharts-responsive-container { height:150px !important; }
          .print-root * { page-break-inside:avoid; }
        }
      `}</style>
      <AnalysisTabs />
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">💼 매출 대시보드</h1>
          <p className="text-xs text-slate-400 mt-0.5">고객사 PO 기준 · 납기월 집계 · 최근 {range}개월 합계 <b className="text-slate-600">{fmtEok(d.total)}억</b></p>
        </div>
        <div className="flex items-center gap-2">
        <button onClick={() => window.print()} className="no-print inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg bg-slate-800 text-white hover:bg-slate-700">🖨️ 출력</button>
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
          {[6,12,24].map(n=>(
            <button key={n} onClick={()=>setRange(n)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md ${range===n?'bg-white text-slate-900 shadow-sm':'text-slate-500 hover:text-slate-700'}`}>{n}개월</button>
          ))}
        </div>
        </div>
      </div>

      {d.noPrice>0 && (
        <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠️ 단가 미입력 PO {d.noPrice}건은 0원으로 집계됨 — 고객사 PO에 단가를 채우면 정확해집니다.
        </p>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-bold text-slate-500 mb-2">월별 매출 (고객사 적층)</p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={d.months}>
            <XAxis dataKey="label" tick={{fontSize:11}} />
            <YAxis tickFormatter={v=>fmtEok(v)} tick={{fontSize:11}} width={44} />
            <Tooltip formatter={(v,n)=>[`${fmtEok(v)}억`, n]} labelFormatter={l=>`20${l.replace('.','년 ')}월`} />
            <Legend wrapperStyle={{fontSize:11}} />
            {d.csSet.map((cs,i)=>(
              <Bar key={cs} dataKey={cs} stackId="a" fill={csColor(cs)}
                radius={i===d.csSet.length-1?[3,3,0,0]:[0,0,0,0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ResizableTable cols={COLS} storageKey="sales_cols" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>
        {() => (
          <tbody className="divide-y divide-slate-100">
            {sorted.map(r=>(
              <tr key={r.month} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-mono font-semibold text-slate-700">{r.month}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.cnt}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.qty.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-slate-800">{fmtEok(r.total)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{fmtEok(r.done)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <span className={`font-bold ${r.rate>=80?'text-emerald-600':r.rate>=50?'text-amber-600':'text-slate-400'}`}>{r.rate}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        )}
      </ResizableTable>
    </div>
  )
}
