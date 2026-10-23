// 📨 수주대장 — 전장 고객사 PO 를 접수부터 확인 · 회신 · 납품까지
//
//   v4.87.0  PDF 접수 · 변경 이력 · 회신 · AX PO 파일 반영
//   v4.88.0  품번별(납기순) 기본 화면 · 줄 단위 회신 · 발주 단가 · 예상 매출 · 부서로 화면 구분
//   v4.89.0  화면 정리(두 줄 셀 · 상태 한 칸 · D-day) · AXCELIS CCN · 납품처 · 납기 지남 지표
//   v4.90.0  CSK 발주 예정(Plnd order number) — 실제 발주서가 오면 그 PO 로 옮김 · 열 너비 끌어서 조절
//            협력사 불출일(release_date) — 납기(고객사 납품일)와 따로. Edwards 엑셀 「납품 요청일」
//   구매자재 부서: 회신 입력 · 납품 표시 · PO 파일 반영 / 그 밖: 회신 결론만
import { useState, useMemo, useEffect, useRef, useDeferredValue, lazy, Suspense } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useMyProfile, canEdit, isPurchasing } from '../../hooks/useProfile'
import { useResizableColumns } from '../../hooks/useResizableColumns'
import { logActivity } from '../../lib/activityLog'
import { toastError, toastSuccess } from '../../lib/toast'
import { todayISO } from '../../lib/utils'
import { fetchQuoteMarginCfg, QUOTE_CFG_KEY } from '../../lib/quoteSettings'
import {
  ORDER_CUSTOMERS, fetchOrders, stageOf, lineState, bizDaysSince, axSyncPreview, axSyncRun,
  replyLines, markDelivered, setReleaseDate, FIELD_LABEL, SOURCE_LABEL, mgmtNoOf, packOf, oddsOf, ODD_PRICE_PCT,
} from '../../lib/orderIntake'
import { parseAxPoWorkbook } from '../../lib/axPoFile'
import OrderUpload from './OrderUpload'
import OrderEntry, { downloadTemplate } from './OrderEntry'
import { KINDS, KIND_SHORT, KIND_TONE, kindOf, isTempPo, CANCEL_REASONS, cancelLines, uncancelLines, promotePo, setSlipNo } from '../../lib/orderEntry'
const EcountMatch = lazy(() => import('./EcountMatch'))
const OrderCleanup = lazy(() => import('./OrderCleanup'))

const fmt = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }))
const won = (v) => `₩${Math.round(v || 0).toLocaleString('ko-KR')}`
const md = (d) => (d ? String(d).slice(5).replace('-', '/') : '—')
const ts = (t) => String(t || '').slice(0, 16).replace('T', ' ')
const isUsd = (o) => o.currency === 'USD' || o.ccn === 'B'
const amountOf = (l) => (+l.qty || 0) * (+l.unit_price || 0)
const money = (o, v) => (isUsd(o) ? `$${fmt(Math.round(v * 100) / 100)}` : won(v))
const dayDiff = (d) => (d ? Math.round((new Date(d) - new Date(todayISO())) / 86400000) : null)

const REPLY = {
  가능: ['bg-emerald-50 text-emerald-700', '가능'],
  조건부: ['bg-amber-50 text-amber-700', '조건부'],
  불가: ['bg-red-50 text-red-600', '불가'],
}
const KPI_TONE = {
  red: ['bg-red-50/70 border-red-100', 'text-red-600'], amber: ['bg-amber-50/70 border-amber-100', 'text-amber-600'],
  violet: ['bg-violet-50/70 border-violet-100', 'text-violet-600'], green: ['bg-emerald-50/70 border-emerald-100', 'text-emerald-700'],
}

// 줄 상태 — 한 칸으로 (회신 결론은 옆 「구매자재 회신」 칸에)
function statusOf(l) {
  if (l.st.cancelled) return ['취소', 'bg-slate-100 text-slate-400']
  if (l.st.delivered) return ['납품 완료', 'bg-emerald-50 text-emerald-700']
  if (l.st.partDelivered) return ['일부 납품', 'bg-blue-50 text-blue-700']
  if (l.st.planned) return ['발주 예정', 'bg-violet-50 text-violet-700']
  if (l.reply) return ['납품 대기', 'bg-slate-100 text-slate-600']
  if (l.st.confirmed) return ['회신 대기', 'bg-amber-50 text-amber-700']
  return ['확인 대기', 'bg-red-50 text-red-600']
}

// 지표 · 보기 조건 — 지표 숫자 · 목록 · 고객사 버튼 숫자가 같은 기준을 쓰도록 한 곳에 (v4.90.4)
const KPI_PICK = {
  unconfirmed: (l) => l.st.live && !l.o.migrated && !l.o.planned && !l.st.confirmed && bizDaysSince(l.o.registered_at) >= 1,
  waiting: (l) => l.st.live && !l.reply,
  risk: (l) => l.st.live && (l.reply === '조건부' || l.reply === '불가'),
  late: (l, today) => l.st.live && !!l.due_date && l.due_date < today,
  noPrice: (l) => !l.st.cancelled && !(+l.unit_price > 0),
  odd: (l) => l.st.live && !!l.odd,
}
const inView = (view, l) => (view === 'live' ? l.st.live : view === 'po' ? l.st.live && !l.st.planned
  : view === 'plan' ? l.st.live && l.st.planned : view === 'temp' ? l.st.live && isTempPo(l.o)
  : view === 'done' ? l.st.delivered && !l.st.cancelled : view === 'cancel' ? l.st.cancelled : true)
const isMonthPo = (o, month) => String(o.registered_at).slice(0, 7) === month && !['po_file', 'ax_import', 'excel'].includes(o.source)

// 열 너비 — 머리글 오른쪽 끝을 끌어 조절 (사람마다 이 브라우저에 기억) · 다른 화면 표와 같은 방식
const LINE_COLS = [['chk', 40], ['due', 112], ['cust', 160], ['po', 170], ['pn', 320], ['qty', 80], ['amt', 130], ['st', 110], ['reply', 230]]
const PO_COLS = [['po', 180], ['cust', 170], ['items', 340], ['due', 130], ['amt', 140], ['reply', 160], ['reg', 120]]
function Th({ k, rz, className = '', children }) {
  return (
    <th className={`relative px-3 py-2.5 font-bold whitespace-nowrap overflow-hidden ${className}`}>
      {children}
      {k && <span onMouseDown={(e) => rz.startResize(e, k)} title="끌어서 너비 조절" data-resize={k}
        className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-violet-300/70 transition-colors" style={{ userSelect: 'none' }} />}
    </th>
  )
}
function ColGroup({ cols, rz }) { return <colgroup>{cols.map(([k, d]) => <col key={k} style={{ width: (rz.widths[k] || d) + 'px' }} />)}</colgroup> }
const tableStyle = (cols, rz) => ({ tableLayout: 'fixed', width: cols.reduce((a, [k, d]) => a + (rz.widths[k] || d), 0) + 'px', minWidth: '100%' })

// 휴대폰 폭(768px 미만)이면 표 대신 카드로 (v4.90.7)
const NARROW_Q = '(max-width: 767px)'
function useNarrow() {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(NARROW_Q).matches
  const [n, setN] = useState(get)
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(NARROW_Q)
    const on = () => setN(mq.matches)
    on(); mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on)
    return () => { mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on) }
  }, [])
  return n
}

function Kpi({ tone, label, value, sub, on, onClick }) {
  const [box, num] = KPI_TONE[tone]
  return (
    <button type="button" onClick={onClick} data-kpi={label}
      className={`min-w-0 text-left rounded-xl border px-3 md:px-4 py-3 transition ${box} ${on ? 'ring-2 ring-violet-400' : 'hover:shadow-sm'}`}>
      <div className="text-[12px] text-slate-500">{label}</div>
      <div className={`text-[24px] md:text-[28px] font-extrabold leading-tight tabular-nums ${num}`}>{value.toLocaleString('ko-KR')}</div>
      <div className="text-[11px] text-slate-500 truncate">{sub}</div>
    </button>
  )
}

function DueCell({ l, noRelease = false }) {
  const d = dayDiff(l.due_date)
  const live = l.st.live
  const tag = !live || d == null ? null : d < 0 ? ['bg-red-50 text-red-600', `지연 ${-d}일`] : d <= 7 ? ['bg-amber-50 text-amber-700', d === 0 ? '오늘' : `D-${d}`] : null
  return (
    <div className="whitespace-nowrap">
      <div className={`font-mono tabular-nums ${tag && d < 0 ? 'text-red-600 font-semibold' : 'text-slate-700'}`}>{l.due_date || '—'}</div>
      {tag && <span className={`inline-block mt-0.5 px-1.5 py-[1px] rounded text-[10px] font-bold ${tag[0]}`}>{tag[1]}</span>}
      {l.release_date && !noRelease && (
        <div className={`text-[10.5px] mt-0.5 ${live && l.release_date < todayISO() ? 'text-red-500 font-semibold' : 'text-slate-400'}`} title="협력사 불출일 — 협력사에 자재를 내줘야 하는 날" data-release-date>
          불출 {md(l.release_date)}{live && l.release_date < todayISO() ? ' 지남' : ''}
        </div>
      )}
    </div>
  )
}

// 묶음 주의 — 품명에 PK2 면 수량 1 이 실제 2개
function PackNote({ l }) {
  const n = packOf(l)
  if (!n) return null
  return <div className="mt-0.5 inline-block px-1.5 py-[1px] rounded bg-amber-50 text-amber-700 text-[10px] font-bold whitespace-nowrap" title={`품명의 PK${n} = 한 개에 ${n}개 묶음 — 실제 ${(+l.qty || 0) * n}개 준비`} data-pack>⚠ PK{n} · 실제 {fmt((+l.qty || 0) * n)}개</div>
}

