import { useState, useMemo } from 'react'
import AnalysisTabs from '../components/AnalysisTabs'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const CS_COLORS = {
  AXCELIS: { light:'bg-indigo-50', border:'border-indigo-200', text:'text-indigo-700', hex:'#6366f1' },
  Edwards: { light:'bg-rose-50',   border:'border-rose-200',   text:'text-rose-700',   hex:'#f43f5e' },
  VM:      { light:'bg-emerald-50',border:'border-emerald-200',text:'text-emerald-700',hex:'#10b981' },
  CSK:     { light:'bg-amber-50',  border:'border-amber-200',  text:'text-amber-700',  hex:'#f59e0b' },
}
const csColor = cs => CS_COLORS[cs] || { light:'bg-slate-50', border:'border-slate-200', text:'text-slate-600', hex:'#94a3b8' }

async function fetchDashboard() {
  const year = new Date().getFullYear()

  const [confirmedRes, rpcRes, portalRes] = await Promise.all([
    supabase.from('confirmed_purchases').select('year,month,customer,amount').eq('year', year).lte('month', 4),
    supabase.rpc('get_purchase_monthly', { year_val: year }),
    supabase.rpc('get_weekly_portal_ax', { p_from: year+'-01-01', p_to: year+'-12-31', p_year: year })
      .then(r=>r.data).catch(()=>({})),
  ])
  const AXN = 'AXCELIS'
  const portalAx = portalRes || {}

  const monthlyMap = {}
  const csAmtMap = {}
  const addAmt = (m, cs, amt, type) => {
    if (!monthlyMap[m]) monthlyMap[m] = { month: m }
    if (type === 'actual') {
      monthlyMap[m].actual = (monthlyMap[m].actual||0) + amt
      monthlyMap[m][cs] = (monthlyMap[m][cs]||0) + amt
      csAmtMap[cs] = csAmtMap[cs]||{name:cs,actual:0,pending:0}
      csAmtMap[cs].actual += amt
    } else {
      monthlyMap[m].pending = (monthlyMap[m].pending||0) + amt
      monthlyMap[m][cs+'Pend'] = (monthlyMap[m][cs+'Pend']||0) + amt
      csAmtMap[cs] = csAmtMap[cs]||{name:cs,actual:0,pending:0}
      csAmtMap[cs].pending += amt
    }
  }

  // confirmed_purchases 확정 월 파악 (동적)
  const maxConfirmedMonth = (confirmedRes.data||[]).reduce((max, r) => Math.max(max, r.month), 0)

  // 확정값 적용
  ;(confirmedRes.data||[]).forEach(r => {
    const m = `${r.year}-${String(r.month).padStart(2,'0')}`
    const cs = r.customer||'기타'
    const amt = Math.round((r.amount||0)/10000)
    if (amt) addAmt(m, cs, amt, 'actual')
  })

  // 확정 이후 월만 RPC 집계 사용 (중복 방지). AX는 포털로 대체하므로 제외.
  ;(rpcRes.data||[]).forEach(r => {
    const monthNum = parseInt(r.month.slice(5,7))
    if (monthNum <= maxConfirmedMonth) return
    const cs = r.customer||'기타'
    if (cs === AXN) return   // AXCELIS는 5월~ 포털값 사용
    const actualAmt = Math.round((r.actual_sum||0)/10000)
    const pendingAmt = Math.round((r.pending_sum||0)/10000)
    if (actualAmt) addAmt(r.month, cs, actualAmt, 'actual')
    if (pendingAmt) addAmt(r.month, cs, pendingAmt, 'pending')
  })

  // AXCELIS — 확정 이후 월은 포털 실데이터(입고×단가 / 진행중 발주)
  ;(portalAx.purchase||[]).forEach(r => {
    const m = (r.target_date||'').slice(0,7)
    if (!m || parseInt(m.slice(5,7)) <= maxConfirmedMonth) return
    const amt = Math.round((r.amount||0)/10000)
    if (amt) addAmt(m, AXN, amt, 'actual')
  })
  ;(portalAx.pending||[]).forEach(r => {
    const m = (r.target_date||'').slice(0,7)
    if (!m || parseInt(m.slice(5,7)) <= maxConfirmedMonth) return
    const amt = Math.round((r.amount||0)/10000)
    if (amt) addAmt(m, AXN, amt, 'pending')
  })

  const months = Object.values(monthlyMap).sort((a,b)=>a.month.localeCompare(b.month))
    .map(m => ({ ...m, label: m.month.slice(2,4)+'.'+m.month.slice(5,7)+'월' }))
  const csChart = Object.values(csAmtMap).filter(c=>c.actual+c.pending>0)

  return { months, csChart, monthlyMap }
}

