// 수주대장 › 코드 · BOM 정리 (v4.94.0)
//   ① 코드 부여 — 포털 코드가 없는 고객사 품번을 고객사별로 → 코드 · 분류(기준코드) 제안 → 체크해서 한 번에 등록
//   ② BOM 없는 품목 — 진행 중 수주 품목 중 BOM 이 없는 것 → BOM 필요 / 단품 · 영업에 BOM 요청
import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { ORDER_CUSTOMERS } from '../../lib/orderIntake'
import { CATS, unregGroups, fetchFlags, setNonItem, registerItems, fetchBomItems, closeDone, setNeed, requestBom, cancelBomRequest, bomState, needOf, BOM_STATE } from '../../lib/orderCleanup'
import { toastError, toastSuccess } from '../../lib/toast'

const md = (d) => (d ? String(d).slice(5).replace('-', '/') : '—')
const daysTo = (d) => (d ? Math.round((new Date(d) - new Date(new Date().toISOString().slice(0, 10))) / 86400000) : null)
const STATE_TONE = { need: 'bg-red-50 text-red-600 border-red-200', unknown: 'bg-white text-slate-600 border-slate-200', single: 'bg-white text-slate-600 border-slate-200', req: 'bg-violet-50 text-violet-700 border-violet-200', has: 'bg-emerald-50 text-emerald-700 border-emerald-200' }

