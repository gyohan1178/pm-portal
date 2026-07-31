import { useState, useMemo } from 'react'
import { buildPurchaseReport } from '../lib/purchaseReport'
import AnalysisTabs from '../components/AnalysisTabs'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const CS_COLORS = {
  '에드워드': { light:'bg-rose-50',    border:'border-rose-200',    text:'text-rose-700',    hex:'#f43f5e' },
  'VM':       { light:'bg-emerald-50', border:'border-emerald-200', text:'text-emerald-700', hex:'#10b981' },
  'CSK':      { light:'bg-amber-50',   border:'border-amber-200',   text:'text-amber-700',   hex:'#f59e0b' },
  '엑셀리스':  { light:'bg-indigo-50',  border:'border-indigo-200',  text:'text-indigo-700',  hex:'#6366f1' },
  '하네스':    { light:'bg-sky-50',     border:'border-sky-200',     text:'text-sky-700',     hex:'#0ea5e9' },
  '기타':      { light:'bg-slate-50',   border:'border-slate-200',   text:'text-slate-600',   hex:'#94a3b8' },
}
const csColor = cs => CS_COLORS[cs] || { light:'bg-slate-50', border:'border-slate-200', text:'text-slate-600', hex:'#94a3b8' }
// 예상매입 관리 대상(확정+예상). 하네스·기타는 확정만.
const FORECAST_CS = ['에드워드','VM','CSK','엑셀리스']

async function fetchDashboard() {
  const year = new Date().getFullYear()

  // 확정매입 = ecount (회계 확정치)
  // 예상매입 = 결제(명세서) 기준.
  //   분할 결제 건은 명세서를 월별로 끊어 받으므로 ecount 확정매입도 그 달에 잡힌다.
  //   따라서 예상도 결제 계획이 있으면 그 달로 나눠야 확정과 대조가 맞는다.
  //   계획이 없는 발주는 납기 기준, 담당자 엑셀 입고예정도 함께 본다.
  const [ecountRes, pendingRes] = await Promise.all([
    supabase.rpc('pm_ecount_monthly', { p_year: year }),
    supabase.rpc('pm_pending_purchase_monthly', { p_year: year }).then(r => r).catch(() => ({ data: [] })),
  ])

  const monthlyMap = {}
  const csAmtMap = {}
  const addAmt = (m, cs, amt, type) => {
    if (!amt) return
    if (!monthlyMap[m]) monthlyMap[m] = { month: m }
    csAmtMap[cs] = csAmtMap[cs] || { name: cs, actual: 0, pending: 0 }
    if (type === 'actual') {
      monthlyMap[m].actual = (monthlyMap[m].actual || 0) + amt
      monthlyMap[m][cs] = (monthlyMap[m][cs] || 0) + amt
      csAmtMap[cs].actual += amt
    } else {
      monthlyMap[m].pending = (monthlyMap[m].pending || 0) + amt
      monthlyMap[m][cs + 'Pend'] = (monthlyMap[m][cs + 'Pend'] || 0) + amt
      csAmtMap[cs].pending += amt
    }
  }

  // 확정 (ecount) — 만원 단위로
  ;(ecountRes.data || []).forEach(r => {
    const m = `${r.year}-${String(r.month).padStart(2, '0')}`
    const amt = Math.round((r.supply_amt || 0) / 10000)
    addAmt(m, r.customer || '기타', amt, 'actual')
  })

  // 예상 (발주 미입고 잔량) — 입고 예정일이 속한 달에 반영
  ;(pendingRes.data || []).forEach(r => {
    const m = `${r.year}-${String(r.month).padStart(2, '0')}`
    const amt = Math.round((r.pending_amt || 0) / 10000)
    addAmt(m, r.customer || '기타', amt, 'pending')
  })

  const months = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month))
    .map(m => ({ ...m, label: m.month.slice(2, 4) + '.' + m.month.slice(5, 7) + '월' }))
  // 고객사 정렬: 확정 관리 대상 먼저, 그다음 금액순
  const order = ['에드워드','VM','CSK','엑셀리스','하네스','기타']
  const csChart = Object.values(csAmtMap).filter(c => c.actual + c.pending > 0)
    .sort((a, b) => {
      const ia = order.indexOf(a.name), ib = order.indexOf(b.name)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })

  return { months, csChart, monthlyMap }
}