// 특이사항 표시 — 바로 앞 PO 와 Rev · 단가가 다름 · 메모에 ⚠ (v4.90.7)
function OddBadges({ odd }) {
  if (!odd) return null
  const pct = odd.price ? odd.price.pct : 0
  return <>
    {odd.rev && <span className="px-1.5 py-[1px] rounded bg-red-50 text-red-600 text-[10px] font-bold whitespace-nowrap" title={`바로 앞 PO ${odd.rev.po} 는 Rev ${odd.rev.prev} — 도면 · 자재 Rev 확인`} data-odd-rev>Rev {odd.rev.prev}→{odd.rev.now}</span>}
    {odd.price && <span className="px-1.5 py-[1px] rounded bg-amber-50 text-amber-700 text-[10px] font-bold whitespace-nowrap" title={`바로 앞 PO ${odd.price.po} 단가 ${fmt(odd.price.prev)} → 이번 ${fmt(odd.price.now)}`} data-odd-price>단가 {pct > 0 ? '+' : ''}{pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%</span>}
    {odd.note && <span className="px-1.5 py-[1px] rounded bg-amber-50 text-amber-700 text-[10px] font-bold whitespace-nowrap" title="메모에 ⚠ — 메모를 확인하세요" data-odd-note>⚠ 메모</span>}
  </>
}

function CustCell({ o }) {
  const c = ORDER_CUSTOMERS[o.customer_code]
  return (
    <div className="whitespace-nowrap">
      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${c.badge}`}>{c.name}</span>
      {o.customer_code === 'AX' && o.ccn && <span className="ml-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold" title="CCN">CCN {o.ccn}</span>}
      <div className="text-[11px] text-slate-400 mt-0.5">{o.ship_to || (o.customer_code === 'AX' ? (o.ccn === 'B' ? '미국' : '') : '')}</div>
    </div>
  )
}

// 회신 칸 — 조건부 · 불가는 사유를 누구 화면이든 결론 바로 아래에 크게 (v4.93.2: 구매자재 화면에서 사유가 안 보이던 것)
//   가능 메모는 memo 일 때만 (영업 화면 · PO 상세)
// 구두 발주 · 선진행 표시 (정식 PO · 발주 예정은 표시 안 함 — 발주 예정은 보라 글자로 이미 구분) (v4.94.0)
function KindBadge({ o }) {
  const k = kindOf(o)
  if (k !== 'verbal' && k !== 'advance') return null
  return <span className={`ml-1 px-1.5 py-[1px] rounded text-[10px] font-bold align-middle ${KIND_TONE[k]}`} data-kind-badge={k} title={[KINDS[k], o.req_person, o.po_due && `정식 PO 받을 날 ${o.po_due}`].filter(Boolean).join(' · ')}>{KIND_SHORT[k]}</span>
}

function ReplyCell({ l, memo }) {
  if (!l.reply) return <span className="text-[11px] text-slate-300">—</span>
  const risk = l.reply !== '가능'
  return (
    <div className="min-w-0" title={l.reply_memo || ''}>
      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${REPLY[l.reply][0]}`}>{REPLY[l.reply][1]}</span>
      {l.reply_date && <span className="ml-1 text-[11px] text-slate-500">준비 {md(l.reply_date)}</span>}
      {risk && l.reply_memo && <div className={`mt-0.5 text-[11.5px] font-semibold leading-snug break-words ${l.reply === '불가' ? 'text-red-600' : 'text-amber-700'}`} data-reply-reason>사유: {l.reply_memo}</div>}
      {!risk && memo && l.reply_memo && <div className="text-[10.5px] text-slate-400 mt-0.5 truncate">{l.reply_memo}</div>}
      {risk && (l.replied_name || l.replied_at) && <div className="text-[10px] text-slate-400 mt-0.5">{[l.replied_name, l.replied_at && md(String(l.replied_at).slice(0, 10))].filter(Boolean).join(' · ')}</div>}
    </div>
  )
}