export default function OrderCleanup({ orders, editable, meName, onChanged }) {
  const qc = useQueryClient()
  const custList = Object.keys(ORDER_CUSTOMERS).filter((k) => !ORDER_CUSTOMERS[k].manual)   // 기타는 접두 규칙이 없어 코드 부여 대상 아님 (v4.107.0)
  const { data: flags = new Map(), refetch: refetchFlags } = useQuery({ queryKey: ['orderPnFlags'], queryFn: fetchFlags, staleTime: 60 * 1000 })
  const all = useMemo(() => unregGroups(orders, flags), [orders, flags])
  const [cust, setCust] = useState(() => {
    const c = custList.map((k) => [k, all.filter((x) => x.cust === k && x.live > 0 && !x.nonItem).length]).sort((a, b) => b[1] - a[1])[0]
    return c && c[1] > 0 ? c[0] : 'VM'
  })
  const [liveOnly, setLiveOnly] = useState(true)
  const [edits, setEdits] = useState({})           // key → { code, cat, name }
  const [pick, setPick] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState(null)            // 마지막 등록 결과

  const countOf = (k) => all.filter((x) => x.cust === k && !x.nonItem && (!liveOnly || x.live > 0)).length
  const rows = all.filter((x) => x.cust === cust && !x.nonItem && (!liveOnly || x.live > 0)).map((x) => ({ ...x, ...(edits[x.key] || {}) }))
  const nonRows = all.filter((x) => x.cust === cust && x.nonItem)
  const picked = rows.filter((x) => pick.has(x.key))
  const setE = (k, p) => setEdits((e) => ({ ...e, [k]: { ...(e[k] || {}), ...p } }))
  const togglePick = (k) => setPick((x) => { const n = new Set(x); n.has(k) ? n.delete(k) : n.add(k); return n })
  const allOn = rows.length > 0 && rows.filter((x) => !x.guessNon).every((x) => pick.has(x.key))

  async function register() {
    setBusy(true)
    try {
      const r = await registerItems(picked.map((x) => ({ cust: x.cust, pn: x.pn, code: x.code, name: x.name || x.desc, cat: x.cat })), meName)
      setLast({ ...r, rows: picked.map((x) => ({ pn: x.pn, code: x.code, name: x.name || x.desc, cat: x.cat })) })
      setPick(new Set())
      toastSuccess(`코드 등록 — 새 코드 ${r.created} · 이미 있던 코드 ${r.existed} · 수주 줄 ${r.linked} 연결`)
      onChanged?.(); qc.invalidateQueries({ queryKey: ['orderBom'] })
    } catch (e) { toastError(e.message) }
    setBusy(false)
  }
  async function markNon(groups, on) {
    setBusy(true)
    try { await setNonItem(groups, on, meName); await refetchFlags(); setPick((x) => { const n = new Set(x); groups.forEach((g) => n.delete(g.key)); return n }); toastSuccess(on ? `${groups.length}품번 비품목으로 — 목록에서 뺐습니다` : '다시 품목으로') } catch (e) { toastError(e.message) }
    setBusy(false)
  }
  async function exportCodes() {
    if (!last) return
    const XLSX = await import('xlsx')
    const js = new Map((last.codes || []).map((c) => [c.std_code, c.js_code]))
    const aoa = [['고객사 품번', '포털 코드', '기준코드(이카운트)', '품명', '분류'], ...last.rows.map((r) => [r.pn, r.code, js.get(r.code.toUpperCase()) || '(이미 있던 코드)', r.name, CATS.find((c) => c.code === r.cat)?.label])]
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '코드 부여')
    XLSX.writeFile(wb, `코드부여_${cust}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <div className="space-y-4" data-cleanup>
      <p className="page-desc text-xs text-slate-400 leading-relaxed">
        수주대장에 들어온 고객사 품번 중 포털 코드가 없는 것은 고객사별로 코드를 주고, BOM 이 없는 완제품 · 어셈블리는 영업에 BOM 을 요청합니다. 요청은 영업 업무 흐름 「BOM 확인」에 건수로 뜨고, BOM 을 올리면 자동으로 완료됩니다.
      </p>
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-slate-500">고객사</span>
        {custList.map((k) => (
          <button key={k} type="button" onClick={() => { setCust(k); setPick(new Set()) }} data-cl-cust={k}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border ${cust === k ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>
            {ORDER_CUSTOMERS[k].name} <span className={cust === k ? 'text-slate-300' : 'text-slate-400'}>{countOf(k)}</span>
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} data-cl-live />진행 중 PO 품번만</label>
        <span className="ml-auto text-[11px] text-slate-400">숫자 = 코드 없는 고객사 품번 수</span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4 items-start">
        {/* ① 코드 부여 */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-cl-codes>
          <div className="px-4 py-3 border-b border-slate-100">
            <div className="flex items-baseline gap-2"><h3 className="text-[15px] font-extrabold">① 코드 부여</h3><span className="text-xs text-slate-500">{ORDER_CUSTOMERS[cust].name} {rows.length}품번 · 진행 중 줄 {rows.reduce((a, x) => a + x.live, 0)}</span></div>
            <p className="text-[11.5px] text-slate-500 mt-1">포털 코드는 「{cust === 'CSK' ? 'CS + 품번 (완제품은 하이픈 없이)' : `${ORDER_CUSTOMERS[cust].prefix}품번`}」 규칙으로 제안 · 분류를 고르면 기준코드(JS-)를 다음 번호로 줍니다. 체크한 것만 등록 → 같은 품번의 수주대장 줄이 바로 그 코드로 연결됩니다.</p>
          </div>
          <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-200 sticky top-0"><tr className="text-left">
                <th className="pl-3 py-2 w-7">{editable && <input type="checkbox" checked={allOn} onChange={() => setPick(allOn ? new Set() : new Set(rows.filter((x) => !x.guessNon).map((x) => x.key)))} data-cl-all title="비품목으로 보이는 것 빼고 전체" />}</th>
                <th className="px-2 font-bold">고객사 품번 · 품명</th><th className="px-2 font-bold">포털 코드 (제안)</th><th className="px-2 font-bold">분류 → 기준코드</th><th className="px-2 font-bold text-right">진행 중</th><th className="px-2" />
              </tr></thead>
              <tbody>
                {!rows.length && <tr><td colSpan={6} className="p-8 text-center text-slate-400">코드 없는 품번이 없습니다</td></tr>}
                {rows.map((x) => (
                  <tr key={x.key} className={`border-t border-slate-100 align-top ${x.guessNon ? 'bg-amber-50/40' : ''}`} data-cl-row={x.pn}>
                    <td className="pl-3 py-2">{editable && <input type="checkbox" checked={pick.has(x.key)} onChange={() => togglePick(x.key)} data-cl-pick={x.pn} />}</td>
                    <td className="px-2 py-2"><div className="font-mono font-bold">{x.pn}{x.rev && <span className="ml-1 px-1 rounded bg-slate-100 text-slate-500 text-[10px]">Rev {x.rev}</span>}</div><div className="text-[10.5px] text-slate-400 truncate max-w-[260px]" title={x.desc}>{x.desc || '—'}</div>
                      {x.guessNon && <div className="text-[10.5px] text-amber-700 font-bold">코드 아님? (작업비 · 외주 · 묶음 이름)</div>}</td>
                    <td className="px-2 py-2">{editable ? <input value={x.code} onChange={(e) => setE(x.key, { code: e.target.value.toUpperCase() })} data-cl-code={x.pn} className="w-44 h-7 px-1.5 text-[11.5px] font-mono border border-slate-200 rounded text-[#5b6ee8]" /> : <span className="font-mono text-[#5b6ee8]">{x.code}</span>}</td>
                    <td className="px-2 py-2">{editable ? (
                      <select value={x.cat} onChange={(e) => setE(x.key, { cat: e.target.value })} data-cl-cat={x.pn} className="h-7 px-1 text-[11.5px] border border-slate-200 rounded">
                        {CATS.map((c) => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
                      </select>) : CATS.find((c) => c.code === x.cat)?.label}</td>
                    <td className="px-2 py-2 text-right font-mono">{x.live}줄{x.due && <div className={`text-[10px] ${daysTo(x.due) < 0 ? 'text-red-500' : 'text-slate-400'}`}>납기 {md(x.due)}</div>}</td>
                    <td className="px-2 py-2">{editable && <button type="button" onClick={() => markNon([x], true)} disabled={busy} data-cl-non={x.pn} className="text-[10.5px] text-slate-400 hover:text-slate-700 whitespace-nowrap">비품목</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editable && (
            <div className="px-4 py-3 flex flex-wrap items-center gap-2 bg-[#f9fafc] border-t border-slate-100">
              <span className="text-xs text-slate-600">체크 <b className="text-violet-700 font-mono" data-cl-picked>{picked.length}</b>품번 · 수주 줄 <b className="font-mono">{picked.reduce((a, x) => a + x.lines, 0)}</b> 연결</span>
              {picked.length > 0 && <button type="button" onClick={() => markNon(picked, true)} disabled={busy} className="text-xs text-slate-500 underline">체크한 것 비품목으로</button>}
              <span className="flex-1" />
              {last && <button type="button" onClick={exportCodes} data-cl-export className="h-8 px-3 rounded-lg text-xs font-bold bg-white border border-slate-300">방금 등록한 코드 엑셀 (이카운트 품목 등록용)</button>}
              <button type="button" onClick={register} disabled={busy || !picked.length} data-cl-register className="h-8 px-4 rounded-lg text-xs font-bold bg-violet-600 text-white disabled:opacity-40">{busy ? '등록 중…' : `${picked.length}품번 코드 등록`}</button>
            </div>
          )}
          {nonRows.length > 0 && (
            <details className="px-4 py-2 border-t border-slate-100 text-xs" data-cl-nonlist>
              <summary className="cursor-pointer text-slate-500">비품목으로 뺀 품번 {nonRows.length}</summary>
              <div className="mt-1 flex flex-wrap gap-1.5">{nonRows.map((x) => (
                <span key={x.key} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-mono text-[11px]">{x.pn}{editable && <button type="button" onClick={() => markNon([x], false)} className="ml-1 text-violet-600 font-sans font-bold" data-cl-unnon={x.pn}>되돌리기</button>}</span>
              ))}</div>
            </details>
          )}
        </section>

        <BomPanel cust={cust} editable={editable} meName={meName} />
      </div>
    </div>
  )
}

// ② BOM 없는 품목
function BomPanel({ cust, editable, meName }) {
  const qc = useQueryClient()
  const { data: rowsRaw = [], isLoading, error, refetch } = useQuery({
    queryKey: ['orderBom', cust],
    queryFn: async () => {
      const r = await fetchBomItems([cust])
      if (editable) { try { const n = await closeDone(r); if (n) r.forEach((x) => { if (x.has_bom && x.req_status === '요청') x.req_status = '완료' }) } catch { /* 완료 표시는 다음에 */ } }
      return r
    },
    staleTime: 60 * 1000,
  })
  const { data: sales = [] } = useQuery({
    queryKey: ['salesPeople'],
    queryFn: async () => { const { data } = await supabase.from('pm_profiles').select('name,dept,status').eq('dept', '영업'); return (data || []).filter((p) => p.status !== 'rejected' && p.name).map((p) => p.name) },
    staleTime: 10 * 60 * 1000,
  })
  const [st, setSt] = useState('need')
  const [pick, setPick] = useState(() => new Set())
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const rows = rowsRaw.map((r) => ({ ...r, st: bomState(r) }))
  const cnt = (k) => rows.filter((r) => r.st === k).length
  const shown = rows.filter((r) => r.st === st).sort((a, b) => String(a.due_min || '9').localeCompare(String(b.due_min || '9')))
  const picked = shown.filter((r) => pick.has(r.item_id))
  const who = assignee || sales[0] || ''

  async function run(fn, ok) {
    setBusy(true)
    try { await fn(); toastSuccess(ok); setPick(new Set()); await refetch(); qc.invalidateQueries({ queryKey: ['flowCounts'] }) } catch (e) { toastError(e.message) }
    setBusy(false)
  }
  async function exportList() {
    const XLSX = await import('xlsx')
    const ls = picked.length ? picked : shown
    const aoa = [['고객사 품번', '포털 코드', '품명', '진행 중 PO', '가장 빠른 납기'], ...ls.map((r) => [r.pn, r.std_code, r.name, r.pos, r.due_min || ''])]
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'BOM 요청')
    XLSX.writeFile(wb, `BOM요청목록_${cust}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-cl-bom>
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="flex items-baseline gap-2"><h3 className="text-[15px] font-extrabold">② BOM 없는 품목</h3><span className="text-xs text-slate-500">{ORDER_CUSTOMERS[cust].name} 진행 중 수주 품목 {rows.length}</span></div>
        <p className="text-[11.5px] text-slate-500 mt-1">분류가 어셈블리 · 하네스 · 판금이면 「BOM 필요」, 부품이면 「단품」으로 미리 나눕니다. 미정은 한 번만 골라 주면 기억합니다. 코드가 없는 품번은 ①에서 먼저 코드를 주세요.</p>
      </div>
      {error ? <div className="p-4 text-xs text-amber-700 bg-amber-50" data-cl-bom-err>{error.message}</div> : (
        <>
          <div className="px-4 py-2.5 flex flex-wrap gap-1.5 border-b border-slate-100">
            {['need', 'unknown', 'req', 'single', 'has'].map((k) => (
              <button key={k} type="button" onClick={() => { setSt(k); setPick(new Set()) }} data-cl-st={k}
                className={`px-3 py-1 rounded-full text-xs font-bold border ${st === k ? 'ring-2 ring-violet-300 ' : ''}${STATE_TONE[k]}`}>{BOM_STATE[k]} <b className="font-mono">{cnt(k)}</b></button>
            ))}
          </div>
          <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-200 sticky top-0"><tr className="text-left">
                <th className="pl-3 py-2 w-7">{editable && ['need', 'unknown', 'req'].includes(st) && shown.length > 0 && <input type="checkbox" checked={shown.every((r) => pick.has(r.item_id))} onChange={(e) => setPick(e.target.checked ? new Set(shown.map((r) => r.item_id)) : new Set())} data-cl-bom-all />}</th>
                <th className="px-2 font-bold">품목</th><th className="px-2 font-bold">가장 빠른 납기</th><th className="px-2 font-bold">{st === 'req' ? '요청' : 'BOM 필요?'}</th>
              </tr></thead>
              <tbody>
                {isLoading && <tr><td colSpan={4} className="p-6 text-center text-slate-400">불러오는 중…</td></tr>}
                {!isLoading && !shown.length && <tr><td colSpan={4} className="p-6 text-center text-slate-400">해당 품목이 없습니다</td></tr>}
                {shown.map((r) => {
                  const d = daysTo(r.due_min)
                  return (
                    <tr key={r.item_id} className="border-t border-slate-100 align-top" data-cl-bom-row={r.std_code}>
                      <td className="pl-3 py-2">{editable && ['need', 'unknown', 'req'].includes(st) && <input type="checkbox" checked={pick.has(r.item_id)} onChange={() => setPick((x) => { const n = new Set(x); n.has(r.item_id) ? n.delete(r.item_id) : n.add(r.item_id); return n })} data-cl-bom-pick={r.std_code} />}</td>
                      <td className="px-2 py-2"><div className="font-mono font-bold">{r.std_code}</div><div className="text-[10.5px] text-slate-400 truncate max-w-[240px]" title={r.name}>{r.name} · PO {r.pos}건</div></td>
                      <td className="px-2 py-2 font-mono whitespace-nowrap">{r.due_min || '—'}{d != null && d <= 14 && <span className={`ml-1 px-1 rounded text-[10px] font-bold ${d < 0 ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>{d < 0 ? `지연 ${-d}일` : `D-${d}`}</span>}</td>
                      <td className="px-2 py-2">
                        {st === 'req' ? <div className="text-[11px]"><span className="text-violet-700 font-bold">{r.assignee}</span>{r.due_date && <span className="text-slate-500"> · 기한 {md(r.due_date)}</span>}<div className="text-[10px] text-slate-400">{r.req_name} · {md(String(r.req_at || '').slice(0, 10))}</div></div>
                          : st === 'has' ? <span className="text-emerald-700 font-bold">BOM 있음{r.req_status === '완료' ? ' · 요청 완료' : ''}</span>
                          : editable ? (
                            <select value={needOf(r) || ''} onChange={(e) => run(() => setNeed([r.item_id], e.target.value), e.target.value === '단품' ? '단품으로 — BOM 없이 진행' : 'BOM 필요로')} data-cl-need={r.std_code} className="h-7 px-1 text-[11.5px] border border-slate-200 rounded">
                              <option value="" disabled>골라 주세요</option><option value="필요">BOM 필요</option><option value="단품">단품 (BOM 없음)</option>
                            </select>) : (needOf(r) || '미정')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-[#f9fafc] border-t border-slate-100 space-y-2">
            {editable && st !== 'req' && st !== 'has' && st !== 'single' && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-600">받는 사람</span>
                <input list="cl-sales" value={who} onChange={(e) => setAssignee(e.target.value)} placeholder="영업 담당" data-cl-assignee className="w-32 h-8 px-2 text-xs border border-slate-200 rounded-lg" />
                <datalist id="cl-sales">{sales.map((n) => <option key={n} value={n} />)}</datalist>
                <span className="text-xs text-slate-600">기한</span>
                <input type="date" value={due} onChange={(e) => setDue(e.target.value)} data-cl-due className="h-8 px-2 text-xs border border-slate-200 rounded-lg" />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={exportList} disabled={!shown.length} data-cl-bom-export className="h-8 px-3 rounded-lg text-xs font-bold bg-white border border-slate-300 disabled:opacity-40">고객사 요청용 목록 엑셀</button>
              <span className="flex-1" />
              {editable && st === 'req' && <button type="button" onClick={() => run(() => cancelBomRequest(picked), '요청을 거뒀습니다')} disabled={busy || !picked.length} className="h-8 px-3 rounded-lg text-xs font-bold bg-white border border-slate-300 disabled:opacity-40">요청 거두기</button>}
              {editable && (st === 'need' || st === 'unknown') && <button type="button" onClick={() => run(() => requestBom(picked, { assignee: who, due }, meName), `${picked.length}품목 BOM 요청 → ${who}`)} disabled={busy || !picked.length || !who} data-cl-bom-req className="h-8 px-4 rounded-lg text-xs font-bold bg-violet-600 text-white disabled:opacity-40">{picked.length}품목 BOM 요청</button>}
            </div>
            <p className="text-[11px] text-slate-400">BOM 요청은 📎 자료 요청에도 같이 올라가 영업 「받은 자료 요청」에 뜹니다. BOM 을 올리면(BOM 메뉴) 요청이 자동으로 「완료 · 받음」.</p>
          </div>
        </>
      )}
    </section>
  )
}
