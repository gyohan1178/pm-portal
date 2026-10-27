// 📥 영업 견적 단가 요청 — 품목 단가 등록 화면 위쪽 (v4.99.2)
//   영업이 견적 접수(매출견적 › 견적 접수 현황)에서 「💲 구매자재에 단가 요청」한 건의 「단가 없는 부품」을 모아 보여 준다.
//   부품마다 「단가 넣기」 → 아래 한 품목 입력칸에 채움. 등록한 뒤 「🔍 다시 점검」을 누르면 견적 접수에 반영되고,
//   요청 건의 부품이 모두 준비되면 「단가 요청 끝」이 저절로 찍힌다 (rfq.js syncPriceDone).
import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { todayISO } from '../../lib/utils'
import { toastError, toastSuccess } from '../../lib/toast'
import { useMyProfile, canEdit } from '../../hooks/useProfile'
import { isOpenLine, checkRfq, dday } from '../master/rfq'
import { SkelBar } from '../../components/ux/Skeleton'
import Spin from '../../components/ux/Spin'

const n = (v) => Number(v || 0).toLocaleString('ko-KR')
const md = (d) => (d ? String(d).slice(5, 10).replace('-', '/') : '')
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
  if (!reqs.length) return { reqs: [], parts: [] }
  const { data: ls, error: e2 } = await supabase.from('pm_rfq_line').select('*').in('rfq_id', reqs.map((r) => r.id))
  if (e2) throw e2
  const byRfq = new Map(reqs.map((r) => [r.id, { ...r, lines: [] }]))
  ;(ls || []).forEach((l) => byRfq.get(l.rfq_id)?.lines.push(l))
  const full = [...byRfq.values()]

  // 부품(품번) → 어느 요청 · 어느 품목에서 나왔나
  const map = new Map()
  for (const r of full) {
    for (const l of r.lines.filter(isOpenLine)) {
      for (const code of l.noprice_codes || []) {
        const k = String(code || '').trim()
        if (!k) continue
        if (!map.has(k)) map.set(k, { code: k, item: null, from: [] })
        map.get(k).from.push({ rfq: r, line: l })
      }
    }
  }
  const codes = [...map.keys()]
  for (let i = 0; i < codes.length; i += 150) {
    const { data: its, error: e3 } = await supabase.from('items').select(`${ITEM_COLS}, vendors(name)`).in('std_code', codes.slice(i, i + 150))
    if (e3) throw e3
    ;(its || []).forEach((it) => { const p = map.get(it.std_code); if (p) p.item = it })
  }
  const parts = [...map.values()].map((p) => ({
    ...p,
    priced: Number(p.item?.purchase_price) > 0,
    due: p.from.map((f) => f.rfq.due_date).filter(Boolean).sort()[0] || null,
  })).sort((a, b) => (a.priced - b.priced) || String(a.due || '9999').localeCompare(String(b.due || '9999')) || a.code.localeCompare(b.code))
  return { reqs: full, parts }
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

  const reqs = data?.reqs || []
  const parts = data?.parts || []
  const left = parts.filter((p) => !p.priced)
  const shown = onlyLeft ? left : parts
  const lateReq = reqs.filter((r) => r.due_date && dday(r.due_date, today) < 0).length
  const doneN = parts.length - left.length

  // 남은 품번을 엑셀 · 협력사 견적 요청용으로 복사 (품번 · 품명 · 제조사 · 제조사품번 · 요청 건)
  const tsv = useMemo(() => left.map((p) => [p.code, p.item?.name || '', p.item?.manufacturer || '', p.item?.manufacturer_code || '',
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
        </> : <span className="text-[12px] text-slate-400">지금 요청된 단가가 없습니다</span>}
        <span className="ml-auto text-xs text-slate-400">{open ? '▲ 접기' : '▼ 펼치기'}</span>
      </button>
      {open && reqs.length > 0 && (
        <div className="px-4 py-3 space-y-3">
          <p className="text-[12px] text-slate-500">
            영업이 견적 접수에서 「💲 구매자재에 단가 요청」한 건의 단가 없는 부품입니다. 「단가 넣기」를 누르면 아래 입력칸에 채워집니다.
            다 넣은 뒤 <b>🔍 다시 점검</b>을 누르면 견적 접수에 반영되고, 부품이 모두 준비된 건은 「단가 요청 끝」이 저절로 찍힙니다.
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
          <div className="overflow-x-auto max-h-[360px] overflow-y-auto rounded-lg border border-slate-100">
            <table className="w-full min-w-[860px] text-xs">
              <thead className="bg-slate-50 text-slate-500 sticky top-0"><tr className="text-left">
                <th className="px-3 py-2 font-bold">품번 · 품명</th><th className="px-3 font-bold">제조사 · 제조사품번</th>
                <th className="px-3 font-bold">견적 건 (고객사 · 회신 기한)</th><th className="px-3 font-bold text-right">현재 매입가</th><th className="px-3 font-bold"></th>
              </tr></thead>
              <tbody>
                {!shown.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">남은 부품이 없습니다 — 「🔍 다시 점검」을 눌러 견적 접수에 반영하세요</td></tr>}
                {shown.map((p) => {
                  const rfqs = [...new Map(p.from.map((f) => [f.rfq.id, f.rfq])).values()]
                  return (
                    <tr key={p.code} className={`border-t border-slate-100 ${p.priced ? 'bg-emerald-50/40' : ''}`} data-price-req={p.code}>
                      <td className="px-3 py-2"><div className="font-mono font-bold text-[#5b6ee8]">{p.code}</div><div className="text-[11px] text-slate-500 truncate max-w-[260px]" title={p.item?.name}>{p.item?.name || <span className="text-rose-500">포털에 없는 품번</span>}</div></td>
                      <td className="px-3"><div className="text-slate-600">{p.item?.manufacturer || '—'}</div><div className="font-mono text-[11px] text-slate-400">{p.item?.manufacturer_code || ''}</div></td>
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
                      <td className="px-3 text-right">
                        {p.item
                          ? <button type="button" onClick={() => onPick?.(p.item, rfqs)} data-price-req-pick={p.code}
                              className={`px-2.5 py-1 rounded-lg text-[11.5px] font-bold whitespace-nowrap ${p.priced ? 'bg-white border border-slate-200 text-slate-500' : 'bg-amber-500 text-white hover:bg-amber-600'}`}>{p.priced ? '다시 넣기' : '💲 단가 넣기'}</button>
                          : <span className="text-[11px] text-slate-400">품목 등록 먼저</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
