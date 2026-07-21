import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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
  const [{ data: pos }, { data: css }, { data: sales }] = await Promise.all([
    supabase.from('purchase_orders')
      .select('id,customer_id,ccn,qty_ordered,unit_price,promise_date,order_date,status,issued')
      .eq('order_type','customer_po').limit(20000),
    supabase.from('customers').select('id,name'),
    supabase.from('pm_sales').select('part_no,qty,unit_price,ccn,promise_date,status_note,customer_code,updated_at').limit(20000),
  ])
  const csMap = Object.fromEntries((css||[]).map(c=>[c.id,c.name]))
  // 진행중 PO (예정 매출) — pm_sales에 실적이 있으니 완료건 중복 피하려 '완료' 아닌 것만
  const poRows = (pos||[]).filter(p=>p.status!=='완료').map(p=>({
    csName: csMap[p.customer_id]||'기타',
    month: (p.promise_date||p.order_date||'').slice(0,7),
    isUsd: (p.ccn||'').trim().toUpperCase() === 'B',
    baseAmount: (Number(p.qty_ordered)||0) * (Number(p.unit_price)||0),
    qty_ordered: p.qty_ordered, unit_price: p.unit_price,
    done: false,   // 예정
  })).filter(p=>p.month)
  // pm_sales (실매출, 납품완료) — 취소 제외
  const csCodeMap = { AX:'AXCELIS' }
  const saleRows = (sales||[]).filter(r=>r.status_note!=='발주 취소').map(r=>({
    csName: csCodeMap[r.customer_code]||r.customer_code||'AXCELIS',
    month: (r.promise_date||'').slice(0,7),
    isUsd: (r.ccn||'').trim().toUpperCase() === 'B',
    baseAmount: (Number(r.qty)||0) * (Number(r.unit_price)||0),
    qty_ordered: r.qty, unit_price: r.unit_price,
    done: true,    // 실매출(완료)
  })).filter(r=>r.month)
  const lastUpdated = (sales||[]).reduce((mx,r)=> r.updated_at>mx?r.updated_at:mx, '')
  return { rows: [...poRows, ...saleRows], lastUpdated }
}

