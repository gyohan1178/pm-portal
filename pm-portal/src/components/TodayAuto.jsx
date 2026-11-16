// 내 오늘 할 일 — 자동 모음 (v4.191.0) · 할 일 화면 맨 위 (구매자재)
//   노트북 화면(1366×768)에서 한 줄에 들어가게 낮고 좁은 칸 6개 · 누르면 그 화면으로
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { todayISO } from '../lib/utils'
import { useCustomers } from '../hooks/useCustomers'
import { useRemember } from '../hooks/useRemember'
import { primaryCsCode, CUSTOMERS } from '../lib/customers'
import { flowCountsQuery } from '../lib/flowSeen'
import { fetchDuePo, tallyPo } from '../lib/todayAuto'

const TONE = {
  red: 'bg-red-50 border-red-200 text-red-600', amber: 'bg-amber-50 border-amber-200 text-amber-700',
  violet: 'bg-violet-50 border-violet-200 text-violet-700', gray: 'bg-white border-slate-200 text-slate-700',
}
function Tile({ to, label, n, tone, note, k }) {
  const zero = !(n > 0)
  return (
    <Link to={to} data-today={k} className={`rounded-xl border px-3 py-2 flex flex-col gap-0.5 min-w-0 hover:shadow-sm ${zero ? 'bg-white border-slate-200 text-slate-400' : TONE[tone]}`}>
      <span className="text-[11px] font-bold truncate">{label}</span>
      <span className="flex items-baseline gap-1"><b className="text-xl leading-6 tabular-nums">{n == null ? '—' : Number(n).toLocaleString()}</b><span className="text-[10.5px] opacity-70 truncate">{note}</span></span>
    </Link>
  )
}

export default function TodayAuto({ profile, fold = false }) {
  const [openM, setOpenM] = useState(false)   // 휴대폰 — 한 줄로 접어 둔다 · 눌러서 펼침 (v4.194.0)
  const today = todayISO()
  const pcs = (primaryCsCode(profile) || 'ax').toLowerCase()
  const pcsName = CUSTOMERS.find((c) => c.id === pcs)?.name || pcs.toUpperCase()
  const [scope, setScope] = useRemember('today.scope', 'mine', (v) => v === 'mine' || v === 'all')
  const { data: customers = [] } = useCustomers()
  const { data: rows, isError } = useQuery({ queryKey: ['todayDuePo', today], queryFn: () => fetchDuePo(today), staleTime: 2 * 60 * 1000 })
  const { data: c = null } = useQuery({ ...flowCountsQuery, enabled: !!profile })
  const myId = customers.find((x) => String(x.code || '').toLowerCase() === pcs)?.id || null
  const po = rows ? tallyPo(rows, today, scope === 'mine' ? myId : null) : null
  const who = scope === 'mine' ? pcsName : '전체'
  const ordN = c ? (Number(c.ord_unconfirmed) || 0) + (Number(c.ord_waiting) || 0) : null
  if (fold && !openM) {
    const bit = (l, v, cls) => <span className={`whitespace-nowrap ${v > 0 ? cls : 'text-slate-400'}`}>{l} {v == null ? '—' : Number(v).toLocaleString()}</span>
    return (
      <button type="button" data-today-fold onClick={() => setOpenM(true)}
        className="w-full min-h-[48px] rounded-2xl border border-slate-200 bg-white px-3 py-2 flex items-center gap-x-2 gap-y-0.5 flex-wrap text-left text-xs font-bold">
        <span className="text-slate-800">오늘 챙길 일</span>
        {bit('입고 지남', po?.late, 'text-red-600')}
        {bit('오늘 입고', po?.today, 'text-violet-700')}
        {bit('수주', ordN, 'text-amber-700')}
        {bit('요청', c ? c.req_open : null, 'text-amber-700')}
        <span className="ml-auto font-medium text-slate-500 whitespace-nowrap">6칸 펼치기 ▾</span>
      </button>
    )
  }
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 space-y-2" data-today-auto>
      <div className="flex items-center gap-2 flex-wrap">
        <b className="text-xs text-slate-700">오늘 챙길 일 <span className="font-medium text-slate-400">· 자동으로 모은 것 (적지 않아도 나옵니다)</span></b>
        <span className="ml-auto inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-[11px] font-bold" title="발주 숫자를 내 고객사로 좁힙니다 — 수주 · 자재 요청은 팀 전체 숫자">
          {[['mine', `내 고객사 (${pcsName})`], ['all', '전체']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setScope(k)} data-today-scope={k} className={`px-2 py-0.5 rounded-md ${scope === k ? 'bg-[#6c5ce7] text-white' : 'text-slate-500'}`}>{l}</button>
          ))}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Tile k="in-today" to="/inbound" label="오늘 들어올 발주" n={po?.today} tone="violet" note={`${who} · 받을 날 오늘`} />
        <Tile k="in-late" to={`/customer/${pcs}/purchase`} label="입고 지남 · 독촉" n={po?.late} tone="red" note={`${who} · 받을 날 지남`} />
        <Tile k="in-week" to="/inbound" label="이번 주 남은 입고" n={po?.week} tone="gray" note={`${who} · 일요일까지`} />
        <Tile k="ord" to="/orders" label={c?.ord_one_step ? '수주 미확인 (PO · 회신 전)' : c?.ord_by_po ? '수주 미확인 · 회신 대기 (PO)' : '수주 미확인 · 회신 대기'} n={c ? (Number(c.ord_unconfirmed) || 0) + (Number(c.ord_waiting) || 0) : null} tone="amber" note={c ? (c.ord_one_step ? `11월 등록분 · 급한 것만${c.ord_later ? ` · 예정 ${c.ord_later}` : ''}` : `미확인 ${c.ord_unconfirmed || 0} · 대기 ${c.ord_waiting || 0}${c.ord_by_po && c.ord_later ? ` · 예정 ${c.ord_later}` : ''}`) : '팀 전체'} />
        <Tile k="req" to="/material-request" label="자재 요청 처리 대기" n={c ? c.req_open : null} tone="amber" note="팀 전체" />
        <Tile k="rfq" to="/quote" label="견적 단가 요청" n={c ? c.rfq_price : null} tone="violet" note="영업 → 구매자재" />
      </div>
      {fold && <button type="button" data-today-unfold onClick={() => setOpenM(false)} className="w-full h-11 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-500">접기 ▴</button>}
      {isError && <p className="text-[11px] text-red-500">발주 숫자를 불러오지 못했습니다 — 잠시 뒤 새로고침해 주세요</p>}
    </section>
  )
}
