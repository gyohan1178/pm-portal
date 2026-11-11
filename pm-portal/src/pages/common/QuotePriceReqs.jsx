// 📥 영업 견적 단가 요청 — 품목 단가 등록 화면 위쪽 (v4.99.2)
//   영업이 견적 접수(매출견적 › 견적 접수 현황)에서 「💲 구매자재에 단가 요청」한 건의 「단가 없는 부품」을 모아 보여 준다.
//   부품마다 「단가 넣기」 → 아래 한 품목 입력칸에 채움. 등록한 뒤 「🔍 다시 점검」을 누르면 견적 접수에 반영되고,
//   요청 건의 부품이 모두 준비되면 「단가 요청 끝」이 저절로 찍힌다 (rfq.js syncPriceDone).
//   v4.128.0 — 부품마다 「🚫 견적 불가」(수급 불가 · 단종 …) — 「그 부품만」 단가 요청에서 뺀다 (부품별 · nq_parts)
//              같은 품목의 다른 부품은 계속 단가를 받는다 (견적은 못 내도 확인은 해 둔다)
//              견적 품목은 「부품 견적 불가 — 영업 확인」 단계로 넘어가 영업이 정리한다. 접수는 저절로 닫지 않는다
//              (v4.127.x 는 부품 하나에 품목 전체를 견적 불가로 만들어 다른 부품까지 목록에서 빠졌다)
//   v4.176.0 — 부품마다 「견적 특이사항」(MOQ · 납기 · 단종 예정 …) — 품목에 붙어(pm_item_quote_note) 다음 견적에도 따라가고,
//              영업이 견적 작성에서 품목을 넣으면 그 줄 「비고」에 자동으로 들어간다 (lib/quoteNote)
import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { todayISO, kst } from '../../lib/utils'
import { toastError, toastSuccess } from '../../lib/toast'
import { useMyProfile, canEdit } from '../../hooks/useProfile'
import { isOpenLine, checkRfq, dday, NOQUOTES, setPartNoquote, missCodes, nqParts, savePastePrice } from '../master/rfq'
import { isPasteKey, keyLabel, pasteKey } from '../../lib/quotePartsPaste'
import { SkelBar } from '../../components/ux/Skeleton'
import Spin from '../../components/ux/Spin'
import { fetchQuoteNotes, saveQuoteNote } from '../../lib/quoteNote'

const n = (v) => Number(v || 0).toLocaleString('ko-KR')
const md = (d) => (d ? kst(d).slice(5, 10).replace('-', '/') : '')
const CS = { ax: 'AXCELIS', ed: 'Edwards', vm: 'VM', csk: 'CSK' }
const csName = (c) => CS[String(c || '').toLowerCase()] || String(c || '')
const ITEM_COLS = 'id, std_code, name, type, unit, lt_weeks, purchase_price, manufacturer, manufacturer_code'

export const PRICE_REQ_KEY = ['quotePriceReqs']

