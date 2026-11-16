// 수주대장 PO 「🔍 자재 점검」 (v4.199.0)
//   PO 를 열어 BOM 을 풀고 이 PO 가 쓸 자재가 모자란지 본 뒤 「문제 없음 — 가능」 / 「문제 있음 — 조건부」로 바로 회신
//   계산: SQL pm_order_po_check — 부족자재 화면과 같은 재료(수주대장 소요 · BOM · 재고 · 미입고 발주)
//   점검 결과(부족 품목 · 기준 시각)는 PO 변경 이력에 「자재 점검」으로 남는다
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { toastError, toastSuccess } from '../../lib/toast'
import { swallow } from '../../lib/errorLog'
import { fetchPoCheck, splitCheck, hasProblem, affectedLineIds, suggestDate, reasonText, checkLogText } from '../../lib/poMatCheck'
import { addItemsToCart } from '../common/PoCart'
import Spin from '../../components/ux/Spin'

const fmt = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }))
const md = (d) => (d ? String(d).slice(5, 10).replace('-', '/') : '—')
const TONE = {
  short: { row: 'bg-red-50/40', fg: 'text-red-600', chip: 'bg-red-50 text-red-600', label: '부족' },
  late: { row: 'bg-amber-50/40', fg: 'text-amber-700', chip: 'bg-amber-50 text-amber-700', label: '입고 늦음' },
  ok: { row: '', fg: 'text-emerald-700', chip: 'bg-emerald-50 text-emerald-700', label: '충분' },
  harness: { row: '', fg: 'text-slate-500', chip: 'bg-slate-100 text-slate-500', label: '하네스(제작)' },
  squeeze: { row: 'bg-violet-50/40', fg: 'text-violet-700', chip: 'bg-violet-50 text-violet-700', label: '뒤 PO 영향' },
}
const GRID = 'grid grid-cols-[150px_minmax(0,1fr)_76px_76px_150px_92px_76px_96px] gap-2.5 px-3.5'

function Kpi({ tone, label, value, sub }) {
  const t = { red: 'border-red-200 bg-red-50 text-red-600', amber: 'border-amber-200 bg-amber-50 text-amber-700', green: 'border-emerald-200 bg-emerald-50 text-emerald-700', gray: 'border-slate-200 bg-slate-50 text-slate-600', violet: 'border-violet-200 bg-violet-50 text-violet-700', white: 'border-slate-200 bg-white text-slate-800' }[tone]
  return (
    <div className={`rounded-xl border px-3.5 py-2.5 ${t}`}>
      <div className="text-[12px] text-slate-500">{label}</div>
      <div className="text-2xl font-extrabold tabular-nums">{fmt(value)}</div>
      <div className="text-[11px] text-slate-500 leading-snug">{sub}</div>
    </div>
  )
}

