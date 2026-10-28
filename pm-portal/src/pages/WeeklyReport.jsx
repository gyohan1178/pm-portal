import { useState, useMemo, useEffect } from 'react'
import { toast, toastError, toastSuccess } from '../lib/toast'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import PurchaseDashboard from './PurchaseDashboard'
import { ymdKST } from '../lib/utils'
import { fetchWeekRequests, summarizeRequests } from '../lib/weeklyRequest'
import { SkelBar } from '../components/ux/Skeleton'
import { useConfirm } from '../components/ux/ConfirmDialog'
import InfoTip from '../components/ux/InfoTip'
import Spin from '../components/ux/Spin'

const CUSTOMERS = ['AXCELIS','Edwards','VM','CSK']

const dayBefore = (ymd) => { const [y,m,d] = ymd.split('-').map(Number); const t = new Date(y, m-1, d-1); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}` }

function getWeekRange(offset=0) {
  const now = new Date()
  const day = now.getDay()||7
  const mon = new Date(now); mon.setDate(now.getDate()-day+1+offset*7); mon.setHours(0,0,0,0)
  const sun = new Date(mon); sun.setDate(mon.getDate()+6)
  // ⚠ 한국 시간 자정을 toISOString(UTC)으로 바꾸면 하루 앞 날짜가 된다 (월요일 → 일요일).
  //   그래서 주 범위가 일~토로 나갔다 → 이 PC 날짜 그대로 적는다 (월~일). (2026-10-02)
  const fmt = d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  return { from:fmt(mon), to:fmt(sun), label:`${fmt(mon)} ~ ${fmt(sun)}` }
}

// 보고 있는 주(from) 기준 다음 주 — 예전엔 오늘 기준으로 고정이라 「다음 주 →」로 넘기면 캘린더가 비었다 (2026-10-08)
const ymdLocal = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const addDaysYmd = (ymd, n) => { const d = new Date(String(ymd).slice(0,10) + 'T12:00:00'); d.setDate(d.getDate() + n); return ymdLocal(d) }
export const nextWeekOf = (from) => ({ from: addDaysYmd(from, 7), to: addDaysYmd(from, 13) })

async function fetchWeeklyReport(from, to) {
  // 이번주 + 다음주 보고 가져오기
  const nextWeek = nextWeekOf(from)
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
  const nextW = nextWeek
  const { data: calItems } = await supabase.from('weekly_items')
    .select('*')
    .in('category',['schedule_outbound','schedule_consignment','special_note'])
    // 특이사항은 주 시작일로 저장된다. 예전(일요일 시작)에 적은 것도 보이게 하루 앞부터 읽는다.
    .gte('target_date', dayBefore(from))
    .lte('target_date', nextW.to)

  // 포털 자동 집계.
  //   ⚠ 예전에는 AXCELIS 만 자동이고 나머지는 사람이 적어야 떴다.
  //     그래서 납기 지연 64건 중 61건(Edwards 53 · CSK 8)이 안 보였다.
  //     이제 네 고객사를 다 자동으로 집계한다.
  let portal = {}
  try {
    const { data: pall } = await supabase.rpc('get_weekly_portal_all', {
      p_from: from, p_to: to, p_year: new Date(from).getFullYear(),
    })
    portal = pall || {}
  } catch {
    // 새 함수가 아직 없으면 예전 방식(AX 만)으로 물러난다
    try {
      const { data: pax } = await supabase.rpc('get_weekly_portal_ax', {
        p_from: from, p_to: to, p_year: new Date(from).getFullYear(),
      })
      portal = pax || {}
    } catch { portal = {} }
  }
  // 손으로 적은 것은 「직접 입력」으로 표시해 자동분과 갈라 본다.
  //   자동과 겹치면 눈에 보이므로 수기 쪽을 지우면 된다.
  const manual = arr => (arr||[]).map(r => ({ ...r, _manual: true }))

  // 그 주 자재요청 대응 (불출 · 발주) — 못 읽으면 숨기지 않고 「못 불러옴」으로 알린다 (v4.68.0)
  let reqSum = null, reqErr = ''
  try { reqSum = summarizeRequests(await fetchWeekRequests(supabase, from, to)) }
  catch (e) { reqErr = e?.message || String(e) }

  return {
    submitters: [...new Set((allReports||[]).map(r=>r.submitted_by))],
    // 자동 집계가 기준. 수기 입력은 「직접 입력」 표시로 함께 보여 준다.
    inbound:  [...(portal.inbound||[])],
    plan:     [...(portal.plan||[])],
    delay:    [...(portal.delay||[]),
               ...manual((items||[]).filter(r=>r.category==='delay'&&thisWeekReportIds.has(r.report_id)))],
    outbound: [...(portal.outbound||[]),
               ...manual((items||[]).filter(r=>r.category==='outbound'&&thisWeekReportIds.has(r.report_id)))],
    calItems: (calItems||[]).filter(r=>r.category!=='special_note'),
    specialNotes: (calItems||[]).filter(r=>r.category==='special_note').sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)),
    reqSum, reqErr,
    purchaseData: [...(portal.purchase||[])],
    pendingData:  [...(portal.pending||[])],
  }
}

function SectionCard({ title, color, children, id, collapsed, onToggle, extra }) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-x-auto">
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

// 주간 일정 그리드의 고객사 구분.
// 요일별로 나누면 어느 날에 했는지 애매한 건이 많아 고객사 기준으로 바꿨다.
const CAL_CS = ['AXCELIS', 'Edwards', 'VM', 'CSK', '기타']
const CS_TONE = {
  AXCELIS: 'text-indigo-600', Edwards: 'text-rose-600',
  VM: 'text-emerald-600', CSK: 'text-amber-600', 기타: 'text-slate-500',
}
// 입력된 고객사명을 5개 칸 중 하나로 맞춘다 (표기 차이 흡수)
function csBucket(v) {
  const t = String(v || '').trim().toLowerCase()
  if (!t) return '기타'
  if (t.includes('axcelis') || t.includes('엑셀리스') || t === 'ax') return 'AXCELIS'
  if (t.includes('edward') || t.includes('에드워드')) return 'Edwards'
  if (t.includes('csk')) return 'CSK'
  if (t.includes('vm') || t.includes('브이엠')) return 'VM'
  return '기타'
}
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
  const [ask, confirmEl] = useConfirm()
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

  if (isLoading) return (
    <div className="space-y-4 max-w-5xl mx-auto" data-wk-loading>
      <div className="flex items-center gap-2" data-skeleton><SkelBar w={56} h={28} /><SkelBar w={56} h={28} /><SkelBar w={64} h={28} /><SkelBar w={150} h={12} className="ml-1" /></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-2" data-skeleton><SkelBar w={90} h={10} /><SkelBar w={220} h={20} /><SkelBar w={150} h={11} /></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 space-y-2" data-skeleton><SkelBar w={90} h={11} /><SkelBar w={70} h={22} /></div>)}
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white" data-skeleton>
          <div className="px-4 py-3 border-b border-slate-100"><SkelBar w={130} h={14} /></div>
          {[0, 1, 2, 3].map((j) => <div key={j} className="flex items-center gap-4 px-4 py-2.5 border-b border-slate-50 last:border-0"><SkelBar w={70} h={11} /><SkelBar w={110} h={11} /><SkelBar w="30%" h={11} /><SkelBar w={40} h={11} /></div>)}
        </div>
      ))}
    </div>
  )

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
  const inboundTotal  = (d?.inbound||[]).reduce((a,r)=>a+Number(r.total_qty||0),0)
  const inboundCount  = (d?.inbound||[]).reduce((a,r)=>a+Number(r.cnt||0),0)
  const planTotal     = (d?.plan||[]).reduce((a,r)=>a+Number(r.total_qty||0),0)
  const planCount     = (d?.plan||[]).reduce((a,r)=>a+Number(r.cnt||0),0)
  // 지연 = 받을 날(협력사 변경 납기가 있으면 그 날, 없으면 요청 납기)이 지난 건 (v4.108.0)
  //   변경 납기가 오늘 이후인 건은 그날까지 지연이 아니다 — 서버(SQL 반영 전)가 보내도 여기서 뺀다
  //   ① 독촉 필요 = 변경 납기 없음(직접 입력 포함) · ② 변경 납기도 지남
  const todayYmd      = ymdKST(today)
  const delayAll      = (d?.delay||[]).filter(r => !(r.vendor_date && String(r.vendor_date).slice(0,10) >= todayYmd))
  const delayByCS     = byCustomer(delayAll)
  const delayCount    = delayAll.length
  const delayG2       = delayAll.filter(r => !!r.vendor_date)
  const delayG1       = delayAll.filter(r => !r.vendor_date)

  return (
    <>
      {confirmEl}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          html, body { height:auto !important; overflow:visible !important; }
          body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
          /* PC 화면 비율 유지 — 살짝만 축소 (폰트 강제축소 제거) */
          .print-zoom { zoom:0.9; }
          .no-print { display:none !important; }
          aside, header, nav { display:none !important; }
          /* ★ 핵심: 앱 레이아웃(flex h-screen overflow-hidden)을 인쇄 시 해제
             — flex/overflow 컨테이너 안에선 page-break가 무시되어 대시보드가 이어붙던 원인 */
          .app-shell { display:block !important; height:auto !important; overflow:visible !important; }
          main { display:block !important; padding:0 !important; overflow:visible !important; height:auto !important; flex:none !important; }
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
            <p className="text-[11px] text-slate-500 mt-0.5 font-mono">작성일 {ymdKST(today)}</p>
          </div>
        </div>

        {/* KPI — 요약을 맨 위로 (v4.69.0: 요약 → 일정 → 지연 · 특이사항 순)
            v4.69.1: 칸을 낮게 — 이름 한 줄 + 숫자 한 줄(보조 숫자는 옆에 작게) · 자재요청은 불출만 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 print:grid-cols-4 gap-2">
          <div data-kpi="inbound" className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white px-3.5 py-2.5 shadow-sm">
            <p className="text-[11px] font-bold text-emerald-600">📦 이번 주 입고</p>
            <p className="mt-0.5 whitespace-nowrap"><span className="text-2xl font-bold text-slate-900">{inboundCount.toLocaleString()}</span><span className="text-sm ml-0.5 text-slate-400">건</span>
              <span className="text-xs text-slate-400 ml-2">{inboundTotal.toLocaleString()}개</span></p>
          </div>
          <div data-kpi="plan" className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white px-3.5 py-2.5 shadow-sm">
            <p className="text-[11px] font-bold text-blue-600">📋 차주 입고 예정</p>
            <p className="mt-0.5 whitespace-nowrap"><span className="text-2xl font-bold text-slate-900">{planCount.toLocaleString()}</span><span className="text-sm ml-0.5 text-slate-400">건</span>
              <span className="text-xs text-slate-400 ml-2">{planTotal.toLocaleString()}개</span></p>
          </div>
          {/* 자재요청 대응 — 자재요청 화면에서 그 주에 불출 처리한 것 */}
          <div data-req-sum className="rounded-xl border border-purple-100 bg-gradient-to-br from-purple-50 to-white px-3.5 py-2.5 shadow-sm">
            <p className="text-[11px] font-bold text-purple-600 flex items-center gap-1">🙋 자재요청 대응 불출<InfoTip text="자재요청 화면에서 처리 방법이 「불출」이고 상태가 「완료」인 요청 줄 중, 처리일이 이 주(월~일, 한국 시간)인 것. 큰 숫자는 줄(품목) 수, 옆의 「요청」은 요청번호 수입니다." /></p>
            {d?.reqErr ? (
              <p className="text-xs text-rose-600 mt-1">집계를 못 불러왔습니다 ({d.reqErr})</p>
            ) : (
              <p className="mt-0.5 whitespace-nowrap"><span className="text-2xl font-bold text-slate-900">{(d?.reqSum?.issue.items||0).toLocaleString()}</span><span className="text-sm ml-0.5 text-slate-400">품목</span>
                <span className="text-xs text-slate-400 ml-2">요청 {d?.reqSum?.issue.reqs||0}건</span></p>
            )}
          </div>
          <div className={`rounded-xl border px-3.5 py-2.5 shadow-sm ${delayCount>0?'border-red-200 bg-gradient-to-br from-red-50 to-white':'border-slate-100 bg-gradient-to-br from-slate-50 to-white'}`}>
            <p className={`text-[11px] font-bold flex items-center gap-1 ${delayCount>0?'text-red-600':'text-slate-500'}`}>{delayCount>0?'🚨':'✅'} 납기 지연<InfoTip align="right" text="포털이 자동으로 모은 받을 날이 지난 건(AXCELIS · Edwards · VM · CSK) + 이 주 주간보고에 직접 적은 지연 건. 받을 날 = 협력사 변경 납기가 있으면 그 날, 없으면 요청 납기 — 변경 납기를 받으면 그날까지 지연에서 빠집니다. 변경 납기가 없으면(직접 입력 포함) 「독촉」, 변경 납기도 지났으면 「변경 납기도 지남」." /></p>
            <p className="mt-0.5 whitespace-nowrap"><span className="text-2xl font-bold text-slate-900">{delayCount}</span><span className="text-sm ml-0.5 text-slate-400">건</span>
              <span className="text-xs text-slate-400 ml-2">{delayCount>0?`독촉 ${delayG1.length} · 변경 납기도 지남 ${delayG2.length}`:'지난 납기 없음'}</span></p>
          </div>
        </div>

        {/* 캘린더 — 이번주 + 다음주 */}
        {(() => {
          const thisWeekDays = getWeekDays(week.from)
          const nextWeekDays = getWeekDays(nextWeek.from)
          const calItems = d?.calItems||[]
          const todayStr = ymdKST(today)

          function openEdit(item) {
                setCalModal({ date: item.target_date, type: item.category==='schedule_outbound'?'outbound':'consignment', editId: item.id })
                setCalForm({ customer:item.customer||'AXCELIS', project:item.project||'', name:item.name||'', qty:item.qty||'', note:item.note||'', _customCs:false })
              }
          // 칸 안 항목 (v4.69.0) — 그 고객사 칸에서는 고객사 이름을 빼고(기타 칸만 표시), 이름은 잘리지 않게 줄바꿈 · 수량은 오른쪽
          function DayCol({ item, showCs, showProject }) {
            return (
              <div draggable data-cal-item
                onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData('itemId',item.id)}}
                onDragEnd={e=>e.preventDefault()}
                className={`rounded border px-1.5 py-0.5 text-xs group cursor-grab active:cursor-grabbing ${csColor(item.customer).light} ${csColor(item.customer).border}`}
                onClick={()=>openEdit(item)}>
                <div className="flex items-start justify-between gap-1">
                  <p className={`min-w-0 break-words leading-snug ${csColor(item.customer).text}`}>
                    {showCs&&item.customer&&<span className="font-semibold mr-1">{item.customer}</span>}
                    {showProject&&item.project&&<span className="mr-1 opacity-70">{item.project}</span>}
                    {item.name&&<span>{item.name}</span>}
                  </p>
                  <span className="flex items-center flex-shrink-0">
                    {item.qty&&<span className={`font-bold tabular-nums ${csColor(item.customer).text}`}>{Number(item.qty).toLocaleString()}</span>}
                    <button onClick={async e=>{e.stopPropagation();if(await ask({ title:'이 일정을 삭제할까요?', desc:'주간 일정에서 바로 지워지며 되돌릴 수 없습니다.', items:[[item.customer, item.project, item.name, item.qty?`${Number(item.qty).toLocaleString()}개`:''].filter(Boolean).join(' · ')], okText:'삭제', danger:true }))deleteCalMut.mutate(item.id)}}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 no-print text-xs ml-1">×</button>
                  </span>
                </div>
              </div>
            )
          }
          // 같은 칸 안은 프로젝트 → 이름 순 (숫자는 크기대로). 같은 프로젝트가 여럿이면 프로젝트 이름을 묶음 머리로 한 번만
          const calSort = (a, b) => String(a.project||'').localeCompare(String(b.project||''), 'ko', { numeric: true })
            || String(a.name||'').localeCompare(String(b.name||''), 'ko', { numeric: true })
          function CellItems({ items, cs }) {
            const list = [...items].sort(calSort)
            const cnt = {}
            list.forEach(it => { const k = it.project || ''; cnt[k] = (cnt[k] || 0) + 1 })
            return list.map((it, i) => {
              const pj = it.project || ''
              const grouped = pj && cnt[pj] > 1
              const head = grouped && (i === 0 || (list[i - 1].project || '') !== pj)
              return (
                <div key={it.id}>
                  {head && <p data-cal-group className={`px-0.5 pt-0.5 text-[11px] font-bold ${csColor(it.customer).text} opacity-80`}>{pj}</p>}
                  <DayCol item={it} showCs={cs === '기타'} showProject={!grouped} />
                </div>
              )
            })
          }

          return (
            <div className="rounded-xl border border-slate-200 overflow-x-auto">
              {/* 주 단위 · 고객사별.
                  어느 요일에 했는지 애매한 건이 많아 요일 구분을 없앴다.
                  항목의 target_date 는 그대로 두고 주 범위로 묶어 보여준다. */}
              {[
                { label: '이번 주', wk: week, days: thisWeekDays, cur: true },
                { label: '다음 주', wk: nextWeek, days: nextWeekDays, cur: false },
              ].map(({ label, wk, days, cur }) => (
                <div key={label}>
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-700">{label}</span>
                    <span className="text-xs text-slate-400">{wk.label}</span>
                    {cur && d?.reqErr && (
                      <span className="ml-auto text-xs text-rose-600">자재요청 집계를 못 불러왔습니다 ({d.reqErr})</span>
                    )}
                  </div>

                  {/* 고객사 헤더 */}
                  <div className="flex border-b border-slate-100">
                    {CAL_CS.map(cs => (
                      <div key={cs} className="w-1/5 border-r border-slate-100 last:border-0 px-2 py-1">
                        <span className={`text-xs font-bold ${CS_TONE[cs] || 'text-slate-600'}`}>{cs}</span>
                      </div>
                    ))}
                  </div>

                  {/* 불출 · 사급 */}
                  {[
                    { cat: 'schedule_outbound', name: '불출', type: 'outbound',
                      bg: 'bg-purple-50/50', tx: 'text-purple-500', btn: 'text-purple-400 hover:text-purple-600', min: 36 },
                    { cat: 'schedule_consignment', name: '사급', type: 'consignment',
                      bg: 'bg-amber-50/50', tx: 'text-amber-500', btn: 'text-amber-400 hover:text-amber-600', min: 24 },
                  ].map((row, ri) => (
                    <div key={row.cat} className={`flex ${ri === 0 ? 'border-b border-slate-100' : cur ? 'border-b border-slate-200' : ''}`}>
                      {CAL_CS.map(cs => {
                        const items = calItems.filter(r =>
                          days.includes(r.target_date) &&
                          r.category === row.cat &&
                          csBucket(r.customer) === cs)
                        return (
                          <div key={cs} onDragOver={e => e.preventDefault()}
                            onDrop={e => {
                              e.preventDefault()
                              const id = e.dataTransfer.getData('itemId')
                              // 고객사 칸으로 옮기면 그 주 월요일 날짜로 이동한다
                              if (id) moveCalMut.mutate({ id, newDate: days[0] })
                            }}
                            className="w-1/5 border-r border-slate-100 last:border-0">
                            <div className={`flex items-center justify-between px-1.5 py-0.5 ${row.bg}`}>
                              <span className={`text-xs font-bold ${row.tx}`}>{row.name}</span>
                              <button onClick={() => {
                                  setCalModal({ date: days[0], type: row.type })
                                  setCalForm({ customer: cs === '기타' ? '' : cs, project: '', name: '', qty: '', note: '', _customCs: cs === '기타' })
                                }}
                                className={`text-xs font-bold no-print ${row.btn}`}>＋</button>
                            </div>
                            <div className="p-1 space-y-0.5" style={{ minHeight: row.min }}>
                              {/* 자재요청으로 나간 것 — 자동 (손으로 적은 불출과 구분되게 점선) */}
                              {cur && row.cat === 'schedule_outbound' && (() => {
                                const c = d?.reqSum?.byCs?.[cs]
                                if (!c || !c.issue.items) return null
                                return (
                                  <div data-req-cs={cs} title="자재요청 화면에서 처리한 것 (자동 집계)"
                                    className="rounded border border-dashed border-purple-300 bg-white px-1.5 py-1 text-xs leading-snug">
                                    <p className="text-purple-700"><span className="text-[11px] font-bold text-purple-500 mr-1">자재요청</span>불출 <b className="text-sm">{c.issue.items}</b>품목 <span className="text-purple-400">· {c.issue.reqs}건</span></p>
                                  </div>
                                )
                              })()}
                              <CellItems items={items} cs={cs} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              ))}
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
                  {addCalMut.isPending?<span className="inline-flex items-center gap-1.5"><Spin />{calModal.editId?'수정 중...':'추가 중...'}</span>:(calModal.editId?'수정 완료':'추가')}
                </button>
              </div>
            </div>
          </div>
        )}

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
                    <button onClick={async()=>{ const sel=delayAll.filter(r=>checkedIds.includes(r.id)); if(await ask({ title:`선택 ${checkedIds.length}건 삭제할까요?`, desc:'주간보고 항목에서 지워지며 되돌릴 수 없습니다.', items:sel.slice(0,5).map(r=>[r.pn||'-', r.vendor, r.qty?`${r.qty}개`:''].filter(Boolean).join(' · ')), more:Math.max(0,checkedIds.length-5), okText:'삭제', danger:true })) deleteItemMut.mutate(checkedIds) }}
                      className="text-xs font-bold px-2 py-0.5 rounded border border-red-300 text-red-600 bg-red-50 hover:bg-red-100 no-print">
                      선택 삭제 ({checkedIds.length})
                    </button>
                  )}
                </div>
              }>
              {/* v4.108.0 — 받을 날이 지난 건을 ① 독촉 필요(변경 납기 없음) ② 변경 납기도 지남 으로 나눈다.
                  변경 납기가 아직 안 온 건은 지연이 아니라 여기 안 나온다 */}
              {[[1, '① 독촉 필요', '변경 납기 없음 — 협력사에 날짜 받기', 'bg-red-50 text-red-700', delayG1], [2, '② 변경 납기도 지남', '협력사가 준 새 날짜도 지남 — 다시 독촉', 'bg-red-50 text-red-700', delayG2]].map(([grp, gt, gs, gc, grows]) => {
                const byCS = byCustomer(grows)
                return grows.length > 0 && (
                <div key={grp} data-wk-delay-group={grp}>
                  <div className={`px-4 py-2 border-b border-slate-200 flex items-center gap-2 ${gc}`}>
                    <span className="text-xs font-extrabold">{gt} {grows.length}건</span>
                    <span className="text-[11px] opacity-80">{gs}</span>
                  </div>
              {CUSTOMERS.map(cs=>(byCS[cs]?.length>0&&(
                <div key={cs}>
                  <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-600">{cs}</span>
                      <span className="ml-2 text-xs text-red-500 font-semibold">{byCS[cs].length}건</span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-2 py-2 no-print w-6">
                          <input type="checkbox"
                            checked={byCS[cs].filter(r=>isStored(r.id)).length>0 && byCS[cs].filter(r=>isStored(r.id)).every(r=>checkedDelay[r.id])}
                            onChange={e=>setCheckedDelay(v=>({...v,...Object.fromEntries(byCS[cs].filter(r=>isStored(r.id)).map(r=>[r.id,e.target.checked]))}))}
                            className="w-3.5 h-3.5 accent-red-500"/>
                        </th>
                        {['품목코드','구매처','제조사','제조사품번','수량','요청 납기','변경 납기','현황','대책'].map(h=>(
                          <th key={h} className="px-3 py-2 text-left font-bold text-slate-400 whitespace-nowrap">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {byCS[cs].map((r,i)=>(
                          <tr key={r.id||i} className={`border-b border-slate-100 ${checkedDelay[r.id]?'bg-emerald-50/30':'hover:bg-red-50/20'}`}>
                            <td className="px-2 py-1.5 no-print">
                              {isStored(r.id) && <input type="checkbox" checked={!!checkedDelay[r.id]}
                                onChange={e=>setCheckedDelay(v=>({...v,[r.id]:e.target.checked}))}
                                className="w-3.5 h-3.5 accent-emerald-500"/>}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-indigo-600">
                              {r.pn||'-'}
                              {/* 자동 집계와 손으로 적은 것을 갈라 본다.
                                  겹쳐 보이면 수기 쪽을 지우면 된다. */}
                              {r._manual && (
                                <span className="ml-1.5 px-1 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-bold align-middle">
                                  직접 입력
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-slate-600">{r.vendor||'-'}</td>
                            <td className="px-3 py-1.5 text-slate-500">{r.manufacturer||'-'}</td>
                            <td className="px-3 py-1.5 font-mono text-slate-400">{r.manufacturer_pn||'-'}</td>
                            <td className="px-3 py-1.5 text-right font-bold text-red-600">{r.qty||'-'}</td>
                            <td className="px-3 py-1.5 font-mono text-red-400 whitespace-nowrap">
                              {r.target_date||'-'}
                              {r.target_date && (()=>{ const dd=Math.floor((today-new Date(r.target_date))/86400000); return dd>0?<span className="ml-1 px-1 rounded bg-red-100 text-red-600 text-[10px] font-bold">D+{dd}</span>:null })()}
                            </td>
                            <td className="px-3 py-1.5 whitespace-nowrap" data-wk-vendor-date>
                              {r.vendor_date ? <span className="font-mono font-bold text-red-600">{r.vendor_date} (지남)</span> : <span className="text-red-500">없음</span>}
                              {r.vendor_reason && <span className="block text-[10px] text-slate-400">{r.vendor_reason}</span>}
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
                </div>
                )
              })}
              {delayAll.length===0&&<p className="text-xs text-slate-400 text-center py-6">지연 없음 ✓</p>}
            </SectionCard>
          )
        })()}

        {/* 특이사항 */}
        <div className="rounded-xl border border-slate-200 overflow-x-auto">
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