// PO 상세 맨 위 — 조건부 · 불가 줄과 사유를 모아서 (v4.93.2)
function RiskBanner({ ls }) {
  const risk = ls.filter((l) => !l.st.cancelled && l.reply && l.reply !== '가능')
  if (!risk.length) return null
  return (
    <div className="rounded-xl border border-red-200 bg-red-50/60 px-4 py-3" data-risk-banner>
      <div className="text-xs font-extrabold text-red-700">조건부 · 불가 {risk.length}품목 — 고객사 납기 협의 필요</div>
      <div className="mt-1.5 space-y-1">
        {risk.map((l) => (
          <div key={l.id} className="flex flex-wrap items-baseline gap-x-2 text-[12px]" data-risk-line={`${l.line_no}/${l.del_line}`}>
            <span className={`px-1.5 py-[1px] rounded-full text-[10.5px] font-bold ${REPLY[l.reply][0]}`}>{l.reply}</span>
            <span className="font-mono font-bold text-slate-700">{l.items?.std_code || l.raw_pn || '품번 없음'}</span>
            <span className="text-slate-400">Line {l.line_no}{l.del_line !== '1' ? `/${l.del_line}` : ''}</span>
            <span className={`font-semibold ${l.reply === '불가' ? 'text-red-600' : 'text-amber-700'}`}>{l.reply_memo || '사유 없음'}</span>
            {l.reply_date && <span className="text-slate-500">준비 {md(l.reply_date)}</span>}
            <span className="text-[10.5px] text-slate-400">{[l.replied_name, l.replied_at && md(String(l.replied_at).slice(0, 10))].filter(Boolean).join(' · ')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// 회신 입력 — 여러 줄 한꺼번에
function ReplyForm({ count, onSave, busy, unit = '건' }) {
  const [reply, setReply] = useState('')
  const [date, setDate] = useState('')
  const [memo, setMemo] = useState('')
  return (
    <div className="flex flex-wrap items-center gap-2" data-reply-form>
      <div className="flex rounded-lg border border-slate-200 overflow-hidden">
        {['가능', '조건부', '불가'].map((r) => (
          <button key={r} type="button" onClick={() => setReply(r)} data-reply={r}
            className={`px-3 py-1.5 text-xs font-bold border-r last:border-r-0 border-slate-200 ${reply === r ? REPLY[r][0] : 'bg-white text-slate-500 hover:bg-slate-50'}`}>{r}</button>
        ))}
      </div>
      <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">자재 준비일
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-reply-date className="px-2 py-1 text-xs border border-slate-200 rounded-lg" />
      </label>
      <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="영업에 보일 메모 (조건부 · 불가는 사유 필수)" data-reply-memo
        className="flex-1 min-w-[220px] px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />
      <button type="button" disabled={busy || !count} onClick={() => onSave({ reply, date, memo })} data-reply-save
        className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-violet-600 text-white disabled:opacity-40 whitespace-nowrap">회신 저장 ({count}{unit})</button>
    </div>
  )
}

export default function OrderIntake() {
  const qc = useQueryClient()
  const { data: profile, isLoading: pLoading } = useMyProfile()
  // 관리자는 「영업 화면으로 보기」로 영업 · 타부서가 보는 화면을 그대로 미리 볼 수 있다 (v4.93.2)
  const isAdmin = profile?.role === 'admin'
  const [asSales, setAsSales] = useState(false)
  const isBuy = !pLoading && isPurchasing(profile) && !asSales
  const editable = !!profile && canEdit(profile)
  const meName = (profile?.name || '').trim() || profile?.email || ''

  const { data: orders = [], isLoading, error } = useQuery({ queryKey: ['orderIntake'], queryFn: fetchOrders })
  const { data: qcfg } = useQuery({ queryKey: QUOTE_CFG_KEY, queryFn: fetchQuoteMarginCfg, staleTime: 10 * 60 * 1000 })
  const [fxIn, setFxIn] = useState('')
  const fx = Number(fxIn) > 0 ? Number(fxIn) : (qcfg?.sellRate || 1400)

  const [mode, setMode] = useState('line')       // line 품번별 · po PO별
  const [cust, setCust] = useState('all')
  const [q, setQ] = useState('')
  const [view, setView] = useState('live')       // live 진행 중 · done 납품 완료 · all
  const [kpi, setKpi] = useState(null)
  const [sort, setSort] = useState('due')
  const [checked, setChecked] = useState(() => new Set())
  const [poOpen, setPoOpen] = useState(null)
  const [upload, setUpload] = useState(false)
  const [entry, setEntry] = useState(null)       // 'one' 직접 등록 · 'excel' 엑셀로 여러 건 (v4.94.0)
  const [sp, setSp] = useSearchParams()
  const tab = ['ecount', 'cleanup'].includes(sp.get('tab')) ? sp.get('tab') : 'list'
  const goTab = (t) => { const n = new URLSearchParams(sp); if (t === 'list') n.delete('tab'); else n.set('tab', t); setSp(n, { replace: true }) }
  const refresh = () => qc.invalidateQueries({ queryKey: ['orderIntake'] })
  // 작은 작업(회신 · 납품 · 불출일 · 납품처 · 확인 · 삭제) 뒤에는 1만 줄을 다시 받지 않고 화면 데이터만 고친다 (v4.90.6 속도)
  //   PDF 등록 · AX 엑셀 반영처럼 줄이 생기는 작업만 전체를 다시 받는다
  const patchLocal = (fnOrder) => qc.setQueryData(['orderIntake'], (prev) => (prev ? fnOrder(prev) : prev))
  const patchLines = (patchOf) => patchLocal((os) => os.map((o) => {
    let hit = false
    const lines = o.lines.map((l) => { const p = patchOf(l); if (!p) return l; hit = true; return { ...l, ...p } })
    return hit ? { ...o, lines } : o
  }))
  const patchHead = (ids, p) => { const set = new Set(ids); patchLocal((os) => os.map((o) => (set.has(o.id) ? { ...o, ...p(o) } : o))) }
  const lineRz = useResizableColumns('orderIntake_line_cols', Object.fromEntries(LINE_COLS))
  const poRz = useResizableColumns('orderIntake_po_cols', Object.fromEntries(PO_COLS))
  const lineCols = isBuy ? LINE_COLS : LINE_COLS.filter(([k]) => k !== 'chk')
  const narrow = useNarrow()

  // 줄 펼치기 — 고객사 · 구분 상관없이 전체 (v4.90.4 「AX 전장만」 없앰)
  const { allLines, oddMap } = useMemo(() => {
    const ls = orders.flatMap((o) => o.lines.map((l) => ({ ...l, o, st: lineState(l, o) })))
    const odd = oddsOf(ls)                   // 특이사항 — 바로 앞 PO 와 Rev · 단가 다름 · ⚠ 메모 (v4.90.7)
    ls.forEach((l) => { const x = odd.get(l.id); if (x) l.odd = x })
    return { allLines: ls, oddMap: odd }
  }, [orders])
  const byOrder = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  // 코드 없는 고객사 품번 수 (진행 중 줄) — 「코드 · BOM 정리」 탭 숫자
  const unregCount = useMemo(() => new Set(allLines.filter((l) => l.st.live && !l.item_id && String(l.raw_pn || '').trim()).map((l) => `${l.o.customer_code}|${String(l.raw_pn).trim().toUpperCase()}`)).size, [allLines])
  const qd = useDeferredValue(q)            // 글자 칠 때마다 1만 줄을 다시 거르지 않게 — 입력은 바로, 목록은 한 박자 뒤 (v4.90.6)
  const k = qd.trim().toUpperCase()
  const hit = (l) => !k || [l.o.po_no, l.o.file_name, l.o.ship_to, l.items?.std_code, l.items?.name, l.raw_pn, l.raw_desc, l.note, l.plnd_no, l.prod_no].some((v) => String(v || '').toUpperCase().includes(k))
  const scoped = useMemo(() => allLines.filter((l) => (cust === 'all' || l.o.customer_code === cust) && hit(l)), [allLines, cust, k]) // eslint-disable-line react-hooks/exhaustive-deps

  const today = todayISO()
  const month = today.slice(0, 7)
  const kpis = useMemo(() => {
    const pos = (ls) => new Set(ls.map((l) => l.order_id)).size
    const unconfirmed = scoped.filter((l) => KPI_PICK.unconfirmed(l))
    const waiting = scoped.filter((l) => KPI_PICK.waiting(l))
    const risk = scoped.filter((l) => KPI_PICK.risk(l))
    const late = scoped.filter((l) => KPI_PICK.late(l, today))
    const monthPos = orders.filter((o) => isMonthPo(o, month) && (cust === 'all' || o.customer_code === cust))
    // 예상 매출 — 취소 빼고 납품 완료 포함. 달러(CCN B)는 환율을 곱한다
    // 올해 납기(납품일) 줄만 — 엑셀 매출 결산과 같은 기준. 내년 이후 · 납기 없음은 따로 (v4.90.2)
    const yr = today.slice(0, 4)
    const m = { krw: 0, usd: 0, doneKrw: 0, doneUsd: 0, later: 0, noDue: 0, byCust: {} }
    scoped.filter((l) => !l.st.cancelled).forEach((l) => {
      const y = String(l.due_date || '').slice(0, 4)
      if (y !== yr) { const a = amountOf(l) * (isUsd(l.o) ? fx : 1); if (!y) m.noDue += a; else if (y > yr) m.later += a; return }
      const a = amountOf(l), d = Math.min(+l.delivered_qty || 0, +l.qty || 0) * (+l.unit_price || 0)
      if (isUsd(l.o)) { m.usd += a; m.doneUsd += d } else { m.krw += a; m.doneKrw += d }
      const c = (m.byCust[l.o.customer_code] ||= { total: 0, done: 0 }), k = isUsd(l.o) ? fx : 1
      c.total += a * k; c.done += d * k
    })
    m.total = m.krw + m.usd * fx
    m.done = m.doneKrw + m.doneUsd * fx
    // 단가 없는 품목 — 연도 상관없이 (금액 합계에서 빠지는 줄). 눌러서 목록으로 본다 (v4.90.4)
    const noPrice = scoped.filter((l) => KPI_PICK.noPrice(l))
    const odd = scoped.filter((l) => KPI_PICK.odd(l))
    m.yr = yr
    return { unconfirmed, waiting, risk, late, monthPos, money: m, pos, noPrice, odd }
  }, [scoped, orders, month, today, cust, fx])

  const lines = useMemo(() => {
    let r = kpi && kpi !== 'month' ? kpis[kpi] : scoped
    if (!kpi) r = r.filter((l) => inView(view, l))
    if (kpi === 'month') { const ids = new Set(kpis.monthPos.map((o) => o.id)); r = scoped.filter((l) => ids.has(l.order_id)) }
    const due = (l) => l.due_date || '9999'
    const cmp = {
      due: (a, b) => due(a).localeCompare(due(b)) || a.o.po_no.localeCompare(b.o.po_no),
      reg: (a, b) => String(b.o.registered_at).localeCompare(String(a.o.registered_at)) || (+a.line_no - +b.line_no),
      cust: (a, b) => a.o.customer_code.localeCompare(b.o.customer_code) || due(a).localeCompare(due(b)),
    }[sort]
    return [...r].sort(cmp)
  }, [scoped, kpis, kpi, view, sort])

  // PO별 묶기 — PO 마다 전체 줄을 다시 거르면 PO 수 × 줄 수로 느려진다 → 한 번에 묶는다 (v4.90.6)
  const poRows = useMemo(() => {
    if (mode !== 'po') return []
    const by = new Map()
    lines.forEach((l) => { if (!by.has(l.order_id)) by.set(l.order_id, []); by.get(l.order_id).push(l) })
    return [...by].map(([id, ls]) => ({ o: byOrder.get(id), ls })).filter((x) => x.o)
      .map(({ o, ls }) => ({ o, ls, s: stageOf(o), amount: ls.filter((l) => !l.st.cancelled).reduce((a, l) => a + amountOf(l), 0) }))
  }, [lines, byOrder, mode])

  // 고객사 버튼 숫자 = 진행 중 PO 수
  // 고객사 버튼 숫자 = 지금 보는 목록과 같은 기준 (v4.90.4)
  //   품번별 → 품목 줄 수 · PO별 → PO 수 · 보기(진행 중/납품 완료/…) · 검색 · 지표 거르기를 그대로 따른다
  const counts = useMemo(() => {
    let base = allLines.filter(hit)
    if (kpi === 'month') base = base.filter((l) => isMonthPo(l.o, month))
    else if (kpi) base = base.filter((l) => KPI_PICK[kpi](l, today))
    else base = base.filter((l) => inView(view, l))
    const c = { all: new Set() }
    base.forEach((l) => { const id = mode === 'line' ? l.id : l.order_id; c.all.add(id); (c[l.o.customer_code] ||= new Set()).add(id) })
    return Object.fromEntries(Object.entries(c).map(([k2, v]) => [k2, v.size]))
  }, [allLines, k, mode, view, kpi, month, today]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 구매자재 동작 ──
  const replyMut = useMutation({
    mutationFn: ({ ls, form }) => replyLines(ls, form, meName),
    onSuccess: (r) => {
      const ids = new Set(r.ids)
      patchLines((l) => (ids.has(l.id) ? r.patch : null))
      patchHead(r.orderIds, (o) => (o.confirmed_at ? {} : r.head))
      setChecked(new Set()); toastSuccess(`${r.lines}건 회신 저장 → 영업 화면에 표시`)
    },
    onError: (e) => toastError(e.message),
  })
  const dlvMut = useMutation({
    mutationFn: ({ ls, on }) => markDelivered(ls, on, meName),
    onSuccess: (r) => { patchLines((l) => r.patches.get(l.id) || null); setChecked(new Set()) },
    onError: (e) => toastError('저장 실패: ' + e.message),
  })
  const relMut = useMutation({
    mutationFn: ({ ls, date }) => setReleaseDate(ls, date, meName),
    onSuccess: (r) => { const ids = new Set(r.ids); patchLines((l) => (ids.has(l.id) ? r.patch : null)); toastSuccess('협력사 불출일 저장') },
    onError: (e) => toastError(/release_date/.test(e.message || '') ? '불출일 칸이 아직 없습니다 — 수주대장_에드워드납기_반영_261023.sql 을 먼저 실행하세요' : '저장 실패: ' + e.message),
  })
  const [relDate, setRelDate] = useState('')
  const headMut = useMutation({
    mutationFn: async ({ id, patch, log }) => {
      const { error } = await supabase.from('pm_order').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      if (log) { const { error: e2 } = await supabase.from('pm_order_change').insert({ order_id: id, source: 'manual', changed_name: meName, ...log }); if (e2) throw e2 }
      return { id, patch }
    },
    onSuccess: (r) => { patchHead([r.id], () => ({ ...r.patch, updated_at: new Date().toISOString() })); toastSuccess('저장했습니다') },
    onError: (e) => toastError(/ship_to/.test(e.message || '') ? '납품처 칸이 아직 없습니다 — 수주대장_납품처_261023.sql 을 먼저 실행하세요' : '저장 실패: ' + e.message),
  })
  const delMut = useMutation({
    mutationFn: async (id) => { const { error } = await supabase.from('pm_order').delete().eq('id', id); if (error) throw error },
    onSuccess: (_, id) => { const o = byOrder.get(id); if (o) logActivity('delete', 'pm_order', o.po_no, `수주대장에서 PO 삭제 · 품목 ${o.lines.length}`, null, ORDER_CUSTOMERS[o.customer_code]?.name); setPoOpen(null); patchLocal((os) => os.filter((x) => x.id !== id)); toastSuccess('삭제했습니다') },
    onError: (e) => toastError('삭제 실패: ' + e.message),
  })

  // 줄 취소 · 되돌리기 · 정식 PO 번호 · 명세서번호 — 편집 권한이면 누구나 (v4.94.0)
  const cancelMut = useMutation({
    mutationFn: ({ ls, reason, memo }) => cancelLines(ls, reason, memo, meName),
    onSuccess: (r) => { const ids = new Set(r.ids); patchLines((l) => (ids.has(l.id) ? r.patch : null)); toastSuccess(`${r.ids.length}품목 취소 — 변경 이력에 남았습니다`) },
    onError: (e) => toastError(e.message),
  })
  const uncancelMut = useMutation({
    mutationFn: (ls) => uncancelLines(ls, meName),
    onSuccess: (r) => { const ids = new Set(r.ids); patchLines((l) => (ids.has(l.id) ? r.patch : null)); toastSuccess('취소를 되돌렸습니다') },
    onError: (e) => toastError(e.message),
  })
  const promoteMut = useMutation({
    mutationFn: ({ o, no }) => promotePo(o, no, meName),
    onSuccess: (r) => { patchHead([r.id], () => r.patch); toastSuccess(`정식 PO ${r.patch.po_no} 로 바꿨습니다`) },
    onError: (e) => toastError(e.message),
  })
  const slipMut = useMutation({
    mutationFn: ({ o, slip }) => setSlipNo(o, slip, meName),
    onSuccess: (r) => { patchHead([r.id], () => r.patch); toastSuccess('명세서번호 저장') },
    onError: (e) => toastError(e.message),
  })

  const [axPrev, setAxPrev] = useState(null)
  const [axBusy, setAxBusy] = useState(false)
  const axFileRef = useRef(null)
  // AXCELIS PO 엑셀(「고객사 PO」에 올리는 그 파일)을 골라 바로 읽는다 — Current Data + Received (v4.90.5)
  async function axPreview(file) {
    if (!file) return
    setAxBusy(true)
    try {
      const XLSX = await import('xlsx')
      const buf = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsArrayBuffer(file) })
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const parsed = parseAxPoWorkbook(XLSX, wb)
      const pv = await axSyncPreview(parsed.rows)
      setAxPrev({ ...pv, fileName: file.name, stats: parsed.stats })
    } catch (e) { toastError('PO 엑셀 읽기 실패: ' + e.message) }
    setAxBusy(false)
  }
  async function axRun() {
    setAxBusy(true)
    try { const r = await axSyncRun(axPrev, meName); toastSuccess(`PO 엑셀 반영 — 새 PO ${r.created}건 · 바뀐 품목 ${r.changed}${r.resets ? ` · 재회신 ${r.resets}` : ''}`); setAxPrev(null); refresh() } catch (e) { toastError('반영 실패: ' + e.message) }
    setAxBusy(false)
  }

  // 목록이 길면 화면이 무거움 — 100건씩 펼치고 「더 보기」 (v4.90.3)
  const PAGE = 100
  const [limit, setLimit] = useState(PAGE)
  useEffect(() => { setLimit(PAGE) }, [mode, cust, q, view, kpi, sort])
  const shownLines = useMemo(() => lines.slice(0, limit), [lines, limit])
  const shownPos = useMemo(() => poRows.slice(0, limit), [poRows, limit])
  const totalN = mode === 'line' ? lines.length : poRows.length
  const liveVisible = shownLines.filter((l) => !l.st.cancelled)
  const checkedLines = liveVisible.filter((l) => checked.has(l.id))
  const toggle = (id) => setChecked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allOn = liveVisible.length > 0 && liveVisible.every((l) => checked.has(l.id))

  if (error && /pm_order/.test(error.message || '')) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        수주대장 표가 아직 없습니다. Supabase SQL Editor 에서 <b>수주대장_261023.sql</b> 을 먼저 실행해 주세요.
        <div className="text-xs mt-1 text-amber-600">{error.message}</div>
      </div>
    )
  }
  const m = kpis.money
  const pos = kpis.pos
  const kpiBtn = (key) => ({ on: kpi === key, onClick: () => setKpi(kpi === key ? null : key) })
  const sel = 'text-xs font-semibold border border-slate-200 rounded-lg px-2.5 py-2 bg-white text-slate-600'

  return (
    <div className="space-y-4 min-w-0" data-order-intake data-view={isBuy ? 'buy' : 'sales'}>
      <div className="flex items-start gap-3">
        <p className="page-desc text-xs text-slate-400 flex-1 leading-relaxed">
          전장 고객사 PO 를 발주서 PDF 로 접수하고, 구매자재가 품번마다 확인 · 회신합니다. 같은 PO 를 다시 올리면 바뀐 것만 반영되고 변경 이력이 남습니다.
          {isBuy ? ' 품번을 체크해 한꺼번에 회신하세요.' : ' 구매자재 회신은 결론 · 준비일 · 메모만 보입니다.'}
        </p>
        <span className={`shrink-0 whitespace-nowrap px-3 py-1 rounded-full text-xs font-bold ${isBuy ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'}`} data-view-badge>{isBuy ? '구매자재 화면' : '영업 · 타부서 화면'}</span>
        {isAdmin && isPurchasing(profile) && (
          <button type="button" onClick={() => { setAsSales((v) => !v); setChecked(new Set()) }} data-as-sales
            title="영업 · 타부서 계정이 보는 화면을 미리 봅니다 (관리자만)"
            className={`shrink-0 whitespace-nowrap px-3 py-1 rounded-full text-xs font-bold border ${asSales ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
            {asSales ? '구매자재 화면으로 돌아가기' : '영업 화면으로 보기'}
          </button>
        )}
      </div>

      <nav className="flex gap-1 border-b border-slate-200 overflow-x-auto" aria-label="수주대장 탭" data-oi-tabs>
        {[['list', '수주 목록'], ['ecount', '이카운트 대조'], ['cleanup', '코드 · BOM 정리']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => goTab(k)} data-oi-tab={k}
            className={`px-4 py-2.5 text-[13.5px] whitespace-nowrap -mb-px border-b-2 ${tab === k ? 'font-extrabold text-violet-700 border-violet-600' : 'font-bold text-slate-500 border-transparent hover:text-slate-700'}`}>
            {l}{k === 'cleanup' && unregCount > 0 && <span className="ml-1.5 px-1.5 py-[1px] rounded-full bg-red-50 text-red-600 text-[10.5px] font-bold" data-unreg-count>미등록 {unregCount.toLocaleString('ko-KR')}</span>}
          </button>
        ))}
      </nav>
      {tab !== 'list' && (
        <Suspense fallback={<div className="p-8 text-center text-xs text-slate-400">불러오는 중…</div>}>
          {tab === 'ecount' ? <EcountMatch orders={orders} editable={editable} meName={meName} onChanged={refresh} />
            : <OrderCleanup orders={orders} editable={editable} meName={meName} onChanged={refresh} />}
        </Suspense>
      )}
      {tab === 'list' && <>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Kpi tone="red" label="미확인" value={kpis.unconfirmed.length} sub={`PO ${pos(kpis.unconfirmed)}건 · 등록 1영업일 넘게 확인 없음`} {...kpiBtn('unconfirmed')} />
        <Kpi tone="amber" label="회신 대기" value={kpis.waiting.length} sub={`PO ${pos(kpis.waiting)}건 · 변경 재회신 포함`} {...kpiBtn('waiting')} />
        <Kpi tone="red" label="조건부 · 불가" value={kpis.risk.length} sub={`PO ${pos(kpis.risk)}건 · 고객사 납기 협의`} {...kpiBtn('risk')} />
        <Kpi tone="red" label="납기 지남" value={kpis.late.length} sub={`PO ${pos(kpis.late)}건 · 납기일 지났는데 미납`} {...kpiBtn('late')} />
        <Kpi tone="violet" label="이번 달 접수" value={kpis.monthPos.length} sub="PDF · 직접 등록 PO (이관 제외)" {...kpiBtn('month')} />
      </div>

      {/* 올해 예상 매출 — 카드 줄과 따로 길게 (v4.90.3) · 고객사별 합계 / 납품 완료 / 납품 예정 (v4.90.4) */}
      <div className={`rounded-xl border px-4 md:px-5 py-3 flex flex-wrap items-start gap-x-8 gap-y-3 min-w-0 ${KPI_TONE.green[0]}`} data-kpi="예상 매출">
        <div className="min-w-0 md:min-w-[210px]">
          <div className="text-[12px] text-slate-500">{m.yr}년 예상 매출 <span className="text-[10.5px] text-slate-400">· 올해 납기 · 발주 단가</span></div>
          <div className="text-[22px] md:text-[26px] font-extrabold leading-tight tabular-nums text-emerald-700" data-money-total>{won(m.total)}</div>
          <div className="text-[11.5px] text-slate-600 tabular-nums mt-0.5">납품 완료 <b>{won(m.done)}</b> · 납품 예정 <b>{won(m.total - m.done)}</b></div>
        </div>
        {/* 휴대폰: 고객사마다 두 줄 (합계 / 완료 · 예정) — 큰 금액 4칸이 화면 밖으로 밀리던 것 (v4.90.7) */}
        <div className="md:hidden w-full divide-y divide-emerald-100 text-[12px] tabular-nums" data-money-cust-m>
          {Object.entries(ORDER_CUSTOMERS).filter(([k2]) => m.byCust[k2]).map(([k2, v]) => (
            <div key={k2} className="py-1.5" data-money-row-m={k2}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-600 whitespace-nowrap"><span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: v.color }} />{v.name}</span>
                <b className="text-slate-800">{won(m.byCust[k2].total)}</b>
              </div>
              <div className="flex justify-end flex-wrap gap-x-3 text-[11px] text-slate-500">
                <span>완료 {won(m.byCust[k2].done)}</span><span className="text-emerald-700 font-semibold">예정 {won(m.byCust[k2].total - m.byCust[k2].done)}</span>
              </div>
            </div>
          ))}
        </div>
        <table className="hidden md:table text-[12px] tabular-nums" data-money-cust>
          <thead><tr className="text-[11px] text-slate-400">
            <th className="text-left font-semibold pr-5 pb-1">고객사</th><th className="text-right font-semibold px-3 pb-1">합계</th>
            <th className="text-right font-semibold px-3 pb-1">납품 완료</th><th className="text-right font-semibold pl-3 pb-1">납품 예정</th>
          </tr></thead>
          <tbody>
            {Object.entries(ORDER_CUSTOMERS).filter(([k2]) => m.byCust[k2]).map(([k2, v]) => (
              <tr key={k2} data-money-row={k2}>
                <td className="pr-5 py-0.5 whitespace-nowrap"><span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: v.color }} /><span className="text-slate-600">{v.name}</span></td>
                <td className="text-right px-3 font-bold text-slate-800">{won(m.byCust[k2].total)}</td>
                <td className="text-right px-3 text-slate-600">{won(m.byCust[k2].done)}</td>
                <td className="text-right pl-3 text-emerald-700 font-semibold">{won(m.byCust[k2].total - m.byCust[k2].done)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="w-full md:w-auto md:ml-auto text-[10.5px] text-slate-400 tabular-nums space-y-1 text-right">
          {m.usd > 0 && (
            <div className="flex items-center justify-end gap-1">달러 ${fmt(Math.round(m.usd))} × 환율
              <input value={fxIn} onChange={(e) => setFxIn(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={String(qcfg?.sellRate || 1400)} title="달러(CCN B) PO 환율 — 비우면 매출견적 기준 판매환율" data-fx className="w-14 px-1 py-0.5 text-[10.5px] border border-emerald-200 rounded bg-white" /></div>
          )}
          {m.later > 0 && <div data-money-later>내년 이후 납기 {won(m.later)} 별도</div>}
          {kpis.noPrice.length > 0 && (
            <button type="button" onClick={() => { setKpi(kpi === 'noPrice' ? null : 'noPrice'); setMode('line') }} data-noprice
              className={`px-2 py-1 rounded-lg font-bold border ${kpi === 'noPrice' ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-white border-amber-200 text-amber-700 hover:bg-amber-50'}`}>
              단가 없는 품목 {kpis.noPrice.length.toLocaleString('ko-KR')} (합계 제외) {kpi === 'noPrice' ? '✕' : '보기 →'}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5">
            {[['line', '품번별'], ['po', 'PO별']].map(([k2, l]) => (
              <button key={k2} type="button" onClick={() => setMode(k2)} data-mode={k2} className={`px-3 py-1.5 text-xs font-bold rounded-md ${mode === k2 ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500'}`}>{l}</button>
            ))}
          </div>
          <span className="w-px h-5 bg-slate-200 mx-1" />
          {[['all', '전체'], ...Object.entries(ORDER_CUSTOMERS).map(([k2, v]) => [k2, v.name])].map(([k2, l]) => (
            <button key={k2} type="button" onClick={() => setCust(k2)} data-cust={k2}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border ${cust === k2 ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
              {k2 !== 'all' && <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: ORDER_CUSTOMERS[k2].color }} />}{l}<span className={`ml-1 ${cust === k2 ? 'text-slate-300' : 'text-slate-400'}`}>{(counts[k2] || 0).toLocaleString('ko-KR')}</span>
            </button>
          ))}
          <span className="text-[11px] text-slate-400" data-count-unit>숫자 = {mode === 'line' ? '품목 줄 수' : 'PO 수'}</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {editable && <>
              <button type="button" onClick={() => axFileRef.current?.click()} disabled={axBusy} data-ax-import title="「고객사 PO」에 올리는 AXCELIS PO 관리 엑셀을 고르세요 (Current Data · Received 시트)"
                className="px-3 py-2 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50">{axBusy ? '읽는 중…' : '🔁 AX PO 엑셀 반영'}</button>
              <input ref={axFileRef} type="file" accept=".xlsx,.xlsm,.xls" className="hidden" data-ax-file onChange={(e) => { axPreview(e.target.files?.[0]); e.target.value = '' }} />
            </>}
            {editable && <>
              <button type="button" onClick={downloadTemplate} data-entry-template title="구두 발주 · 선진행 · 발주 예정 · PDF 없는 PO 를 엑셀로 여러 건 올리는 양식" className="px-3 py-2 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50">엑셀 양식 받기</button>
              <button type="button" onClick={() => setEntry('excel')} data-open-entry-excel className="px-3 py-2 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50">엑셀로 여러 건</button>
              <button type="button" onClick={() => setEntry('one')} data-open-entry className="px-3 py-2 rounded-lg text-xs font-bold bg-violet-50 border border-violet-200 text-violet-700 hover:bg-violet-100">직접 등록</button>
              <button type="button" onClick={() => setUpload(true)} data-open-upload className="px-4 py-2 rounded-lg text-xs font-bold bg-violet-600 text-white hover:bg-violet-700">📄 PDF 올리기</button>
            </>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 PO번호 · 품번 · 품명 · 납품처 · 관리번호 · Plnd 번호 검색" data-search
            className="flex-1 min-w-0 basis-full md:basis-auto md:min-w-[240px] px-3 py-2 text-xs border border-slate-200 rounded-lg" />
          <select value={view} onChange={(e) => { setView(e.target.value); setKpi(null) }} className={sel} data-viewsel>
            <option value="live">진행 중 (전체)</option><option value="po">진행 중 · 발주 확정만</option><option value="temp">구두 발주 · 선진행만</option><option value="plan">발주 예정만</option><option value="done">납품 완료</option><option value="cancel">취소된 줄</option><option value="all">전체</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className={sel} data-sort>
            <option value="due">납기 빠른 순</option><option value="reg">최근 접수 순</option><option value="cust">고객사 순</option>
          </select>
          <button type="button" onClick={() => { setKpi(kpi === 'odd' ? null : 'odd'); setMode('line') }} data-odd-btn
            title={`진행 중 줄 가운데 — 같은 품목의 바로 앞 PO 와 Rev 가 다르거나 · 단가가 ${ODD_PRICE_PCT}% 넘게 다르거나 · 메모에 ⚠ 가 있는 줄`}
            className={`px-3 py-2 rounded-lg text-xs font-bold border whitespace-nowrap ${kpi === 'odd' ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-white border-amber-200 text-amber-700 hover:bg-amber-50'}`}>
            ⚠ 특이사항 {kpis.odd.length.toLocaleString('ko-KR')}
            <span className="font-semibold text-amber-600/80 ml-1">Rev {kpis.odd.filter((l) => l.odd.rev).length} · 단가 {kpis.odd.filter((l) => l.odd.price).length}{kpis.odd.some((l) => l.odd.note) ? ` · 메모 ${kpis.odd.filter((l) => l.odd.note).length}` : ''}</span>
            {kpi === 'odd' && ' ✕'}
          </button>
          {kpi && <button type="button" onClick={() => setKpi(null)} className="text-xs text-violet-600 font-bold">지표 거르기 해제 ✕</button>}
        </div>
      </div>

      {axPrev && (() => {
        const s = axPrev.summary
        const nothing = !s.newPos && !s.changedPos
        return (
          <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 text-sm" data-ax-preview>
            <b>AXCELIS PO 엑셀 → 수주대장 반영</b> <span className="text-xs font-mono text-slate-500">{axPrev.fileName}</span>
            <div className="text-xs text-slate-500 mt-0.5" data-ax-stats>
              읽은 줄: Current Data(진행 중) <b>{axPrev.stats.cur.toLocaleString('ko-KR')}</b>
              {axPrev.stats.rcvSheet ? <> · Received 올해 납기 <b>{axPrev.stats.rcv.toLocaleString('ko-KR')}</b> (납품 {axPrev.stats.rcvDone} · 취소 {axPrev.stats.rcvCancel} · 그 밖 {axPrev.stats.rcvOther}) · 작년 이전 {axPrev.stats.rcvOld.toLocaleString('ko-KR')}줄은 안 씀</> : ' · Received 시트 없음'}
            </div>
            {nothing ? <div className="mt-2 text-xs text-slate-600">바뀐 것이 없습니다.</div> : (
              <div className="mt-2 text-xs text-slate-700 space-y-1">
                {s.newPos > 0 && <div>· 새로 들일 PO <b>{s.newPos}</b>건 · {s.newLines}품목 (진행 중 {s.newLive}건 · 납품 끝난 PO {s.newDone}건은 납품 · 판매입력 완료로)</div>}
                {s.changedPos > 0 && <div>· 바뀐 PO <b>{s.changedPos}</b>건 — 납기 {s.due} · 수량 {s.qty} · Rev {s.rev} · 단가 {s.price} · 납품 완료 {s.delivered} · 취소 {s.cancelled} · 품목 추가 {s.added}</div>}
                {s.fromRcv > 0 && <div>· 그중 Received 시트에서 온 줄 {s.fromRcv} — Current Data 에 없는 지난 납품 · 취소분</div>}
                {s.resets > 0 && <div className="text-red-600">· 납기가 당겨지거나 수량이 늘어 <b>재회신 필요</b> {s.resets}건</div>}
                {axPrev.hist.length > 0 && (
                  <div className="mt-2 max-h-40 overflow-y-auto bg-white rounded-lg border border-violet-100 p-2 font-mono text-[11px]">
                    {axPrev.hist.slice(0, 60).map((c, i) => (
                      <div key={i}>{c.po_no} {c.line_key} {FIELD_LABEL[c.field] || c.field}: {c.before_val != null && <span className="line-through text-slate-400">{c.before_val}</span>}{c.before_val != null && ' → '}<b>{c.after_val ?? '—'}</b></div>
                    ))}
                    {axPrev.hist.length > 60 && <div className="text-slate-400">… {axPrev.hist.length - 60}건 더</div>}
                  </div>
                )}
              </div>
            )}
            {s.missing > 0 && (
              <details className="mt-2 text-xs text-amber-700" data-ax-missing>
                <summary className="cursor-pointer">⚠ 엑셀 어디에도 없는 수주대장 진행 중 줄 {s.missing} — 바꾸지 않음 (줄 번호가 바뀌었거나 Received 반영 전일 수 있음)</summary>
                <div className="mt-1 font-mono text-[11px] text-slate-600 max-h-32 overflow-y-auto">{axPrev.missing.slice(0, 80).map((x, i) => <div key={i}>{x.po_no} {x.key} · 납기 {x.due || '—'}</div>)}</div>
              </details>
            )}
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setAxPrev(null)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-200">닫기</button>
              {!nothing && <button type="button" disabled={axBusy} onClick={axRun} data-ax-run className="px-3 py-1.5 rounded-lg text-xs font-bold bg-violet-600 text-white disabled:opacity-40">반영하기</button>}
            </div>
          </div>
        )
      })()}

      {isBuy && checkedLines.length > 0 && (
        <div className="sticky top-0 z-20 rounded-xl border border-violet-300 bg-white shadow-md px-4 py-3 flex flex-wrap items-center gap-3" data-bulk>
          <b className="text-xs text-violet-700 whitespace-nowrap">품목 {checkedLines.length}개 선택 · PO {new Set(checkedLines.map((l) => l.order_id)).size}건</b>
          <div className="flex-1"><ReplyForm count={checkedLines.length} busy={replyMut.isPending} onSave={(form) => replyMut.mutate({ ls: checkedLines, form })} /></div>
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 whitespace-nowrap" title="협력사에 자재를 내줘야 하는 날 — 납기(고객사 납품일)와 따로 관리">협력사 불출일
            <input type="date" value={relDate} onChange={(e) => setRelDate(e.target.value)} data-bulk-release-date className="px-2 py-1 text-xs border border-slate-200 rounded-lg" />
            <button type="button" disabled={!relDate || relMut.isPending} onClick={() => relMut.mutate({ ls: checkedLines, date: relDate }, { onSuccess: () => { setRelDate(''); setChecked(new Set()) } })} data-bulk-release className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white border border-slate-300 disabled:opacity-40">저장</button>
          </label>
          <button type="button" onClick={() => dlvMut.mutate({ ls: checkedLines.filter((l) => !l.st.delivered), on: true })} data-bulk-dlv className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300">납품 표시</button>
          <button type="button" onClick={() => setChecked(new Set())} className="text-xs text-slate-400 hover:text-slate-700">선택 해제</button>
        </div>
      )}

      {narrow ? (
        <div className="space-y-2" data-mobile-list>
          {isLoading && <div className="p-8 text-center text-xs text-slate-400 bg-white border border-slate-200 rounded-xl">불러오는 중…</div>}
          {mode === 'line' && <>
            {!isLoading && !lines.length && <div className="p-8 text-center text-xs text-slate-400 bg-white border border-slate-200 rounded-xl">{orders.length ? '조건에 맞는 품목이 없습니다' : '아직 등록된 PO 가 없습니다'}</div>}
            {isBuy && liveVisible.length > 0 && (
              <label className="flex items-center gap-2 px-1 text-[11px] font-bold text-slate-500"><input type="checkbox" checked={allOn} onChange={() => setChecked(allOn ? new Set() : new Set(liveVisible.map((l) => l.id)))} data-check-all-m />보이는 품목 전체 선택</label>
            )}
            {shownLines.map((l) => <LineCard key={l.id} l={l} isBuy={isBuy} checked={checked.has(l.id)} onToggle={() => toggle(l.id)} onOpen={() => setPoOpen(l.order_id)} />)}
          </>}
          {mode === 'po' && <>
            {!isLoading && !poRows.length && <div className="p-8 text-center text-xs text-slate-400 bg-white border border-slate-200 rounded-xl">조건에 맞는 PO 가 없습니다</div>}
            {shownPos.map((r) => <PoCard key={r.o.id} {...r} onOpen={() => setPoOpen(r.o.id)} />)}
          </>}
        </div>
      ) : (
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        {mode === 'line' ? (
          <table className="text-xs" style={tableStyle(lineCols, lineRz)} data-line-table>
            <ColGroup cols={lineCols} rz={lineRz} />
            <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-200"><tr className="text-left">
              {isBuy && <th className="pl-4 py-2.5"><input type="checkbox" checked={allOn} onChange={() => setChecked(allOn ? new Set() : new Set(liveVisible.map((l) => l.id)))} data-check-all /></th>}
              <Th k="due" rz={lineRz}><span title="납기 = 고객사 납품일 · 그 아래 「불출」 = 협력사 불출일">납기</span></Th><Th k="cust" rz={lineRz}>고객사 · 납품처</Th><Th k="po" rz={lineRz}>PO번호</Th>
              <Th k="pn" rz={lineRz}>품번 · 품명</Th><Th k="qty" rz={lineRz} className="text-right">수량</Th><Th k="amt" rz={lineRz} className="text-right">금액</Th>
              <Th k="st" rz={lineRz}>상태</Th><Th k="reply" rz={lineRz}>구매자재 회신</Th>
            </tr></thead>
            <tbody>
              {isLoading && <tr><td colSpan={9} className="p-8 text-center text-slate-400">불러오는 중…</td></tr>}
              {!isLoading && !lines.length && <tr><td colSpan={9} className="p-10 text-center text-slate-400">{orders.length ? '조건에 맞는 품목이 없습니다' : '아직 등록된 PO 가 없습니다 — 「📄 PDF 올리기」로 시작하세요'}</td></tr>}
              {shownLines.map((l) => {
                const late = l.st.live && !l.st.confirmed && !l.o.migrated && !l.o.planned && bizDaysSince(l.o.registered_at) >= 1
                const [stLabel, stCls] = statusOf(l)
                return (
                  <tr key={l.id} className={`border-t border-slate-100 align-top hover:bg-slate-50/70 ${l.st.cancelled ? 'opacity-40' : ''} ${checked.has(l.id) ? 'bg-violet-50/60' : ''}`} data-row={`${l.o.po_no}|${l.line_no}/${l.del_line}`}>
                    {isBuy && <td className="pl-4 py-3">{!l.st.cancelled && <input type="checkbox" checked={checked.has(l.id)} onChange={() => toggle(l.id)} data-check={`${l.o.po_no}|${l.line_no}/${l.del_line}`} />}</td>}
                    <td className="px-3 py-3"><DueCell l={l} /></td>
                    <td className="px-3 py-3"><CustCell o={l.o} /></td>
                    <td className="px-3 py-3 whitespace-nowrap overflow-hidden">
                      <button type="button" onClick={() => setPoOpen(l.order_id)} className={`font-mono font-bold hover:underline ${l.o.planned ? 'text-violet-600' : 'text-[#5b6ee8]'}`} data-po-link={l.o.po_no}>{l.o.po_no}</button><KindBadge o={l.o} />
                      {l.o.planned
                        ? <div className="text-[11px] text-slate-400 mt-0.5 truncate" title={`Plnd ${l.plnd_no || '—'} · Prod ${l.prod_no || '—'}`}>{l.plnd_no ? `Plnd ${l.plnd_no}` : '번호 없음'}{mgmtNoOf(l) ? ` · ${mgmtNoOf(l)}` : ''}</div>
                        : <div className="text-[11px] text-slate-400 mt-0.5 truncate">Line {l.line_no}{l.del_line !== '1' ? `/${l.del_line}` : ''} · 접수 {md(String(l.o.registered_at).slice(0, 10))}{l.o.migrated ? ' · 이관' : ''}{l.plnd_no ? ` · Plnd ${l.plnd_no}` : ''}</div>}
                    </td>
                    <td className="px-3 py-3 overflow-hidden">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {l.items ? <span className="font-mono font-bold text-slate-800">{l.items.std_code}</span> : <span className="font-mono text-slate-500">{l.raw_pn || '품번 없음'}</span>}
                        {!l.items && <span className="px-1.5 py-[1px] rounded bg-amber-50 text-amber-700 text-[10px] font-bold">미등록</span>}
                        {l.rev && <span className="px-1.5 py-[1px] rounded bg-slate-100 text-slate-500 text-[10px] font-bold">Rev {l.rev}</span>}
                        <OddBadges odd={l.odd} />
                      </div>
                      <div className="text-[11.5px] text-slate-500 truncate" title={l.items?.name || l.raw_desc || ''}>{l.items?.name || l.raw_desc || '—'}</div>
                      {l.note && <div className="text-[10.5px] text-slate-400 truncate" title={l.note}>{l.note}</div>}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden">
                      <div className="text-slate-800">{fmt(l.qty)}</div>
                      <PackNote l={l} />
                      {+l.delivered_qty > 0 && <div className="text-[10.5px] text-emerald-600">납품 {fmt(l.delivered_qty)}</div>}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden">
                      <div className="text-slate-800">{+l.unit_price ? money(l.o, amountOf(l)) : '—'}</div>
                      {+l.unit_price > 0 && <div className="text-[10.5px] text-slate-400">@ {isUsd(l.o) ? '$' : ''}{fmt(l.unit_price)}</div>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${stCls}`} data-status title={l.cancel_reason || ''}>{stLabel}</span>
                      {late && <div className="text-[10.5px] text-red-500 mt-0.5">{bizDaysSince(l.o.registered_at)}영업일 미확인</div>}
                      {l.st.cancelled && l.cancel_reason && <div className="text-[10.5px] text-slate-500 mt-0.5 whitespace-normal" data-cancel-reason>{l.cancel_reason}</div>}
                    </td>
                    <td className="px-3 py-3"><ReplyCell l={l} memo={!isBuy} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <table className="text-xs" style={tableStyle(PO_COLS, poRz)} data-po-table>
            <ColGroup cols={PO_COLS} rz={poRz} />
            <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-200"><tr className="text-left">
              <Th k="po" rz={poRz} className="pl-4">PO번호</Th><Th k="cust" rz={poRz}>고객사 · 납품처</Th><Th k="items" rz={poRz}>품목</Th>
              <Th k="due" rz={poRz}>가장 빠른 납기</Th><Th k="amt" rz={poRz} className="text-right">금액</Th><Th k="reply" rz={poRz}>회신</Th><Th k="reg" rz={poRz}>등록</Th>
            </tr></thead>
            <tbody>
              {!isLoading && !poRows.length && <tr><td colSpan={7} className="p-10 text-center text-slate-400">조건에 맞는 PO 가 없습니다</td></tr>}
              {shownPos.map(({ o, ls, amount }) => {
                const rp = ls.filter((l) => !l.st.cancelled)
                const replied = rp.filter((l) => l.reply).length
                const liveL = rp.filter((l) => l.st.live)
                const first = { ...liveL.slice().sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9')))[0], st: { live: true } }
                return (
                  <tr key={o.id} onClick={() => setPoOpen(o.id)} className="border-t border-slate-100 align-top cursor-pointer hover:bg-slate-50/70" data-order={o.po_no}>
                    <td className="px-4 py-3 whitespace-nowrap overflow-hidden"><div className={`font-mono font-bold ${o.planned ? 'text-violet-600' : 'text-[#5b6ee8]'}`}>{o.po_no}<KindBadge o={o} /></div><div className="text-[11px] text-slate-400 mt-0.5">{o.planned ? '실제 발주 오면 PO 로 옮겨짐' : `접수 ${md(String(o.registered_at).slice(0, 10))}${o.migrated ? ' · 이관' : ''}`}</div></td>
                    <td className="px-3 py-3"><CustCell o={o} /></td>
                    <td className="px-3 py-3 overflow-hidden"><div className="font-bold text-slate-700">{rp.length}품목</div><div className="text-[11px] text-slate-400 truncate">{rp.slice(0, 3).map((l) => `${l.items?.std_code || l.raw_pn || l.raw_desc} ×${fmt(l.qty)}`).join(' · ')}</div></td>
                    <td className="px-3 py-3">{liveL.length ? <DueCell l={first} /> : <span className="text-slate-400">납품 완료</span>}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums whitespace-nowrap overflow-hidden">{amount ? money(o, amount) : '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap overflow-hidden">{replied ? <span className="text-slate-600">{replied}/{rp.length}</span> : <span className="text-slate-400">회신 전</span>}{rp.some((l) => l.reply && l.reply !== '가능') && <span className="ml-1.5 px-1.5 py-[1px] rounded bg-amber-50 text-amber-700 text-[10px] font-bold">조건부 · 불가</span>}</td>
                    <td className="px-3 py-3 text-slate-500 whitespace-nowrap overflow-hidden truncate">{o.registered_name || SOURCE_LABEL[o.source] || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      )}

      {totalN > limit && (
        <div className="-mt-2 flex flex-wrap items-center justify-center gap-2 py-2" data-more>
          <span className="text-xs text-slate-500 tabular-nums">{limit.toLocaleString('ko-KR')} / {totalN.toLocaleString('ko-KR')}{mode === 'line' ? '품목' : '건'} 표시</span>
          <button type="button" onClick={() => setLimit((n) => n + PAGE)} data-more-btn className="px-4 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50">더 보기 (+{Math.min(PAGE, totalN - limit)})</button>
          <button type="button" onClick={() => setLimit(totalN)} data-more-all className="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-800">전체 보기</button>
        </div>
      )}
      <div className="-mt-2 hidden md:flex items-center gap-2 px-1 text-[11px] text-slate-400">
        <span>💡 열 머리글 오른쪽 끝을 끌면 너비를 바꿀 수 있습니다 (이 브라우저에 기억)</span>
        <button type="button" onClick={() => (mode === 'line' ? lineRz : poRz).resetWidths()} data-reset-cols className="ml-auto hover:text-slate-600 underline-offset-2 hover:underline">열 너비 초기화</button>
      </div>

      {poOpen && byOrder.get(poOpen) && (
        <PoDrawer o={byOrder.get(poOpen)} isBuy={isBuy} editable={editable} fx={fx} oddMap={oddMap} onClose={() => setPoOpen(null)}
          onCancel={(ls, reason, memo, done) => cancelMut.mutate({ ls, reason, memo }, { onSuccess: done })} cancelBusy={cancelMut.isPending}
          onUncancel={(ls) => uncancelMut.mutate(ls)}
          onPromote={(o, no) => promoteMut.mutate({ o, no })} promoteBusy={promoteMut.isPending}
          onSlip={(o, slip) => slipMut.mutate({ o, slip })}
          onReply={(ls, form) => replyMut.mutate({ ls, form })} replyBusy={replyMut.isPending}
          onDlv={(ls, on) => dlvMut.mutate({ ls, on })} dlvBusy={dlvMut.isPending}
          onRelease={(ls, date) => relMut.mutate({ ls, date })}
          onConfirm={(o) => headMut.mutate({ id: o.id, patch: { confirmed_at: new Date().toISOString(), confirmed_name: meName } })}
          onShipTo={(o, v) => headMut.mutate({ id: o.id, patch: { ship_to: v || null }, log: { field: 'ship_to', before_val: o.ship_to || null, after_val: v || null } })}
          onDelete={(o) => { if (window.confirm(`${o.po_no} 를 수주대장에서 지울까요? (품목 · 변경 이력도 함께 지워집니다)`)) delMut.mutate(o.id) }} />
      )}
      {upload && <OrderUpload meName={meName} onClose={() => setUpload(false)} onSaved={refresh} />}
      {entry && <OrderEntry mode={entry} meName={meName} onClose={() => setEntry(null)} onSaved={refresh} />}
      </>}
    </div>
  )
}

// 휴대폰 카드 — 품번별 한 줄 (v4.90.7)
function LineCard({ l, isBuy, checked, onToggle, onOpen }) {
  const [stLabel, stCls] = statusOf(l)
  const late = l.st.live && !l.st.confirmed && !l.o.migrated && !l.o.planned && bizDaysSince(l.o.registered_at) >= 1
  const c = ORDER_CUSTOMERS[l.o.customer_code]
  return (
    <div className={`bg-white border rounded-xl p-3 ${checked ? 'border-violet-300 bg-violet-50/40' : 'border-slate-200'} ${l.st.cancelled ? 'opacity-50' : ''}`} data-mcard={`${l.o.po_no}|${l.line_no}/${l.del_line}`}>
      <div className="flex items-start gap-2">
        {isBuy && <div className="pt-0.5 w-5 shrink-0">{!l.st.cancelled && <input type="checkbox" className="w-4 h-4" checked={checked} onChange={onToggle} data-check={`${l.o.po_no}|${l.line_no}/${l.del_line}`} />}</div>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${c.badge}`}>{c.name}</span>
            <button type="button" onClick={onOpen} className={`font-mono font-bold text-[13px] ${l.o.planned ? 'text-violet-600' : 'text-[#5b6ee8]'}`} data-po-link={l.o.po_no}>{l.o.po_no}</button>
            <span className="text-[10.5px] text-slate-400">{l.o.planned ? (l.plnd_no ? `Plnd ${l.plnd_no}` : '') : `Line ${l.line_no}${l.del_line !== '1' ? `/${l.del_line}` : ''}`}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {l.items ? <span className="font-mono font-bold text-[12px] text-slate-800 break-all">{l.items.std_code}</span> : <span className="font-mono text-[12px] text-slate-500 break-all">{l.raw_pn || '품번 없음'}</span>}
            {!l.items && <span className="px-1.5 py-[1px] rounded bg-amber-50 text-amber-700 text-[10px] font-bold">미등록</span>}
            {l.rev && <span className="px-1.5 py-[1px] rounded bg-slate-100 text-slate-500 text-[10px] font-bold">Rev {l.rev}</span>}
            <OddBadges odd={l.odd} />
          </div>
          <div className="text-[11.5px] text-slate-500 truncate">{l.items?.name || l.raw_desc || '—'}</div>
          {(l.o.ship_to || mgmtNoOf(l)) && <div className="text-[10.5px] text-slate-400 truncate">{[l.o.ship_to, mgmtNoOf(l)].filter(Boolean).join(' · ')}</div>}
        </div>
        <div className="shrink-0 text-right">
          <span className={`inline-block px-2 py-0.5 rounded-full text-[10.5px] font-bold whitespace-nowrap ${stCls}`} data-status>{stLabel}</span>
          {late && <div className="text-[10px] text-red-500 mt-0.5 whitespace-nowrap">{bizDaysSince(l.o.registered_at)}영업일 미확인</div>}
        </div>
      </div>
      <div className={`mt-2 pt-2 border-t border-slate-100 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 text-xs ${isBuy ? 'pl-7' : ''}`}>
        <div className="min-w-0"><div className="text-[10px] text-slate-400">납기</div><DueCell l={l} /></div>
        <div className="text-right font-mono tabular-nums min-w-0"><div className="text-[10px] text-slate-400 font-sans">수량</div><div className="text-slate-800">{fmt(l.qty)}</div><PackNote l={l} />{+l.delivered_qty > 0 && <div className="text-[10.5px] text-emerald-600">납품 {fmt(l.delivered_qty)}</div>}</div>
        <div className="text-right font-mono tabular-nums min-w-0"><div className="text-[10px] text-slate-400 font-sans">금액</div><div className="text-slate-800 whitespace-nowrap">{+l.unit_price ? money(l.o, amountOf(l)) : '—'}</div>{+l.unit_price > 0 && <div className="text-[10px] text-slate-400">@ {isUsd(l.o) ? '$' : ''}{fmt(l.unit_price)}</div>}</div>
      </div>
      {l.reply && <div className={`mt-2 ${isBuy ? 'pl-7' : ''}`}><ReplyCell l={l} memo /></div>}
    </div>
  )
}

// 휴대폰 카드 — PO별 (v4.90.7)
function PoCard({ o, ls, amount, onOpen }) {
  const c = ORDER_CUSTOMERS[o.customer_code]
  const rp = ls.filter((l) => !l.st.cancelled)
  const replied = rp.filter((l) => l.reply).length
  const liveL = rp.filter((l) => l.st.live)
  const first = { ...liveL.slice().sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9')))[0], st: { live: true } }
  return (
    <button type="button" onClick={onOpen} className="w-full text-left bg-white border border-slate-200 rounded-xl p-3" data-order={o.po_no}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${c.badge}`}>{c.name}</span>
        <span className={`font-mono font-bold text-[13px] ${o.planned ? 'text-violet-600' : 'text-[#5b6ee8]'}`}>{o.po_no}</span>
        {o.ship_to && <span className="text-[10.5px] text-slate-400">{o.ship_to}</span>}
        <span className="ml-auto text-[11px] text-slate-500">{replied ? `회신 ${replied}/${rp.length}` : '회신 전'}</span>
      </div>
      <div className="mt-1 text-[11px] text-slate-500 truncate"><b className="text-slate-700">{rp.length}품목</b> · {rp.slice(0, 3).map((l) => `${l.items?.std_code || l.raw_pn || l.raw_desc} ×${fmt(l.qty)}`).join(' · ')}</div>
      <div className="mt-2 pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
        <div><div className="text-[10px] text-slate-400">가장 빠른 납기</div>{liveL.length ? <DueCell l={first} /> : <span className="text-slate-400">납품 완료</span>}</div>
        <div className="text-right font-mono tabular-nums"><div className="text-[10px] text-slate-400 font-sans">금액</div>{amount ? money(o, amount) : '—'}</div>
      </div>
    </button>
  )
}

// PO 한 건 — 원본 · 등록 · 품목 · 변경 이력 · PO 전체 회신
function PoDrawer({ o, isBuy, editable, fx, oddMap, onClose, onReply, replyBusy, onDlv, dlvBusy, onRelease, onConfirm, onShipTo, onDelete,
  onCancel, cancelBusy, onUncancel, onPromote, promoteBusy, onSlip }) {
  const { data: changes = [] } = useQuery({
    queryKey: ['orderChanges', o.id, o.updated_at, o.lines.map((l) => l.updated_at || '').join()],
    queryFn: async () => {
      const { data, error } = await supabase.from('pm_order_change').select('*').eq('order_id', o.id).order('changed_at', { ascending: false }).limit(300)
      if (error) throw error
      return data || []
    },
  })
  const [ship, setShip] = useState(o.ship_to || '')
  const [slip, setSlip] = useState(o.slip_no || '')
  const [newNo, setNewNo] = useState('')
  const [pick, setPick] = useState(() => new Set())      // 취소할 줄
  const [why, setWhy] = useState('')
  const [whyMemo, setWhyMemo] = useState('')
  const c = ORDER_CUSTOMERS[o.customer_code]
  const k = kindOf(o)
  const ls = o.lines.map((l) => ({ ...l, o, st: lineState(l, o) }))
  const cancellable = (l) => !l.st.cancelled && !(+l.delivered_qty > 0)
  const picked = ls.filter((l) => pick.has(l.id) && cancellable(l))
  const togglePick = (id) => setPick((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n })
  const waitDays = isTempPo(o) && o.registered_at ? Math.max(0, Math.round((Date.now() - new Date(o.registered_at)) / 86400000)) : 0
  const live = ls.filter((l) => l.st.live)
  const amount = ls.filter((l) => !l.st.cancelled).reduce((a, l) => a + amountOf(l), 0)
  const usd = isUsd(o)
  const Info = ({ k: label, children }) => <div><div className="text-[10.5px] text-slate-400">{label}</div><div className="text-xs text-slate-700 font-semibold">{children}</div></div>
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onClose} data-po-drawer={o.po_no}>
      <div className="w-full max-w-[920px] h-full bg-[#f7f8fb] shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 z-10">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${c.badge}`}>{c.name}</span>
            <b className="font-mono text-lg text-slate-800">{o.po_no}</b>
            {o.migrated && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">이관</span>}
            {k !== 'po' && <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-bold ${KIND_TONE[k]}`} data-drawer-kind={k}>{KINDS[k]}</span>}
            <button type="button" onClick={onClose} className="ml-auto text-sm font-bold text-slate-400 hover:text-slate-700">✕ 닫기</button>
          </div>
          <div className="mt-3 grid grid-cols-3 md:grid-cols-6 gap-3">
            <Info k="발주일">{o.order_date || '—'}</Info>
            <Info k={o.customer_code === 'AX' ? '통화 · CCN' : '통화'}>{o.currency}{o.ccn ? ` · CCN ${o.ccn}` : ''}</Info>
            <Info k="납품처">{isBuy ? (
              <span className="flex gap-1"><input value={ship} onChange={(e) => setShip(e.target.value)} placeholder="예: 아산 공장" data-ship-input className="w-28 px-1.5 py-0.5 text-xs border border-slate-200 rounded" />
                {ship !== (o.ship_to || '') && <button type="button" onClick={() => onShipTo(o, ship.trim())} data-ship-save className="text-[11px] text-violet-600 font-bold">저장</button>}</span>
            ) : (o.ship_to || '—')}</Info>
            <Info k="금액">{usd ? `$${fmt(Math.round(amount * 100) / 100)} ≈ ${won(amount * fx)}` : won(amount)}</Info>
            <Info k="등록">{o.registered_name || SOURCE_LABEL[o.source] || '—'} · {md(String(o.registered_at).slice(0, 10))}</Info>
            <Info k="확인">{o.confirmed_at ? [o.confirmed_name, md(String(o.confirmed_at).slice(0, 10))].filter(Boolean).join(' · ') : <span className="text-red-500">확인 전</span>}</Info>
          </div>
          {!o.planned && (
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              <span className="flex items-center gap-1.5"><span className="text-[10.5px] text-slate-400">이카운트 명세서번호</span>
                {editable ? <>
                  <input value={slip} onChange={(e) => setSlip(e.target.value)} placeholder="예: 2026/10/23-4" data-slip-input className="w-36 px-1.5 py-0.5 text-xs font-mono border border-slate-200 rounded" />
                  {slip.trim() !== (o.slip_no || '') && <button type="button" onClick={() => onSlip(o, slip)} data-slip-save className="text-[11px] text-violet-600 font-bold">저장</button>}
                </> : <b className="font-mono text-slate-700">{o.slip_no || '—'}</b>}
              </span>
              {(o.req_channel || o.req_person) && <span className="text-slate-600"><span className="text-[10.5px] text-slate-400 mr-1">받은 경로</span>{[o.req_channel, o.req_person].filter(Boolean).join(' · ')}</span>}
              {o.po_due && <span className={o.po_due < todayISO() && isTempPo(o) ? 'text-red-600 font-bold' : 'text-slate-600'}><span className="text-[10.5px] text-slate-400 mr-1">정식 PO 받을 날</span>{o.po_due}</span>}
            </div>
          )}
          {o.file_name && <div className="mt-2 text-[11px] text-slate-400">📄 {o.file_name}</div>}
        </div>
        <div className="p-3 md:p-6 space-y-4">
          <RiskBanner ls={ls} />
          {isTempPo(o) && editable && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3" data-promote>
              <div className="text-xs font-extrabold text-amber-800">{KINDS[k]} · 정식 PO 대기 {waitDays}일째</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input value={newNo} onChange={(e) => setNewNo(e.target.value)} placeholder="정식 PO 번호" data-promote-input className="w-48 h-8 px-2 text-xs font-mono border border-slate-200 rounded-lg bg-white" />
                <button type="button" disabled={!newNo.trim() || promoteBusy} onClick={() => onPromote(o, newNo)} data-promote-save className="h-8 px-3 rounded-lg text-xs font-bold bg-violet-600 text-white disabled:opacity-40">정식 PO 번호로 바꾸기</button>
                <span className="text-[11px] text-slate-500">회신 · 명세서번호 · 이력은 그대로 이어집니다. 정식 발주서 PDF 가 이미 따로 등록됐으면 이 줄들은 「새 PO 로 재발행」으로 취소하세요.</span>
              </div>
            </div>
          )}
          {isBuy && (
            <div className="rounded-xl border border-violet-200 bg-white p-4 space-y-2.5" data-po-reply>
              <div className="flex items-center gap-2">
                <b className="text-xs text-slate-700">이 PO 진행 중 {live.length}품목 전체에 회신</b>
                {!o.confirmed_at && <button type="button" onClick={() => onConfirm(o)} data-confirm className="ml-auto px-3 py-1 rounded-lg text-xs font-bold bg-white border border-slate-300">✓ 확인했음</button>}
              </div>
              <ReplyForm count={live.length} unit="품목" busy={replyBusy} onSave={(form) => onReply(live, form)} />
              <p className="text-[10.5px] text-slate-400">품번마다 다르게 답하려면 목록(품번별)에서 체크해 회신하세요. 자재 가용성 자동 계산은 다음 단계에서 붙습니다.</p>
            </div>
          )}
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto" data-dline-wrap>
            <table className="w-full min-w-[760px] text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-200"><tr className="text-left whitespace-nowrap">
                {editable && <th className="pl-3 py-2 w-6" title="취소할 줄 고르기" />}
                <th className="px-3 py-2 font-bold">{o.planned ? 'Plnd 번호' : 'Line'}</th><th className="px-3 font-bold">품번 · 품명</th>
                <th className="px-3 font-bold text-right">수량</th><th className="px-3 font-bold text-right">단가</th><th className="px-3 font-bold">납기</th>
                <th className="px-3 font-bold" title="협력사에 자재를 내줘야 하는 날">협력사 불출</th>
                {o.customer_code === 'AX' && <th className="px-3 font-bold">구분</th>}
                <th className="px-3 font-bold">회신</th>
                {isBuy && <th className="px-3 font-bold text-center">납품</th>}
              </tr></thead>
              <tbody>
                {ls.map((l) => (
                  <tr key={l.id} className={`border-t border-slate-100 align-top ${l.st.cancelled ? 'bg-slate-50/80' : ''}`} data-dline={`${l.line_no}/${l.del_line}`}>
                    {editable && <td className="pl-3 py-2">{cancellable(l) && <input type="checkbox" checked={pick.has(l.id)} onChange={() => togglePick(l.id)} data-pick={`${l.line_no}/${l.del_line}`} />}</td>}
                    <td className="px-3 py-2 font-mono text-slate-500">{o.planned ? (l.plnd_no ? <span title={`Prod ${l.prod_no || '—'}`}>{l.plnd_no}</span> : '—') : <>{l.line_no}{l.del_line !== '1' ? `/${l.del_line}` : ''}</>}{!o.planned && l.plnd_no && <div className="text-[10px] text-slate-400">Plnd {l.plnd_no}</div>}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">{l.items ? <span className="font-mono font-bold text-slate-800">{l.items.std_code}</span> : <><span className="font-mono text-slate-500">{l.raw_pn || '품번 없음'}</span><span className="px-1.5 py-[1px] rounded bg-amber-50 text-amber-700 font-bold text-[10px]">미등록</span></>}{l.rev && <span className="px-1.5 py-[1px] rounded bg-slate-100 text-slate-500 text-[10px] font-bold">Rev {l.rev}</span>}<OddBadges odd={oddMap?.get(l.id)} /></div>
                      <div className="text-[11px] text-slate-500">{l.items?.name || l.raw_desc}</div>
                      {l.note && <div className="text-[10.5px] text-slate-400">{l.note}</div>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(l.qty)}<PackNote l={l} />{+l.delivered_qty > 0 && <div className="text-[10.5px] text-emerald-600">납품 {fmt(l.delivered_qty)}</div>}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{l.unit_price != null ? `${usd ? '$' : ''}${fmt(l.unit_price)}` : '—'}</td>
                    <td className="px-3 py-2"><DueCell l={l} noRelease /></td>
                    <td className="px-3 py-2">{isBuy && !l.st.cancelled
                      ? <input type="date" defaultValue={l.release_date || ''} key={l.release_date || ''} data-release={`${l.line_no}/${l.del_line}`}
                          onBlur={(e) => { if ((e.target.value || '') !== (l.release_date || '')) onRelease([l], e.target.value) }}
                          className={`px-1.5 py-0.5 text-[11px] border rounded ${l.st.live && l.release_date && l.release_date < todayISO() ? 'border-red-300 text-red-600' : 'border-slate-200'}`} />
                      : <span className="text-slate-600">{l.release_date || '—'}</span>}</td>
                    {o.customer_code === 'AX' && <td className="px-3 py-2 text-slate-500">{l.division}</td>}
                    <td className="px-3 py-2">{l.st.cancelled
                      ? <div className="text-[11px] min-w-[140px]" data-dline-cancel>
                          <span className="px-1.5 py-[1px] rounded-full bg-slate-200 text-slate-600 font-bold text-[10.5px]">취소</span>
                          {l.cancel_reason && <div className="text-slate-600 mt-0.5">{l.cancel_reason}</div>}
                          {(l.cancelled_name || l.cancelled_at) && <div className="text-[10px] text-slate-400">{[l.cancelled_name, l.cancelled_at && md(String(l.cancelled_at).slice(0, 10))].filter(Boolean).join(' · ')}</div>}
                          {editable && <button type="button" onClick={() => onUncancel([l])} data-uncancel={`${l.line_no}/${l.del_line}`} className="mt-0.5 text-[10.5px] text-violet-600 font-bold hover:underline">취소 되돌리기</button>}
                        </div>
                      : <ReplyCell l={l} memo />}</td>
                    {isBuy && <td className="px-3 py-2 text-center">{!l.st.cancelled && <input type="checkbox" checked={l.st.delivered} disabled={dlvBusy} onChange={(e) => onDlv([l], e.target.checked)} data-dlv={`${l.line_no}/${l.del_line}`} />}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable && picked.length > 0 && (
            <div className="bg-white border border-red-200 rounded-xl px-4 py-3 space-y-2" data-cancel-panel>
              <div className="text-xs font-extrabold text-slate-800">고른 {picked.length}품목 취소 <span className="font-normal text-slate-500">— 지우지 않고 「취소」 표시 · 변경 이력에 남음 · 「취소 되돌리기」 가능</span></div>
              <div className="flex flex-wrap gap-1.5">
                {CANCEL_REASONS.map((r) => <button key={r} type="button" onClick={() => setWhy(r)} data-cancel-why={r} className={`px-3 py-1 rounded-full text-[12px] font-bold border ${why === r ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>{r}</button>)}
              </div>
              <div className="flex gap-2">
                <input value={whyMemo} onChange={(e) => setWhyMemo(e.target.value)} placeholder="사유 (필수) — 예: 회신 불가 납기지연, 고객사 협의 후 취소" data-cancel-memo className="flex-1 min-w-0 h-8 px-2.5 text-xs border border-slate-200 rounded-lg" />
                <button type="button" disabled={!why || !whyMemo.trim() || cancelBusy} data-cancel-run
                  onClick={() => onCancel(picked, why, whyMemo, () => { setPick(new Set()); setWhy(''); setWhyMemo('') })}
                  className="h-8 px-3.5 rounded-lg text-xs font-bold bg-red-500 text-white disabled:opacity-40 whitespace-nowrap">{picked.length}품목 취소</button>
              </div>
              <p className="text-[10.5px] text-slate-400">납품이 있는 줄은 고를 수 없습니다.</p>
            </div>
          )}
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3" data-changes>
            <div className="text-xs font-bold text-slate-700 mb-1.5">변경 이력 <span className="text-slate-400 font-normal">{changes.length}</span></div>
            {!changes.length && <div className="text-[11px] text-slate-400">아직 없습니다</div>}
            <div className="max-h-64 overflow-y-auto space-y-0.5">
              {changes.map((ch) => (
                <div key={ch.id} className="text-[11px] text-slate-600 font-mono">
                  <span className="text-slate-400">{ts(ch.changed_at)} {ch.changed_name || ''}{ch.source && ch.source !== 'manual' ? ` (${SOURCE_LABEL[ch.source] || ch.source})` : ''}</span> {ch.line_key ? `${ch.line_key} ` : ''}{FIELD_LABEL[ch.field] || ch.field}: {ch.before_val != null && <span className="line-through text-slate-400">{ch.before_val}</span>}{ch.before_val != null && ' → '}<b className="text-slate-800">{ch.after_val ?? '—'}</b>
                </div>
              ))}
            </div>
          </div>
          {isBuy && <button type="button" onClick={() => onDelete(o)} data-del className="text-[11px] text-red-500 hover:underline">이 PO 지우기</button>}
        </div>
      </div>
    </div>
  )
}