// 진행 중 · 단가 요청함 · 요청 끝 아님 — 그 건의 보류 · 제출 안 한 품목의 단가 없는 부품
export async function fetchPriceReqs() {
  const { data: rs, error } = await supabase.from('pm_rfq').select('*')
    .eq('status', '진행').not('price_req_at', 'is', null).is('price_done_at', null)
  if (error) throw error
  const reqs = (rs || []).sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')))
  if (!reqs.length) return { reqs: [], parts: [], nqs: [] }
  const { data: ls, error: e2 } = await supabase.from('pm_rfq_line').select('*').in('rfq_id', reqs.map((r) => r.id))
  if (e2) throw e2
  const byRfq = new Map(reqs.map((r) => [r.id, { ...r, lines: [] }]))
  ;(ls || []).forEach((l) => byRfq.get(l.rfq_id)?.lines.push(l))
  const full = [...byRfq.values()]

  // 부품(품번) → 어느 요청 · 어느 품목에서 나왔나
  const map = new Map()
  const nqMap = new Map()   // 견적 불가로 표시한 부품 — 아래에 따로 (해제할 수 있게)
  for (const r of full) {
    for (const l of r.lines.filter(isOpenLine)) {
      for (const x of nqParts(l)) {
        const k = String(x.code || '').trim()
        if (!k || !(l.noprice_codes || []).includes(k)) continue   // 그 사이 단가가 들어온 부품은 뺌
        if (!nqMap.has(k)) nqMap.set(k, { code: k, reason: x.reason, memo: x.memo, by: x.by, at: x.at, from: [] })
        nqMap.get(k).from.push({ rfq: r, line: l })
      }
      for (const code of missCodes(l)) {
        const k = String(code || '').trim()
        if (!k) continue
        if (!map.has(k)) map.set(k, { code: k, item: null, paste: null, from: [] })
        const e = map.get(k)
        e.from.push({ rfq: r, line: l })
        // 부품표 부품(포털에 없는 품번 · v4.149.0) — 제조사 · 제조사품번 · 품명은 견적 품목의 부품표에서
        if (isPasteKey(k) && !e.paste) e.paste = (l.paste_parts?.parts || []).find((x) => pasteKey(x) === k) || null
      }
    }
  }
  const codes = [...map.keys()].filter((k) => !isPasteKey(k))
  for (let i = 0; i < codes.length; i += 150) {
    const { data: its, error: e3 } = await supabase.from('items').select(`${ITEM_COLS}, vendors(name)`).in('std_code', codes.slice(i, i + 150))
    if (e3) throw e3
    ;(its || []).forEach((it) => { const p = map.get(it.std_code); if (p) p.item = it })
  }
  // 견적 특이사항 (v4.176.0) — 표가 없으면(SQL 전) 비어 있다
  const notes = await fetchQuoteNotes([...map.values()].map((p) => p.item?.id))
  const parts = [...map.values()].map((p) => ({
    ...p,
    note: (p.item?.id && notes.get(p.item.id)) || null,
    priced: Number(p.item?.purchase_price) > 0,
    due: p.from.map((f) => f.rfq.due_date).filter(Boolean).sort()[0] || null,
  })).sort((a, b) => (a.priced - b.priced) || String(a.due || '9999').localeCompare(String(b.due || '9999')) || a.code.localeCompare(b.code))
  return { reqs: full, parts, nqs: [...nqMap.values()].sort((a, b) => a.code.localeCompare(b.code)) }
}

