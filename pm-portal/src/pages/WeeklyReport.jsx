import { useState, useMemo, useEffect } from 'react'
import { toast, toastError, toastSuccess } from '../lib/toast'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import PurchaseDashboard from './PurchaseDashboard'

const CUSTOMERS = ['AXCELIS','Edwards','VM','CSK']

function getWeekRange(offset=0) {
  const now = new Date()
  const day = now.getDay()||7
  const mon = new Date(now); mon.setDate(now.getDate()-day+1+offset*7); mon.setHours(0,0,0,0)
  const sun = new Date(mon); sun.setDate(mon.getDate()+6)
  const fmt = d=>d.toISOString().split('T')[0]
  return { from:fmt(mon), to:fmt(sun), label:`${fmt(mon)} ~ ${fmt(sun)}` }
}

async function fetchWeeklyReport(from, to) {
  // 이번주 + 다음주 보고 가져오기
  const nextWeek = getWeekRange(1)
  // week_from 날짜 불일치 대비 ±3일 범위로 조회
  const fromD = new Date(from); fromD.setDate(fromD.getDate()-3)
  const toD = new Date(from); toD.setDate(toD.getDate()+3)
  const fromRange = fromD.toISOString().split('T')[0]
  const toRange = toD.toISOString().split('T')[0]
  const { data: allReports } = await supabase.from('weekly_reports')
    .select('id,week_from,submitted_by')
    .gte('week_from', fromRange)
    .lte('week_from', toRange)
    .order('week_from', { ascending: false })
  // 이번주 & 다음주
  const nextFromD = new Date(nextWeek.from); nextFromD.setDate(nextFromD.getDate()-3)
  const nextToD = new Date(nextWeek.from); nextToD.setDate(nextToD.getDate()+3)
  const { data: nextReports } = await supabase.from('weekly_reports')
    .select('id,week_from,submitted_by')
    .gte('week_from', nextFromD.toISOString().split('T')[0])
    .lte('week_from', nextToD.toISOString().split('T')[0])
  const reports = [...(allReports||[]), ...(nextReports||[])]
  const reportIds = (reports||[]).map(r=>r.id)

  // RPC로 입고/예정 집계 (row limit 우회)
  const { data: weekSummary } = await supabase.rpc('get_weekly_summary', {
    week_from: from, week_to: to,
    next_from: nextWeek.from, next_to: nextWeek.to,
  })
  const { data: items } = reportIds.length > 0
    ? await supabase.from('weekly_items').select('*').in('report_id', reportIds).in('category',['delay','outbound']).limit(2000)
    : { data:[] }

  const all = items||[]
  // ±3일 범위 내 이번주 보고 ID
  const thisWeekReportIds = new Set((allReports||[]).map(r=>r.id))
  const nextWeekReportIds = new Set((nextReports||[]).map(r=>r.id))

  // 캘린더 항목
  const nextW = getWeekRange(1)
  const { data: calItems } = await supabase.from('weekly_items')
    .select('*')
    .in('category',['schedule_outbound','schedule_consignment','special_note'])
    .gte('target_date', from)
    .lte('target_date', nextW.to)

  // 매입 데이터 - RPC 집계 (Supabase row limit 우회)
  const thisYear = new Date().getFullYear()
  const yearStart = thisYear + '-01-01'
  const yearEnd   = thisYear + '-12-31'
  const { data: summaryData } = await supabase.rpc('get_purchase_summary', {
    year_start: yearStart,
    year_end: yearEnd,
  })
  // RPC 결과를 purchaseData/pendingData 형태로 변환
  const purchaseData = (summaryData||[])
    .filter(r => r.actual_amt > 0)
    .map(r => ({ customer: r.customer, amount: r.actual_amt, target_date: r.month + '-01' }))
  const pendingData = (summaryData||[])
    .filter(r => r.pending_amt > 0)
    .map(r => ({ customer: r.customer, amount: r.pending_amt, target_date: r.month + '-01' }))

  // AX 포털 자동 집계 (업로드 대신 포털 실데이터)
  let portalAx = {}
  try {
    const { data: pax } = await supabase.rpc('get_weekly_portal_ax', {
      p_from: from, p_to: to, p_year: new Date(from).getFullYear(),
    })
    portalAx = pax || {}
  } catch { portalAx = {} }
  const AXN = portalAx.inbound?.[0]?.customer || portalAx.purchase?.[0]?.customer
            || portalAx.delay?.[0]?.customer || portalAx.pending?.[0]?.customer || 'AXCELIS'
  const notAx = arr => (arr||[]).filter(r => r.customer !== AXN)

  return {
    submitters: [...new Set((allReports||[]).map(r=>r.submitted_by))],
    inbound:  [...notAx((weekSummary||[]).filter(r=>r.category==='inbound')), ...(portalAx.inbound||[])],
    plan:     [...notAx((weekSummary||[]).filter(r=>r.category==='plan')), ...(portalAx.plan||[])],
    delay:    [...notAx((items||[]).filter(r=>r.category==='delay'&&thisWeekReportIds.has(r.report_id))), ...(portalAx.delay||[])],
    outbound: [...notAx((items||[]).filter(r=>r.category==='outbound'&&thisWeekReportIds.has(r.report_id))), ...(portalAx.outbound||[])],
    calItems: (calItems||[]).filter(r=>r.category!=='special_note'),
    specialNotes: (calItems||[]).filter(r=>r.category==='special_note').sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)),
    purchaseData: [...notAx(purchaseData), ...(portalAx.purchase||[])],
    pendingData:  [...notAx(pendingData), ...(portalAx.pending||[])],
  }
}