function Row({ r }) {
  const sq = r.squeeze && r.verdict !== 'short' && r.verdict !== 'harness'
  const t = sq ? TONE.squeeze : TONE[r.verdict] || TONE.ok
  const ins = (r.ins || []).slice(0, 2).map((x) => `${fmt(x.q)}${x.d ? ` · ${md(x.d)}` : ' · 날짜 미정'}`).join(' / ')
  return (
    <div className={`${GRID} py-2 border-b border-slate-100 text-[12.5px] items-center ${t.row}`} data-mc-row={r.std_code} data-mc-verdict={sq ? 'squeeze' : r.verdict}>
      <span className="font-mono font-bold text-indigo-600 text-[12px] truncate" title={r.std_code}>{r.std_code}</span>
      <span className="min-w-0">
        <span className="block truncate text-slate-800" title={r.name}>{r.name}</span>
        <span className="block truncate text-[11px] text-slate-500">{r.nobom ? 'BOM 없음 — 이 품번 재고로 봄' : r.parents || ''}{r.maker ? ` · ${r.maker}` : ''}</span>
        {sq && <span className="block truncate text-[11px] font-semibold text-violet-700" title={r.later_pos}>받으면 먼저 가능 회신한 {r.later_pos} 몫 {fmt(r.squeeze_q)}개 모자람</span>}
      </span>
      <span className="text-right tabular-nums">{fmt(r.need)}</span>
      <span className="text-right tabular-nums">{fmt(r.stock)}</span>
      <span className="text-[11.5px] text-slate-600 truncate" title={ins}>{ins || '—'}</span>
      <span className="text-right tabular-nums text-slate-500">{+r.prior ? fmt(r.prior) : '0'}</span>
      <span className={`text-right tabular-nums font-extrabold ${t.fg}`}>{r.verdict === 'short' ? fmt(r.short) : sq ? fmt(r.squeeze_q) : r.verdict === 'late' ? md(r.late_at) : '0'}</span>
      <span>{sq && r.verdict === 'late' && <span className="inline-block mr-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700">입고 늦음</span>}<span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${t.chip}`}>{t.label}</span>{r.nobom && r.verdict !== 'harness' && <span className="ml-1 text-[10px] font-bold text-slate-400">BOM없음</span>}</span>
    </div>
  )
}

// 「문제 있음 — 조건부」 누른 뒤
function IssueDialog({ o, res, s, live, busy, onCancel, onSave }) {
  const aff = affectedLineIds(s)
  const affN = live.filter((l) => aff.has(l.id)).length
  const [memo, setMemo] = useState(() => reasonText(res, s))
  const [date, setDate] = useState(() => suggestDate(s))
  const [scope, setScope] = useState('all')
  const [cart, setCart] = useState(s.short.length > 0)
  const [err, setErr] = useState('')
  const save = () => {
    if (!memo.trim()) { setErr('「조건부」는 영업이 고객사와 협의해야 해서 사유가 꼭 필요합니다'); return }
    onSave({ memo: memo.trim(), date, scope: affN && affN < live.length ? scope : 'all', cart })
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-3" data-mc-issue>
      <div className="w-full max-w-[640px] bg-white rounded-2xl overflow-hidden flex flex-col shadow-2xl">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center">
          <b className="text-[15px] text-slate-800">문제 있음 — 조건부 회신</b>
          <button type="button" onClick={onCancel} className="ml-auto text-slate-400 hover:text-slate-700 font-bold" aria-label="닫기">✕</button>
        </div>
        <div className="px-5 py-4 space-y-3.5 bg-[#f9fafc]">
          <div className="text-[13px] text-slate-600">PO <b className="font-mono text-indigo-600">{o.po_no}</b> · 영업 화면에 사유가 그대로 보입니다.</div>
          <label className="block">
            <span className="text-[13px] font-bold text-slate-800">사유 <span className="text-red-500">*</span> <span className="font-normal text-slate-500">— 점검 결과로 미리 채움, 고칠 수 있음</span></span>
            <textarea value={memo} onChange={(e) => { setMemo(e.target.value); setErr('') }} rows={5} data-mc-memo
              className={`mt-1 w-full px-3 py-2 text-[13px] leading-relaxed border rounded-lg bg-white resize-y ${err ? 'border-red-400 ring-2 ring-red-100' : 'border-slate-300'}`} />
            {err && <span className="text-[11.5px] font-semibold text-red-600">{err}</span>}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[13px] font-bold text-slate-800">가능한 날 (회신일)</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-mc-date className="mt-1 w-full h-10 px-3 text-[13px] border border-slate-300 rounded-lg bg-white" />
              <span className="text-[11.5px] text-slate-500">{date ? '가장 늦게 들어오는 입고 + 1주로 제안' : '발주가 없는 부족 품목이 있어 날짜를 정하지 못했습니다'}</span>
            </label>
            <label className="block">
              <span className="text-[13px] font-bold text-slate-800">회신할 줄</span>
              <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={!affN || affN >= live.length} data-mc-scope className="mt-1 w-full h-10 px-2.5 text-[13px] border border-slate-300 rounded-lg bg-white disabled:bg-slate-50">
                <option value="all">PO 전체 {live.length}줄 「조건부」</option>
                {affN > 0 && affN < live.length && <option value="aff">문제 품목이 들어간 줄만 ({affN}줄) · 나머지는 「가능」</option>}
              </select>
            </label>
          </div>
          {s.short.length > 0 && (
            <label className="flex items-center gap-2 text-[13px] font-bold text-slate-800">
              <input type="checkbox" checked={cart} onChange={(e) => setCart(e.target.checked)} data-mc-cart className="w-4 h-4" />부족 {s.short.length}품목을 발주 담기함에 같이 넣기
            </label>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-9 px-4 rounded-lg border border-slate-300 bg-white text-[13px] font-bold">취소</button>
          <button type="button" disabled={busy} onClick={save} data-mc-issue-save className="h-9 px-4 rounded-lg bg-red-600 text-white text-[13px] font-extrabold disabled:opacity-50 inline-flex items-center gap-1.5">{busy && <Spin />}조건부로 회신</button>
        </div>
      </div>
    </div>
  )
}

export default function PoMatCheck({ o, live, meName, onReplyAsync, onClose }) {
  const qc = useQueryClient()
  const { data: res, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['poMatCheck', o.id], queryFn: () => fetchPoCheck(o.id), staleTime: 0, gcTime: 0, retry: false,
  })
  const [showOk, setShowOk] = useState(false)
  const [issue, setIssue] = useState(false)
  const [busy, setBusy] = useState('')
  const s = splitCheck(res)
  const bad = hasProblem(s)
  const ed = res?.customer === 'ED'
  const lines = res?.lines || {}

  const logCheck = (reply) => supabase.from('pm_order_change').insert({
    order_id: o.id, line_key: null, field: 'mat_check', before_val: null, after_val: checkLogText(res, s, reply), source: 'manual', changed_name: meName || null,
  }).then(({ error: e }) => { if (e) throw e }).catch(swallow('수주 자재 점검 · 변경 이력 남기기'))

  async function toCart(rows) {
    const { added } = await addItemsToCart(rows.map((r) => ({
      item_id: r.item_id, customer_id: res.customer_id || null, vendor_id: r.vendor_id || null,
      qty: Math.ceil(+r.short || 0), promise_date: r.rel || null, memo: `수주 PO ${o.po_no} 자재 점검 부족`,
    })))
    qc.invalidateQueries({ queryKey: ['poCart'] })
    return added
  }
  async function cartOnly() {
    setBusy('cart')
    try { const n = await toCart(s.short); toastSuccess(`${n}품목 발주 담기함에 넣었습니다 — 🛒 담기함에서 구매처 · 납기를 확인하세요`) }
    catch (e) { toastError('담기 실패: ' + e.message) } finally { setBusy('') }
  }
  async function okReply() {
    setBusy('ok')
    try {
      await onReplyAsync(live, { reply: '가능', date: '', memo: '자재 점검 이상 없음' })
      await logCheck('가능')
      onClose()
    } catch (e) { toastError(e.message) } finally { setBusy('') }
  }
  async function issueReply({ memo, date, scope, cart }) {
    setBusy('issue')
    try {
      const aff = affectedLineIds(s)
      const a = scope === 'aff' ? live.filter((l) => aff.has(l.id)) : live
      const b = scope === 'aff' ? live.filter((l) => !aff.has(l.id)) : []
      if (a.length) await onReplyAsync(a, { reply: '조건부', date, memo })
      if (b.length) await onReplyAsync(b, { reply: '가능', date: '', memo: '자재 점검 이상 없음' })
      await logCheck(scope === 'aff' ? `조건부 ${a.length}줄 · 가능 ${b.length}줄` : '조건부')
      if (cart && s.short.length) {
        try { await toCart(s.short) } catch (e) { toastError('회신은 저장됐고, 발주 담기는 실패: ' + e.message) }
      }
      setIssue(false); onClose()
    } catch (e) { toastError(e.message) } finally { setBusy('') }
  }

  const sqSet = new Set(s.squeeze.map((r) => r.item_id))
  const shown = [...s.short, ...s.late, ...s.ok.filter((r) => r.nobom || sqSet.has(r.item_id))]
  const folded = s.ok.filter((r) => !r.nobom && !sqSet.has(r.item_id))
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 md:p-6" data-mc>
      <div className="w-full max-w-[1180px] max-h-full bg-white rounded-2xl flex flex-col overflow-hidden shadow-2xl">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap"><b className="font-mono text-[17px] text-indigo-600">{o.po_no}</b><span className="text-[13px] font-extrabold text-slate-800">🔍 자재 점검</span>
              {res && <span className="text-[12px] text-slate-500">살아 있는 줄 {fmt(lines.live)} · BOM 전개 {fmt(lines.bom)}줄 · BOM 없음 {fmt(lines.nobom)}줄{+lines.issued ? ` · 이미 불출 ${fmt(lines.issued)}줄 뺌` : ''}{+res.unregistered ? ` · 품번 미등록 ${fmt(res.unregistered)}줄 뺌` : ''}</span>}</div>
            <div className="text-[11.5px] text-slate-500 mt-0.5">BOM 을 풀어 이 PO 가 쓸 자재를 재고 · 미입고 발주와 맞춰 봅니다. 점검 결과는 PO 변경 이력에 남습니다.</div>
          </div>
          <button type="button" onClick={() => refetch()} disabled={isFetching} className="h-8 px-3 rounded-lg border border-slate-300 text-[12px] font-bold text-slate-600 disabled:opacity-50" data-mc-refresh>↻ 다시 점검</button>
          <button type="button" onClick={onClose} className="w-8 h-8 text-slate-400 hover:text-slate-700 font-bold" aria-label="닫기">✕</button>
        </div>

        {isLoading && <div className="p-10 text-center text-[13px] text-slate-500" data-mc-loading><Spin /> BOM 을 풀고 재고 · 발주를 맞추는 중…</div>}
        {error && <div className="m-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-600" data-mc-error>{error.message}</div>}

        {res && <>
          <div className="px-5 pt-3.5 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
            <Kpi tone="white" label="BOM 푼 하위 품목" value={s.parts} sub={`상위 ${fmt(lines.bom)}줄 전개${s.harness.length ? ` · 하네스 ${s.harness.length} 따로` : ''}`} />
            <Kpi tone="red" label="부족" value={s.short.length} sub="발주가 다 들어와도 모자람" />
            <Kpi tone="amber" label="입고 늦음" value={s.late.length} sub="수량은 되는데 불출일 뒤 입고" />
            <Kpi tone="violet" label="뒤 PO 영향" value={s.squeeze.length} sub="받으면 먼저 가능 회신한 PO 가 모자람" />
            <Kpi tone="green" label="충분" value={s.ok.length - s.squeeze.filter((r) => r.verdict === 'ok').length} sub="재고 + 미입고 발주로 됨" />
            <Kpi tone="gray" label="BOM 없음" value={+lines.nobom || 0} sub="그 품번 재고만 봄 (줄 수)" />
          </div>
          {ed && <div className="mx-5 mt-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800" data-mc-ed-note>⚠ Edwards BOM 은 불출리스트 기준(레벨 구분 없음)이라 빠지거나 겹친 하위가 있을 수 있습니다. 결과는 참고용으로 보고, BOM 정리 뒤 정확해집니다.</div>}
          <div className="px-5 mt-2 text-[11.5px] text-slate-500" data-mc-basis>기준: 불출일 {md(res.rel_min)} (줄의 협력사 불출일, 없으면 납기 − {res.lead_days}일) 까지 쓸 수 있는 수량 = 현재고 + 그 전에 들어올 미입고 발주 − 고객사 납기가 앞선 다른 PO 가 먼저 쓰는 양</div>

          <div className="mx-5 mt-2 flex-1 min-h-0 border border-slate-200 rounded-xl overflow-auto">
            <div className="min-w-[1000px]">
              <div className={`${GRID} py-2 bg-slate-50 border-b-2 border-slate-200 text-[12px] font-bold text-slate-600 sticky top-0`}>
                <span>품번</span><span>품명 · 들어가는 상위</span><span className="text-right">이 PO 필요</span><span className="text-right">현재고</span><span>미입고 발주</span><span className="text-right">앞선 PO 먼저</span><span className="text-right">모자람</span><span>판정</span>
              </div>
              {!shown.length && !folded.length && !s.harness.length && <div className="px-4 py-6 text-[13px] text-slate-500">점검할 품목이 없습니다 (줄이 모두 불출됐거나 품번이 없습니다)</div>}
              {shown.map((r) => <Row key={r.item_id} r={r} />)}
              {folded.length > 0 && <button type="button" onClick={() => setShowOk((v) => !v)} data-mc-fold className="w-full h-10 px-3.5 text-left text-[12.5px] font-bold text-slate-500 hover:bg-slate-50 border-b border-slate-100">{showOk ? '▾ 충분 접기' : `▸ 충분 ${folded.length}개${s.harness.length ? ` · 하네스(제작) ${s.harness.length}개` : ''} 펼치기`}</button>}
              {showOk && [...folded, ...s.harness].map((r) => <Row key={r.item_id} r={r} />)}
            </div>
          </div>

          <div className="px-5 py-3 border-t border-slate-200 mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-slate-500 flex-1 min-w-[220px]">누르면 이 PO 가 「확인 처리」되고 진행 중 {live.length}줄에 회신이 들어갑니다.{bad ? ' 부족 · 입고 늦음 · 뒤 PO 영향이 있으면 「문제 없음」은 누를 수 없습니다.' : ''}{s.squeeze.length ? ' 이 PO 를 먼저 하려면 영향받는 PO 회신을 고친 뒤 다시 점검하세요.' : ''}</span>
            {s.short.length > 0 && <button type="button" disabled={!!busy} onClick={cartOnly} data-mc-cart-only className="h-10 px-4 rounded-xl border border-slate-300 bg-white text-[13px] font-bold disabled:opacity-50 inline-flex items-center gap-1.5">{busy === 'cart' && <Spin />}📦 부족 {s.short.length}개 발주 담기</button>}
            <button type="button" disabled={!!busy || !live.length} onClick={() => setIssue(true)} data-mc-issue-open className="h-10 px-4 rounded-xl border border-red-600 bg-white text-red-600 text-[13px] font-extrabold disabled:opacity-50">⚠ 문제 있음 — 조건부</button>
            <button type="button" disabled={!!busy || bad || !live.length} onClick={okReply} data-mc-ok title={bad ? '부족 · 입고 늦음 · 뒤 PO 영향이 있어 「가능」으로 회신할 수 없습니다' : ''} className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-[13px] font-extrabold disabled:opacity-40 inline-flex items-center gap-1.5">{busy === 'ok' && <Spin />}✓ 문제 없음 — 가능</button>
          </div>
        </>}
      </div>
      {issue && res && <IssueDialog o={o} res={res} s={s} live={live} busy={busy === 'issue'} onCancel={() => setIssue(false)} onSave={issueReply} />}
    </div>
  )
}
