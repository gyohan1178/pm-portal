// 📨 수주대장 — 전장 고객사 PO 를 접수부터 확인 · 회신 · 납품까지
//
//   v4.87.0  PDF 접수 · 변경 이력 · 회신 · AX PO 파일 반영
//   v4.88.0  기본 화면을 품번(줄)별로 — 납기순으로 PO 를 가로질러 본다 · 회신을 줄 단위로(여러 줄 한꺼번에)
//            · 발주 단가 · 금액 · 예상 매출(납품 완료 포함) · 구매자재 화면은 부서(구매자재)로 구분
//   화면은 보는 사람에 따라 다르다 — 구매자재 부서: 회신 입력 · 납품 표시 · PO 파일 반영 / 그 밖: 회신 결론만
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useMyProfile, canEdit, isPurchasing } from '../../hooks/useProfile'
import { toastError, toastSuccess } from '../../lib/toast'
import { todayISO } from '../../lib/utils'
import { fetchQuoteMarginCfg, QUOTE_CFG_KEY } from '../../lib/quoteSettings'
import {
  ORDER_CUSTOMERS, fetchOrders, stageOf, lineState, bizDaysSince, axSyncPreview, axSyncRun,
  replyLines, markDelivered, FIELD_LABEL, SOURCE_LABEL,
} from '../../lib/orderIntake'
import OrderUpload from './OrderUpload'

const fmt = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }))
const won = (v) => `₩${Math.round(v || 0).toLocaleString('ko-KR')}`
const md = (d) => (d ? String(d).slice(5).replace('-', '/') : '—')
const ts = (t) => String(t || '').slice(0, 16).replace('T', ' ')
const REPLY = {
  가능: ['bg-emerald-50 text-emerald-700', '✅ 가능'],
  조건부: ['bg-amber-50 text-amber-700', '◐ 조건부'],
  불가: ['bg-red-50 text-red-600', '✕ 불가'],
}
const KPI_TONE = {
  red: 'bg-red-50 border-red-100 text-red-600', amber: 'bg-amber-50 border-amber-100 text-amber-600',
  blue: 'bg-blue-50 border-blue-100 text-blue-600', violet: 'bg-violet-50 border-violet-100 text-violet-600',
  green: 'bg-emerald-50 border-emerald-100 text-emerald-700',
}
const isUsd = (o) => o.currency === 'USD' || o.ccn === 'B'
const amountOf = (l) => (+l.qty || 0) * (+l.unit_price || 0)

function Kpi({ tone, label, value, sub, on, onClick }) {
  return (
    <button type="button" onClick={onClick} data-kpi={label} disabled={!onClick}
      className={`text-left rounded-xl border px-4 py-3 ${KPI_TONE[tone]} ${on ? 'ring-2 ring-offset-1 ring-violet-400' : ''}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-extrabold leading-tight">{value}</div>
      <div className="text-[11px] text-slate-500">{sub}</div>
    </button>
  )
}

function Steps({ s }) {
  const st = [
    ['접수', 'd'],
    ['확인', s.confirmed ? 'd' : 'x'],
    ['회신', s.replied ? 'd' : s.confirmed ? 'n' : ''],
    ['납품', s.delivered ? 'd' : s.partDelivered ? 'n' : ''],
  ]
  const cls = { d: 'bg-emerald-50 text-emerald-700', n: 'bg-amber-50 text-amber-700', x: 'bg-red-50 text-red-600', '': 'bg-slate-100 text-slate-400' }
  return <div className="flex gap-0.5">{st.map(([l, k]) => <span key={l} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${cls[k]}`}>{l}</span>)}</div>
}

function ReplyBadge({ l, memo }) {
  if (!l.reply) return <span className="text-slate-400">—</span>
  return (
    <div title={l.reply_memo || ''}>
      <span className={`px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${REPLY[l.reply][0]}`}>{REPLY[l.reply][1]}{l.reply_date ? ` · ${md(l.reply_date)}` : ''}</span>
      {memo && l.reply_memo && <div className="text-[10.5px] text-slate-500 mt-0.5 max-w-[220px] truncate">{l.reply_memo}</div>}
    </div>
  )
}

