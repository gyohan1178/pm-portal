// 📥 견적 접수 현황 — 영업 › 매출견적 첫 탭 (v4.92.0)
//   고객사 견적 요청을 접수해 두고 BOM 확인 → 단가(구매자재) → 견적 작성 → 제출 → 수주 · 실주까지 한 줄로 따라간다
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
import { RFQ_STAGES, STAGE_TONE, stageLabel, stageOf, fetchRfqs, parsePaste, checkRfq, saveRfq, patchRfq, deleteRfq, dday, HOLDS, isOpenLine, readyLines, setLineHold, submitRfq } from './rfq'

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

  const { data: rfqs = [], isLoading, error } = useQuery({ queryKey: ['rfqs'], queryFn: fetchRfqs, staleTime: 30 * 1000 })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['rfqs'] }); qc.invalidateQueries({ queryKey: ['flowCounts'] }) }

  const [stage, setStage] = useState('live')     // live 진행 중 · all · 단계 키
  const [cs, setCs] = useState('all')
  const [q, setQ] = useState('')
  const qd = useDeferredValue(q).trim().toUpperCase()
  const [open, setOpen] = useState(null)          // 품목 펼친 접수 id
  const [result, setResult] = useState(null)      // 결과 입력 중 { id, ... }
  const [form, setForm] = useState(null)          // 새 접수
  const [busy, setBusy] = useState(null)

  const csName = (code) => customers.find((c) => c.id === code)?.name || String(code || '').toUpperCase()
  const rows = useMemo(() => rfqs.map((r) => ({ ...r, stage: stageOf(r), d: r.status === '진행' ? dday(r.due_date, today) : null })), [rfqs, today])
  const hit = (r) => !qd || [r.title, r.cust_ref, r.owner_name, r.quote_no, r.po_no, csName(r.customer_code), ...r.lines.flatMap((l) => [l.pn, l.name])]
    .some((v) => String(v || '').toUpperCase().includes(qd))
  const scoped = rows.filter((r) => (cs === 'all' || r.customer_code === cs) && hit(r))
  const count = (k) => scoped.filter((r) => r.stage === k).length
  const shown = scoped.filter((r) => (stage === 'all' ? true : stage === 'live' ? r.status === '진행' || r.status === '제출' : r.stage === stage))
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

  async function saveNew() {
    const lines = parsePaste(form.paste)
    if (!form.customer_code || !form.title.trim() || !lines.length) { toastError('고객사 · 건명 · 품목은 꼭 넣어 주세요'); return }
    const c = csRows.find((x) => String(x.code).toLowerCase() === form.customer_code)
    setBusy('new')
    try {
      const r = await saveRfq({
        head: { customer_code: form.customer_code, customer_id: c?.id || null, title: form.title.trim(), cust_ref: form.cust_ref.trim() || null, due_date: form.due_date || null, owner_name: form.owner_name.trim() || meName, memo: form.memo.trim() || null },
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

  async function saveResult() {
    const r = result
    if (r.status === '제출') {
      // 고른 품목만 제출 · 남은 품목은 나누기(기본) — 보류 · 미준비 품목을 빼고 먼저 낸다 (v4.92.1)
      const src = rfqs.find((x) => x.id === r.id)
      if (!r.lineIds.length) { toastError('제출할 품목을 하나 이상 골라 주세요'); return }
      await run(r.id, async () => {
        const res = await submitRfq(src, { lineIds: r.lineIds, quote_no: r.quote_no, submitted_at: r.submitted_at || today, submit_amount: r.submit_amount, currency: r.currency, split: r.split, meName })
        logActivity('update', 'pm_rfq', r.title, `견적 제출 — ${r.title} · ${r.lineIds.length}품목${res.child ? ` · 남은 품목은 「${res.child.title}」로 나눔` : ''}`)
        toastSuccess(res.child ? `${r.lineIds.length}품목 제출 · 남은 품목은 「${res.child.title}」로 나눴습니다` : res.partial ? `${r.lineIds.length}품목 제출 · 남은 품목은 이 접수에서 계속` : '제출로 저장했습니다')
      })
      setResult(null)
      return
    }
    const patch = { status: r.status }
    if (r.status === '제출') Object.assign(patch, { quote_no: r.quote_no || null, submitted_at: r.submitted_at || today, submit_amount: r.submit_amount === '' ? null : Number(r.submit_amount), currency: r.currency || null })
    if (r.status === '수주') Object.assign(patch, { po_no: r.po_no || null, result_at: today })
    if (r.status === '실주' || r.status === '취소') Object.assign(patch, { result_memo: r.result_memo || null, result_at: today })
    if ((r.status === '실주') && !String(r.result_memo || '').trim()) { toastError('실주 사유를 적어 주세요'); return }
    await run(r.id, async () => { await patchRfq(r.id, patch); logActivity('update', 'pm_rfq', r.title, `견적 결과 — ${r.title} → ${r.status}`) }, `${r.status} 로 저장했습니다`)
    setResult(null)
  }

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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi tone="bg-red-50/70 border-red-100 text-red-600" label="회신 기한 D-3 이내" v={kpi.due} sub="고객사에 견적 낼 날이 3일 안 (지난 것 포함)" />
        <Kpi tone="bg-red-50/70 border-red-100 text-red-600" label="BOM 필요" v={kpi.bom} sub="포털에 BOM · 품목이 없어 견적을 못 시작" />
        <Kpi tone="bg-amber-50/70 border-amber-100 text-amber-700" label="단가 없음 · 요청 중" v={kpi.price} sub={kpi.priceLate ? `구매자재 요청 2일 넘음 ${kpi.priceLate}건` : '구매자재가 매입 단가 확인'} />
        <Kpi tone="bg-violet-50/70 border-violet-100 text-violet-700" label="작성 가능" v={kpi.ready} sub="준비된 품목이 있음 — 일부만이라도 견적 작성" />
        <Kpi tone="bg-white border-slate-200 text-slate-800" label="이번 달 접수" v={kpi.month} sub="고객사 견적 요청 건수" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {pill('live', '진행 · 제출', scoped.filter((r) => r.status === '진행' || r.status === '제출').length)}
          <span className="w-px h-5 bg-slate-200 mx-1" />
          {pill('new', '① 점검 전', count('new'))}
          {pill('bom', '② BOM 필요', count('bom'), 'bg-red-50 text-red-600 border-red-200')}
          {pill('noprice', '③ 단가 없음', count('noprice'), 'bg-amber-50 text-amber-700 border-amber-200')}
          {pill('price', '③ 단가 요청 중', count('price'), 'bg-amber-50 text-amber-700 border-amber-200')}
          {pill('ready', '④ 작성 가능', count('ready'), 'bg-violet-50 text-violet-700 border-violet-200')}
          {pill('hold', '보류', count('hold'), 'bg-slate-100 text-slate-600 border-slate-300')}
          {pill('제출', '⑤ 제출', count('제출'))}
          {pill('수주', '⑥ 수주', count('수주'), 'bg-emerald-50 text-emerald-700 border-emerald-200')}
          {pill('실주', '실주', count('실주'))}
          {pill('all', '전체', scoped.length)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 건명 · 요청번호 · 품번 · 품명 · 담당 · 견적번호 · PO번호 검색" data-rfq-search
            className="flex-1 min-w-0 basis-full md:basis-auto md:min-w-[260px] px-3 py-2 text-xs border border-slate-200 rounded-lg" />
          <select value={cs} onChange={(e) => setCs(e.target.value)} className="text-xs font-semibold border border-slate-200 rounded-lg px-2.5 py-2 bg-white text-slate-600">
            <option value="all">모든 고객사</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {editable && <button type="button" onClick={() => setForm({ customer_code: customers[0]?.id || '', title: '', cust_ref: '', due_date: '', owner_name: meName, memo: '', paste: '' })} data-rfq-new
            className="ml-auto px-4 py-2 rounded-lg text-xs font-bold bg-violet-600 text-white hover:bg-violet-700">＋ 견적 접수</button>}
        </div>
      </div>

      {form && (
        <div className="bg-white border border-violet-200 rounded-xl p-4 space-y-3" data-rfq-form>
          <div className="flex items-center"><b className="text-sm">＋ 견적 접수</b><button type="button" onClick={() => setForm(null)} className="ml-auto text-xs font-bold text-slate-500">✕ 닫기</button></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-50/70 rounded-lg p-3">
            <label className="text-xs font-bold text-slate-600 space-y-1">고객사 <span className="text-red-500">*</span>
              <select value={form.customer_code} onChange={(e) => setForm({ ...form, customer_code: e.target.value })} className={INP}>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="text-xs font-bold text-slate-600 space-y-1 md:col-span-2">건명 <span className="text-red-500">*</span>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="예: EFEM PD 리뉴얼 견적" className={INP} data-rfq-title /></label>
            <label className="text-xs font-bold text-slate-600 space-y-1">회신 기한
              <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className={INP} /></label>
            <label className="text-xs font-bold text-slate-600 space-y-1">고객 요청번호
              <input value={form.cust_ref} onChange={(e) => setForm({ ...form, cust_ref: e.target.value })} placeholder="RFQ 번호 (없으면 비움)" className={INP} /></label>
            <label className="text-xs font-bold text-slate-600 space-y-1">담당 (영업)
              <input value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} className={INP} /></label>
            <label className="text-xs font-bold text-slate-600 space-y-1 md:col-span-2">메모
              <input value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="고객사 담당자 · 특이사항" className={INP} /></label>
            <label className="text-xs font-bold text-slate-600 space-y-1 md:col-span-4">품목 <span className="text-red-500">*</span>
              <textarea rows={4} value={form.paste} onChange={(e) => setForm({ ...form, paste: e.target.value })} data-rfq-paste
                placeholder={'엑셀에서 품번 · 품명 · Rev · 수량 순서로 복사해 붙여넣으세요 (여러 줄)\n110219638\tASSY PWR DIST EFEM\tA\t2'}
                className={`${INP} font-mono text-[12px]`} /></label>
            <p className="md:col-span-4 -mt-1 text-[11.5px] text-slate-500">
              읽은 품목 <b>{parsePaste(form.paste).length}</b>줄 · 저장하면 품목마다 BOM · 단가를 바로 점검합니다. BOM 이 없으면 「BOM 필요」로, 단가 없는 부품이 있으면 「단가 없음」으로 표시됩니다.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setForm(null)} className="px-4 py-2 rounded-lg text-xs font-bold bg-white border border-slate-200">취소</button>
            <button type="button" disabled={busy === 'new'} onClick={saveNew} data-rfq-save className="px-4 py-2 rounded-lg text-xs font-bold bg-violet-600 text-white disabled:opacity-40">{busy === 'new' ? '저장 · 점검 중…' : '접수 저장'}</button>
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
            {isLoading && <tr><td colSpan={7} className="p-8 text-center text-slate-400">불러오는 중…</td></tr>}
            {!isLoading && !shown.length && <tr><td colSpan={7} className="p-10 text-center text-slate-400">{rfqs.length ? '조건에 맞는 접수가 없습니다' : '아직 접수한 견적이 없습니다 — 「＋ 견적 접수」로 시작하세요'}</td></tr>}
            {shown.map((r) => {
              const ls = r.lines
              const openLs = ls.filter(isOpenLine)
              const none = openLs.filter((l) => (l.kind || 'none') === 'none' && l.checked_at)
              const miss = openLs.reduce((a, l) => a + (+l.noprice_count || 0), 0)
              const held = ls.filter((l) => l.hold && !l.quoted_at)
              const quoted = ls.filter((l) => l.quoted_at)
              const ready = readyLines(r)
              const partial = ready.length > 0 && ready.length < ls.length - quoted.length
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
                    {quoted.length > 0 && <div className="mt-1 text-[10.5px] text-slate-500">제출 {n(quoted.length)}품목</div>}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold ${STAGE_TONE[r.stage] || ''}`} data-rfq-stage-of={r.stage}>{stageLabel(r.stage)}</span>
                    {r.status === '제출' && <div className="text-[11px] text-slate-500 mt-1 font-mono">{r.quote_no || ''}{r.submit_amount ? ` · ${r.currency === 'USD' ? '$' : '₩'}${n(r.submit_amount)}` : ''}</div>}
                    {r.status === '수주' && r.po_no && <button type="button" onClick={() => nav('/orders')} className="block text-[11px] font-bold text-[#5b6ee8] mt-1">📨 PO {r.po_no} →</button>}
                    {(r.status === '실주' || r.status === '취소') && r.result_memo && <div className="text-[11px] text-slate-400 mt-1 truncate max-w-[180px]" title={r.result_memo}>{r.result_memo}</div>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {editable && r.stage === 'new' && <Btn tone="primary" onClick={() => check(r)} busy={b} data="check">🔍 점검</Btn>}
                      {r.stage === 'bom' && <Btn tone="red" onClick={() => nav(`/customer/${r.customer_code}/bom`)} data="bom">🧬 BOM 올리기</Btn>}
                      {editable && r.stage === 'noprice' && <Btn tone="amber" onClick={() => askPrice(r)} busy={b} data="ask">💲 구매자재에 단가 요청</Btn>}
                      {r.stage === 'price' && (isBuy
                        ? <Btn tone="amber" onClick={() => nav('/quote')} data="quote">💲 품목 단가 등록 →</Btn>
                        : <span className="text-[11px] text-slate-500">구매자재 처리 중</span>)}
                      {r.status === '진행' && ready.length > 0 && <Btn tone="primary" onClick={() => onWrite?.({ ...r, lines: ready })} data="write">{partial ? `✏ 준비된 ${ready.length}품목만 견적 작성 →` : '✏ 견적 작성 →'}</Btn>}
                      {editable && ['bom', 'noprice', 'price', 'ready'].includes(r.stage) && <Btn onClick={() => check(r)} busy={b} data="recheck">🔍 다시 점검</Btn>}
                      {editable && isBuy && r.stage === 'price' && <Btn onClick={() => priceDone(r)} busy={b} data="done">단가 요청 끝</Btn>}
                      {editable && ['진행', '제출'].includes(r.status) && <Btn onClick={() => setResult({ id: r.id, title: r.title, status: r.status === '진행' ? '제출' : '수주', quote_no: r.quote_no || '', submitted_at: r.submitted_at || today, submit_amount: r.submit_amount ?? '', currency: r.currency || (r.customer_code === 'ax' ? 'USD' : 'KRW'), po_no: r.po_no || '', result_memo: r.result_memo || '',
                        lineIds: ready.map((l) => l.id), split: true })} data="result">결과 입력</Btn>}
                    </div>
                  </td>
                </tr>,
                open === r.id && (
                  <tr key={r.id + ':lines'} className="bg-slate-50/60"><td colSpan={7} className="px-4 py-3">
                    <table className="w-full text-[11.5px]" data-rfq-line-table>
                      <thead className="text-slate-400"><tr className="text-left"><th className="py-1 pr-3">#</th><th className="pr-3">품번</th><th className="pr-3">품명</th><th className="pr-3">Rev</th><th className="pr-3 text-right">수량</th><th className="pr-3">점검</th><th className="pr-3">단가 없는 부품</th><th>보류 (구매자재) · 제출</th></tr></thead>
                      <tbody>
                        {ls.map((l) => (
                          <tr key={l.id} className="border-t border-slate-100 align-top">
                            <td className="py-1.5 pr-3 font-mono text-slate-400">{l.line_no}</td>
                            <td className="pr-3 font-mono font-bold text-slate-700">{l.pn}{l.std_code && l.std_code !== l.pn && <div className="text-[10px] text-slate-400 font-normal">{l.std_code}</div>}</td>
                            <td className="pr-3 text-slate-600">{l.name || '—'}</td>
                            <td className="pr-3">{l.rev || '—'}</td>
                            <td className="pr-3 text-right font-mono">{n(l.qty)}</td>
                            <td className="pr-3 whitespace-nowrap">{!l.checked_at ? <span className="text-slate-400">점검 전</span> : l.kind === 'assy' ? <span className="text-emerald-700 font-bold">BOM 있음 · 부품 {n(l.part_count)}</span> : l.kind === 'item' ? <span className="text-emerald-700 font-bold">단품</span> : <span className="text-red-600 font-bold">⚠ BOM · 품목 없음</span>}</td>
                            <td className="text-amber-700">{+l.noprice_count > 0 ? <span title={(l.noprice_codes || []).join(', ')}><b>{n(l.noprice_count)}</b> · <span className="font-mono">{(l.noprice_codes || []).slice(0, 6).join(', ')}{(l.noprice_codes || []).length > 6 ? ` 외 ${(l.noprice_codes || []).length - 6}` : ''}</span></span> : <span className="text-slate-300">—</span>}</td>
                            <td className="pl-3" data-rfq-hold-cell={l.pn}>
                              {l.quoted_at ? <span className="text-emerald-700 font-bold">✓ 제출 {l.quote_no || ''} {md(l.quoted_at)}</span>
                                : isBuy && editable && r.status === '진행' ? (
                                  <div className="flex items-center gap-1.5">
                                    <select value={l.hold || ''} data-rfq-hold={l.pn} disabled={busy === r.id}
                                      onChange={(e) => { const v = e.target.value; const memo = v ? (window.prompt(`${l.pn} — ${v} 사유 (선택)`, l.hold_memo || '') ?? '') : ''; run(r.id, () => setLineHold(r, l, v || null, memo, meName), v ? `${l.pn} 보류 — ${v}` : `${l.pn} 보류 해제`) }}
                                      className="px-1.5 py-1 text-[11px] border border-slate-200 rounded bg-white">
                                      <option value="">— 진행</option>{HOLDS.map((h) => <option key={h} value={h}>{h}</option>)}
                                    </select>
                                    {l.hold_memo && <span className="text-[10.5px] text-slate-500 truncate max-w-[160px]" title={l.hold_memo}>{l.hold_memo}</span>}
                                  </div>
                                ) : l.hold ? <span className="px-1.5 py-[1px] rounded bg-slate-100 text-slate-600 font-bold" title={[l.hold_memo, l.hold_by].filter(Boolean).join(' · ')}>보류 · {l.hold}{l.hold_memo ? ` — ${l.hold_memo}` : ''}</span> : <span className="text-slate-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {editable && <button type="button" onClick={() => { if (window.confirm(`${r.title} 접수를 지울까요? (품목도 함께 지워집니다)`)) run(r.id, () => deleteRfq(r.id), '지웠습니다') }} className="mt-2 text-[11px] text-red-500 hover:underline" data-rfq-del>이 접수 지우기</button>}
                  </td></tr>
                ),
                result?.id === r.id && (
                  <tr key={r.id + ':result'} className="bg-violet-50/40"><td colSpan={7} className="px-4 py-3" data-rfq-result>
                    <div className="flex flex-wrap items-end gap-2 text-xs">
                      <label className="space-y-1 font-bold text-slate-600">결과
                        <select value={result.status} onChange={(e) => setResult({ ...result, status: e.target.value })} className={INP} data-rfq-result-status>
                          {['진행', '제출', '수주', '실주', '취소'].map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
                      {result.status === '제출' && <>
                        <label className="space-y-1 font-bold text-slate-600">견적번호<input value={result.quote_no} onChange={(e) => setResult({ ...result, quote_no: e.target.value })} className={INP} /></label>
                        <label className="space-y-1 font-bold text-slate-600">제출일<input type="date" value={result.submitted_at} onChange={(e) => setResult({ ...result, submitted_at: e.target.value })} className={INP} /></label>
                        <label className="space-y-1 font-bold text-slate-600">금액<input value={result.submit_amount} onChange={(e) => setResult({ ...result, submit_amount: e.target.value.replace(/[^0-9.]/g, '') })} className={`${INP} w-32 text-right`} /></label>
                        <label className="space-y-1 font-bold text-slate-600">통화<select value={result.currency} onChange={(e) => setResult({ ...result, currency: e.target.value })} className={INP}><option>KRW</option><option>USD</option></select></label>
                        <div className="basis-full mt-1 rounded-lg border border-violet-100 bg-white px-3 py-2" data-rfq-submit-lines>
                          <div className="font-bold text-slate-600 mb-1">이번에 제출할 품목 <span className="font-normal text-slate-400">— 준비된 품목이 기본 · 보류 · 미준비 품목은 빼고 먼저 낼 수 있어요</span></div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            {ls.filter((l) => !l.quoted_at).map((l) => {
                              const on = result.lineIds.includes(l.id)
                              const why = l.hold ? `보류 · ${l.hold}` : (l.kind || 'none') === 'none' ? 'BOM 없음' : +l.noprice_count > 0 ? `단가 없음 ${l.noprice_count}` : '준비됨'
                              return (
                                <label key={l.id} className="flex items-center gap-1.5">
                                  <input type="checkbox" checked={on} data-rfq-submit-line={l.pn} onChange={() => setResult({ ...result, lineIds: on ? result.lineIds.filter((x) => x !== l.id) : [...result.lineIds, l.id] })} className="w-4 h-4 accent-violet-600" />
                                  <span className="font-mono font-bold">{l.pn}</span><span className={`text-[10.5px] ${why === '준비됨' ? 'text-emerald-700' : 'text-amber-700'}`}>{why}</span>
                                </label>
                              )
                            })}
                          </div>
                          {ls.filter((l) => !l.quoted_at && !result.lineIds.includes(l.id)).length > 0 && (
                            <label className="mt-2 flex items-center gap-1.5 font-bold text-slate-700">
                              <input type="checkbox" checked={result.split} onChange={(e) => setResult({ ...result, split: e.target.checked })} data-rfq-split className="w-4 h-4 accent-violet-600" />
                              남은 {ls.filter((l) => !l.quoted_at && !result.lineIds.includes(l.id)).length}품목은 새 접수(「{r.title} (잔여)」)로 나눠 계속 진행
                              <span className="font-normal text-slate-400">— 끄면 이 접수에 남아 「진행」 그대로</span>
                            </label>
                          )}
                        </div>
                      </>}
                      {result.status === '수주' && <label className="space-y-1 font-bold text-slate-600">수주 PO번호<input value={result.po_no} onChange={(e) => setResult({ ...result, po_no: e.target.value })} placeholder="수주대장 PO번호" className={INP} /></label>}
                      {(result.status === '실주' || result.status === '취소') && <label className="space-y-1 font-bold text-slate-600 flex-1 min-w-[220px]">{result.status === '실주' ? '실주 사유' : '취소 사유'} {result.status === '실주' && <span className="text-red-500">*</span>}<input value={result.result_memo} onChange={(e) => setResult({ ...result, result_memo: e.target.value })} placeholder="예: 단가 · 납기 · 사양 변경" className={INP} data-rfq-result-memo /></label>}
                      <button type="button" onClick={() => setResult(null)} className="px-3 py-2 rounded-lg font-bold bg-white border border-slate-200">닫기</button>
                      <button type="button" disabled={busy === r.id} onClick={saveResult} data-rfq-result-save className="px-3 py-2 rounded-lg font-bold bg-violet-600 text-white disabled:opacity-40">저장</button>
                    </div>
                  </td></tr>
                ),
              ]
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-400 px-1">한 줄 = 고객사 견적 요청 한 건. 품목 칸을 누르면 품목마다 점검 결과(BOM · 단가 없는 부품)가 나옵니다. BOM 을 올리거나 단가를 등록한 뒤 「🔍 다시 점검」을 누르세요. 구매자재가 「수급 어려움 · 단가 대기」로 보류한 품목은 빼고 준비된 품목부터 견적 · 제출할 수 있습니다.</p>
    </div>
  )
}

function Btn({ tone, onClick, busy, data, children }) {
  const cls = tone === 'primary' ? 'bg-violet-600 text-white border-violet-600 hover:bg-violet-700'
    : tone === 'red' ? 'bg-white text-red-600 border-red-200 hover:bg-red-50'
    : tone === 'amber' ? 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50'
    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
  return <button type="button" onClick={onClick} disabled={busy} data-rfq-act={data} className={`px-2.5 py-1.5 rounded-lg text-[11.5px] font-bold border whitespace-nowrap disabled:opacity-40 ${cls}`}>{busy ? '…' : children}</button>
}