export default function SalesDashboard() {
  const { data: fetched, isLoading } = useQuery({ queryKey:['salesDash'], queryFn: fetchSales })
  const rows = fetched?.rows || []
  const lastUpdated = fetched?.lastUpdated || ''
  const [year, setYear] = useState(String(new Date().getFullYear())) // 연도 선택
  const [fx, setFx] = useState(1400) // USD→KRW 환율 (키인)

  // 데이터에 존재하는 연도 목록 (드롭다운용)
  const years = useMemo(()=>{
    const ys = [...new Set(rows.map(r=>r.month.slice(0,4)).filter(Boolean))].sort().reverse()
    return ys.length ? ys : [String(new Date().getFullYear())]
  },[rows])

  const d = useMemo(()=>{
    // 환율 적용: 달러(CCN=B)는 fx 곱함, 원화는 그대로
    const amt = r => r.isUsd ? r.baseAmount * fx : r.baseAmount
    const csSet = [...new Set(rows.map(r=>r.csName))].sort()
    const byMonth = {}
    // 선택 연도의 1~12월 미리 생성 (빈 달도 0으로 표시)
    for (let m=1; m<=12; m++){
      const key = `${year}-${String(m).padStart(2,'0')}`
      byMonth[key] = { month:key, total:0, qty:0, done:0, pending:0, cnt:0 }
      csSet.forEach(cs=>{ byMonth[key][cs] = 0 })
    }
    rows.filter(r=>r.month.slice(0,4)===year).forEach(r=>{
      const a = amt(r)
      const b = byMonth[r.month]; if(!b) return
      b[r.csName] = (b[r.csName]||0) + a
      b.total += a
      b.qty += Number(r.qty_ordered)||0
      b.cnt += 1
      if (r.done) b.done += a       // 완료(실매출 = pm_sales)
      else b.pending += a           // 예정 (진행중 PO)
    })
    const months = Object.values(byMonth).sort((a,b)=>a.month.localeCompare(b.month))
      .map(m=>({ ...m, label:m.month.slice(5,7)+'월' }))
    const noPrice = rows.filter(r=>r.month.slice(0,4)===year && !r.unit_price).length
    const total = months.reduce((a,m)=>a+m.total,0)
    const doneTotal = months.reduce((a,m)=>a+m.done,0)
    const pendingTotal = months.reduce((a,m)=>a+m.pending,0)
    return { csSet, months, noPrice, total, doneTotal, pendingTotal }
  },[rows,year,fx])

  const tableRows = useMemo(()=>d.months.map(m=>({
    month:m.month, cnt:m.cnt, qty:m.qty, total:m.total, done:m.done, pending:m.pending, rate: m.total>0? Math.round(m.done/m.total*100):0
  })),[d])
  const { sorted, sortKey, sortDir, onSort } = useTableSort(tableRows, { defaultKey:'month', defaultDir:'asc' })

  const COLS = [
    { key:'month', label:'월',        defaultWidth:90 },
    { key:'cnt',   label:'PO 건수',   defaultWidth:80,  style:{textAlign:'right'} },
    { key:'qty',   label:'수량',      defaultWidth:90,  style:{textAlign:'right'} },
    { key:'total', label:'매출(억)',  defaultWidth:100, style:{textAlign:'right'} },
    { key:'done',  label:'완료(억)',  defaultWidth:100, style:{textAlign:'right'} },
    { key:'pending', label:'예정(억)', defaultWidth:100, style:{textAlign:'right'} },
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
          <p className="text-xs text-slate-400 mt-0.5">고객사 PO 기준 · 납기월 집계 · {year}년 합계 <b className="text-slate-600">{fmtEok(d.total)}억</b> <span className="text-emerald-600">(완료 {fmtEok(d.doneTotal)} · 예정 {fmtEok(d.pendingTotal)})</span>{lastUpdated && <span className="text-slate-300 ml-1">· 실적 갱신 {String(lastUpdated).slice(0,10)}</span>}</p>
        </div>
        <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg px-2 py-1.5">
          <span title="CCN=B(달러) PO에 적용">💱 USD</span>
          <input type="number" value={fx} onChange={e=>setFx(Number(e.target.value)||0)}
            className="w-16 text-right font-mono text-slate-900 outline-none" />
          <span className="text-slate-400">원</span>
        </label>
        <button onClick={() => window.print()} className="no-print inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg bg-slate-800 text-white hover:bg-slate-700">🖨️ 출력</button>
        <Link to="/sales/upload" className="no-print inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">📥 실적 업로드</Link>
        <select value={year} onChange={e=>setYear(e.target.value)}
          className="text-xs font-bold text-slate-900 bg-white border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500">
          {years.map(y=>(<option key={y} value={y}>{y}년</option>))}
        </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-bold text-slate-500">예상 매출 (전체)</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{fmtEok(d.total)}<span className="text-sm text-slate-400 ml-1">억</span></p>
          <p className="text-[11px] text-slate-400 mt-0.5">{year}년 PO 총액</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-bold text-emerald-600">기매출 (납품완료)</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{fmtEok(d.doneTotal)}<span className="text-sm text-slate-400 ml-1">억</span></p>
          <p className="text-[11px] text-slate-400 mt-0.5">완료·납품 처리된 금액</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-bold text-indigo-600">잔여 (진행중)</p>
          <p className="text-2xl font-bold text-indigo-700 mt-1">{fmtEok(d.total - d.doneTotal)}<span className="text-sm text-slate-400 ml-1">억</span></p>
          <p className="text-[11px] text-slate-400 mt-0.5">아직 납품 안 된 예정액</p>
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
            <Tooltip formatter={(v,n)=>[`${fmtEok(v)}억`, n]} labelFormatter={l=>`${year}년 ${l}`} />
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
                <td className="px-3 py-2 text-right tabular-nums text-indigo-500">{fmtEok(r.pending)}</td>
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
