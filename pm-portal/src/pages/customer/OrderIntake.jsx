// 📥 수주대장 (v4.87.0) — 전장 고객사 PO 를 접수부터 확인 · 회신 · 납품까지 한 줄로
//
//   1단계: PDF 접수 · 변경 이력 · 구매자재 확인 · 회신 · 기존 PO 이관
//   화면은 보는 사람에 따라 다르다 — 「구매」 메뉴 권한이 있으면 구매자재 화면(확인 · 회신 입력 · 이관 · 납품 표시),
//   없으면 영업 화면(회신 결론만).
import { useState, useMemo, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useMyProfile, canAccessSection, canEdit } from '../../hooks/useProfile'
import { toastError, toastSuccess } from '../../lib/toast'
import { todayISO } from '../../lib/utils'
import { ORDER_CUSTOMERS, fetchOrders, stageOf, bizDaysSince, axSyncPreview, axSyncRun, FIELD_LABEL, SOURCE_LABEL } from '../../lib/orderIntake'
import OrderUpload from './OrderUpload'

const fmt = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }))
const md = (d) => (d ? String(d).slice(5).replace('-', '/') : '—')
const REPLY = {
  가능: ['bg-emerald-50 text-emerald-700', '✅ 가능'],
  조건부: ['bg-amber-50 text-amber-700', '◐ 조건부'],
  불가: ['bg-red-50 text-red-600', '✕ 불가'],
}
const KPI_TONE = {
  red: 'bg-red-50 border-red-100 text-red-600', amber: 'bg-amber-50 border-amber-100 text-amber-600',
  blue: 'bg-blue-50 border-blue-100 text-blue-600', violet: 'bg-violet-50 border-violet-100 text-violet-600',
}