function SectionCard({ title, color, children, id, collapsed, onToggle, extra }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className={`px-4 py-3 border-b border-slate-200 ${color} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-slate-800">{title}</p>
          {extra}
        </div>
        {onToggle&&<button onClick={onToggle}
          className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded border border-slate-200 bg-white/60 no-print">
          {collapsed?'펼치기 ▾':'접기 ▴'}
        </button>}
      </div>
      {!collapsed&&children}
    </div>
  )
}

function ItemTable({ items, cols }) {
  if (!items||items.length===0)
    return <p className="text-xs text-slate-400 text-center py-6">데이터 없음</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr className="bg-slate-50 border-b border-slate-200">
          {cols.map(c=><th key={c.key} className="px-3 py-2 text-left font-bold text-slate-400 whitespace-nowrap">{c.label}</th>)}
        </tr></thead>
        <tbody>
          {items.map((r,i)=>(
            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
              {cols.map(c=>(
                <td key={c.key} className={`px-3 py-2 ${c.cls||'text-slate-600'}`}>
                  {c.render ? c.render(r) : r[c.key]||'-'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}


const DAYS_KO = ['월','화','수','목','금','토','일']
const CUSTOMERS_CAL = ['AXCELIS','Edwards','VM','CSK']
const CS_COLORS = {
  AXCELIS:  { bg:'bg-indigo-500', light:'bg-indigo-50', border:'border-indigo-200', text:'text-indigo-700', hex:'#6366f1' },
  Edwards:  { bg:'bg-rose-500',   light:'bg-rose-50',   border:'border-rose-200',   text:'text-rose-700',   hex:'#f43f5e' },
  VM:       { bg:'bg-emerald-500',light:'bg-emerald-50',border:'border-emerald-200',text:'text-emerald-700',hex:'#10b981' },
  CSK:      { bg:'bg-amber-500',  light:'bg-amber-50',  border:'border-amber-200',  text:'text-amber-700',  hex:'#f59e0b' },
}
const CS_COLOR_DEFAULT = { bg:'bg-slate-400', light:'bg-slate-50', border:'border-slate-200', text:'text-slate-600', hex:'#94a3b8' }
function csColor(cs) { return CS_COLORS[cs]||CS_COLOR_DEFAULT }

const CAT_COLORS = {
  schedule_outbound:     'bg-purple-50 border-purple-200 text-purple-700',
  schedule_consignment:  'bg-amber-50 border-amber-200 text-amber-700',
}
const CAT_LABEL = {
  schedule_outbound: '불출',
  schedule_consignment: '사급',
}

function getWeekDays(from) {
  return Array.from({length:7}, (_,i)=>{
    const d = new Date(from); d.setDate(d.getDate()+i)
    return d.toISOString().split('T')[0]
  }).filter(date => {
    const dow = new Date(date).getDay()
    return dow !== 0 && dow !== 6  // 일(0), 토(6) 제외
  })
}

export default function WeeklyReport() {
  const qc = useQueryClient()
  const [weekOffset, setWeekOffset] = useState(0)
  const week = useMemo(()=>getWeekRange(weekOffset),[weekOffset])
  const today = new Date()
  const nextWeek = useMemo(()=>getWeekRange(weekOffset+1),[weekOffset])



  // 캘린더 모달
  const [collapsed, setCollapsed] = useState({})
  const [noteInput, setNoteInput] = useState('')
  const [withDash, setWithDash] = useState(false)   // 출력에 매입 대시보드 포함
  const [checkedDelay, setCheckedDelay] = useState({})
  const [calModal, setCalModal] = useState(null) // { date, type }
  const [calForm, setCalForm] = useState({ customer:'AXCELIS', project:'', name:'', qty:'', note:'' })

  const updateItemMut = useMutation({
    mutationFn: async ({id, field, value}) => {
      const { error } = await supabase.from('weekly_items').update({[field]:value}).eq('id',id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['weeklyReport2']),
  })

  const deleteItemMut = useMutation({
    mutationFn: async (ids) => {
      const { error } = await supabase.from('weekly_items').delete().in('id', ids)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries(['weeklyReport2']); setCheckedDelay({}) },
    onError: e => toastError('오류: '+e.message),
  })

  const addNoteMut = useMutation({
    mutationFn: async (text) => {
      const { error } = await supabase.from('weekly_items').insert({
        category:'special_note', target_date:week.from, note:text, report_id:null,
      })
      if (error) throw error
    },
    onSuccess: () => { setNoteInput(''); qc.invalidateQueries(['weeklyReport2']) },
    onError: e => toastError('오류: '+e.message),
  })

  const deleteNoteMut = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('weekly_items').delete().eq('id',id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['weeklyReport2']),
    onError: e => toastError('오류: '+e.message),
  })

  const addCalMut = useMutation({
    mutationFn: async ({ date, type, editId }) => {
      if (editId) {
        // 수정
        const { error } = await supabase.from('weekly_items').update({
          customer: calForm.customer,
          project:  calForm.project||null,
          name:     calForm.name,
          qty:      calForm.qty?Number(calForm.qty):null,
          note:     calForm.note||null,
        }).eq('id', editId)
        if (error) throw error
      } else {
        // 신규
        const { error } = await supabase.from('weekly_items').insert({
          category: type==='outbound'?'schedule_outbound':'schedule_consignment',
          customer: calForm.customer,
          project:  calForm.project||null,
          name:     calForm.name,
          qty:      calForm.qty?Number(calForm.qty):null,
          target_date: date,
          note:     calForm.note||null,
          report_id: null,
        })
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries(['weeklyReport2'])
      setCalModal(null)
      setCalForm({ customer:'AXCELIS', project:'', name:'', qty:'', note:'', _customCs:false })
    },
    onError: e => toastError('오류: '+e.message),
  })

  const moveCalMut = useMutation({
    mutationFn: async ({id, newDate}) => {
      const { error } = await supabase.from('weekly_items').update({ target_date: newDate }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['weeklyReport2']),
  })

  const deleteCalMut = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('weekly_items').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['weeklyReport2']),
  })

  const { data:d, isLoading } = useQuery({
    queryKey:['weeklyReport2', week.from, week.to],
    queryFn:()=>fetchWeeklyReport(week.from, week.to),
  })

  function handlePrint() {
    const orig = document.title
    document.title = `구매자재팀_주간업무보고_${week.from}`
    window.print()
    setTimeout(()=>{ document.title = orig },1000)
  }

  if (isLoading) return <div className="text-center py-20 text-slate-400">불러오는 중...</div>

  const byCustomer = (items, key='customer') => {
    const map = {}
    // 안정 정렬: 요청일 → 품목코드 → id (입력/리페치 후에도 순서 고정)
    const sortKey = (r) => [
      r.target_date || '9999-99-99',
      r.pn || r.std_code || '',
      String(r.id || ''),
    ].join('|')
    CUSTOMERS.forEach(c=>{
      map[c] = items.filter(r=>r[key]===c).sort((a,b)=>sortKey(a)<sortKey(b)?-1:sortKey(a)>sortKey(b)?1:0)
    })
    return map
  }

  const inboundByCS   = byCustomer(d?.inbound||[])

  // 매입금액 집계 (weekly_items 기반)
  const monthlyMap = {}
  const csAmtMap = {}
  ;(d?.purchaseData||[]).forEach(r => {
    const m = (r.target_date||'').slice(0,7)
    if (!m || !r.amount) return
    const amt = Math.round(r.amount/10000)
    monthlyMap[m] = monthlyMap[m]||{month:m,actual:0,pending:0}
    monthlyMap[m].actual += amt
    const cs = r.customer||'기타'
    csAmtMap[cs] = csAmtMap[cs]||{name:cs,actual:0,pending:0}
    csAmtMap[cs].actual += amt
  })
  ;(d?.pendingData||[]).forEach(r => {
    const m = (r.target_date||'').slice(0,7)
    if (!m || !r.amount) return
    const amt = Math.round(r.amount/10000)
    monthlyMap[m] = monthlyMap[m]||{month:m,actual:0,pending:0}
    monthlyMap[m].pending += amt
    const cs = r.customer||'기타'
    csAmtMap[cs] = csAmtMap[cs]||{name:cs,actual:0,pending:0}
    csAmtMap[cs].pending += amt
  })
  const monthlyChart = Object.values(monthlyMap).sort((a,b)=>a.month.localeCompare(b.month)).slice(-12)
    .map(m=>({...m, label:m.month.slice(2,4)+'.'+m.month.slice(5,7)+'월'}))
  const csChart = Object.values(csAmtMap).filter(c=>c.actual+c.pending>0)
  const planByCS      = byCustomer(d?.plan||[])
  const delayByCS     = byCustomer(d?.delay||[])
  // 불출: 상위 품목(project) 기준으로 묶음 — 하위 부품 일일이 나열 안 함.
  // project 없는 수기 항목은 그대로 유지.
  const rollupOutbound = (rows) => {
    const groups = {}, standalone = []
    for (const r of (rows || [])) {
      const proj = (r.project || '').trim()
      if (!proj) { standalone.push(r); continue }
      const k = (r.customer || '') + '|' + proj
      if (!groups[k]) groups[k] = { customer: r.customer, project: proj, parts: 0, note: r.note || '' }
      groups[k].parts += 1
    }
    const grouped = Object.values(groups).map(g => ({
      customer: g.customer, project: g.project, pn: '', name: `부품 ${g.parts}종`, qty: '', note: g.note,
    }))
    return [...grouped, ...standalone]
  }
  const outboundByCS  = byCustomer(rollupOutbound(d?.outbound||[]))

  const inboundTotal  = (d?.inbound||[]).reduce((a,r)=>a+Number(r.total_qty||0),0)
  const inboundCount  = (d?.inbound||[]).reduce((a,r)=>a+Number(r.cnt||0),0)
  const planTotal     = (d?.plan||[]).reduce((a,r)=>a+Number(r.total_qty||0),0)
  const planCount     = (d?.plan||[]).reduce((a,r)=>a+Number(r.cnt||0),0)
  const delayCount    = (d?.delay||[]).length

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          html, body { height:auto !important; overflow:visible !important; }
          body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
          /* PC 화면 비율 유지 — 살짝만 축소 (폰트 강제축소 제거) */
          .print-zoom { zoom:0.9; }
          .no-print { display:none !important; }
          aside, header, nav { display:none !important; }
          main { padding:0 !important; overflow:visible !important; }
          .max-w-5xl { max-width:100% !important; }
          .overflow-x-auto { overflow:visible !important; }
          table { width:100% !important; table-layout:fixed !important; }
          th, td { white-space:normal !important; word-break:break-word !important; overflow:visible !important; }
          tr { page-break-inside:avoid !important; }
          .rounded-xl, .rounded-2xl { page-break-inside:avoid !important; }
          .print-show { display:block !important; }
          .no-print-dashboard { display:none !important; }
          .print-page-break { page-break-before:always !important; break-before:page !important; }
        }
      `}</style>
      <div className="space-y-4 max-w-5xl mx-auto print-zoom">
        {/* 컨트롤 */}
        <div className="flex items-center gap-2 no-print flex-wrap">
          <button onClick={()=>setWeekOffset(v=>v-1)} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">← 전주</button>
          <button onClick={()=>setWeekOffset(0)} className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${weekOffset===0?'border-indigo-500 bg-indigo-50 text-indigo-700':'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>이번 주</button>
          <button onClick={()=>setWeekOffset(v=>v+1)} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">다음 주 →</button>
          <span className="text-xs text-slate-400 font-mono ml-1">{week.label}</span>
          {d?.submitters?.length>0&&(
            <div className="flex items-center gap-1 ml-2">
              {d.submitters.map(s=><span key={s} className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-semibold">{s} ✓</span>)}
            </div>
          )}
          <div className="flex-1"/>
          <div className="flex items-center gap-2 no-print">
            <button onClick={()=>setWithDash(v=>!v)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border transition-all ${withDash?'border-indigo-500 bg-indigo-600 text-white shadow-sm':'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              💰 대시보드 {withDash?'포함됨':'포함'}
            </button>
            <button onClick={handlePrint} className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg bg-slate-800 text-white hover:bg-slate-700">🖨️ 출력</button>
            <Link to="/weekly/upload" className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">📤 업로드</Link>
          </div>
        </div>

        {/* 헤더 — 그라데이션 배너 */}
        <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-900 p-5 flex items-center justify-between shadow-lg">
          <div>
            <p className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest mb-1">Weekly Report</p>
            <h1 className="text-xl font-bold text-white">구매자재 주간업무보고</h1>
            <p className="text-xs text-slate-400 mt-1 font-mono">{week.label}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold text-slate-300">진선테크 구매자재</p>
            <p className="text-[11px] text-slate-500 mt-0.5 font-mono">작성일 {today.toISOString().split('T')[0]}</p>
          </div>
        </div>

        {/* 캘린더 — 이번주 + 다음주 */}
        {(() => {
          const thisWeekDays = getWeekDays(week.from)
          const nextWeekDays = getWeekDays(nextWeek.from)
          const calItems = d?.calItems||[]
          const todayStr = today.toISOString().split('T')[0]

          function openEdit(item) {
                setCalModal({ date: item.target_date, type: item.category==='schedule_outbound'?'outbound':'consignment', editId: item.id })
                setCalForm({ customer:item.customer||'AXCELIS', project:item.project||'', name:item.name||'', qty:item.qty||'', note:item.note||'', _customCs:false })
              }
          function DayCol({ item }) {
            return (
              <div draggable
                onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData('itemId',item.id)}}
                onDragEnd={e=>e.preventDefault()}
                className={`rounded border px-1.5 py-0.5 text-xs group cursor-grab active:cursor-grabbing ${csColor(item.customer).light} ${csColor(item.customer).border}`}
                onClick={()=>openEdit(item)}>
                <div className="flex items-center justify-between gap-1">
                  <p className={`truncate leading-snug ${csColor(item.customer).text}`}>
                    {item.customer&&<span className="font-semibold">{item.customer}</span>}
                    {item.project&&<span className="ml-1 opacity-70">{item.project}</span>}
                    {item.name&&<span className="ml-1">{item.name}</span>}
                    {item.qty&&<span className="ml-1 font-bold">{Number(item.qty).toLocaleString()}</span>}
                  </p>
                  <button onClick={e=>{e.stopPropagation();if(window.confirm('삭제?'))deleteCalMut.mutate(item.id)}}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 flex-shrink-0 no-print text-xs ml-1">×</button>
                </div>
              </div>
            )
          }

          return (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              {/* 이번 주 */}
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700">이번 주</span>
                <span className="text-xs text-slate-400">{week.label}</span>
              </div>
              {/* 이번주 날짜 헤더 */}
              <div className="flex border-b border-slate-100">
                {thisWeekDays.map(date=>{
                  const isToday=date===todayStr; const di=new Date(date).getDay()
                  return <div key={date} className={`w-1/5 border-r border-slate-100 last:border-0 px-2 py-1 ${isToday?'bg-indigo-100/50':''}`}>
                    <span className={`text-xs font-bold ${isToday?'text-indigo-600':'text-slate-600'}`}>{DAYS_KO[di===0?6:di-1]} {date.slice(8)}</span>
                  </div>
                })}
              </div>
              {/* 이번주 불출 행 */}
              <div className="flex border-b border-slate-100">
                {thisWeekDays.map(date=>{
                  const items=calItems.filter(r=>r.target_date===date&&r.category==='schedule_outbound')
                  const isToday=date===todayStr
                  return <div key={date} onDragOver={e=>e.preventDefault()}
                    onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData('itemId');if(id)moveCalMut.mutate({id,newDate:date})}}
                    className={`w-1/5 border-r border-slate-100 last:border-0 ${isToday?'bg-indigo-50/20':''}`}>
                    <div className="flex items-center justify-between px-1.5 py-0.5 bg-purple-50/50">
                      <span className="text-xs font-bold text-purple-500">불출</span>
                      <button onClick={()=>{setCalModal({date,type:'outbound'});setCalForm({customer:'AXCELIS',project:'',name:'',qty:'',note:'',_customCs:false})}} className="text-xs text-purple-400 hover:text-purple-600 font-bold no-print">＋</button>
                    </div>
                    <div className="p-1 space-y-0.5 min-h-[36px]">
                      {items.map(item=><DayCol key={item.id} item={item}/>)}
                    </div>
                  </div>
                })}
              </div>
              {/* 이번주 사급 행 */}
              <div className="flex border-b border-slate-200">
                {thisWeekDays.map(date=>{
                  const items=calItems.filter(r=>r.target_date===date&&r.category==='schedule_consignment')
                  const isToday=date===todayStr
                  return <div key={date} onDragOver={e=>e.preventDefault()}
                    onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData('itemId');if(id)moveCalMut.mutate({id,newDate:date})}}
                    className={`w-1/5 border-r border-slate-100 last:border-0 ${isToday?'bg-indigo-50/20':''}`}>
                    <div className="flex items-center justify-between px-1.5 py-0.5 bg-amber-50/50">
                      <span className="text-xs font-bold text-amber-500">사급</span>
                      <button onClick={()=>{setCalModal({date,type:'consignment'});setCalForm({customer:'AXCELIS',project:'',name:'',qty:'',note:'',_customCs:false})}} className="text-xs text-amber-400 hover:text-amber-600 font-bold no-print">＋</button>
                    </div>
                    <div className="p-1 space-y-0.5 min-h-[24px]">
                      {items.map(item=><DayCol key={item.id} item={item}/>)}
                    </div>
                  </div>
                })}
              </div>
              {/* 다음 주 */}
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700">다음 주</span>
                <span className="text-xs text-slate-400">{nextWeek.label}</span>
              </div>
              {/* 다음주 날짜 헤더 */}
              <div className="flex border-b border-slate-100">
                {nextWeekDays.map(date=>{
                  const di=new Date(date).getDay()
                  return <div key={date} className="w-1/5 border-r border-slate-100 last:border-0 px-2 py-1">
                    <span className="text-xs font-bold text-slate-600">{DAYS_KO[di===0?6:di-1]} {date.slice(8)}</span>
                  </div>
                })}
              </div>
              {/* 다음주 불출 행 */}
              <div className="flex border-b border-slate-100">
                {nextWeekDays.map(date=>{
                  const items=calItems.filter(r=>r.target_date===date&&r.category==='schedule_outbound')
                  return <div key={date} onDragOver={e=>e.preventDefault()}
                    onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData('itemId');if(id)moveCalMut.mutate({id,newDate:date})}}
                    className="w-1/5 border-r border-slate-100 last:border-0">
                    <div className="flex items-center justify-between px-1.5 py-0.5 bg-purple-50/50">
                      <span className="text-xs font-bold text-purple-500">불출</span>
                      <button onClick={()=>{setCalModal({date,type:'outbound'});setCalForm({customer:'AXCELIS',project:'',name:'',qty:'',note:'',_customCs:false})}} className="text-xs text-purple-400 hover:text-purple-600 font-bold no-print">＋</button>
                    </div>
                    <div className="p-1 space-y-0.5 min-h-[36px]">
                      {items.map(item=><DayCol key={item.id} item={item}/>)}
                    </div>
                  </div>
                })}
              </div>
              {/* 다음주 사급 행 */}
              <div className="flex">
                {nextWeekDays.map(date=>{
                  const items=calItems.filter(r=>r.target_date===date&&r.category==='schedule_consignment')
                  return <div key={date} onDragOver={e=>e.preventDefault()}
                    onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData('itemId');if(id)moveCalMut.mutate({id,newDate:date})}}
                    className="w-1/5 border-r border-slate-100 last:border-0">
                    <div className="flex items-center justify-between px-1.5 py-0.5 bg-amber-50/50">
                      <span className="text-xs font-bold text-amber-500">사급</span>
                      <button onClick={()=>{setCalModal({date,type:'consignment'});setCalForm({customer:'AXCELIS',project:'',name:'',qty:'',note:'',_customCs:false})}} className="text-xs text-amber-400 hover:text-amber-600 font-bold no-print">＋</button>
                    </div>
                    <div className="p-1 space-y-0.5 min-h-[24px]">
                      {items.map(item=><DayCol key={item.id} item={item}/>)}
                    </div>
                  </div>
                })}
              </div>
            </div>
          )
        })()}

        {/* 캘린더 입력 모달 */}
        {calModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print p-4" onClick={()=>setCalModal(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-80 p-5" onClick={e=>e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    {calModal.editId?'✏️ 수정 — ':''}{calModal.type==='outbound'?'📤 자재 불출':'📦 사급자재 조달'}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{calModal.date}</p>
                </div>
                <button onClick={()=>setCalModal(null)} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-500">고객사</label>
                    <button type="button" onClick={()=>setCalForm(f=>({...f,_customCs:!f._customCs,customer:''}))}
                      className="text-xs text-indigo-400 hover:text-indigo-600">
                      {calForm._customCs?'목록 선택':'직접 입력'}
                    </button>
                  </div>
                  {calForm._customCs
                    ? <input value={calForm.customer} onChange={e=>setCalForm(f=>({...f,customer:e.target.value}))}
                        placeholder="고객사명 직접 입력"
                        className="w-full px-3 py-2 text-sm border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                    : <select value={calForm.customer} onChange={e=>setCalForm(f=>({...f,customer:e.target.value}))}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="">선택</option>
                        {CUSTOMERS_CAL.map(c=><option key={c}>{c}</option>)}
                      </select>
                  }
                </div>
                {calModal.type==='outbound'&&(
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">프로젝트</label>
                    <input value={calForm.project} onChange={e=>setCalForm(f=>({...f,project:e.target.value}))} placeholder="프로젝트명"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">내용 *</label>
                  <input value={calForm.name} onChange={e=>setCalForm(f=>({...f,name:e.target.value}))}
                    placeholder={calModal.type==='outbound'?'불출 내용':'사급 품목/내용'}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">수량</label>
                  <input type="number" value={calForm.qty} onChange={e=>setCalForm(f=>({...f,qty:e.target.value}))} placeholder="0"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">비고</label>
                  <input value={calForm.note} onChange={e=>setCalForm(f=>({...f,note:e.target.value}))} placeholder="비고"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={()=>setCalModal(null)}
                  className="flex-1 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">취소</button>
                <button onClick={()=>addCalMut.mutate(calModal)}
                  disabled={!calForm.name||addCalMut.isPending}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg text-white disabled:opacity-40
                    ${calModal.type==='outbound'?'bg-purple-600 hover:bg-purple-700':'bg-amber-600 hover:bg-amber-700'}`}>
                  {addCalMut.isPending?(calModal.editId?'수정 중...':'추가 중...'):(calModal.editId?'수정 완료':'추가')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* KPI */}
        <div className="grid grid-cols-1 sm:grid-cols-3 print:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center text-xs">📦</span>
              <p className="text-[11px] font-bold text-emerald-600 uppercase tracking-wide">이번 주 입고</p>
            </div>
            <p className="text-3xl font-bold text-slate-900">{inboundCount}<span className="text-base ml-1 text-slate-400 font-medium">건</span></p>
            <p className="text-xs text-slate-400 mt-1">총 {inboundTotal.toLocaleString()}개</p>
          </div>
          <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-6 h-6 rounded-lg bg-blue-100 flex items-center justify-center text-xs">📋</span>
              <p className="text-[11px] font-bold text-blue-600 uppercase tracking-wide">차주 입고 예정</p>
            </div>
            <p className="text-3xl font-bold text-slate-900">{planCount}<span className="text-base ml-1 text-slate-400 font-medium">건</span></p>
            <p className="text-xs text-slate-400 mt-1">총 {planTotal.toLocaleString()}개</p>
          </div>
          <div className={`rounded-2xl border p-4 shadow-sm ${delayCount>0?'border-red-200 bg-gradient-to-br from-red-50 to-white':'border-slate-100 bg-gradient-to-br from-slate-50 to-white'}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs ${delayCount>0?'bg-red-100':'bg-slate-100'}`}>{delayCount>0?'🚨':'✅'}</span>
              <p className={`text-[11px] font-bold uppercase tracking-wide ${delayCount>0?'text-red-600':'text-slate-500'}`}>납기 지연</p>
            </div>
            <p className="text-3xl font-bold text-slate-900">{delayCount}<span className="text-base ml-1 text-slate-400 font-medium">건</span></p>
            <p className="text-xs text-slate-400 mt-1">제출: {d?.submitters?.length||0}명</p>
          </div>
        </div>

        {/* 납기 지연 */}
        {(() => {
          const isStored = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id||''))
          const checkedIds = Object.entries(checkedDelay).filter(([,v])=>v).map(([k])=>k).filter(isStored)
          return (
            <SectionCard title="🚨 납기 지연 품목" color="bg-red-50"
              collapsed={collapsed['delay']}
              onToggle={()=>setCollapsed(v=>({...v,delay:!v['delay']}))}
              extra={
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-500 font-semibold">{delayCount}건</span>
                  {checkedIds.length>0&&(
                    <button onClick={()=>{ if(window.confirm(`선택 ${checkedIds.length}건 삭제할까요?`)) deleteItemMut.mutate(checkedIds) }}
                      className="text-xs font-bold px-2 py-0.5 rounded border border-red-300 text-red-600 bg-red-50 hover:bg-red-100 no-print">
                      선택 삭제 ({checkedIds.length})
                    </button>
                  )}
                </div>
              }>
              {CUSTOMERS.map(cs=>(delayByCS[cs]?.length>0&&(
                <div key={cs}>
                  <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-600">{cs}</span>
                      <span className="ml-2 text-xs text-red-500 font-semibold">{delayByCS[cs].length}건</span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-2 py-2 no-print w-6">
                          <input type="checkbox"
                            checked={delayByCS[cs].filter(r=>isStored(r.id)).length>0 && delayByCS[cs].filter(r=>isStored(r.id)).every(r=>checkedDelay[r.id])}
                            onChange={e=>setCheckedDelay(v=>({...v,...Object.fromEntries(delayByCS[cs].filter(r=>isStored(r.id)).map(r=>[r.id,e.target.checked]))}))}
                            className="w-3.5 h-3.5 accent-red-500"/>
                        </th>
                        {['품목코드','구매처','제조사','제조사품번','수량','요청일','현황','대책'].map(h=>(
                          <th key={h} className="px-3 py-2 text-left font-bold text-slate-400 whitespace-nowrap">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {delayByCS[cs].map((r,i)=>(
                          <tr key={r.id||i} className={`border-b border-slate-100 ${checkedDelay[r.id]?'bg-emerald-50/30':'hover:bg-red-50/20'}`}>
                            <td className="px-2 py-1.5 no-print">
                              {isStored(r.id) && <input type="checkbox" checked={!!checkedDelay[r.id]}
                                onChange={e=>setCheckedDelay(v=>({...v,[r.id]:e.target.checked}))}
                                className="w-3.5 h-3.5 accent-emerald-500"/>}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-indigo-600">{r.pn||'-'}</td>
                            <td className="px-3 py-1.5 text-slate-600">{r.vendor||'-'}</td>
                            <td className="px-3 py-1.5 text-slate-500">{r.manufacturer||'-'}</td>
                            <td className="px-3 py-1.5 font-mono text-slate-400">{r.manufacturer_pn||'-'}</td>
                            <td className="px-3 py-1.5 text-right font-bold text-red-600">{r.qty||'-'}</td>
                            <td className="px-3 py-1.5 font-mono text-red-400 whitespace-nowrap">
                              {r.target_date||'-'}
                              {r.target_date && (()=>{ const dd=Math.floor((today-new Date(r.target_date))/86400000); return dd>0?<span className="ml-1 px-1 rounded bg-red-100 text-red-600 text-[10px] font-bold">D+{dd}</span>:null })()}
                            </td>
                            <td className="px-3 py-1.5">
                              <input defaultValue={r.situation||''} placeholder="현황 입력"
                                onBlur={e=>{ if(r.id) updateItemMut.mutate({id:r.id,field:'situation',value:e.target.value}) }}
                                className="w-full px-1.5 py-0.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"/>
                            </td>
                            <td className="px-3 py-1.5">
                              <input defaultValue={r.countermeasure||''} placeholder="대책 입력"
                                onBlur={e=>{ if(r.id) updateItemMut.mutate({id:r.id,field:'countermeasure',value:e.target.value}) }}
                                className="w-full px-1.5 py-0.5 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"/>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )))}
              {(d?.delay||[]).length===0&&<p className="text-xs text-slate-400 text-center py-6">지연 없음 ✓</p>}
            </SectionCard>
          )
        })()}

        {/* 자재 불출 */}
        {(d?.outbound||[]).length>0&&(
          <SectionCard title="📤 자재 불출 현황" color="bg-purple-50"
            collapsed={collapsed['outbound']}
            onToggle={()=>setCollapsed(v=>({...v,outbound:!v['outbound']}))}>
            {CUSTOMERS.map(cs=>(outboundByCS[cs]?.length>0&&(
              <div key={cs}>
                <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-100">
                  <span className="text-xs font-bold text-slate-600">{cs}</span>
                </div>
                <ItemTable items={outboundByCS[cs]} cols={[
                  {key:'project', label:'프로젝트', cls:'font-mono text-slate-600'},
                  {key:'pn',      label:'품목코드', cls:'font-mono text-indigo-600'},
                  {key:'name',    label:'품명'},
                  {key:'qty',     label:'수량', cls:'text-right font-bold text-purple-700'},
                  {key:'note',    label:'비고', cls:'text-slate-400'},
                ]}/>
              </div>
            )))}
          </SectionCard>
        )}

        {/* 특이사항 */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <p className="text-sm font-bold text-slate-700">📝 특이사항</p>
          </div>
          <div className="p-3 space-y-2">
            {(d?.specialNotes||[]).length===0
              ? <p className="text-xs text-slate-400 py-1">특이사항 없음</p>
              : (d?.specialNotes||[]).map((item,idx)=>(
                <div key={item.id} className="flex items-start gap-2 group">
                  <span className="text-xs font-bold text-slate-400 mt-0.5 w-4 flex-shrink-0">{idx+1}.</span>
                  <p className="text-sm text-slate-700 flex-1">{item.note}</p>
                  <button onClick={()=>deleteNoteMut.mutate(item.id)}
                    className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 flex-shrink-0 no-print text-sm px-1">×</button>
                </div>
              ))
            }
            <div className="flex gap-2 no-print pt-1 border-t border-slate-100">
              <input value={noteInput} onChange={e=>setNoteInput(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter'&&noteInput.trim()){addNoteMut.mutate(noteInput.trim())}}}
                placeholder="특이사항 입력 후 Enter 또는 추가"
                className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
              <button onClick={()=>{if(noteInput.trim()) addNoteMut.mutate(noteInput.trim())}}
                disabled={!noteInput.trim()||addNoteMut.isPending}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">추가</button>
            </div>
          </div>
        </div>

      </div>

      {/* 매입 대시보드 포함 출력 — print-zoom 밖(zoom 중첩 방지)이라 페이지 나눔 확실히 동작 */}
      {withDash && (
        <div className="print-page-break pt-4 max-w-5xl mx-auto">
          <div className="flex items-center gap-2 mb-2 no-print">
            <div className="h-px flex-1 bg-slate-200"/>
            <span className="text-xs font-bold text-slate-400">⬇ 출력 시 아래 대시보드가 다음 페이지에 포함됩니다</span>
            <div className="h-px flex-1 bg-slate-200"/>
          </div>
          <PurchaseDashboard embed />
        </div>
      )}
    </>
  )
}
