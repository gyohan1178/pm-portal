// 📥 견적 접수 현황 — 영업 › 매출견적 첫 탭 (v4.92.0)
//   고객사 견적 요청을 접수해 두고 BOM 확인 → 단가(구매자재) → 견적 작성 → 📤 발송 완료까지 한 줄로 따라간다 (v4.119.0 — 수주 · 실주는 안 물음)
//   BOM 이 없는 품목은 영업이 고객 BOM 을 먼저 올린다 (기초자료 › BOM). 단가 없는 부품은 구매자재에 요청한다.
import { useState, useMemo, useDeferredValue } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMyProfile, canEdit, isPurchasing } from '../../hooks/useProfile'
import { useCustomers } from '../../hooks/useCustomers'
import { supabase } from '../../lib/supabase'
import { todayISO } from '../../lib/utils'
import { toastError, toastSuccess } from '../../lib/toast'
import { logActivity } from '../../lib/activityLog'
import { SkeletonRows } from '../../components/ux/Skeleton'
import { useConfirm } from '../../components/ux/ConfirmDialog'
import Spin from '../../components/ux/Spin'
import { RFQ_STAGES, STAGE_TONE, stageLabel, stageOf, fetchRfqs, parsePaste, checkRfq, saveRfq, patchRfq, deleteRfq, dday, HOLDS, isOpenLine, readyLines, setLineHold, submitRfq, NOQUOTES, setLineNoquote, closeNoquote, editRfq } from './rfq'

const n = (v) => Number(v || 0).toLocaleString('ko-KR')
const md = (d) => (d ? String(d).slice(5, 10).replace('-', '/') : '')
const CS_BADGE = { ax: 'bg-violet-50 text-violet-700', ed: 'bg-blue-50 text-blue-700', vm: 'bg-emerald-50 text-emerald-700', csk: 'bg-amber-50 text-amber-700' }
const INP = 'w-full px-2.5 py-2 text-[13px] border border-slate-200 rounded-lg bg-white'