// 회신 입력 — 여러 줄 한꺼번에
function ReplyForm({ count, onSave, busy, compact }) {
  const [reply, setReply] = useState('')
  const [date, setDate] = useState('')
  const [memo, setMemo] = useState('')
  return (
    <div className={`flex ${compact ? 'flex-wrap items-center' : 'flex-col'} gap-2`} data-reply-form>
      <div className="flex gap-1">
        {['가능', '조건부', '불가'].map((r) => (
          <button key={r} type="button" onClick={() => setReply(r)} data-reply={r}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border ${reply === r ? REPLY[r][0] + ' border-current' : 'bg-white border-slate-200 text-slate-500'}`}>{REPLY[r][1]}</button>
        ))}
      </div>
      <label className="flex items-center gap-1 text-[11px] font-bold text-slate-500">자재 준비 가능일
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-reply-date className="px-2 py-1 text-xs border border-slate-200 rounded-lg" />
      </label>
      <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="영업에 보일 메모 (조건부 · 불가는 사유 필수)" data-reply-memo
        className={`${compact ? 'flex-1 min-w-[220px]' : 'w-full'} px-2 py-1.5 text-xs border border-slate-200 rounded-lg`} />
      <button type="button" disabled={busy || !count} onClick={() => onSave({ reply, date, memo })} data-reply-save
        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-violet-600 text-white disabled:opacity-40 whitespace-nowrap">{count}줄 회신 저장</button>
    </div>
  )
}

export default function OrderIntake() {
  const qc = useQueryClient()
  const { data: profile, isLoading: pLoading } = useMyProfile()
  const isBuy = !pLoading && isPurchasing(profile)
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
  const [axOnlyElec, setAxOnlyElec] = useState(true)
  const [checked, setChecked] = useState(() => new Set())
  const [poOpen, setPoOpen] = useState(null)
  const [upload, setUpload] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['orderIntake'] })

  // 줄 펼치기 — AX 전장만이면 하네스 · 구매품 줄은 뺀다(PO 가 아니라 줄 단위로)
  const allLines = useMemo(() => orders.flatMap((o) => o.lines.map((l) => ({ ...l, o, st: lineState(l, o) })))
    .filter((l) => !axOnlyElec || l.o.customer_code !== 'AX' || !l.division || l.division === '전장'), [orders, axOnlyElec])
  const byOrder = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders])
  const k = q.trim().toUpperCase()
  const hit = (l) => !k || [l.o.po_no, l.o.file_name, l.items?.std_code, l.items?.name, l.raw_pn, l.raw_desc].some((v) => String(v || '').toUpperCase().includes(k))
  const scoped = useMemo(() => allLines.filter((l) => (cust === 'all' || l.o.customer_code === cust) && hit(l)), [allLines, cust, k]) // eslint-disable-line react-hooks/exhaustive-deps

  const month = todayISO().slice(0, 7)
  const kpis = useMemo(() => {
    const live = scoped.filter((l) => l.st.live && !l.o.migrated)
    const liveAll = scoped.filter((l) => l.st.live)
    const pos = (ls) => new Set(ls.map((l) => l.order_id)).size
    const unconfirmed = live.filter((l) => !l.st.confirmed && bizDaysSince(l.o.registered_at) >= 1)
    const waiting = liveAll.filter((l) => !l.reply)
    const risk = liveAll.filter((l) => l.reply === '조건부' || l.reply === '불가')
    const monthPos = orders.filter((o) => String(o.registered_at).slice(0, 7) === month && o.source !== 'po_file' && o.source !== 'ax_import' && (cust === 'all' || o.customer_code === cust))
    // 예상 매출 — 취소 빼고 납품 완료 포함. 달러(CCN B)는 환율을 곱한다
    const money = { krw: 0, usd: 0, doneKrw: 0, doneUsd: 0 }
    scoped.filter((l) => !l.st.cancelled).forEach((l) => {
      const a = amountOf(l), d = Math.min(+l.delivered_qty || 0, +l.qty || 0) * (+l.unit_price || 0)
      if (isUsd(l.o)) { money.usd += a; money.doneUsd += d } else { money.krw += a; money.doneKrw += d }
    })
    money.total = money.krw + money.usd * fx
    money.done = money.doneKrw + money.doneUsd * fx
    money.noPrice = scoped.filter((l) => !l.st.cancelled && !(+l.unit_price > 0)).length
    return { unconfirmed, waiting, risk, monthPos, money, pos }
  }, [scoped, orders, month, cust, fx])

  const lines = useMemo(() => {
    let r = kpi && kpi !== 'month' ? kpis[kpi] : scoped
    if (!kpi) {
      if (view === 'live') r = r.filter((l) => l.st.live)
      else if (view === 'done') r = r.filter((l) => l.st.delivered && !l.st.cancelled)
    }
    if (kpi === 'month') { const ids = new Set(kpis.monthPos.map((o) => o.id)); r = scoped.filter((l) => ids.has(l.order_id)) }
    const due = (l) => l.due_date || '9999'
    const cmp = {
      due: (a, b) => due(a).localeCompare(due(b)) || a.o.po_no.localeCompare(b.o.po_no),
      reg: (a, b) => String(b.o.registered_at).localeCompare(String(a.o.registered_at)) || (+a.line_no - +b.line_no),
      cust: (a, b) => a.o.customer_code.localeCompare(b.o.customer_code) || due(a).localeCompare(due(b)),
    }[sort]
    return [...r].sort(cmp)
  }, [scoped, kpis, kpi, view, sort])

  const poRows = useMemo(() => {
    const ids = [...new Set(lines.map((l) => l.order_id))]
    return ids.map((id) => byOrder.get(id)).filter(Boolean).map((o) => {
      const ls = lines.filter((l) => l.order_id === o.id)
      return { o, ls, s: stageOf(o), amount: ls.filter((l) => !l.st.cancelled).reduce((a, l) => a + amountOf(l), 0) }
    })
  }, [lines, byOrder])

  const counts = useMemo(() => {
    const c = { all: 0 }
    allLines.filter((l) => l.st.live && hit(l)).forEach((l) => { c.all++; c[l.o.customer_code] = (c[l.o.customer_code] || 0) + 1 })
    return c
  }, [allLines, k]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 구매자재 동작 ──
  const replyMut = useMutation({
    mutationFn: ({ ls, form }) => replyLines(ls, form, meName),
    onSuccess: (r) => { setChecked(new Set()); refresh(); toastSuccess(`${r.lines}줄 회신 저장 → 영업 화면에 표시`) },
    onError: (e) => toastError(e.message),
  })
  const dlvMut = useMutation({
    mutationFn: ({ ls, on }) => markDelivered(ls, on, meName),
    onSuccess: () => { setChecked(new Set()); refresh() },
    onError: (e) => toastError('저장 실패: ' + e.message),
  })
  const headMut = useMutation({
    mutationFn: async ({ id, patch }) => {
      const { error } = await supabase.from('pm_order').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { refresh(); toastSuccess('저장했습니다') },
    onError: (e) => toastError('저장 실패: ' + e.message),
  })
  const delMut = useMutation({
    mutationFn: async (id) => { const { error } = await supabase.from('pm_order').delete().eq('id', id); if (error) throw error },
    onSuccess: () => { setPoOpen(null); refresh(); toastSuccess('삭제했습니다') },
    onError: (e) => toastError('삭제 실패: ' + e.message),
  })

  const [axPrev, setAxPrev] = useState(null)
  const [axBusy, setAxBusy] = useState(false)
  async function axPreview() {
    setAxBusy(true)
    try { setAxPrev(await axSyncPreview()) } catch (e) { toastError('읽기 실패: ' + e.message) }
    setAxBusy(false)
  }
  async function axRun() {
    setAxBusy(true)
    try { const r = await axSyncRun(axPrev, meName); toastSuccess(`PO 파일 반영 — 새 PO ${r.created}건 · 바뀐 줄 ${r.changed}${r.resets ? ` · 재회신 ${r.resets}줄` : ''}`); setAxPrev(null); refresh() } catch (e) { toastError('반영 실패: ' + e.message) }
    setAxBusy(false)
  }

  const liveVisible = lines.filter((l) => !l.st.cancelled)
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
  const poCount = (ls) => kpis.pos(ls)

  return (
    <div className="space-y-4" data-order-intake data-view={isBuy ? 'buy' : 'sales'}>
      <div className="flex items-start gap-3">
        <p className="page-desc text-xs text-slate-400 flex-1">
          전장 고객사 PO 를 발주서 PDF 로 접수하고, 구매자재가 품번마다 확인 · 회신합니다. 같은 PO 를 다시 올리면 바뀐 것만 반영되고 변경 이력이 남습니다.
          {isBuy ? ' 지금은 구매자재 화면입니다 — 줄을 체크해 한꺼번에 회신하세요.' : ' 회신은 결론(가능 · 조건부 · 불가)과 가능일, 메모만 보입니다.'}
        </p>
        <span className={`px-3 py-1 rounded-full text-xs font-bold ${isBuy ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'}`}>{isBuy ? '구매자재 화면' : '영업 · 타부서 화면'}</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi tone="red" label="미확인" value={`${kpis.unconfirmed.length}줄`} sub={`PO ${poCount(kpis.unconfirmed)}건 · 등록 후 1영업일 넘게 확인 없음`} on={kpi === 'unconfirmed'} onClick={() => setKpi(kpi === 'unconfirmed' ? null : 'unconfirmed')} />
        <Kpi tone="amber" label="회신 대기" value={`${kpis.waiting.length}줄`} sub={`PO ${poCount(kpis.waiting)}건 · 변경으로 다시 회신할 것 포함`} on={kpi === 'waiting'} onClick={() => setKpi(kpi === 'waiting' ? null : 'waiting')} />
        <Kpi tone="red" label="조건부 · 불가" value={`${kpis.risk.length}줄`} sub="고객사와 납기 협의 필요" on={kpi === 'risk'} onClick={() => setKpi(kpi === 'risk' ? null : 'risk')} />
        <Kpi tone="violet" label="이번 달 접수" value={`${kpis.monthPos.length}건`} sub="PDF · 직접 등록 PO (이관 제외)" on={kpi === 'month'} onClick={() => setKpi(kpi === 'month' ? null : 'month')} />
        <div className={`rounded-xl border px-4 py-3 ${KPI_TONE.green}`} data-kpi="예상 매출">
          <div className="text-xs text-slate-500 flex items-center gap-1">예상 매출 <span className="text-[10px]">(납품 완료 포함 · 발주 단가)</span></div>
          <div className="text-xl font-extrabold leading-tight" data-money-total>{won(m.total)}</div>
          <div className="text-[11px] text-slate-500">납품 {won(m.done)} · 남은 {won(m.total - m.done)}</div>
          {m.usd > 0 && <div className="text-[10.5px] text-slate-500 flex items-center gap-1">원화 {won(m.krw)} + ${fmt(m.usd)} ×
            <input value={fxIn} onChange={(e) => setFxIn(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={String(qcfg?.sellRate || 1400)} title="달러(CCN B) PO 환율 — 비우면 매출견적 기준 판매환율" data-fx className="w-14 px-1 py-0.5 text-[10.5px] border border-emerald-200 rounded bg-white" /></div>}
          {m.noPrice > 0 && <div className="text-[10.5px] text-amber-600">단가 없는 줄 {m.noPrice} (합계 제외)</div>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {[['line', '품번별'], ['po', 'PO별']].map(([k2, l]) => (
            <button key={k2} type="button" onClick={() => setMode(k2)} data-mode={k2} className={`px-3 py-1 text-xs font-bold rounded-md ${mode === k2 ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500'}`}>{l}</button>
          ))}
        </div>
        {[['all', '전체'], ...Object.entries(ORDER_CUSTOMERS).map(([k2, v]) => [k2, v.name])].map(([k2, l]) => (
          <button key={k2} type="button" onClick={() => setCust(k2)} data-cust={k2}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border ${cust === k2 ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>
            {k2 !== 'all' && <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: ORDER_CUSTOMERS[k2].color }} />}{l} {counts[k2] || 0}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 PO번호 · 품번 · 품명 · 파일명 검색" data-search
          className="flex-1 min-w-[200px] px-3 py-2 text-xs border border-slate-200 rounded-xl" />
        <select value={view} onChange={(e) => { setView(e.target.value); setKpi(null) }} className="text-xs font-bold border border-slate-200 rounded-xl px-2 py-2" data-viewsel>
          <option value="live">진행 중</option><option value="done">납품 완료</option><option value="all">전체</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="text-xs font-bold border border-slate-200 rounded-xl px-2 py-2" data-sort>
          <option value="due">납기 빠른 순</option><option value="reg">최근 접수 순</option><option value="cust">고객사 순</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-500" title="AXCELIS 하네스 · 구매품 줄을 숨깁니다">
          <input type="checkbox" checked={axOnlyElec} onChange={(e) => setAxOnlyElec(e.target.checked)} data-ax-elec /> AX 전장만
        </label>
        {isBuy && <button type="button" onClick={axPreview} disabled={axBusy} data-ax-import className="px-3 py-2 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-700">🔁 AX PO 파일 반영</button>}
        {editable && <button type="button" onClick={() => setUpload(true)} data-open-upload className="px-4 py-2 rounded-xl text-xs font-bold bg-violet-600 text-white">📄 PDF 올리기</button>}
      </div>

      {axPrev && (() => {
        const s = axPrev.summary
        const nothing = !s.newPos && !s.changedPos
        return (
          <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 text-sm" data-ax-preview>
            <b>AXCELIS PO 파일 → 수주대장 반영</b>
            <span className="text-xs text-slate-500"> — 「고객사 PO」에서 올린 최신 PO 파일 내용으로 납기 · 수량 · Rev · 단가 · 완료 · 취소를 맞춥니다.</span>
            {nothing ? <div className="mt-2 text-xs text-slate-600">바뀐 것이 없습니다.</div> : (
              <div className="mt-2 text-xs text-slate-700 space-y-1">
                {s.newPos > 0 && <div>· 새로 들일 PO <b>{s.newPos}</b>건 · {s.newLines}줄 (진행 중 전장 줄이 있는 PO · 이미 완료된 줄은 납품 · 판매입력 완료로)</div>}
                {s.changedPos > 0 && <div>· 바뀐 PO <b>{s.changedPos}</b>건 — 납기 {s.due} · 수량 {s.qty} · Rev {s.rev} · 단가 {s.price} · 납품 완료 {s.delivered} · 취소 {s.cancelled} · 줄 추가 {s.added}</div>}
                {s.resets > 0 && <div className="text-red-600">· 납기가 당겨지거나 수량이 늘어 <b>재회신 필요</b> {s.resets}줄</div>}
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
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setAxPrev(null)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-200">닫기</button>
              {!nothing && <button type="button" disabled={axBusy} onClick={axRun} data-ax-run className="px-3 py-1.5 rounded-lg text-xs font-bold bg-violet-600 text-white disabled:opacity-40">반영하기</button>}
            </div>
          </div>
        )
      })()}

      {isBuy && checkedLines.length > 0 && (
        <div className="sticky top-0 z-20 rounded-xl border border-violet-300 bg-white shadow-md p-3 flex flex-wrap items-center gap-3" data-bulk>
          <b className="text-xs text-violet-700 whitespace-nowrap">{checkedLines.length}줄 선택 · PO {new Set(checkedLines.map((l) => l.order_id)).size}건</b>
          <div className="flex-1"><ReplyForm compact count={checkedLines.length} busy={replyMut.isPending} onSave={(form) => replyMut.mutate({ ls: checkedLines, form })} /></div>
          <button type="button" onClick={() => dlvMut.mutate({ ls: checkedLines.filter((l) => !l.st.delivered), on: true })} data-bulk-dlv className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300">납품 표시</button>
          <button type="button" onClick={() => setChecked(new Set())} className="text-xs text-slate-400 hover:text-slate-700">선택 해제</button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        {mode === 'line' ? (
          <table className="w-full text-xs" data-line-table>
            <thead className="bg-slate-50 text-slate-500"><tr>
              {isBuy && <th className="pl-3 py-2.5 w-6"><input type="checkbox" checked={allOn} onChange={() => setChecked(allOn ? new Set() : new Set(liveVisible.map((l) => l.id)))} data-check-all /></th>}
              <th className="px-2 py-2.5 text-left">납기</th><th className="px-2 text-left">고객사</th><th className="px-2 text-left">PO번호 · 라인</th>
              <th className="px-2 text-left">품번</th><th className="px-2 text-left">품명</th><th className="px-2 text-left">Rev</th>
              <th className="px-2 text-right">수량</th><th className="px-2 text-right">납품</th><th className="px-2 text-right">단가</th><th className="px-2 text-right">금액</th>
              <th className="px-2 text-left">진행</th><th className="px-2 text-left">구매자재 회신</th><th className="px-2 text-left">접수</th>
            </tr></thead>
            <tbody>
              {isLoading && <tr><td colSpan={14} className="p-6 text-center text-slate-400">불러오는 중…</td></tr>}
              {!isLoading && !lines.length && <tr><td colSpan={14} className="p-8 text-center text-slate-400">{orders.length ? '조건에 맞는 줄이 없습니다' : '아직 등록된 PO 가 없습니다 — 「📄 PDF 올리기」로 시작하세요'}</td></tr>}
              {lines.map((l) => {
                const c = ORDER_CUSTOMERS[l.o.customer_code]
                const late = l.st.live && !l.st.confirmed && !l.o.migrated && bizDaysSince(l.o.registered_at) >= 1
                const overdue = l.st.live && l.due_date && l.due_date < todayISO()
                return (
                  <tr key={l.id} className={`border-t border-slate-100 ${l.st.cancelled ? 'opacity-40 line-through' : ''} ${late ? 'bg-red-50/40' : ''} ${checked.has(l.id) ? 'bg-violet-50/60' : ''}`} data-row={`${l.o.po_no}|${l.line_no}/${l.del_line}`}>
                    {isBuy && <td className="pl-3">{!l.st.cancelled && <input type="checkbox" checked={checked.has(l.id)} onChange={() => toggle(l.id)} data-check={`${l.o.po_no}|${l.line_no}/${l.del_line}`} />}</td>}
                    <td className={`px-2 py-2 whitespace-nowrap font-mono ${overdue ? 'text-red-600 font-bold' : ''}`}>{l.due_date || '—'}{overdue && <div className="text-[10px]">납기 지남</div>}</td>
                    <td className="px-2"><span className={`px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${c.badge}`}>{c.name}</span></td>
                    <td className="px-2 whitespace-nowrap"><button type="button" onClick={() => setPoOpen(l.order_id)} className="font-mono font-bold text-indigo-600 hover:underline" data-po-link={l.o.po_no}>{l.o.po_no}</button><span className="text-slate-400 ml-1">L{l.line_no}{l.del_line !== '1' ? `/${l.del_line}` : ''}</span></td>
                    <td className="px-2 font-mono font-bold whitespace-nowrap">{l.items?.std_code || <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px]">미등록 {l.raw_pn || ''}</span>}</td>
                    <td className="px-2 text-slate-500 max-w-[220px] truncate" title={l.items?.name || l.raw_desc || ''}>{l.items?.name || l.raw_desc || '—'}</td>
                    <td className="px-2">{l.rev || '—'}</td>
                    <td className="px-2 text-right font-mono">{fmt(l.qty)}</td>
                    <td className={`px-2 text-right font-mono ${l.st.delivered ? 'text-emerald-600 font-bold' : ''}`}>{+l.delivered_qty ? fmt(l.delivered_qty) : '—'}</td>
                    <td className="px-2 text-right font-mono whitespace-nowrap">{l.unit_price != null ? `${isUsd(l.o) ? '$' : ''}${fmt(l.unit_price)}` : '—'}</td>
                    <td className="px-2 text-right font-mono whitespace-nowrap">{+l.unit_price ? `${isUsd(l.o) ? '$' : '₩'}${fmt(Math.round(amountOf(l) * 100) / 100)}` : '—'}</td>
                    <td className="px-2"><Steps s={l.st} /></td>
                    <td className="px-2"><ReplyBadge l={l} memo={!isBuy} /></td>
                    <td className="px-2 text-slate-500 whitespace-nowrap">{md(String(l.o.registered_at).slice(0, 10))}{late && <div className="text-[10px] text-red-500">{bizDaysSince(l.o.registered_at)}영업일 미확인</div>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-xs" data-po-table>
            <thead className="bg-slate-50 text-slate-500"><tr>
              <th className="px-3 py-2.5 text-left">접수</th><th className="px-2 text-left">고객사</th><th className="px-2 text-left">PO번호</th>
              <th className="px-2 text-left">품목</th><th className="px-2 text-left">가장 빠른 납기</th><th className="px-2 text-right">금액</th><th className="px-2 text-left">진행</th>
              <th className="px-2 text-left">회신</th><th className="px-2 text-left">등록</th>
            </tr></thead>
            <tbody>
              {!isLoading && !poRows.length && <tr><td colSpan={9} className="p-8 text-center text-slate-400">조건에 맞는 PO 가 없습니다</td></tr>}
              {poRows.map(({ o, ls, s, amount }) => {
                const c = ORDER_CUSTOMERS[o.customer_code]
                const rp = ls.filter((l) => !l.st.cancelled)
                const replied = rp.filter((l) => l.reply).length
                return (
                  <tr key={o.id} onClick={() => setPoOpen(o.id)} className="border-t border-slate-100 cursor-pointer hover:bg-slate-50" data-order={o.po_no}>
                    <td className="px-3 py-2 whitespace-nowrap">{md(String(o.registered_at).slice(0, 10))}{o.migrated && <div className="text-[10px] text-slate-400">이관</div>}</td>
                    <td className="px-2"><span className={`px-2 py-0.5 rounded-full font-bold ${c.badge}`}>{c.name}</span></td>
                    <td className="px-2 font-mono font-bold">{o.po_no}</td>
                    <td className="px-2 py-2"><b>{rp.length}줄</b><div className="text-[10.5px] text-slate-400 truncate max-w-[340px]">{rp.slice(0, 3).map((l) => `${l.items?.std_code || l.raw_pn || l.raw_desc} ×${fmt(l.qty)}`).join(' · ')}</div></td>
                    <td className="px-2 whitespace-nowrap">{rp.filter((l) => l.st.live).map((l) => l.due_date).filter(Boolean).sort()[0] || '—'}</td>
                    <td className="px-2 text-right font-mono whitespace-nowrap">{amount ? `${isUsd(o) ? '$' : '₩'}${fmt(Math.round(amount))}` : '—'}</td>
                    <td className="px-2"><Steps s={s} /></td>
                    <td className="px-2 whitespace-nowrap">{replied ? `${replied}/${rp.length}줄` : <span className="text-slate-400">회신 전</span>}{rp.some((l) => l.reply && l.reply !== '가능') && <span className="ml-1 text-amber-600 font-bold">조건부 · 불가 있음</span>}</td>
                    <td className="px-2 text-slate-500 whitespace-nowrap">{o.registered_name || SOURCE_LABEL[o.source] || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {poOpen && byOrder.get(poOpen) && (
        <PoDrawer o={byOrder.get(poOpen)} isBuy={isBuy} fx={fx} onClose={() => setPoOpen(null)}
          onReply={(ls, form) => replyMut.mutate({ ls, form })} replyBusy={replyMut.isPending}
          onDlv={(ls, on) => dlvMut.mutate({ ls, on })} dlvBusy={dlvMut.isPending}
          onConfirm={(o) => headMut.mutate({ id: o.id, patch: { confirmed_at: new Date().toISOString(), confirmed_name: meName } })}
          onDelete={(o) => { if (window.confirm(`${o.po_no} 를 수주대장에서 지울까요? (줄 · 변경 이력도 함께 지워집니다)`)) delMut.mutate(o.id) }} />
      )}
      {upload && <OrderUpload meName={meName} onClose={() => setUpload(false)} onSaved={refresh} />}
    </div>
  )
}

// PO 한 건 — 원본 · 등록 · 줄 · 변경 이력 · PO 전체 회신
function PoDrawer({ o, isBuy, fx, onClose, onReply, replyBusy, onDlv, dlvBusy, onConfirm, onDelete }) {
  const { data: changes = [] } = useQuery({
    queryKey: ['orderChanges', o.id, o.updated_at, o.lines.map((l) => l.updated_at || '').join()],
    queryFn: async () => {
      const { data, error } = await supabase.from('pm_order_change').select('*').eq('order_id', o.id).order('changed_at', { ascending: false }).limit(300)
      if (error) throw error
      return data || []
    },
  })
  const c = ORDER_CUSTOMERS[o.customer_code]
  const ls = o.lines.map((l) => ({ ...l, o, st: lineState(l, o) }))
  const live = ls.filter((l) => l.st.live)
  const amount = ls.filter((l) => !l.st.cancelled).reduce((a, l) => a + amountOf(l), 0)
  const usd = isUsd(o)
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onClose} data-po-drawer={o.po_no}>
      <div className="w-full max-w-[900px] h-full bg-white shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-start gap-3 z-10">
          <div>
            <div className="flex items-center gap-2"><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${c.badge}`}>{c.name}</span><b className="font-mono text-lg">{o.po_no}</b>{o.migrated && <span className="text-xs text-slate-400">이관</span>}</div>
            <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-3">
              <span>발주일 {o.order_date || '—'}</span><span>{o.currency}{o.ccn ? ` (CCN ${o.ccn})` : ''}</span>
              <span>금액 <b className="text-slate-700">{usd ? `$${fmt(Math.round(amount * 100) / 100)} ≈ ${won(amount * fx)}` : won(amount)}</b></span>
              {o.file_name && <span>📄 {o.file_name}</span>}<span>등록 {o.registered_name || SOURCE_LABEL[o.source] || '—'} · {ts(o.registered_at)}</span>
              <span>{o.confirmed_at ? `확인 ${o.confirmed_name || ''} · ${ts(o.confirmed_at)}` : <b className="text-red-500">확인 전</b>}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="ml-auto text-sm font-bold text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <div className="p-5 space-y-4">
          {isBuy && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-3 space-y-2" data-po-reply>
              <div className="flex items-center gap-2">
                <b className="text-xs text-violet-700">이 PO 진행 중 {live.length}줄 전체에 회신</b>
                {!o.confirmed_at && <button type="button" onClick={() => onConfirm(o)} data-confirm className="ml-auto px-3 py-1 rounded-lg text-xs font-bold bg-white border border-slate-300">✓ 확인했음</button>}
              </div>
              <ReplyForm compact count={live.length} busy={replyBusy} onSave={(form) => onReply(live, form)} />
              <p className="text-[10.5px] text-slate-400">품번마다 다르게 답하려면 목록(품번별)에서 줄을 체크해 회신하세요. 자재 가용성 자동 계산은 다음 단계에서 붙습니다.</p>
            </div>
          )}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500"><tr>
                <th className="px-2 py-1.5 text-left">줄</th><th className="px-2 text-left">품번 · 품명</th><th className="px-2 text-left">Rev</th>
                <th className="px-2 text-right">수량</th><th className="px-2 text-right">납품</th><th className="px-2 text-right">단가</th><th className="px-2 text-left">납기</th>
                {o.customer_code === 'AX' && <th className="px-2 text-left">구분</th>}
                <th className="px-2 text-left">회신</th>
                {isBuy && <th className="px-2 text-center">납품</th>}
              </tr></thead>
              <tbody>
                {ls.map((l) => (
                  <tr key={l.id} className={`border-t border-slate-100 ${l.st.cancelled ? 'opacity-40 line-through' : ''}`} data-dline={`${l.line_no}/${l.del_line}`}>
                    <td className="px-2 py-1.5 font-mono">{l.line_no}{l.del_line !== '1' ? `/${l.del_line}` : ''}</td>
                    <td className="px-2 py-1.5">{l.items ? <span className="font-mono font-bold text-indigo-600">{l.items.std_code}</span> : <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-bold text-[10px]">미등록</span>}<span className="ml-1 text-slate-500">{l.items?.name || l.raw_desc || l.raw_pn}</span></td>
                    <td className="px-2">{l.rev || '—'}</td>
                    <td className="px-2 text-right font-mono">{fmt(l.qty)}</td>
                    <td className={`px-2 text-right font-mono ${l.st.delivered ? 'text-emerald-600 font-bold' : ''}`}>{fmt(l.delivered_qty)}</td>
                    <td className="px-2 text-right font-mono">{l.unit_price != null ? `${usd ? '$' : ''}${fmt(l.unit_price)}` : '—'}</td>
                    <td className="px-2 whitespace-nowrap">{l.due_date || '—'}</td>
                    {o.customer_code === 'AX' && <td className="px-2">{l.division}</td>}
                    <td className="px-2"><ReplyBadge l={l} memo /></td>
                    {isBuy && <td className="px-2 text-center">{!l.st.cancelled && <input type="checkbox" checked={l.st.delivered} disabled={dlvBusy} onChange={(e) => onDlv([l], e.target.checked)} data-dlv={`${l.line_no}/${l.del_line}`} />}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border border-slate-200 rounded-xl px-3 py-2" data-changes>
            <div className="text-xs font-bold text-slate-600 mb-1">변경 이력 {changes.length}</div>
            {!changes.length && <div className="text-[11px] text-slate-400">아직 없습니다</div>}
            <div className="max-h-64 overflow-y-auto">
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