export default function QuotePriceReqs({ onPick }) {
  const qc = useQueryClient()
  const { data: profile } = useMyProfile()
  const editable = !!profile && canEdit(profile)
  const today = todayISO()
  const { data, isLoading, error } = useQuery({ queryKey: PRICE_REQ_KEY, queryFn: fetchPriceReqs, staleTime: 30 * 1000 })
  const [open, setOpen] = useState(true)
  const [onlyLeft, setOnlyLeft] = useState(true)
  const [busy, setBusy] = useState(false)
  const [nq, setNq] = useState(null)   // 견적 불가 입력 중 — { code, reason, memo }
  const [nqBusy, setNqBusy] = useState(false)
  const [pin, setPin] = useState({})          // 부품표 부품 단가 입력 중 { 키: '1200' } (v4.149.0)
  const [pinBusy, setPinBusy] = useState(null)
  const [memo, setMemo] = useState({})        // 견적 특이사항 고치는 중 { 품번: '글' } (v4.176.0)
  const [memoBusy, setMemoBusy] = useState(null)

  // 견적 특이사항 저장 — 품목에 붙는다 · 빈 글이면 지운다
  async function saveMemo(p) {
    if (!p.item?.id || !(p.code in memo)) return
    setMemoBusy(p.code)
    try {
      await saveQuoteNote(p.item.id, memo[p.code], profile?.name || null)
      setMemo((x) => { const y = { ...x }; delete y[p.code]; return y })
      toastSuccess(String(memo[p.code] || '').trim() ? `${p.code} 견적 특이사항 저장 — 견적 작성에서 이 품목을 넣으면 줄 비고에 들어갑니다` : `${p.code} 견적 특이사항을 지웠습니다`)
      await qc.invalidateQueries({ queryKey: PRICE_REQ_KEY })
    } catch (e) { toastError('특이사항 저장 실패 — ' + (e?.message || e)) } finally { setMemoBusy(null) }
  }

  // 부품표 부품 — 포털에 품목이 없어 여기서 바로 단가를 적는다 (품목 등록 없이 그 견적 품목 안에만 저장)
  //   저장하면 그 부품이 든 견적 건을 다시 점검 → 부품이 다 차면 「단가 요청 끝」이 저절로
  async function savePin(p) {
    const v = Number(String(pin[p.code] ?? '').replace(/[^0-9.]/g, ''))
    if (!(v > 0)) { toastError('단가를 숫자로 넣어 주세요'); return }
    setPinBusy(p.code)
    try {
      await savePastePrice(p.from, p.code, v, profile?.name || null)
      setPin((x) => { const y = { ...x }; delete y[p.code]; return y })
      toastSuccess(`${keyLabel(p.code)} ₩${n(v)} — 견적 접수에 반영했습니다`)
    } catch (e) { toastError('저장 실패 — ' + (e?.message || e)) } finally {
      setPinBusy(null)
      qc.invalidateQueries({ queryKey: PRICE_REQ_KEY }); qc.invalidateQueries({ queryKey: ['rfqs'] }); qc.invalidateQueries({ queryKey: ['flowCounts'] })
    }
  }

  const reqs = data?.reqs || []
  const nqs = data?.nqs || []
  const parts = data?.parts || []
  const left = parts.filter((p) => !p.priced)
  const shown = onlyLeft ? left : parts
  const lateReq = reqs.filter((r) => r.due_date && dday(r.due_date, today) < 0).length
  const doneN = parts.length - left.length

  // 남은 품번을 엑셀 · 협력사 견적 요청용으로 복사 (품번 · 품명 · 제조사 · 제조사품번 · 요청 건)
  const tsv = useMemo(() => left.map((p) => [keyLabel(p.code), p.item?.name || p.paste?.name || '', p.item?.manufacturer || p.paste?.maker || '', p.item?.manufacturer_code || p.paste?.mpn || '',
    [...new Set(p.from.map((f) => f.rfq.title))].join(' / ')].join('\t')).join('\n'), [left])
  async function copyCodes() {
    try { await navigator.clipboard.writeText('품번\t품명\t제조사\t제조사품번\t견적 건\n' + tsv); toastSuccess(`${n(left.length)}개 품번을 복사했습니다 — 엑셀에 붙여넣으세요`) } catch { toastError('복사하지 못했습니다') }
  }

  // 단가를 넣은 뒤 — 요청 건마다 다시 점검 → 견적 접수 「단가 없음」 숫자 갱신, 다 준비되면 「단가 요청 끝」 자동
  async function recheckAll() {
    setBusy(true)
    let fail = 0
    for (const r of reqs) {
      try { await checkRfq(r) } catch { fail++ }
    }
    await qc.invalidateQueries({ queryKey: PRICE_REQ_KEY })
    qc.invalidateQueries({ queryKey: ['rfqs'] }); qc.invalidateQueries({ queryKey: ['flowCounts'] })
    setBusy(false)
    if (fail) toastError(`${fail}건은 다시 점검하지 못했습니다 — 견적 접수 화면에서 「🔍 다시 점검」을 눌러 주세요`)
    else toastSuccess('다시 점검했습니다 — 견적 접수에 반영됐습니다')
  }

  // 부품 견적 불가 (v4.128.0) — 이 부품만 단가 요청에서 뺀다. 같은 품목의 다른 부품은 그대로 · 접수는 닫지 않음
  async function doNoquote(p) {
    const entry = { reason: nq.reason, memo: nq.memo.trim() || null, by: profile?.name || null, name: p.item?.name || null }
    const pairs = [...new Map(p.from.map((f) => [f.line.id, f])).values()]
    setNqBusy(true)
    try {
      for (const f of pairs) await setPartNoquote(f.rfq, f.line.id, p.code, entry)
      setNq(null)
      toastSuccess(`${keyLabel(p.code)} 견적 불가 (${nq.reason}) — 이 부품만 단가 요청에서 뺐습니다 · 견적 품목 ${pairs.length}개에 표시되어 영업이 확인합니다`)
    } catch (e) {
      toastError('견적 불가 처리 실패 — ' + (e?.message || e))
    } finally {
      setNqBusy(false)
      qc.invalidateQueries({ queryKey: PRICE_REQ_KEY }); qc.invalidateQueries({ queryKey: ['rfqs'] }); qc.invalidateQueries({ queryKey: ['flowCounts'] })
    }
  }
  async function undoNoquote(x) {
    setNqBusy(true)
    try {
      for (const f of x.from) await setPartNoquote(f.rfq, f.line.id, x.code, null)
      toastSuccess(`${keyLabel(x.code)} 견적 불가 해제 — 다시 단가 요청 목록에 들어갑니다`)
    } catch (e) {
      toastError('해제 실패 — ' + (e?.message || e))
    } finally {
      setNqBusy(false)
      qc.invalidateQueries({ queryKey: PRICE_REQ_KEY }); qc.invalidateQueries({ queryKey: ['rfqs'] }); qc.invalidateQueries({ queryKey: ['flowCounts'] })
    }
  }

  if (error) return <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800" data-price-reqs>영업 단가 요청을 불러오지 못했습니다 — {error.message}</div>
  if (isLoading) return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-2" data-price-reqs data-skeleton>
      <SkelBar w={150} h={14} /><SkelBar w={64} h={18} className="rounded-full" /><SkelBar w={84} h={18} className="rounded-full" /><SkelBar w={50} h={11} className="ml-auto" />
    </div>
  )

  return (
    <div className="rounded-xl border border-amber-200 bg-white overflow-hidden" data-price-reqs>
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex flex-wrap items-center gap-2 px-4 py-3 bg-amber-50/60 text-left" data-price-reqs-toggle>
        <b className="text-sm text-slate-800">📥 영업 견적 단가 요청</b>
        {reqs.length ? <>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">요청 {n(reqs.length)}건</span>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-white border border-amber-200 text-amber-800" data-price-reqs-left>남은 부품 {n(left.length)}개</span>
          {doneN > 0 && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700">등록됨 {n(doneN)}</span>}
          {lateReq > 0 && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-50 text-red-600">회신 기한 지남 {n(lateReq)}건</span>}
          {nqs.length > 0 && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-600" data-price-reqs-nqn>견적 불가 {n(nqs.length)}</span>}
        </> : <span className="text-[12px] text-slate-400">지금 요청된 단가가 없습니다</span>}
        <span className="ml-auto text-xs text-slate-400">{open ? '▲ 접기' : '▼ 펼치기'}</span>
      </button>
      {open && reqs.length > 0 && (
        <div className="px-4 py-3 space-y-3">
          <p className="text-[12px] text-slate-500">
            영업이 견적 접수에서 「💲 구매자재에 단가 요청」한 건의 단가 없는 부품입니다. 「단가 넣기」를 누르면 아래 입력칸에 채워집니다.
            다 넣은 뒤 <b>🔍 다시 점검</b>을 누르면 견적 접수에 반영되고, 부품이 모두 준비된 건은 「단가 요청 끝」이 저절로 찍힙니다.
            <b className="text-violet-700">📋 부품표</b> 부품(코드 부여 전 · 포털에 없는 품번)은 이 표에서 바로 단가를 적고 💲 저장 — 품목 등록 없이 그 견적에만 들어갑니다.
            <b className="text-slate-700">📝 견적 특이사항</b>(MOQ · 납기 · 단종 예정 …)을 적으면 품목에 붙어, 영업이 견적 작성에서 그 품목을 넣을 때 줄 <b>비고</b>에 자동으로 들어갑니다 (고객사 견적서에 인쇄됨).
            수급할 수 없는 부품은 <b className="text-rose-600">🚫 견적 불가</b> — 그 부품만 목록에서 빠지고(같은 품목의 다른 부품은 그대로), 영업 견적 접수에 사유가 보입니다.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600"><input type="checkbox" checked={onlyLeft} onChange={(e) => setOnlyLeft(e.target.checked)} className="w-4 h-4 accent-violet-600" data-price-reqs-only />남은 것만</label>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={copyCodes} disabled={!left.length} data-price-reqs-copy
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">📋 남은 품번 복사 (협력사 견적 요청용)</button>
              {editable && <button type="button" onClick={recheckAll} disabled={busy} data-price-reqs-recheck
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">{busy ? <span className="inline-flex items-center gap-1.5"><Spin />점검 중…</span> : `🔍 다시 점검 (${n(reqs.length)}건)`}</button>}
            </div>
          </div>
          <div className="overflow-x-auto max-h-[360px] overflow-y-auto rounded-lg border border-slate-100" data-price-reqs-table>
            <table className="w-full min-w-[1080px] text-xs">
              <thead className="bg-slate-50 text-slate-500 sticky top-0"><tr className="text-left">
                <th className="px-3 py-2 font-bold">품번 · 품명</th><th className="px-3 font-bold">제조사 · 제조사품번</th>
                <th className="px-3 font-bold">견적 건 (고객사 · 회신 기한)</th><th className="px-3 font-bold text-right">현재 매입가</th>
                <th className="px-3 font-bold" title="품목에 붙어 다음 견적에도 따라갑니다 · 견적 작성 줄 비고에 자동 입력">📝 견적 특이사항 <span className="font-normal text-slate-400">→ 견적서 비고</span></th><th className="px-3 font-bold"></th>
              </tr></thead>
              <tbody>
                {!shown.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">남은 부품이 없습니다 — 「🔍 다시 점검」을 눌러 견적 접수에 반영하세요</td></tr>}
                {shown.map((p) => {
                  const rfqs = [...new Map(p.from.map((f) => [f.rfq.id, f.rfq])).values()]
                  const lines = [...new Map(p.from.map((f) => [f.line.id, f])).values()]
                  return [
                    <tr key={p.code} className={`border-t border-slate-100 ${p.priced ? 'bg-emerald-50/40' : ''}`} data-price-req={p.code}>
                      <td className="px-3 py-2">{p.paste ? <>
                          <div className="font-mono font-bold text-slate-700">{keyLabel(p.code)} <span className="ml-1 px-1.5 py-[1px] rounded-full bg-violet-50 text-violet-700 text-[10px] font-bold font-sans" title="영업이 코드 부여 전 부품표로 붙인 부품 — 포털 품목이 없어 여기서 바로 단가를 적습니다 (품목 등록 안 함)">📋 부품표</span></div>
                          <div className="text-[11px] text-slate-500 truncate max-w-[260px]" title={p.paste.name}>{p.paste.name || '—'}{p.paste.qty ? <span className="text-slate-400"> · 대당 {n(p.paste.qty)}</span> : ''}</div></>
                        : <><div className="font-mono font-bold text-[#5b6ee8]">{p.code}</div><div className="text-[11px] text-slate-500 truncate max-w-[260px]" title={p.item?.name}>{p.item?.name || <span className="text-rose-500">포털에 없는 품번</span>}</div></>}</td>
                      <td className="px-3"><div className="text-slate-600">{p.item?.manufacturer || p.paste?.maker || '—'}</div><div className="font-mono text-[11px] text-slate-400">{p.item?.manufacturer_code || p.paste?.mpn || ''}</div></td>
                      <td className="px-3 py-2">{rfqs.map((r) => {
                        const d = r.due_date ? dday(r.due_date, today) : null
                        return (
                          <div key={r.id} className="leading-5">
                            <span className="font-bold text-slate-700">{csName(r.customer_code)}</span> · {r.title}
                            {r.due_date && <span className={`ml-1 font-bold ${d < 0 ? 'text-red-600' : d <= 3 ? 'text-amber-600' : 'text-slate-400'}`}>{md(r.due_date)}{d < 0 ? ` · ${-d}일 지남` : ` · D-${d}`}</span>}
                            {r.price_req_by && <span className="ml-1 text-[11px] text-slate-400">요청 {r.price_req_by} {md(r.price_req_at)}</span>}
                          </div>
                        )
                      })}</td>
                      <td className="px-3 text-right font-mono">{p.priced ? <span className="text-emerald-700 font-bold">₩{n(p.item.purchase_price)} ✓</span> : <span className="text-slate-300">—</span>}</td>
                      <td className="px-3 py-1.5" data-price-req-memo={p.code}>
                        {p.item?.id && editable
                          ? <span className="flex items-center gap-1">
                              <input value={memo[p.code] ?? (p.note?.note || '')} onChange={(e) => setMemo((x) => ({ ...x, [p.code]: e.target.value }))}
                                onKeyDown={(e) => { if (e.key === 'Enter') saveMemo(p) }} placeholder="예: MOQ 100 · 납기 12주 · 단종 예정" data-price-req-memo-input
                                title={p.note ? `${p.note.by_name || ''} ${md(p.note.updated_at)} 저장` : ''}
                                className={`w-full min-w-[180px] px-2 py-1 text-[11.5px] border rounded-lg focus:outline-none focus:ring-1 focus:ring-violet-400 ${p.note && !(p.code in memo) ? 'border-violet-200 bg-violet-50/40' : 'border-slate-200'}`} />
                              {p.code in memo && (memo[p.code] ?? '') !== (p.note?.note || '') && (
                                <button type="button" onClick={() => saveMemo(p)} disabled={memoBusy === p.code} data-price-req-memo-ok
                                  className="px-2 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40">{memoBusy === p.code ? <Spin /> : '📝 저장'}</button>
                              )}
                            </span>
                          : p.note ? <span className="text-[11.5px] text-slate-600">{p.note.note}</span>
                          : p.paste ? <span className="text-[11px] text-slate-300" title="부품표 부품은 포털 품목이 없어 특이사항을 붙일 수 없습니다">—</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-3 text-right">
                        {p.paste && editable
                          ? <span className="inline-flex items-center gap-1" data-price-req-pin={keyLabel(p.code)}>
                              <input inputMode="numeric" value={pin[p.code] ?? ''} onChange={(e) => setPin((x) => ({ ...x, [p.code]: e.target.value }))}
                                onKeyDown={(e) => { if (e.key === 'Enter') savePin(p) }} placeholder="단가(원)" data-price-req-pin-input
                                className="w-24 px-2 py-1 text-right font-mono text-[11.5px] border border-amber-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-400" />
                              <button type="button" onClick={() => savePin(p)} disabled={pinBusy === p.code || !String(pin[p.code] ?? '').trim()} data-price-req-pin-ok
                                className="px-2.5 py-1 rounded-lg text-[11.5px] font-bold whitespace-nowrap bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40">{pinBusy === p.code ? <Spin /> : '💲 저장'}</button>
                            </span>
                          : p.item
                          ? <button type="button" onClick={() => onPick?.(p.item, rfqs)} data-price-req-pick={p.code}
                              className={`px-2.5 py-1 rounded-lg text-[11.5px] font-bold whitespace-nowrap ${p.priced ? 'bg-white border border-slate-200 text-slate-500' : 'bg-amber-500 text-white hover:bg-amber-600'}`}>{p.priced ? '다시 넣기' : '💲 단가 넣기'}</button>
                          : <span className="text-[11px] text-slate-400">품목 등록 먼저</span>}
                        {editable && !p.priced && (
                          <button type="button" onClick={() => setNq(nq?.code === p.code ? null : { code: p.code, reason: '수급 불가', memo: '' })} data-price-req-nq={p.code}
                            className={`ml-1.5 px-2 py-1 rounded-lg text-[11.5px] font-bold whitespace-nowrap border ${nq?.code === p.code ? 'bg-rose-600 text-white border-rose-600' : 'bg-white border-rose-200 text-rose-600 hover:bg-rose-50'}`}>🚫 견적 불가</button>
                        )}
                      </td>
                    </tr>,
                    nq?.code === p.code && (
                      <tr key={p.code + '-nq'} className="bg-rose-50/60" data-price-req-nq-form={p.code}>
                        <td colSpan={6} className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-2 text-[12px]">
                            <b className="text-rose-700">🚫 {keyLabel(p.code)} 견적 불가</b>
                            <select value={nq.reason} onChange={(e) => setNq({ ...nq, reason: e.target.value })} data-price-req-nq-reason
                              className="px-2 py-1 border border-rose-200 rounded-lg bg-white text-[12px]">
                              {NOQUOTES.map((h) => <option key={h} value={h}>{h}</option>)}
                            </select>
                            <input value={nq.memo} onChange={(e) => setNq({ ...nq, memo: e.target.value })} data-price-req-nq-memo
                              placeholder="자세한 내용 (예: 단종 · 대체품 없음 / 납기 6개월 이상)" className="flex-1 min-w-[260px] px-2 py-1 border border-rose-200 rounded-lg bg-white" />
                            <button type="button" disabled={nqBusy} onClick={() => doNoquote(p)} data-price-req-nq-ok
                              className="px-3 py-1 rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700 disabled:opacity-50">{nqBusy ? <span className="inline-flex items-center gap-1.5"><Spin />처리 중…</span> : '견적 불가로 확정'}</button>
                            <button type="button" onClick={() => setNq(null)} className="px-2 py-1 text-slate-500 hover:text-slate-700">취소</button>
                          </div>
                          <p className="mt-1.5 text-[11px] text-rose-700/80">
                            이 부품만 단가 요청에서 빠집니다 — 같은 품목의 다른 부품은 계속 단가를 받습니다.
                            이 부품이 들어간 견적 품목 {lines.length}개({lines.map((f) => `${f.rfq.title} · ${f.line.pn}`).join(' / ')})에 사유가 붙어 영업이 확인합니다. 잘못 눌렀으면 아래 「견적 불가로 표시한 부품」에서 해제.
                          </p>
                        </td>
                      </tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
          </div>
          {nqs.length > 0 && (
            <div className="rounded-lg border border-rose-200 bg-rose-50/40 px-3 py-2" data-price-reqs-nq-list>
              <p className="text-[12px] font-bold text-rose-700 mb-1">🚫 견적 불가로 표시한 부품 {n(nqs.length)} <span className="font-normal text-rose-500">— 영업 견적 접수에 사유가 보입니다 · 수급처를 찾으면 해제하고 단가를 넣으세요</span></p>
              {nqs.map((x) => (
                <div key={x.code} className="flex flex-wrap items-center gap-2 py-1 border-t border-rose-100 first:border-t-0 text-[11.5px]" data-price-req-nq-done={x.code}>
                  <b className="font-mono text-rose-700">{keyLabel(x.code)}</b>
                  <span className="px-1.5 py-[1px] rounded bg-rose-100 text-rose-700 font-bold">{x.reason}</span>
                  {x.memo && <span className="text-slate-600">{x.memo}</span>}
                  <span className="text-slate-400">{[x.by, md(x.at)].filter(Boolean).join(' · ')} · {[...new Set(x.from.map((f) => `${f.rfq.title} · ${f.line.pn}`))].join(' / ')}</span>
                  {editable && <button type="button" disabled={nqBusy} onClick={() => undoNoquote(x)} data-price-req-nq-undo={x.code}
                    className="ml-auto px-2 py-0.5 rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40">↩ 해제</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