const CS_LIST = ['에드워드','VM','CSK','엑셀리스','하네스','기타']
const fmt = v => (v/10000).toFixed(2)

// 보고서 파일로 저장 — 링크나 계정 없이 전달할 수 있게 한 파일로 만든다
function downloadReport(d, year) {
  const html = buildPurchaseReport({
    months: d.months, csChart: d.csChart, year, csList: CS_LIST,
  })
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `매입현황_${year}년${new Date().getMonth() + 1}월_${new Date().toISOString().slice(0, 10)}.html`
  a.click()
  URL.revokeObjectURL(url)
}

export default function PurchaseDashboard({ embed = false }) {
  // 숫자를 누르면 근거를 펼친다 — "이 달 매입이 왜 이 금액인가" 를 바로 확인
  const [detail, setDetail] = useState(null)   // { month, cs }
  const { data: d, isLoading } = useQuery({ queryKey:['purchaseDash'], queryFn: fetchDashboard, staleTime: 0, refetchOnMount: 'always' })

  if (isLoading) return <div className="text-center py-20 text-slate-400">불러오는 중...</div>
  if (!d) return null

  const totalActual = d.csChart.reduce((a,c)=>a+c.actual,0)
  const totalPending = d.csChart.reduce((a,c)=>a+c.pending,0)
  const grandTotal = totalActual + totalPending

  return (
    <div className="space-y-5 max-w-5xl mx-auto print-root">
      {!embed && <AnalysisTabs />}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 6mm; }
          aside, header, nav { display:none !important; }
          main { padding:0 !important; overflow:visible !important; }
          body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
          .no-print { display:none !important; }
          /* ── 1페이지 유지하되 PC 비율에 가깝게 (0.72→0.8, 폰트 축소 완화) ── */
          .print-root { zoom:0.8; }
          .print-root .space-y-5 > * + *, .print-root.space-y-5 > * + * { margin-top:8px !important; }
          .print-root .p-5 { padding:12px !important; }
          .print-root .p-4 { padding:10px !important; }
          .print-root .p-3 { padding:8px !important; }
          .print-root table { font-size:11px !important; }
          .print-root td, .print-root th { padding:3px 6px !important; }
          .print-root .recharts-responsive-container { height:160px !important; }
          .print-root .rounded-xl, .print-root tr { page-break-inside:avoid; }
        }
      `}</style>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-bold text-slate-900">💰 매입 대시보드</h1>
        <div className="flex items-center gap-2">
          <p className="text-xs text-slate-400">확정=ecount 회계확정 · 예상=결제(명세서) 기준 · 억원</p>
          {!embed && (
            <button onClick={() => downloadReport(d, new Date().getFullYear())}
              title="보고서 형식 HTML 파일로 저장 — 링크 없이 전달할 수 있습니다"
              className="no-print inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100">
              📄 보고서 저장
            </button>
          )}
          {!embed && <button onClick={() => window.print()} className="no-print inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg bg-slate-800 text-white hover:bg-slate-700">🖨️ 출력</button>}
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
      <div className="rounded-xl border border-slate-200 overflow-x-auto">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <p className="text-sm font-bold text-slate-700">월별 고객사별 매입 현황 (단위: 억원)</p>
          <p className="text-xs text-slate-400 mt-0.5">확정=ecount · 예상=결제 기준</p>
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
                        {((row[cs]||0)>0 || (row[cs+'Pend']||0)>0) ? (
                          <button onClick={()=>setDetail({ month: ri+1, cs })}
                            title="눌러서 이 숫자의 근거 보기"
                            className="hover:underline decoration-dotted underline-offset-2">
                            {(row[cs]||0)>0
                              ? <span className={`font-semibold ${csColor(cs).text}`}>{((row[cs]||0)/10000).toFixed(2)}</span>
                              : <span className="text-slate-300">-</span>}
                            {(row[cs+'Pend']||0)>0 && <span className="text-amber-400 ml-1">+{((row[cs+'Pend']||0)/10000).toFixed(2)}</span>}
                          </button>
                        ) : <span className="text-slate-300">-</span>}
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
      {detail && <BreakdownModal {...detail} onClose={()=>setDetail(null)} />}

    </div>
  )
}


// 숫자의 근거 — 확정(ecount)·결제계획·발주잔을 나눠 보여준다.
// 어느 항목이 얼마인지 보이면 "왜 이 금액인가" 를 바로 알 수 있다.
function BreakdownModal({ month, cs, onClose }) {
  const year = new Date().getFullYear()
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['purchaseBreakdown', year, month, cs],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_purchase_breakdown',
        { p_year: year, p_month: month, p_customer: cs })
      if (error) throw error
      return data || []
    },
  })

  const bySource = {}
  rows.forEach(r => { (bySource[r.source] = bySource[r.source] || []).push(r) })
  const total = rows.reduce((a, r) => a + Number(r.amount || 0), 0)
  const won = (v) => Math.round(Number(v) || 0).toLocaleString('ko-KR')

  const SRC = {
    '확정(ecount)': { c: 'border-emerald-300 bg-emerald-50', t: 'text-emerald-700', d: '회계 확정 · ecount 기준' },
    '결제계획':      { c: 'border-violet-300 bg-violet-50',  t: 'text-violet-700',  d: '분할 결제로 이 달에 배분된 금액' },
    '발주잔':        { c: 'border-amber-300 bg-amber-50',    t: 'text-amber-700',   d: '미입고 발주 · 납기 기준' },
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3.5 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400">{year}년 {month}월 · {cs}</p>
            <p className="text-xl font-bold text-slate-900">{won(total)}원</p>
          </div>
          <button onClick={onClose} className="text-slate-400 text-xl px-2">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {isLoading && <p className="text-center py-8 text-sm text-slate-400">불러오는 중…</p>}
          {!isLoading && !rows.length && (
            <p className="text-center py-8 text-sm text-slate-400">해당 내역이 없습니다.</p>
          )}

          {Object.entries(bySource).map(([src, list]) => {
            const st = SRC[src] || { c: 'border-slate-200 bg-slate-50', t: 'text-slate-600', d: '' }
            const sum = list.reduce((a, r) => a + Number(r.amount || 0), 0)
            return (
              <div key={src} className={`rounded-xl border-2 ${st.c} p-3`}>
                <div className="flex items-baseline justify-between mb-1">
                  <span className={`text-sm font-bold ${st.t}`}>{src}</span>
                  <span className="text-sm font-bold text-slate-800">{won(sum)}원</span>
                </div>
                {st.d && <p className="text-[11px] text-slate-500 mb-2">{st.d}</p>}
                <div className="space-y-1">
                  {list.slice(0, 12).map((r, i) => (
                    <div key={i} className="flex items-baseline justify-between text-xs">
                      <span className="text-slate-600 truncate max-w-[62%]" title={r.label}>
                        {r.label || '(미지정)'}
                        {r.cnt > 1 && <span className="text-slate-400"> · {r.cnt}건</span>}
                      </span>
                      <span className="font-semibold text-slate-700">{won(r.amount)}</span>
                    </div>
                  ))}
                  {list.length > 12 && (
                    <p className="text-[11px] text-slate-400 pt-1">외 {list.length - 12}건</p>
                  )}
                </div>
                {list.some(r => r.note) && (
                  <p className="mt-2 text-[11px] text-amber-700">
                    {[...new Set(list.map(r => r.note).filter(Boolean))].join(' · ')}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