export default function RfqBoard({ customers = [], onWrite }) {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data: profile } = useMyProfile()
  const editable = !!profile && canEdit(profile)
  const isBuy = !!profile && isPurchasing(profile)
  const meName = (profile?.name || '').trim() || profile?.email || ''
  const today = todayISO()
  const { data: csRows = [] } = useCustomers()
  const [ask, confirmEl] = useConfirm()
  const [ferr, setFerr] = useState({})   // 접수 창 — 빠진 칸 안내 (v4.104.0)
  const setF = (patch, k) => { setForm((f) => ({ ...f, ...patch })); if (k && ferr[k]) setFerr((e) => ({ ...e, [k]: '' })) }

  const { data: rfqs = [], isLoading, error } = useQuery({ queryKey: ['rfqs'], queryFn: fetchRfqs, staleTime: 30 * 1000 })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['rfqs'] }); qc.invalidateQueries({ queryKey: ['flowCounts'] }) }

  const [stage, setStage] = useState('live')     // live 진행 중 · all · 단계 키
  const [cs, setCs] = useState('all')
  const [q, setQ] = useState('')
  const qd = useDeferredValue(q).trim().toUpperCase()
  const [open, setOpen] = useState(null)          // 품목 펼친 접수 id
  const [send, setSend] = useState(null)          // 📤 발송 완료 확인 창 { r, pick, rest, split } (v4.119.0 — 「결과 입력」 대신)
  const [form, setForm] = useState(null)          // 새 접수
  const [busy, setBusy] = useState(null)

  // 등록 고객사는 이름으로, 「기타 · 직접 입력」(v4.99.0)은 입력한 이름 그대로 (customer_code 에 이름이 들어 있음)
  const isEtc = (code) => csRows.length > 0 && !csRows.some((c) => String(c.code).toLowerCase() === String(code || '').toLowerCase())
  const csName = (code) => customers.find((c) => c.id === code)?.name || (/^[a-z]{2,4}$/.test(String(code || '')) && !isEtc(code) ? String(code).toUpperCase() : String(code || ''))
  //   발송 완료 = 제출 · (예전에 적은) 수주 · 실주 — 「진행 중 / 발송 완료」 만 본다 (v4.119.0)
  const rows = useMemo(() => rfqs.map((r) => ({ ...r, stage: SENT.includes(r.status) ? 'sent' : stageOf(r), d: r.status === '진행' ? dday(r.due_date, today) : null })), [rfqs, today])
  const hit = (r) => !qd || [r.title, r.cust_ref, r.owner_name, r.quote_no, r.po_no, csName(r.customer_code), ...r.lines.flatMap((l) => [l.pn, l.name])]
    .some((v) => String(v || '').toUpperCase().includes(qd))
  const scoped = rows.filter((r) => (cs === 'all' || (cs === '__etc' ? isEtc(r.customer_code) : r.customer_code === cs)) && hit(r))
  const count = (k) => scoped.filter((r) => r.stage === k).length
  const shown = scoped.filter((r) => (stage === 'all' ? true : stage === 'live' ? r.status === '진행' : r.stage === stage))
    .sort((a, b) => (a.status === '진행' ? 0 : 1) - (b.status === '진행' ? 0 : 1) || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')) || String(b.created_at).localeCompare(String(a.created_at)))
  const month = today.slice(0, 7)
  const kpi = {
    due: scoped.filter((r) => r.d !== null && r.d <= 3).length,
    bom: count('bom'),
    price: count('price') + count('noprice'),
    priceLate: scoped.filter((r) => r.stage === 'price' && r.price_req_at && Math.round((Date.now() - new Date(r.price_req_at)) / 86400000) > 2).length,
    ready: scoped.filter((r) => r.status === '진행' && readyLines(r).length > 0).length,
    month: scoped.filter((r) => String(r.created_at).slice(0, 7) === month).length,
  }

  async function run(id, fn, ok) {
    setBusy(id)
    try { await fn(); if (ok) toastSuccess(ok); refresh() } catch (e) { toastError(e.message || String(e)) } finally { setBusy(null) }
  }
  const check = (r) => run(r.id, () => checkRfq(r), '점검했습니다')
  const askPrice = (r) => run(r.id, async () => {
    await patchRfq(r.id, { price_req_at: new Date().toISOString(), price_req_by: meName, price_done_at: null, price_done_by: null })
    logActivity('update', 'pm_rfq', r.title, `견적 단가 요청 — ${csName(r.customer_code)} ${r.title}`)
  }, '구매자재에 단가를 요청했습니다')
  const priceDone = (r) => run(r.id, () => patchRfq(r.id, { price_done_at: new Date().toISOString(), price_done_by: meName }), '단가 요청을 끝냈습니다')

  // ✏ 수정 (v4.100.0) — 접수 머리와 품목을 그대로 폼에 올린다 (견적 낸 품목은 잠금)
  function openEdit(r) {
    const known = !isEtc(r.customer_code)
    setFerr({})
    setForm({ id: r.id, customer_code: known ? r.customer_code : '__etc', etc_name: known ? '' : r.customer_code, title: r.title || '', cust_ref: r.cust_ref || '', due_date: r.due_date || '',
      owner_name: r.owner_name || '', memo: r.memo || '', paste: '',
      lines: r.lines.map((l) => ({ id: l.id, pn: l.pn || '', name: l.name || '', rev: l.rev || '', qty: l.qty ?? 1, locked: !!l.quoted_at })), removed: [] })
    setOpen(null)
    setTimeout(() => document.querySelector('[data-rfq-form]')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 30)
  }
  async function saveEdit() {
    const r = rfqs.find((x) => x.id === form.id)
    if (!r) { toastError('접수를 찾지 못했습니다'); return }
    const etcName = String(form.etc_name || '').trim()
    const reg = form.customer_code === '__etc' && etcName
      ? csRows.find((x) => [x.code, x.name].some((v) => String(v || '').trim().toLowerCase() === etcName.toLowerCase())) : null
    const code = form.customer_code === '__etc' ? (reg ? String(reg.code).toLowerCase() : etcName) : form.customer_code
    const added = parsePaste(form.paste)
    const keep = form.lines.filter((l) => !form.removed.includes(l.id))
    if (!code || !form.title.trim()) { setFerr({ etc: !code ? '고객사 이름을 넣어 주세요' : '', title: !form.title.trim() ? '건명을 넣어 주세요' : '' }); return }
    if (keep.some((l) => !String(l.pn || '').trim())) { toastError('품번이 빈 줄이 있습니다'); return }
    if (!keep.length && !added.length) { toastError('품목이 하나는 있어야 합니다 — 접수 자체를 지우려면 품목 칸의 「이 접수 지우기」'); return }
    const c = csRows.find((x) => String(x.code).toLowerCase() === code)
    setBusy('new')
    try {
      await editRfq(r, { head: { customer_code: code, customer_id: c?.id || null, title: form.title.trim(), cust_ref: form.cust_ref.trim() || null, due_date: form.due_date || null, owner_name: form.owner_name.trim() || null, memo: form.memo.trim() || null },
        lines: keep, removed: form.removed, added })
      logActivity('update', 'pm_rfq', form.title, `견적 접수 수정 — ${form.title}${form.removed.length ? ` · 뺀 품목 ${form.removed.length}` : ''}${added.length ? ` · 더한 품목 ${added.length}` : ''}`)
      setForm(null)
      try {
        const { data: fresh } = await supabase.from('pm_rfq_line').select('*').eq('rfq_id', r.id)
        const { data: head } = await supabase.from('pm_rfq').select('*').eq('id', r.id).maybeSingle()
        await checkRfq({ ...(head || r), lines: fresh || [] })
        toastSuccess('수정하고 다시 점검했습니다')
      } catch (e) { toastError('수정은 됐고 점검이 실패했습니다 — 「🔍 다시 점검」을 눌러 주세요 (' + e.message + ')') }
      refresh()
    } catch (e) { toastError(e.message) } finally { setBusy(null) }
  }

  async function saveNew() {
    if (form.id) return saveEdit()
    const lines = parsePaste(form.paste)
    // 기타 · 직접 입력 — 입력한 이름이 등록 고객사(코드 · 이름)와 같으면 그 고객사로 맞춘다
    const etcName = String(form.etc_name || '').trim()
    const reg = form.customer_code === '__etc' && etcName
      ? csRows.find((x) => [x.code, x.name].some((v) => String(v || '').trim().toLowerCase() === etcName.toLowerCase())) : null
    const code = form.customer_code === '__etc' ? (reg ? String(reg.code).toLowerCase() : etcName) : form.customer_code
    if (!code || !form.title.trim() || !lines.length) {
      setFerr({ etc: !code ? '고객사 이름을 넣어 주세요' : '', title: !form.title.trim() ? '건명을 넣어 주세요 — 견적 이력에서 이 이름으로 찾습니다' : '', paste: !lines.length ? '품목을 한 줄 이상 붙여넣어 주세요 (품번 · 품명 · Rev · 수량)' : '' })
      return
    }
    const c = csRows.find((x) => String(x.code).toLowerCase() === code)
    setBusy('new')
    try {
      const r = await saveRfq({
        head: { customer_code: code, customer_id: c?.id || null, title: form.title.trim(), cust_ref: form.cust_ref.trim() || null, due_date: form.due_date || null, owner_name: form.owner_name.trim() || meName, memo: form.memo.trim() || null },
        lines, meName,
      })
      logActivity('create', 'pm_rfq', r.title, `견적 접수 — ${csName(r.customer_code)} ${r.title} · 품목 ${lines.length}`)
      setForm(null)
      try {
        const { data: fresh } = await supabase.from('pm_rfq_line').select('*').eq('rfq_id', r.id)
        await checkRfq({ ...r, lines: fresh || [] })
        toastSuccess('접수 · 점검했습니다')
      } catch (e) { toastError('접수는 됐고 점검이 실패했습니다 — 「🔍 점검」을 다시 눌러 주세요 (' + e.message + ')') }
      refresh()
    } catch (e) { toastError(e.message) } finally { setBusy(null) }
  }

  // 📤 발송 완료 (v4.119.0) — 견적번호 · 금액 · 제출일을 다시 적지 않는다. 발송일(오늘) · 누른 사람만 남김
  //   보낼 품목 = 준비된 품목 (없으면 남은 품목 전부) · 나머지가 있으면 「새 접수로 나눠 계속」 (기본 켬)
  function openSend(r) {
    const open = (r.lines || []).filter((l) => !l.quoted_at && !l.noquote)
    const ready = readyLines(r)
    const pick = ready.length ? ready : open
    setSend({ r, pick, rest: open.filter((l) => !pick.includes(l)), split: true })
  }
  async function doSend() {
    const { r, pick, rest, split } = send
    setSend(null)
    await run(r.id, async () => {
      const res = await submitRfq(r, { lineIds: pick.map((l) => l.id), quote_no: r.quote_no || null, submitted_at: today, submit_amount: r.submit_amount ?? null, currency: r.currency || null, split: rest.length ? split : false, meName })
      if (!res.partial) await patchRfq(r.id, { result_memo: `발송: ${meName || ''}`.trim() })
      logActivity('update', 'pm_rfq', r.title, `견적 발송 완료 — ${r.title} · ${pick.length}품목${res.child ? ` · 남은 품목은 「${res.child.title}」로 나눔` : ''}`)
      toastSuccess(res.child ? `${pick.length}품목 발송 완료 · 남은 품목은 「${res.child.title}」로 나눴습니다` : res.partial ? `${pick.length}품목 발송 · 남은 품목은 이 접수에서 계속` : '발송 완료로 저장했습니다')
    })
  }
  // ↩ 발송 취소 — 진행으로 되돌리고, 마지막에 발송한 품목(같은 시각에 표시된 품목)의 발송 표시만 지운다. 나눠진 잔여 접수는 그대로
  async function unsend(r) {
    const ok = await ask({ title: `「${r.title}」 발송 완료를 취소할까요?`, desc: '「진행 중」으로 되돌립니다. 이때 나눠 만든 「(잔여)」 접수는 그대로 남습니다.', okText: '발송 취소' })
    if (!ok) return
    await run(r.id, async () => {
      const last = (r.lines || []).map((l) => l.quoted_at).filter(Boolean).sort().pop()
      const ids = (r.lines || []).filter((l) => l.quoted_at && l.quoted_at === last).map((l) => l.id)
      if (ids.length) { const { error } = await supabase.from('pm_rfq_line').update({ quoted_at: null, quote_no: null }).in('id', ids); if (error) throw error }
      await patchRfq(r.id, { status: '진행', submitted_at: null, result_memo: null, result_at: null })
      logActivity('update', 'pm_rfq', r.title, `견적 발송 취소 — ${r.title}`)
    }, '진행 중으로 되돌렸습니다')
  }
  const sentBy = (r) => (/^발송:/.test(r.result_memo || '') ? String(r.result_memo).replace(/^발송:\s*/, '') : '')

  if (error && /pm_rfq/.test(error.message || '')) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">견적 접수 표가 아직 없습니다. Supabase SQL Editor 에서 <b>견적접수_반영_261023.sql</b> 을 먼저 실행해 주세요.<div className="text-xs mt-1 text-amber-600">{error.message}</div></div>
  }

  const Kpi = ({ tone, label, v, sub }) => (
    <div className={`rounded-xl border px-4 py-3 ${tone}`}>
      <div className="text-[12px] text-slate-500">{label}</div>
      <div className="text-[26px] font-extrabold leading-tight tabular-nums">{n(v)}</div>
      <div className="text-[11px] text-slate-500 truncate">{sub}</div>
    </div>
  )
  const pill = (k, label, cnt, tone) => (
    <button key={k} type="button" onClick={() => setStage(stage === k ? 'live' : k)} data-rfq-stage={k}
      className={`px-3 py-1.5 rounded-full text-xs font-bold border ${stage === k ? 'bg-slate-800 text-white border-slate-800' : tone || 'bg-white text-slate-600 border-slate-200'}`}>
      {label} <b className="font-mono">{n(cnt)}</b>
    </button>
  )

  return (
    <div className="space-y-3" data-rfq-board>
      {confirmEl}
      {send && (
        <div className="fixed inset-0 z-[80] bg-slate-900/40 flex items-center justify-center p-4" onMouseDown={() => setSend(null)} data-rfq-send>
          <div className="w-full max-w-[460px] bg-white rounded-2xl shadow-xl p-5" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3 className="text-[15px] font-extrabold text-slate-800">「{send.r.title}」 {send.rest.length ? `— ${send.pick.length}품목을 ` : '견적을 '}발송 완료로 할까요?</h3>
            <p className="text-[12.5px] text-slate-500 mt-1">품목 {n(send.pick.length)}개 · 오늘({md(today)}) 발송으로 남깁니다. 「발송 완료」 목록으로 옮겨지고, 잘못 눌렀으면 「↩ 발송 취소」로 되돌릴 수 있습니다.</p>
            {send.rest.length > 0 && <>
              <p className="text-[12px] text-amber-700 mt-2">아직 준비 안 된(단가 · BOM · 보류) 품목 {n(send.rest.length)}개가 남아 있습니다.</p>
              <label className="mt-2 flex items-center gap-1.5 text-[12.5px] font-bold text-slate-700">
                <input type="checkbox" checked={send.split} onChange={(e) => setSend({ ...send, split: e.target.checked })} data-rfq-split className="w-4 h-4 accent-emerald-600" />
                남은 {n(send.rest.length)}품목은 새 접수(「{send.r.title} (잔여)」)로 나눠 계속 진행
              </label>
              {!send.split && <p className="text-[11px] text-slate-400 mt-1 pl-6">끄면 이 접수에 남아 「진행 중」 그대로 (보낸 품목만 발송 표시)</p>}
            </>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setSend(null)} className="px-4 py-2 rounded-lg text-sm font-bold border border-slate-200 text-slate-600 bg-white">취소</button>
              <button type="button" onClick={doSend} data-rfq-send-ok className="px-4 py-2 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700">📤 {send.rest.length ? `${n(send.pick.length)}품목 ` : ''}발송 완료</button>
            </div>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi tone="bg-red-50/70 border-red-100 text-red-600" label="회신 기한 D-3 이내" v={kpi.due} sub="고객사에 견적 낼 날이 3일 안 (지난 것 포함)" />
        <Kpi tone="bg-red-50/70 border-red-100 text-red-600" label="BOM 필요" v={kpi.bom} sub="포털에 BOM · 품목이 없어 견적을 못 시작" />
        <Kpi tone="bg-amber-50/70 border-amber-100 text-amber-700" label="단가 없음 · 요청 중" v={kpi.price} sub={kpi.priceLate ? `구매자재 요청 2일 넘음 ${kpi.priceLate}건` : '구매자재가 매입 단가 확인'} />
        <Kpi tone="bg-violet-50/70 border-violet-100 text-violet-700" label="작성 가능" v={kpi.ready} sub="준비된 품목이 있음 — 일부만이라도 견적 작성" />
        <Kpi tone="bg-white border-slate-200 text-slate-800" label="이번 달 접수" v={kpi.month} sub="고객사 견적 요청 건수" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {pill('live', '진행 중', scoped.filter((r) => r.status === '진행').length)}
          <span className="w-px h-5 bg-slate-200 mx-1" />
          {pill('new', '① 점검 전', count('new'))}
          {pill('bom', '② BOM 필요', count('bom'), 'bg-red-50 text-red-600 border-red-200')}
          {pill('noprice', '③ 단가 없음', count('noprice'), 'bg-amber-50 text-amber-700 border-amber-200')}
          {pill('price', '③ 단가 요청 중', count('price'), 'bg-amber-50 text-amber-700 border-amber-200')}
          {pill('ready', '④ 작성 가능', count('ready'), 'bg-violet-50 text-violet-700 border-violet-200')}
          {pill('hold', '보류', count('hold'), 'bg-slate-100 text-slate-600 border-slate-300')}
          {pill('nq', '견적 불가 · 닫기 대기', count('nq'), 'bg-rose-50 text-rose-600 border-rose-200')}
          {pill('sent', '✅ 발송 완료', count('sent'), 'bg-emerald-50 text-emerald-700 border-emerald-200')}
          {pill('불가', '견적 불가', count('불가'))}
          {pill('all', '전체', scoped.length)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 건명 · 요청번호 · 품번 · 품명 · 담당 · 견적번호 · PO번호 검색" data-rfq-search
            className="flex-1 min-w-0 basis-full md:basis-auto md:min-w-[260px] px-3 py-2 text-xs border border-slate-200 rounded-lg" />
          <select value={cs} onChange={(e) => setCs(e.target.value)} className="text-xs font-semibold border border-slate-200 rounded-lg px-2.5 py-2 bg-white text-slate-600">
            <option value="all">모든 고객사</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            {rfqs.some((r) => isEtc(r.customer_code)) && <option value="__etc">기타 (직접 입력)</option>}
          </select>
          {editable && <button type="button" onClick={() => { setFerr({}); setForm({ customer_code: customers[0]?.id || '', etc_name: '', title: '', cust_ref: '', due_date: '', owner_name: meName, memo: '', paste: '' }) }} data-rfq-new
            className="ml-auto px-4 py-2 rounded-lg text-xs font-bold bg-violet-600 text-white hover:bg-violet-700">＋ 견적 접수</button>}
        </div>
      </div>

      {form && (
        <div className="bg-white border border-violet-200 rounded-xl p-4 space-y-3" data-rfq-form>
          <div className="flex items-center"><b className="text-sm">{form.id ? '✏ 접수 수정' : '＋ 견적 접수'}</b><button type="button" onClick={() => { setForm(null); setFerr({}) }} className="ml-auto text-xs font-bold text-slate-500">✕ 닫기</button></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-50/70 rounded-lg p-3">
            <label className="text-xs font-bold text-slate-600 space-y-1">고객사 <span className="text-red-500">*</span>
              <select value={form.customer_code} onChange={(e) => setForm({ ...form, customer_code: e.target.value })} className={INP} data-rfq-cs>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="__etc">기타 (직접 입력)</option></select>
              {form.customer_code === '__etc' && <input value={form.etc_name} onChange={(e) => setF({ etc_name: e.target.value }, 'etc')} placeholder="고객사 이름 (예: 한화컨버전스)" className={`${INP} ${ferr.etc ? '!border-rose-400 ring-2 ring-rose-100' : ''}`} data-rfq-etc autoFocus />}
              {ferr.etc && <span className="block text-[11px] text-rose-600" data-field-error="etc">{ferr.etc}</span>}
              {form.customer_code === '__etc' && <span className="block text-[10.5px] font-normal text-slate-400">등록 안 된 고객사 — BOM 없이 품목(단품)만 찾아 점검합니다</span>}</label>
            <label className="text-xs font-bold text-slate-600 space-y-1 md:col-span-2">건명 <span className="text-red-500">*</span>
              <input value={form.title} onChange={(e) => setF({ title: e.target.value }, 'title')} placeholder="예: EFEM PD 리뉴얼 견적" className={`${INP} ${ferr.title ? '!border-rose-400 ring-2 ring-rose-100' : ''}`} data-rfq-title />
              {ferr.title && <span className="block text-[11px] text-rose-600" data-field-error="title">{ferr.title}</span>}</label>
            <label className="text-xs font-bold text-slate-600 space-y-1">회신 기한
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className={INP} /></label>
            <label className="text-xs font-bold text-slate-600 space-y-1">고객 요청번호
              <input value={form.cust_ref} onChange={(e) => setForm({ ...form, cust_ref: e.target.value })} placeholder="RFQ 번호 (없으면 비움)" className={INP} /></label>
            <label className="text-xs font-bold text-slate-600 space-y-1">담당 (영업)
              <input value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} className={INP} /></label>
            <label className="text-xs font-bold text-slate-600 space-y-1 md:col-span-2">메모
              <input value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="고객사 담당자 · 특이사항" className={INP} /></label>
            {form.id && (
              <div className="md:col-span-4 space-y-1" data-rfq-edit-lines>
                <div className="text-xs font-bold text-slate-600">지금 품목 <span className="font-normal text-slate-400">— 품번을 바꾸면 그 품목은 다시 점검합니다 · 견적 낸 품목은 잠김</span></div>
                <div className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
                  {form.lines.map((l, i) => {
                    const gone = form.removed.includes(l.id)
                    const set = (k, v) => setForm({ ...form, lines: form.lines.map((x) => (x.id === l.id ? { ...x, [k]: v } : x)) })
                    return (
                      <div key={l.id} className={`flex items-center gap-2 px-2 py-1.5 ${gone ? 'opacity-40 line-through' : ''}`} data-rfq-edit-line={l.pn}>
                        <span className="w-6 text-[11px] font-mono text-slate-400">{i + 1}</span>
                        <input value={l.pn} disabled={l.locked || gone} onChange={(e) => set('pn', e.target.value)} placeholder="품번" className="w-40 px-2 py-1 text-[12px] font-mono border border-slate-200 rounded" />
                        <input value={l.name} disabled={l.locked || gone} onChange={(e) => set('name', e.target.value)} placeholder="품명" className="flex-1 min-w-0 px-2 py-1 text-[12px] border border-slate-200 rounded" />
                        <input value={l.rev} disabled={l.locked || gone} onChange={(e) => set('rev', e.target.value)} placeholder="Rev" className="w-14 px-2 py-1 text-[12px] border border-slate-200 rounded" />
                        <input value={l.qty} disabled={l.locked || gone} onChange={(e) => set('qty', e.target.value.replace(/[^0-9.]/g, ''))} className="w-16 px-2 py-1 text-[12px] text-right border border-slate-200 rounded" />
                        {l.locked ? <span className="w-12 text-[10.5px] text-emerald-700 font-bold">제출됨</span>
                          : <button type="button" onClick={() => setForm({ ...form, removed: gone ? form.removed.filter((x) => x !== l.id) : [...form.removed, l.id] })} data-rfq-edit-del={l.pn}
                              className="w-12 text-[11px] font-bold text-red-500">{gone ? '되살리기' : '✕ 빼기'}</button>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <label className="text-xs font-bold text-slate-600 space-y-1 md:col-span-4">{form.id ? '품목 더하기' : <>품목 <span className="text-red-500">*</span></>}
              <textarea rows={form.id ? 2 : 4} value={form.paste} onChange={(e) => setF({ paste: e.target.value }, 'paste')} data-rfq-paste
                placeholder={'엑셀에서 품번 · 품명 · Rev · 수량 순서로 복사해 붙여넣으세요 (여러 줄)\n110219638\tASSY PWR DIST EFEM\tA\t2'}
                className={`${INP} font-mono text-[12px] ${ferr.paste ? '!border-rose-400 ring-2 ring-rose-100' : ''}`} />
              {ferr.paste && <span className="block text-[11px] text-rose-600" data-field-error="paste">{ferr.paste}</span>}</label>
            <p className="md:col-span-4 -mt-1 text-[11.5px] text-slate-500">
              {form.id ? '더할' : '읽은'} 품목 <b>{parsePaste(form.paste).length}</b>줄 · 저장하면 품목마다 BOM · 단가를 바로 점검합니다. BOM 이 없으면 「BOM 필요」로, 단가 없는 부품이 있으면 「단가 없음」으로 표시됩니다.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setForm(null); setFerr({}) }} className="px-4 py-2 rounded-lg text-xs font-bold bg-white border border-slate-200">취소</button>
            <button type="button" disabled={busy === 'new'} onClick={saveNew} data-rfq-save className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-violet-600 text-white disabled:opacity-40">{busy === 'new' ? <><Spin />저장 · 점검 중…</> : form.id ? '수정 저장' : '접수 저장'}</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full min-w-[980px] text-xs">
          <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-200"><tr className="text-left">
            <th className="px-3 py-2.5 font-bold">접수 · 회신 기한</th><th className="px-3 font-bold">고객사 · 건명</th><th className="px-3 font-bold">품목</th>
            <th className="px-3 font-bold">BOM</th><th className="px-3 font-bold">단가 (구매자재)</th><th className="px-3 font-bold">상태</th><th className="px-3 font-bold">다음 할 일</th>
          </tr></thead>
          <tbody>
            {isLoading && <SkeletonRows cols={7} rows={6} two={[0, 1]} />}
            {!isLoading && !shown.length && <tr><td colSpan={7} className="p-10 text-center text-slate-400">{rfqs.length ? '조건에 맞는 접수가 없습니다' : '아직 접수한 견적이 없습니다 — 「＋ 견적 접수」로 시작하세요'}</td></tr>}
            {shown.map((r) => {
              const ls = r.lines
              const openLs = ls.filter(isOpenLine)
              const none = openLs.filter((l) => (l.kind || 'none') === 'none' && l.checked_at)
              const miss = openLs.reduce((a, l) => a + (+l.noprice_count || 0), 0)
              const held = ls.filter((l) => l.hold && !l.quoted_at)
              const quoted = ls.filter((l) => l.quoted_at)
              const ready = readyLines(r)
              const partial = ready.length > 0 && ready.length < ls.filter((l) => !l.quoted_at && !l.noquote).length
              const parts = ls.reduce((a, l) => a + (+l.part_count || 0), 0)
              const b = busy === r.id
              const late = r.d !== null && r.d < 0
              return [
                <tr key={r.id} className={`border-t border-slate-100 align-top ${r.stage === 'bom' ? 'bg-red-50/30' : ''}`} data-rfq={r.title}>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="font-mono text-slate-600">{md(r.created_at)} <span className="text-[10.5px] text-slate-400">#{r.seq}</span></div>
                    {r.due_date && <span className={`inline-block mt-1 px-1.5 py-[1px] rounded text-[10.5px] font-bold ${r.d === null ? 'text-slate-500' : late ? 'bg-red-50 text-red-600' : r.d <= 3 ? 'bg-amber-50 text-amber-700' : 'text-slate-500'}`}>
                      회신 {md(r.due_date)}{r.d !== null ? ` · ${late ? `${-r.d}일 지남` : r.d === 0 ? '오늘' : `D-${r.d}`}` : ''}</span>}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${CS_BADGE[r.customer_code] || 'bg-slate-100 text-slate-600'}`}>{csName(r.customer_code)}</span>
                    <div className="font-bold text-slate-800 mt-1">{r.title}</div>
                    <div className="text-[11px] text-slate-400">{[r.cust_ref && `요청 ${r.cust_ref}`, r.owner_name].filter(Boolean).join(' · ')}</div>
                    {r.memo && <div className="text-[11px] text-sky-700 truncate max-w-[260px]" title={r.memo}>💬 {r.memo}</div>}
                  </td>
                  <td className="px-3 py-3">
                    <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} data-rfq-lines={r.title} className="text-left">
                      <div className="font-mono font-bold text-[#5b6ee8]">{ls[0]?.pn || '—'}{ls.length > 1 ? ` 외 ${ls.length - 1}종` : ''}</div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[220px]">{ls[0]?.name || ''}{ls[0] ? ` · ${n(ls[0].qty)}EA` : ''} {open === r.id ? '▴' : '▾'}</div>
                    </button>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {r.stage === 'new' ? <span className="text-slate-400">점검 전</span>
                      : none.length ? <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-50 text-red-600" data-rfq-bom>⚠ {none.length}종 없음</span>
                      : <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700">✓ 등록됨</span>}
                  </td>
                  <td className="px-3 py-3">
                    {r.stage === 'new' || none.length ? <span className="text-slate-400">—</span>
                      : miss ? <><span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700" data-rfq-miss>단가 없음 {n(miss)}</span><div className="text-[10.5px] text-slate-400 mt-0.5">부품 {n(parts)}개 중</div>
                        {r.price_req_at && !r.price_done_at && <div className="text-[10.5px] text-amber-700 mt-0.5">요청 {md(r.price_req_at)} · {r.price_req_by || ''}</div>}</>
                      : <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700">✓ {n(parts)}/{n(parts)}</span>}
                    {held.length > 0 && <div className="mt-1"><span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-slate-100 text-slate-600 border border-slate-300" data-rfq-held title={held.map((l) => `${l.pn}: ${l.hold}${l.hold_memo ? ` (${l.hold_memo})` : ''}`).join('\n')}>보류 {n(held.length)}품목</span></div>}
                    {quoted.length > 0 && <div className="mt-1 text-[10.5px] text-slate-500">발송 {n(quoted.length)}품목</div>}
                    {ls.some((l) => l.noquote && !l.quoted_at) && <div className="mt-1"><span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-rose-50 text-rose-600 border border-rose-200" data-rfq-nq title={ls.filter((l) => l.noquote).map((l) => `${l.pn}: ${l.noquote}${l.noquote_memo ? ` (${l.noquote_memo})` : ''}`).join('\n')}>견적 불가 {n(ls.filter((l) => l.noquote && !l.quoted_at).length)}품목</span></div>}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold ${STAGE_TONE[r.stage] || ''}`} data-rfq-stage-of={r.stage}>{stageLabel(r.stage)}</span>
                    {r.stage === 'sent' && <div className="text-[11px] text-slate-500 mt-1" data-rfq-sent>{r.submitted_at ? md(r.submitted_at) : ''}{sentBy(r) ? ` · ${sentBy(r)}` : ''}</div>}
                    {r.status === '수주' && r.po_no && <button type="button" onClick={() => nav('/orders')} className="block text-[11px] font-bold text-[#5b6ee8] mt-1">📨 PO {r.po_no} →</button>}
                    {r.status === '취소' && r.result_memo && <div className="text-[11px] text-slate-400 mt-1 truncate max-w-[180px]" title={r.result_memo}>{r.result_memo}</div>}
                  </td>
                  <td className="px-3 py-3">
                    {/* 다음 할 일 — 주 동작은 한 줄 전체 · 보조 동작은 같은 폭 3칸 (v4.99.0 · 버튼 길이가 제각각이라 들쭉날쭉했음) */}
                    <div className="grid grid-cols-3 gap-1.5 w-[300px]" data-rfq-next>
                      {editable && r.stage === 'new' && <Btn wide tone="primary" onClick={() => check(r)} busy={b} data="check">🔍 점검</Btn>}
                      {r.stage === 'bom' && (isEtc(r.customer_code)
                        ? <Btn wide tone="red" onClick={() => nav('/master/items')} data="bom">📦 품목 등록 →</Btn>
                        : <Btn wide tone="red" onClick={() => nav(`/customer/${r.customer_code}/bom`)} data="bom">🧬 BOM 올리기</Btn>)}
                      {editable && r.stage === 'noprice' && <Btn wide tone="amber" onClick={() => askPrice(r)} busy={b} data="ask">💲 구매자재에 단가 요청</Btn>}
                      {r.stage === 'price' && (isBuy
                        ? <Btn wide tone="amber" onClick={() => nav('/quote')} data="quote">💲 품목 단가 등록 →</Btn>
                        : <span className="col-span-3 py-1.5 rounded-lg bg-amber-50/60 text-center text-[11.5px] font-bold text-amber-700">⏳ 구매자재 처리 중</span>)}
                      {r.status === '진행' && ready.length > 0 && <Btn wide tone="primary" onClick={() => onWrite?.({ ...r, lines: ready })} data="write">{partial ? `✏ 준비된 ${ready.length}품목만 견적 작성 →` : '✏ 견적 작성 →'}</Btn>}
                      {editable && ['bom', 'noprice', 'price', 'ready'].includes(r.stage) && <Btn onClick={() => check(r)} busy={b} data="recheck">🔍 다시 점검</Btn>}
                      {editable && r.stage === 'nq' && <Btn wide tone="red" onClick={async () => {
                        const m = await ask({ title: `${r.title} — 견적 불가로 닫을까요?`, desc: '접수가 「견적 불가」로 끝납니다. 고객사에 알린 내용 · 사유를 남기세요 (비우면 품목 사유를 모아 적음).', okText: '견적 불가로 닫기', danger: true,
                          input: { label: '고객사에 알린 내용 · 사유', value: [...new Set(ls.filter((l) => l.noquote).map((l) => l.noquote))].join(' · '), rows: 2 } })
                        if (m) run(r.id, () => closeNoquote(r, m.value), '견적 불가로 닫았습니다') }} busy={b} data="nq-close">🚫 견적 불가로 닫기</Btn>}
                      {editable && isBuy && r.stage === 'price' && <Btn onClick={() => priceDone(r)} busy={b} data="done">단가 요청 끝</Btn>}
                      {editable && r.status === '진행' && r.stage !== 'nq' && <Btn tone="green" onClick={() => openSend(r)} busy={b} data="send">📤 발송 완료</Btn>}
                      {editable && r.status === '제출' && <Btn onClick={() => unsend(r)} busy={b} data="unsend">↩ 발송 취소</Btn>}
                      {editable && r.status === '진행' && <Btn onClick={() => openEdit(r)} busy={b} data="edit">✏ 수정</Btn>}
                    </div>
                  </td>
                </tr>,
                open === r.id && (
                  <tr key={r.id + ':lines'} className="bg-slate-50/60"><td colSpan={7} className="px-4 py-3">
                    <table className="w-full text-[11.5px]" data-rfq-line-table>
                      <thead className="text-slate-400"><tr className="text-left"><th className="py-1 pr-3">#</th><th className="pr-3">품번</th><th className="pr-3">품명</th><th className="pr-3">Rev</th><th className="pr-3 text-right">수량</th><th className="pr-3">점검</th><th className="pr-3">단가 · 없는 부품</th><th>보류 (구매자재) · 제출</th><th className="pl-3">견적 불가</th></tr></thead>
                      <tbody>
                        {ls.map((l) => (
                          <tr key={l.id} className="border-t border-slate-100 align-top">
                            <td className="py-1.5 pr-3 font-mono text-slate-400">{l.line_no}</td>
                            <td className="pr-3 font-mono font-bold text-slate-700">{l.pn}{l.std_code && l.std_code !== l.pn && <div className="text-[10px] text-slate-400 font-normal">{l.std_code}</div>}</td>
                            <td className="pr-3 text-slate-600" data-rfq-line-name={l.pn}>{l.name || l.item?.name || '—'}
                              {l.item?.name && l.name && l.item.name.trim().toUpperCase() !== String(l.name).trim().toUpperCase() && <div className="text-[10px] text-slate-400" title="포털 품목 기준정보의 품명 — 붙여넣은 품명과 다르면 매칭이 맞는지 확인하세요">기준정보: {l.item.name}</div>}</td>
                            <td className="pr-3">{l.rev || '—'}</td>
                            <td className="pr-3 text-right font-mono">{n(l.qty)}</td>
                            <td className="pr-3 whitespace-nowrap">{l.noquote ? <span className="text-rose-600 font-bold">견적 불가</span> : !l.checked_at ? <span className="text-slate-400">점검 전</span> : l.kind === 'assy' ? <span className="text-emerald-700 font-bold">BOM 있음 · 부품 {n(l.part_count)}</span> : l.kind === 'item' ? <span className="text-emerald-700 font-bold">단품</span> : <span className="text-red-600 font-bold">⚠ BOM · 품목 없음</span>}</td>
                            <td className="text-amber-700" data-rfq-line-price={l.pn}>{l.kind === 'item' && !(+l.noprice_count > 0) && l.item?.price > 0 ? (
                              <span className="text-slate-600">매입가 <b className="font-mono">{n(l.item.price)}</b>원
                                {l.item.vendor || l.item.last
                                  ? <span className="text-slate-400"> · {[l.item.vendor, l.item.last ? `이력 ${md(l.item.last)}` : ''].filter(Boolean).join(' · ')}</span>
                                  : <span className="ml-1 px-1.5 py-[1px] rounded-full bg-amber-50 text-amber-700 text-[10.5px] font-bold" title="품목 기준정보에 매입가만 있고 구매처 · 단가 이력이 없습니다 (처음 일괄 등록한 값일 수 있음) — 맞는 단가인지 확인하세요" data-rfq-price-nobasis>근거 없음 · 확인</span>}
                              </span>
                            ) : +l.noprice_count > 0 ? <span title={(l.noprice_codes || []).join(', ')}><b>{n(l.noprice_count)}</b> · <span className="font-mono">{(l.noprice_codes || []).slice(0, 6).join(', ')}{(l.noprice_codes || []).length > 6 ? ` 외 ${(l.noprice_codes || []).length - 6}` : ''}</span></span> : <span className="text-slate-300">—</span>}</td>
                            <td className="pl-3" data-rfq-hold-cell={l.pn}>
                              {l.quoted_at ? <span className="text-emerald-700 font-bold">✓ 발송 {md(l.quoted_at)}</span>
                                : isBuy && editable && r.status === '진행' ? (
                                  <div className="flex items-center gap-1.5">
                                    <select value={l.hold || ''} data-rfq-hold={l.pn} disabled={busy === r.id}
                                      onChange={async (e) => {
                                        const v = e.target.value
                                        const m = v ? await ask({ title: `${l.pn} — 「${v}」 보류`, desc: '이 품목은 견적 작성 대상에서 빠집니다 (나머지 품목만 먼저 견적 가능).', okText: '보류로 표시', cancelText: '그만두기', input: { label: '사유 (선택)', value: l.hold_memo || '', placeholder: '예: 제조사 단종 확인 중 · 11/5 회신 예정' } }) : { value: '' }
                                        if (!m) return
                                        run(r.id, () => setLineHold(r, l, v || null, m.value, meName), v ? `${l.pn} 보류 — ${v}` : `${l.pn} 보류 해제`) }}
                                      className="px-1.5 py-1 text-[11px] border border-slate-200 rounded bg-white">
                                      <option value="">— 진행</option>{HOLDS.map((h) => <option key={h} value={h}>{h}</option>)}
                                    </select>
                                    {l.hold_memo && <span className="text-[10.5px] text-slate-500 truncate max-w-[160px]" title={l.hold_memo}>{l.hold_memo}</span>}
                                  </div>
                                ) : l.hold ? <span className="px-1.5 py-[1px] rounded bg-slate-100 text-slate-600 font-bold" title={[l.hold_memo, l.hold_by].filter(Boolean).join(' · ')}>보류 · {l.hold}{l.hold_memo ? ` — ${l.hold_memo}` : ''}</span> : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="pl-3" data-rfq-nq-cell={l.pn}>
                              {l.quoted_at ? <span className="text-slate-300">—</span>
                                : editable && r.status === '진행' ? (
                                  <div className="flex items-center gap-1.5">
                                    <select value={l.noquote || ''} data-rfq-nq-sel={l.pn} disabled={busy === r.id}
                                      onChange={async (e) => {
                                        const v = e.target.value
                                        const m = v ? await ask({ title: `${l.pn} — 견적 불가 (${v})`, desc: '이 품목은 견적에서 빠지고 영업이 고객사에 알릴 사유로 보입니다.', okText: '견적 불가로 표시', cancelText: '그만두기', danger: true, input: { label: '자세한 내용 (선택)', value: l.noquote_memo || '' } }) : { value: '' }
                                        if (!m) return
                                        run(r.id, () => setLineNoquote(r, l, v || null, m.value, meName), v ? `${l.pn} 견적 불가 — ${v}` : `${l.pn} 견적 불가 해제`) }}
                                      className={`px-1.5 py-1 text-[11px] border rounded bg-white ${l.noquote ? 'border-rose-300 text-rose-600 font-bold' : 'border-slate-200'}`}>
                                      <option value="">— 견적 가능</option>{NOQUOTES.map((h) => <option key={h} value={h}>{h}</option>)}
                                    </select>
                                    {l.noquote_memo && <span className="text-[10.5px] text-slate-500 truncate max-w-[160px]" title={l.noquote_memo}>{l.noquote_memo}</span>}
                                  </div>
                                ) : l.noquote ? <span className="px-1.5 py-[1px] rounded bg-rose-50 text-rose-600 font-bold" title={[l.noquote_memo, l.noquote_by].filter(Boolean).join(' · ')}>{l.noquote}{l.noquote_memo ? ` — ${l.noquote_memo}` : ''}</span> : <span className="text-slate-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {editable && <button type="button" onClick={async () => {
                      const ok = await ask({ title: `${r.title} 접수를 지울까요?`, desc: `품목 ${ls.length}줄도 함께 지워지고 되돌릴 수 없습니다. 견적을 낼 수 없는 건이면 지우지 말고 품목 표의 「견적 불가」로 닫아 기록을 남기세요.`,
                        items: ls.slice(0, 5).map((l) => `${l.pn}${l.name ? ` · ${l.name}` : ''} · ${n(l.qty)}개`), more: Math.max(0, ls.length - 5), okText: '접수 삭제', danger: true })
                      if (ok) run(r.id, () => deleteRfq(r.id), '지웠습니다') }} className="mt-2 text-[11px] text-red-500 hover:underline" data-rfq-del>이 접수 지우기</button>}
                  </td></tr>
                ),
              ]
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400 px-1">한 줄 = 고객사 견적 요청 한 건. 품목 칸을 누르면 품목마다 점검 결과(BOM · 단가 없는 부품)가 나옵니다. BOM 을 올리거나 단가를 등록한 뒤 「🔍 다시 점검」을 누르세요. 구매자재가 「수급 어려움 · 단가 대기」로 보류한 품목은 빼고 준비된 품목부터 견적 · 발송할 수 있습니다. 고객사에 보냈으면 「📤 발송 완료」 — 견적번호 · 금액은 다시 적지 않습니다. 단종 · 제작 불가처럼 견적을 낼 수 없는 품목은 품목 표의 「견적 불가」에서 사유를 고르세요 — 모든 품목이 불가면 「🚫 견적 불가로 닫기」.</p>
    </div>
  )
}

const SENT = ['제출', '수주', '실주']

function Btn({ tone, onClick, busy, data, children, wide }) {
  const cls = tone === 'primary' ? 'bg-violet-600 text-white border-violet-600 hover:bg-violet-700'
    : tone === 'red' ? 'bg-white text-red-600 border-red-200 hover:bg-red-50'
    : tone === 'amber' ? 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50'
    : tone === 'green' ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
  return <button type="button" onClick={onClick} disabled={busy} data-rfq-act={data} className={`${wide ? 'col-span-3' : ''} w-full px-2 py-1.5 rounded-lg text-[11.5px] font-bold border whitespace-nowrap text-center truncate disabled:opacity-40 ${cls}`}>{busy ? '…' : children}</button>
}