const CS_LIST = ['AXCELIS','Edwards','VM','CSK']
const fmt = v => (v/10000).toFixed(2)

export default function PurchaseDashboard() {
  const { data: d, isLoading } = useQuery({ queryKey:['purchaseDash'], queryFn: fetchDashboard, staleTime: 0, refetchOnMount: 'always' })

  if (isLoading) return <div className="text-center py-20 text-slate-400">불러오는 중...</div>
  if (!d) return null

  const totalActual = d.csChart.reduce((a,c)=>a+c.actual,0)
  const totalPending = d.csChart.reduce((a,c)=>a+c.pending,0)
  const grandTotal = totalActual + totalPending

  return (
    <div className="space-y-5 max-w-5xl mx-auto print-root">
      <AnalysisTabs />
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 6mm; }
          aside, header, nav { display:none !important; }
          main { padding:0 !important; overflow:visible !important; }
          body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
          .no-print { display:none !important; }
          /* ── 1페이지 압축: 전체 축소 + 여백/폰트 다이어트 ── */
          .print-root { zoom:0.72; }
          .print-root .space-y-5 > * + *, .print-root.space-y-5 > * + * { margin-top:8px !important; }
          .print-root .p-5 { padding:10px !important; }
          .print-root .p-4 { padding:8px !important; }
          .print-root .p-3 { padding:6px !important; }
          .print-root .text-3xl { font-size:20px !important; }
          .print-root .text-2xl { font-size:16px !important; }
          .print-root .text-xl { font-size:14px !important; }
          .print-root table { font-size:9px !important; }
          .print-root td, .print-root th { padding:2px 6px !important; }
          .print-root .recharts-responsive-container { height:150px !important; }
          .print-root * { page-break-inside:avoid; }
        }
      `}</style>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-bold text-slate-900">💰 매입 대시보드</h1>
        <div className="flex items-center gap-2">
          <p className="text-xs text-slate-400">1~4월 이카운트 · AXCELIS 5월~ 포털 · 타사 업로드 · 억원</p>
          <button onClick={() => window.print()} className="no-print inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg bg-slate-800 text-white hover:bg-slate-700">🖨️ 출력</button>
        </div>
      </div>

      {/* 총합계 */}
      <div className="rounded-xl border-2 border-slate-700 bg-slate-50 p-5">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">올해 총 매입 예상금액</p>
        <p className="text-4xl font-bold text-slate-900 mb-3">{fmt(grandTotal)}<span className="text-lg text-slate-400 ml-1">억</span></p>
        <div className="flex gap-8">
          <div>
            <p className="text-xs text-slate-500 mb-0.5">✅ 매입 완료</p>
            <p className="text-2xl font-bold text-indigo-700">{fmt(totalActual)}<span className="text-xs ml-1 text-indigo-400">억</span></p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-0.5">📋 매입 예정</p>
            <p className="text-2xl font-bold text-amber-600">+{fmt(totalPending)}<span className="text-xs ml-1 text-amber-400">억</span></p>
          </div>
        </div>
      </div>

      {/* 고객사별 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {d.csChart.map(item => {
          const iTot = item.actual + item.pending
          const iPct = grandTotal > 0 ? Math.round(iTot/grandTotal*100) : 0
          return (
            <div key={item.name} className={`rounded-xl border-2 p-4 ${csColor(item.name).light} ${csColor(item.name).border}`}>
              <div className="flex items-start justify-between mb-2">
                <p className={`text-sm font-bold ${csColor(item.name).text}`}>{item.name}</p>
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${csColor(item.name).light} ${csColor(item.name).text} border ${csColor(item.name).border}`}>{iPct}%</span>
              </div>
              <p className={`text-xl font-bold ${csColor(item.name).text} mb-2`}>{fmt(iTot)}<span className="text-xs ml-0.5 opacity-60">억</span></p>
              <div className="border-t border-current border-opacity-20 pt-2 space-y-1">
                <div className="flex justify-between">
                  <span className="text-xs text-slate-400">✅ 완료</span>
                  <span className={`text-sm font-bold ${csColor(item.name).text}`}>{fmt(item.actual)}억</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-slate-400">📋 예정</span>
                  <span className="text-sm font-bold text-amber-600">+{fmt(item.pending)}억</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* 월별 바 차트 */}
      {d.months.length > 0 && (
        <div className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-slate-700">월별 고객사별 매입 추이</p>
            <div className="flex gap-3">
              {CS_LIST.map(cs => (
                <div key={cs} className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{background: csColor(cs).hex}}/>
                  <span className="text-xs text-slate-500">{cs}</span>
                </div>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={d.months} margin={{top:4,right:10,left:10,bottom:0}}>
              <XAxis dataKey="label" tick={{fontSize:10}}/>
              <YAxis tick={{fontSize:10}} tickFormatter={v=>v>=10000?`${(v/10000).toFixed(0)}억`:`${v}만`}/>
              <Tooltip formatter={(v,n)=>[`${v.toLocaleString()}만원`, n.endsWith('Pend')?n.replace('Pend','')+' 예정':n]} contentStyle={{fontSize:11,borderRadius:8}}/>
              {CS_LIST.map(cs=><Bar key={cs} dataKey={cs} name={cs} stackId="a" fill={csColor(cs).hex} radius={cs==='CSK'?[3,3,0,0]:[0,0,0,0]}/>)}
              {CS_LIST.map(cs=><Bar key={cs+'p'} dataKey={cs+'Pend'} name={cs+' 예정'} stackId="b" fill={csColor(cs).hex+'55'} radius={cs==='CSK'?[3,3,0,0]:[0,0,0,0]}/>)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 월별 표 */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <p className="text-sm font-bold text-slate-700">월별 고객사별 매입 현황 (단위: 억원)</p>
          <p className="text-xs text-slate-400 mt-0.5">1~4월 이카운트 · AXCELIS 5월~ 포털 · 타사 업로드</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left font-bold text-slate-500">월</th>
                {CS_LIST.map(cs=>(
                  <th key={cs} className="px-3 py-2 text-right whitespace-nowrap">
                    <span className={`font-bold ${csColor(cs).text}`}>{cs}</span>
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-bold text-slate-600">합계</th>
                <th className="px-3 py-2 text-right font-bold text-amber-600">예정</th>
              </tr>
            </thead>
            <tbody>
              {d.months.map((row, ri) => {
                const rTot = CS_LIST.reduce((a,cs)=>a+(row[cs]||0),0)
                const rPend = row.pending||0
                const isConf = parseInt(row.month.slice(5,7)) <= 4
                return (
                  <tr key={row.month} className={`border-b border-slate-100 ${ri%2===0?'':'bg-slate-50/30'}`}>
                    <td className="px-3 py-1.5 font-semibold text-slate-600 whitespace-nowrap">
                      {row.label}
                      
                    </td>
                    {CS_LIST.map(cs=>(
                      <td key={cs} className="px-3 py-1.5 text-right">
                        {(row[cs]||0)>0
                          ? <span className={`font-semibold ${csColor(cs).text}`}>{((row[cs]||0)/10000).toFixed(2)}</span>
                          : <span className="text-slate-300">-</span>}
                        {(row[cs+'Pend']||0)>0 && <span className="text-amber-400 ml-1">+{((row[cs+'Pend']||0)/10000).toFixed(2)}</span>}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right font-bold text-slate-800">
                      {rTot>0 ? (rTot/10000).toFixed(2) : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right text-amber-600 font-semibold">
                      {rPend>0 ? `+${(rPend/10000).toFixed(2)}` : <span className="text-slate-300">-</span>}
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                <td className="px-3 py-2 text-slate-700">연간 합계</td>
                {CS_LIST.map(csN=>{
                  const tot = d.months.reduce((a,m)=>a+(m[csN]||0),0)
                  const pend = d.months.reduce((a,m)=>a+(m[csN+'Pend']||0),0)
                  return (
                    <td key={csN} className="px-3 py-2 text-right">
                      <span className={csColor(csN).text}>{(tot/10000).toFixed(2)}억</span>
                      {pend>0 && <span className="text-amber-400 ml-1 text-xs font-normal">+{(pend/10000).toFixed(2)}</span>}
                    </td>
                  )
                })}
                <td className="px-3 py-2 text-right text-indigo-700">{(d.months.reduce((a,m)=>a+CS_LIST.reduce((b,cs)=>b+(m[cs]||0),0),0)/10000).toFixed(2)}억</td>
                <td className="px-3 py-2 text-right text-amber-600">+{(d.months.reduce((a,m)=>a+(m.pending||0),0)/10000).toFixed(2)}억</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