function Kpi({ tone, label, value, sub, on, onClick }) {
  return (
    <button type="button" onClick={onClick} data-kpi={label}
      className={`text-left rounded-xl border px-4 py-3 ${KPI_TONE[tone]} ${on ? 'ring-2 ring-offset-1 ring-violet-400' : ''}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-extrabold leading-tight">{value.toLocaleString()}</div>
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

export default function OrderIntake() {
  const qc = useQueryClient()
  const { data: profile, isLoading: pLoading } = useMyProfile()
  // 구매자재 화면 — 「구매」 메뉴 권한 + 편집 권한. 모를 때(불러오는 중)는 영업 화면으로.
  const isBuy = !pLoading && !!profile && canAccessSection(profile, 'buy') && canEdit(profile)
  const editable = !!profile && canEdit(profile)
  const meName = (profile?.name || '').trim() || profile?.email || ''

  const { data: orders = [], isLoading, error } = useQuery({ queryKey: ['orderIntake'], queryFn: fetchOrders })
  const [cust, setCust] = useState('all')
  const [q, setQ] = useState('')
  const [view, setView] = useState('live')       // live 진행 중 · done 납품 완료 · all
  const [kpi, setKpi] = useState(null)
  const [open, setOpen] = useState(null)
  const [upload, setUpload] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['orderIntake'] })
  const [axOnlyElec, setAxOnlyElec] = useState(true)

  // AX 전장만 — AXCELIS PO 중 하네스 · 구매품 줄만 있는 PO 는 지표 · 목록에서 뺀다
  const rows = useMemo(() => orders.map((o) => ({ ...o, s: stageOf(o) }))
    .filter((o) => !axOnlyElec || o.customer_code !== 'AX' || o.lines.some((l) => !l.division || l.division === '전장')), [orders, axOnlyElec])
  const month = todayISO().slice(0, 7)
  const kpis = useMemo(() => {
    const live = rows.filter((o) => !o.s.cancelled && !o.s.delivered && !o.migrated)
    return {
      unconfirmed: live.filter((o) => !o.s.confirmed && bizDaysSince(o.registered_at) >= 1),
      waiting: live.filter((o) => !o.s.replied),
      risk: live.filter((o) => o.reply === '조건부' || o.reply === '불가'),
      month: rows.filter((o) => String(o.registered_at).slice(0, 7) === month && o.source !== 'ax_import'),
    }
  }, [rows, month])

  const list = useMemo(() => {
    let r = kpi ? kpis[kpi] : rows
    if (!kpi) {
      if (view === 'live') r = r.filter((o) => !o.s.cancelled && !o.s.delivered)
      else if (view === 'done') r = r.filter((o) => o.s.delivered)
    }
    if (cust !== 'all') r = r.filter((o) => o.customer_code === cust)
    const k = q.trim().toUpperCase()
    if (k) r = r.filter((o) => [o.po_no, o.file_name, ...o.lines.flatMap((l) => [l.items?.std_code, l.items?.name, l.raw_pn, l.raw_desc])].some((v) => String(v || '').toUpperCase().includes(k)))
    return r
  }, [rows, kpis, kpi, view, cust, q])

  const counts = useMemo(() => {
    const c = { all: 0 }
    rows.filter((o) => !o.s.cancelled && !o.s.delivered).forEach((o) => { c.all++; c[o.customer_code] = (c[o.customer_code] || 0) + 1 })
    return c
  }, [rows])

  // ── 구매자재 동작 ──
  const headMut = useMutation({
    mutationFn: async ({ id, patch, log }) => {
      const { error } = await supabase.from('pm_order').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      if (log) await supabase.from('pm_order_change').insert({ order_id: id, ...log, changed_name: meName })
    },
    onSuccess: () => { refresh(); toastSuccess('저장했습니다') },
    onError: (e) => toastError('저장 실패: ' + e.message),
  })
  const lineMut = useMutation({
    mutationFn: async ({ line, delivered }) => {
      const patch = delivered
        ? { delivered_qty: line.qty, delivered_at: todayISO(), updated_at: new Date().toISOString() }
        : { delivered_qty: 0, delivered_at: null, sales_done_at: null, updated_at: new Date().toISOString() }
      const { error } = await supabase.from('pm_order_line').update(patch).eq('id', line.id)
      if (error) throw error
      await supabase.from('pm_order_change').insert({ order_id: line.order_id, line_key: `${line.line_no}/${line.del_line}`, field: 'delivered', before_val: String(+line.delivered_qty || 0), after_val: String(delivered ? +line.qty : 0), source: 'manual', changed_name: meName })
    },
    onSuccess: refresh,
    onError: (e) => toastError('저장 실패: ' + e.message),
  })
  const delMut = useMutation({
    mutationFn: async (id) => { const { error } = await supabase.from('pm_order').delete().eq('id', id); if (error) throw error },
    onSuccess: () => { setOpen(null); refresh(); toastSuccess('삭제했습니다') },
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
    try { const r = await axSyncRun(axPrev, meName); toastSuccess(`PO 파일 반영 — 새 PO ${r.created}건 · 바뀐 줄 ${r.changed}`); setAxPrev(null); refresh() } catch (e) { toastError('반영 실패: ' + e.message) }
    setAxBusy(false)
  }

  if (error && /pm_order/.test(error.message || '')) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        수주대장 표가 아직 없습니다. Supabase SQL Editor 에서 <b>수주대장_261023.sql</b> 을 먼저 실행해 주세요.
        <div className="text-xs mt-1 text-amber-600">{error.message}</div>
      </div>
    )
  }

  return (
    <div className="space-y-4" data-order-intake data-view={isBuy ? 'buy' : 'sales'}>
      <div className="flex items-start gap-3">
        <p className="page-desc text-xs text-slate-400 flex-1">
          전장 고객사 PO 를 발주서 PDF 로 접수하고, 구매자재가 확인 · 회신합니다. 같은 PO 를 다시 올리면 바뀐 것만 반영되고 변경 이력이 남습니다.
          {isBuy ? ' 지금은 구매자재 화면입니다.' : ' 회신은 결론(가능 · 조건부 · 불가)과 가능일, 메모만 보입니다.'}
        </p>
        <span className={`px-3 py-1 rounded-full text-xs font-bold ${isBuy ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'}`}>{isBuy ? '구매자재 화면' : '영업 · 타부서 화면'}</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi tone="red" label="미확인 PO" value={kpis.unconfirmed.length} sub="등록 후 1영업일 넘게 구매자재 확인 없음" on={kpi === 'unconfirmed'} onClick={() => setKpi(kpi === 'unconfirmed' ? null : 'unconfirmed')} />
        <Kpi tone="amber" label="회신 대기" value={kpis.waiting.length} sub="아직 납기 회신 전 (변경으로 다시 회신할 것 포함)" on={kpi === 'waiting'} onClick={() => setKpi(kpi === 'waiting' ? null : 'waiting')} />
        <Kpi tone="red" label="조건부 · 불가" value={kpis.risk.length} sub="고객사와 납기 협의 필요" on={kpi === 'risk'} onClick={() => setKpi(kpi === 'risk' ? null : 'risk')} />
        <Kpi tone="violet" label="이번 달 접수" value={kpis.month.length} sub="PDF · 직접 등록 (이관 제외)" on={kpi === 'month'} onClick={() => setKpi(kpi === 'month' ? null : 'month')} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {[['all', '전체'], ...Object.entries(ORDER_CUSTOMERS).map(([k, v]) => [k, v.name])].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setCust(k)} data-cust={k}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border ${cust === k ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>
            {k !== 'all' && <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: ORDER_CUSTOMERS[k].color }} />}{l} {counts[k] || 0}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 PO번호 · 품번 · 품명 · 파일명 검색" data-search
          className="flex-1 min-w-[220px] px-3 py-2 text-xs border border-slate-200 rounded-xl" />
        <select value={view} onChange={(e) => { setView(e.target.value); setKpi(null) }} className="text-xs font-bold border border-slate-200 rounded-xl px-2 py-2" data-viewsel>
          <option value="live">진행 중</option><option value="done">납품 완료</option><option value="all">전체</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-500" title="AXCELIS PO 중 하네스 · 구매품 줄만 있는 PO 를 숨깁니다">
          <input type="checkbox" checked={axOnlyElec} onChange={(e) => setAxOnlyElec(e.target.checked)} /> AX 전장만
        </label>
        {isBuy && <button type="button" onClick={axPreview} disabled={axBusy} data-ax-import className="px-3 py-2 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-700">🔁 AX PO 파일 반영</button>}
        {editable && <button type="button" onClick={() => setUpload(true)} data-open-upload className="px-4 py-2 rounded-xl text-xs font-bold bg-violet-600 text-white">📄 PDF 올리기</button>}
      </div>

      {axPrev && (() => {
        const m = axPrev.summary
        const nothing = !m.newPos && !m.changedPos
        return (
          <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-4 text-sm" data-ax-preview>
            <b>AXCELIS PO 파일 → 수주대장 반영</b>
            <span className="text-xs text-slate-500"> — 「고객사 PO」에서 올린 최신 PO 파일 내용으로 납기 · 수량 · Rev · 단가 · 완료 · 취소를 맞춥니다.</span>
            {nothing ? <div className="mt-2 text-xs text-slate-600">바뀐 것이 없습니다.</div> : (
              <div className="mt-2 text-xs text-slate-700 space-y-1">
                {m.newPos > 0 && <div>· 새로 들일 PO <b>{m.newPos}</b>건 · {m.newLines}줄 (진행 중 전장 줄이 있는 PO · 이미 완료된 줄은 납품 · 판매입력 완료로)</div>}
                {m.changedPos > 0 && <div>· 바뀐 PO <b>{m.changedPos}</b>건 — 납기 {m.due} · 수량 {m.qty} · Rev {m.rev} · 단가 {m.price} · 납품 완료 {m.delivered} · 취소 {m.cancelled} · 줄 추가 {m.added}</div>}
                {m.resets > 0 && <div className="text-red-600">· 납기가 당겨지거나 수량이 늘어 <b>재회신 필요</b> {m.resets}건</div>}
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

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500"><tr>
            <th className="px-3 py-2.5 text-left">접수</th><th className="px-2 text-left">고객사</th><th className="px-2 text-left">PO번호</th>
            <th className="px-2 text-left">품목</th><th className="px-2 text-left">가장 빠른 납기</th><th className="px-2 text-left">진행</th>
            <th className="px-2 text-left">구매자재 회신</th><th className="px-2 text-left">등록</th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className="p-6 text-center text-slate-400">불러오는 중…</td></tr>}
            {!isLoading && !list.length && <tr><td colSpan={8} className="p-8 text-center text-slate-400">{orders.length ? '조건에 맞는 PO 가 없습니다' : '아직 등록된 PO 가 없습니다 — 「📄 PDF 올리기」로 시작하세요'}</td></tr>}
            {list.map((o) => {
              const c = ORDER_CUSTOMERS[o.customer_code]
              const live = o.lines.filter((l) => !l.cancelled)
              const elec = o.customer_code === 'AX' ? live.filter((l) => l.division === '전장') : live
              const late = !o.s.confirmed && !o.s.delivered && !o.migrated && bizDaysSince(o.registered_at) >= 1
              const first = elec[0] || live[0]
              const isOpen = open === o.id
              return (
                <Fragment key={o.id}>
                  <tr onClick={() => setOpen(isOpen ? null : o.id)} className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 ${late ? 'bg-red-50/40' : ''} ${isOpen ? 'bg-violet-50/40' : ''}`} data-order={o.po_no}>
                    <td className="px-3 py-2 whitespace-nowrap">{md(String(o.registered_at).slice(0, 10))}{late && <div className="text-[10px] text-red-500">{bizDaysSince(o.registered_at)}영업일 경과</div>}{o.migrated && <div className="text-[10px] text-slate-400">이관</div>}{!o.migrated && o.source !== 'pdf' && <div className="text-[10px] text-slate-400">{SOURCE_LABEL[o.source]}</div>}</td>
                    <td className="px-2"><span className={`px-2 py-0.5 rounded-full font-bold ${c.badge}`}>{c.name}</span></td>
                    <td className="px-2 font-mono font-bold">{o.po_no}{o.cancelled && <span className="ml-1 text-red-500">취소</span>}</td>
                    <td className="px-2 py-2">
                      {elec.length > 1 || (o.customer_code === 'AX' && live.length > elec.length)
                        ? <><b>{o.customer_code === 'AX' ? `전장 ${elec.length}줄` : `${live.length}줄`}</b>{o.customer_code === 'AX' && live.length > elec.length && <span className="text-slate-400"> (하네스 · 구매품 {live.length - elec.length})</span>}<div className="text-[10.5px] text-slate-400 truncate max-w-[340px]">{elec.slice(0, 3).map((l) => `${l.items?.name || l.raw_desc || l.raw_pn} ×${fmt(l.qty)}`).join(' · ')}</div></>
                        : first ? <><span className="font-mono font-bold text-indigo-600">{first.items?.std_code || first.raw_pn || '품목 미등록'}</span> ×{fmt(first.qty)}<div className="text-[10.5px] text-slate-400">{first.items?.name || first.raw_desc}</div></> : '—'}
                      {o.lines.some((l) => !l.item_id && !l.cancelled) && <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-bold text-[10px]">미등록 품목</span>}
                    </td>
                    <td className="px-2 whitespace-nowrap">{o.s.dueMin || (o.s.delivered ? '납품 완료' : '—')}</td>
                    <td className="px-2"><Steps s={o.s} /></td>
                    <td className="px-2">{o.reply ? <span className={`px-2 py-0.5 rounded-full font-bold ${REPLY[o.reply][0]}`}>{REPLY[o.reply][1]}{o.reply_date ? ` · ${md(o.reply_date)}` : ''}</span> : <span className="text-slate-400">{o.s.confirmed ? '회신 작성 전' : '확인 대기'}</span>}</td>
                    <td className="px-2 text-slate-500 whitespace-nowrap">{o.registered_name || '—'}</td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-violet-50/20"><td colSpan={8} className="px-3 pb-3">
                      <OrderDetail o={o} isBuy={isBuy} meName={meName} headMut={headMut} lineMut={lineMut} delMut={delMut} />
                    </td></tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {upload && <OrderUpload meName={meName} onClose={() => setUpload(false)} onSaved={refresh} />}
    </div>
  )
}

function OrderDetail({ o, isBuy, meName, headMut, lineMut, delMut }) {
  const [reply, setReply] = useState(o.reply || '')
  const [rDate, setRDate] = useState(o.reply_date || '')
  const [rMemo, setRMemo] = useState(o.reply_memo || '')
  const { data: changes = [] } = useQuery({
    queryKey: ['orderChanges', o.id, o.updated_at],
    queryFn: async () => {
      const { data, error } = await supabase.from('pm_order_change').select('*').eq('order_id', o.id).order('changed_at', { ascending: false }).limit(200)
      if (error) throw error
      return data || []
    },
  })
  const saveReply = () => {
    if (!reply) { toastError('가능 · 조건부 · 불가 중 하나를 고르세요'); return }
    if (reply !== '가능' && !rMemo.trim()) { toastError('조건부 · 불가는 메모(사유)를 적어 주세요'); return }
    headMut.mutate({
      id: o.id,
      patch: { reply, reply_date: rDate || null, reply_memo: rMemo.trim() || null, replied_name: meName, replied_at: new Date().toISOString(), ...(o.confirmed_at ? {} : { confirmed_at: new Date().toISOString(), confirmed_name: meName }) },
      log: { field: 'reply', before_val: o.reply ? `${o.reply}${o.reply_date ? ` · ${o.reply_date}` : ''}` : null, after_val: `${reply}${rDate ? ` · ${rDate}` : ''}`, source: 'manual' },
    })
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 pt-2" data-detail={o.po_no}>
      <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-100 text-xs text-slate-500 flex flex-wrap gap-x-3">
          <span>발주일 {o.order_date || '—'}</span><span>{o.currency}{o.ccn ? ` (CCN ${o.ccn})` : ''}</span>
          {o.file_name && <span>📄 {o.file_name}</span>}<span>등록 {o.registered_name || '—'} · {String(o.registered_at).slice(0, 16).replace('T', ' ')}</span>
        </div>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 sticky top-0"><tr>
              <th className="px-2 py-1.5 text-left">줄</th><th className="px-2 text-left">품목</th><th className="px-2 text-left">Rev</th>
              <th className="px-2 text-right">수량</th><th className="px-2 text-right">납품</th><th className="px-2 text-right">단가</th><th className="px-2 text-left">납기</th>
              {o.customer_code === 'AX' && <th className="px-2 text-left">구분</th>}
              {isBuy && <th className="px-2 text-center">납품 표시</th>}
            </tr></thead>
            <tbody>
              {o.lines.map((l) => {
                const done = (+l.delivered_qty || 0) >= (+l.qty || 0) && +l.qty > 0
                return (
                  <tr key={l.id} className={`border-t border-slate-100 ${l.cancelled ? 'opacity-40 line-through' : ''}`} data-dline={`${l.line_no}/${l.del_line}`}>
                    <td className="px-2 py-1.5 font-mono">{l.line_no}{l.del_line !== '1' ? `/${l.del_line}` : ''}</td>
                    <td className="px-2 py-1.5">{l.items ? <span className="font-mono font-bold text-indigo-600">{l.items.std_code}</span> : <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-bold text-[10px]">미등록</span>}<span className="ml-1 text-slate-500">{l.items?.name || l.raw_desc || l.raw_pn}</span></td>
                    <td className="px-2">{l.rev || '—'}</td>
                    <td className="px-2 text-right font-mono">{fmt(l.qty)}</td>
                    <td className={`px-2 text-right font-mono ${done ? 'text-emerald-600 font-bold' : ''}`}>{fmt(l.delivered_qty)}</td>
                    <td className="px-2 text-right font-mono">{fmt(l.unit_price)}</td>
                    <td className="px-2 whitespace-nowrap">{l.due_date || '—'}</td>
                    {o.customer_code === 'AX' && <td className="px-2">{l.division}</td>}
                    {isBuy && <td className="px-2 text-center">{!l.cancelled && <input type="checkbox" checked={done} disabled={lineMut.isPending} onChange={(e) => lineMut.mutate({ line: l, delivered: e.target.checked })} data-dlv={`${l.line_no}/${l.del_line}`} />}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {changes.length > 0 && (
          <div className="border-t border-slate-100 px-3 py-2 max-h-40 overflow-y-auto" data-changes>
            <div className="text-xs font-bold text-slate-600 mb-1">변경 이력 {changes.length}</div>
            {changes.map((c) => (
              <div key={c.id} className="text-[11px] text-slate-600 font-mono">
                <span className="text-slate-400">{String(c.changed_at).slice(0, 16).replace('T', ' ')} {c.changed_name || ''}</span> {c.line_key ? `${c.line_key} ` : ''}{FIELD_LABEL[c.field] || c.field}: {c.before_val != null && <span className="line-through text-slate-400">{c.before_val}</span>}{c.before_val != null && ' → '}<b className="text-slate-800">{c.after_val ?? '—'}</b>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2" data-reply-box>
        <div className="text-xs font-bold text-slate-700">구매자재 확인 · 회신</div>
        {o.confirmed_at ? <div className="text-[11px] text-slate-500">확인 {o.confirmed_name} · {String(o.confirmed_at).slice(0, 16).replace('T', ' ')}</div> : <div className="text-[11px] text-red-500">아직 확인 전</div>}
        {isBuy ? (
          <>
            {!o.confirmed_at && <button type="button" onClick={() => headMut.mutate({ id: o.id, patch: { confirmed_at: new Date().toISOString(), confirmed_name: meName } })} data-confirm className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-300">✓ 확인했음</button>}
            <div className="flex gap-1.5">
              {['가능', '조건부', '불가'].map((r) => (
                <button key={r} type="button" onClick={() => setReply(r)} data-reply={r}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-bold border ${reply === r ? REPLY[r][0] + ' border-current' : 'bg-white border-slate-200 text-slate-500'}`}>{REPLY[r][1]}</button>
              ))}
            </div>
            <label className="block text-[11px] font-bold text-slate-500">자재 준비 가능일
              <input type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} data-reply-date className="mt-0.5 w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
            </label>
            <textarea value={rMemo} onChange={(e) => setRMemo(e.target.value)} rows={3} placeholder="영업에 보일 메모 (조건부 · 불가는 사유 필수)" data-reply-memo className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg" />
            <button type="button" onClick={saveReply} disabled={headMut.isPending} data-reply-save className="w-full px-3 py-2 rounded-lg text-xs font-bold bg-violet-600 text-white">회신 저장 → 영업에 표시</button>
            <p className="text-[10.5px] text-slate-400">자재 가용성 자동 계산은 다음 단계에서 이 자리에 붙습니다.</p>
            <button type="button" onClick={() => { if (window.confirm(`${o.po_no} 를 수주대장에서 지울까요? (줄 · 변경 이력도 함께 지워집니다)`)) delMut.mutate(o.id) }} data-del className="text-[11px] text-red-500 hover:underline">이 PO 지우기</button>
          </>
        ) : o.reply ? (
          <div className="space-y-1">
            <span className={`inline-block px-3 py-1 rounded-lg text-sm font-bold ${REPLY[o.reply][0]}`}>{REPLY[o.reply][1]}</span>
            {o.reply_date && <div className="text-xs">자재 준비 가능일 <b>{o.reply_date}</b></div>}
            {o.reply_memo && <div className="text-xs text-slate-600 whitespace-pre-wrap">{o.reply_memo}</div>}
            <div className="text-[10.5px] text-slate-400">{o.replied_name} · {String(o.replied_at).slice(0, 16).replace('T', ' ')}</div>
          </div>
        ) : <div className="text-xs text-slate-400">구매자재 회신 전입니다</div>}
      </div>
    </div>
  )
}
