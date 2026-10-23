// 수주대장 › 이카운트 대조 (v4.94.0)
//   ① 판매입력 파일 만들기 — 납품했는데 판매입력 안 된 줄 → 이카운트 판매입력 업로드 양식
//   ② 판매 자료 올려 대조 — PO No. · 품목코드로 맞추고, 맞은 줄은 「판매입력 마감」 + 명세서번호
import { useState, useMemo, useRef } from 'react'
import { ORDER_CUSTOMERS, lineKey } from '../../lib/orderIntake'
import { parseEcountSales, matchEcount, applyEcount, salesInputWorkbook, normSlip } from '../../lib/ecountMatch'
import { KINDS, kindOf } from '../../lib/orderEntry'
import { toastError, toastSuccess } from '../../lib/toast'
import { todayISO } from '../../lib/utils'

const fmt = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }))
const isUsd = (o) => o?.currency === 'USD' || o?.ccn === 'B'
const money = (o, v) => (v == null ? '—' : isUsd(o) ? `$${fmt(v)}` : `₩${Math.round(v).toLocaleString('ko-KR')}`)
const RESULT = {
  ok: ['맞음', 'bg-emerald-50 text-emerald-700'], diff: ['다름', 'bg-amber-50 text-amber-700'], only_ecount: ['이카운트에만', 'bg-amber-50 text-amber-700'],
  no_sale: ['판매 없음', 'bg-red-50 text-red-600'], verbal_open: ['구두 · 미마감', 'bg-violet-50 text-violet-700'],
}
const CODE_KEY = 'pm_ecount_cust_codes'
const loadCodes = () => { try { return JSON.parse(localStorage.getItem(CODE_KEY) || '{}') || {} } catch { return {} } }
const saveCodes = (v) => { try { localStorage.setItem(CODE_KEY, JSON.stringify(v)) } catch { /* 저장 못 해도 이번 파일엔 들어감 */ } }

function Kpi({ tone, label, value, sub, on, onClick, k }) {
  const T = { green: 'bg-emerald-50/70 border-emerald-100 text-emerald-700', red: 'bg-red-50/70 border-red-100 text-red-600', amber: 'bg-amber-50/70 border-amber-100 text-amber-700', violet: 'bg-violet-50/70 border-violet-100 text-violet-700', gray: 'bg-white border-slate-200 text-slate-800' }[tone]
  return (
    <button type="button" onClick={onClick} data-ec-kpi={k} className={`min-w-0 text-left rounded-xl border px-3 md:px-4 py-3 ${T} ${on ? 'ring-2 ring-violet-400' : 'hover:shadow-sm'}`}>
      <div className="text-[12px] text-slate-500">{label}</div>
      <div className="text-[24px] md:text-[28px] font-extrabold leading-tight tabular-nums">{value.toLocaleString('ko-KR')}</div>
      <div className="text-[11px] text-slate-500">{sub}</div>
    </button>
  )
}

export default function EcountMatch({ orders, editable, meName, onChanged }) {
  const [cust, setCust] = useState('all')
  const [month, setMonth] = useState(todayISO().slice(0, 7))
  const [file, setFile] = useState(null)          // { name, rows, at }
  const [only, setOnly] = useState('check')       // check 확인할 것만 · all · 결과 종류
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(() => new Map())   // 이 화면에서 마감한 줄 id → 시각
  const [codes, setCodes] = useState(loadCodes)
  const [pick, setPick] = useState(() => new Set())
  const ref = useRef(null)

  const ords = useMemo(() => orders.map((o) => (done.size ? { ...o, lines: o.lines.map((l) => (done.has(l.id) ? { ...l, sales_done_at: done.get(l.id) } : l)) } : o)), [orders, done])

  // ① 판매입력 대상 — 이 달 납품 · 판매입력 전 (고객사 거름)
  const toInput = useMemo(() => ords.flatMap((o) => (o.planned || (cust !== 'all' && o.customer_code !== cust) ? []
    : o.lines.filter((l) => !l.cancelled && +l.delivered_qty > 0 && !l.sales_done_at && String(l.delivered_at || '').slice(0, 7) === month).map((l) => ({ ...l, o })))), [ords, cust, month])

  // ② 대조
  const res = useMemo(() => (file ? matchEcount({ rows: file.rows, orders: ords, month, cust }) : null), [file, ords, month, cust])
  const shown = useMemo(() => {
    if (!res) return []
    const ks = only === 'check' ? ['diff', 'only_ecount', 'no_sale', 'verbal_open'] : only === 'all' ? Object.keys(RESULT) : [only]
    return res.items.filter((x) => ks.includes(x.kind))
  }, [res, only])
  const okNew = res ? res.items.filter((x) => x.kind === 'ok' && !x.l.sales_done_at) : []

  async function read(f) {
    if (!f) return
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const buf = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsArrayBuffer(f) })
      const { rows } = parseEcountSales(XLSX, XLSX.read(buf, { type: 'array', cellDates: true }))
      if (!rows.length) throw new Error('읽은 판매 줄이 없습니다')
      const ms = [...new Set(rows.map((r) => String(r.date || '').slice(0, 7)).filter(Boolean))].sort()
      if (ms.length && !ms.includes(month)) setMonth(ms[ms.length - 1])
      setFile({ name: f.name, rows, months: ms })
      setOnly('check')
    } catch (e) { toastError('판매 자료 읽기 실패: ' + e.message) }
    setBusy(false)
  }
  async function apply() {
    setBusy(true)
    try {
      const r = await applyEcount(okNew, meName)
      setDone((m) => { const n = new Map(m); r.ids.forEach((id) => n.set(id, r.at)); return n })
      toastSuccess(`${r.ids.length}품목 판매입력 마감${r.heads.length ? ` · 명세서번호 ${r.heads.length}건 채움` : ''}`)
      onChanged?.()
    } catch (e) { toastError(e.message) }
    setBusy(false)
  }
  async function exportInput() {
    const ls = toInput.filter((l) => pick.size === 0 || pick.has(l.id))
    if (!ls.length) { toastError('판매입력할 줄이 없습니다'); return }
    saveCodes(codes)
    const XLSX = await import('xlsx')
    XLSX.writeFile(salesInputWorkbook(XLSX, ls, codes), `이카운트_판매입력_${month}${cust !== 'all' ? '_' + cust : ''}.xlsx`)
    toastSuccess(`판매입력 파일 ${ls.length}줄 — 이카운트 「판매입력」에 올린 뒤 판매현황을 다시 받아 대조하세요`)
  }

  const C = res?.counts
  const custs = cust === 'all' ? Object.keys(ORDER_CUSTOMERS) : [cust]
  return (
    <div className="space-y-4" data-ecount>
      <p className="page-desc text-xs text-slate-400 leading-relaxed">
        납품한 줄을 이카운트 「판매입력」 양식으로 내려받아 올리고, 월말에 이카운트 판매현황을 다시 올려 PO No. · 품목코드로 맞춥니다. 맞은 줄은 「판매입력 마감」으로 표시하고 PO 에 명세서번호를 채웁니다 (PO 당 명세서 하나).
      </p>
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-slate-500">고객사</span>
        {[['all', '전체'], ...Object.entries(ORDER_CUSTOMERS).map(([k, v]) => [k, v.name])].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setCust(k)} data-ec-cust={k} className={`px-3 py-1.5 rounded-full text-xs font-bold border ${cust === k ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>{l}</button>
        ))}
        <span className="w-px h-5 bg-slate-200 mx-1" />
        <span className="text-xs font-bold text-slate-500">마감 월</span>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} data-ec-month className="h-8 px-2 text-xs border border-slate-200 rounded-lg" />
        <span className="flex-1" />
        {file && <span className="text-[11.5px] text-slate-500" data-ec-file>{file.name} · {file.rows.length.toLocaleString('ko-KR')}줄{file.months.length ? ` · ${file.months.join(', ')}` : ''}</span>}
        <button type="button" onClick={() => ref.current?.click()} disabled={busy} data-ec-pick className="px-4 py-2 rounded-lg text-xs font-bold bg-violet-600 text-white disabled:opacity-40">{busy && !file ? '읽는 중…' : '이카운트 판매자료 올리기'}</button>
        <input ref={ref} type="file" accept=".xlsx,.xls" className="hidden" data-ec-file-input onChange={(e) => { read(e.target.files?.[0]); e.target.value = '' }} />
      </div>

      {/* ① 판매입력 파일 */}
      <section className="bg-white border border-slate-200 rounded-xl px-4 py-3 space-y-2" data-ec-input>
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-[14px] font-extrabold text-slate-800">① 판매입력 파일 만들기</h3>
          <span className="text-[12px] text-slate-500">{month} 납품 · 판매입력 전 <b className="text-slate-800" data-ec-input-n>{toInput.length}</b>줄 (PO {new Set(toInput.map((l) => l.order_id)).size}건) — 체크하지 않으면 전부</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11.5px] text-slate-500">이카운트 거래처코드</span>
          {custs.map((k) => <label key={k} className="flex items-center gap-1 text-[11.5px] text-slate-600">{ORDER_CUSTOMERS[k].name}<input value={codes[k] || ''} onChange={(e) => setCodes({ ...codes, [k]: e.target.value })} data-ec-code={k} className="w-24 h-7 px-1.5 text-[11.5px] font-mono border border-slate-200 rounded" /></label>)}
          <span className="flex-1" />
          <button type="button" onClick={exportInput} disabled={!toInput.length} data-ec-export className="h-8 px-3 rounded-lg text-xs font-bold bg-white border border-slate-300 disabled:opacity-40">판매입력 파일 받기 ({pick.size || toInput.length}줄)</button>
        </div>
        {toInput.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-slate-500">줄 보기 · 고르기</summary>
            <div className="mt-1 max-h-56 overflow-y-auto border border-slate-100 rounded-lg">
              <table className="w-full text-[11.5px]">
                <tbody>{toInput.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100" data-ec-input-line={`${l.o.po_no}|${lineKey(l)}`}>
                    <td className="px-2 py-1"><input type="checkbox" checked={pick.has(l.id)} onChange={() => setPick((x) => { const n = new Set(x); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n })} /></td>
                    <td className="px-2 font-mono">{l.delivered_at}</td><td className="px-2 font-mono text-[#5b6ee8]">{l.o.po_no}</td><td className="px-2 font-mono">{l.items?.js_code || <span className="text-amber-600" title="이카운트 코드(JS-)가 없어 포털 코드로 들어갑니다">{l.items?.std_code || l.raw_pn}</span>}</td>
                    <td className="px-2">{l.items?.name || l.raw_desc}</td><td className="px-2 text-right font-mono">{fmt(+l.delivered_qty)}</td><td className="px-2 text-right font-mono">{money(l.o, (+l.delivered_qty) * (+l.unit_price || 0))}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        )}
        <p className="text-[11px] text-slate-400">품목코드는 이카운트 코드(JS-) — 없으면 포털 코드로 들어가 주황으로 표시됩니다. 같은 날 · 같은 PO 는 같은 순번(명세서 하나). 부가세 칸은 비워 둡니다.</p>
      </section>

      {/* ② 대조 */}
      {!res ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500" data-ec-empty>
          ② 대조 — 이카운트 「판매현황」(또는 판매입력 양식) 엑셀을 올리면 이 달 판매와 수주대장을 맞춰 봅니다.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Kpi k="ok" tone="green" label="맞음" value={C.ok} sub={`마감 ${C.closed} · 새로 마감할 것 ${okNew.length}`} on={only === 'ok'} onClick={() => setOnly(only === 'ok' ? 'check' : 'ok')} />
            <Kpi k="no_sale" tone="red" label="납품했는데 판매 없음" value={C.no_sale} sub="수주대장 납품 · 이카운트 판매 미등록" on={only === 'no_sale'} onClick={() => setOnly(only === 'no_sale' ? 'check' : 'no_sale')} />
            <Kpi k="diff" tone="amber" label="수량 · 금액 다름" value={C.diff} sub="같은 PO · 품목인데 값이 다름" on={only === 'diff'} onClick={() => setOnly(only === 'diff' ? 'check' : 'diff')} />
            <Kpi k="only_ecount" tone="amber" label="이카운트에만" value={C.only_ecount} sub="수주대장에 PO 가 없음 — 구두 발주 누락?" on={only === 'only_ecount'} onClick={() => setOnly(only === 'only_ecount' ? 'check' : 'only_ecount')} />
            <Kpi k="verbal_open" tone="violet" label="구두 발주 미마감" value={C.verbal_open} sub="명세서번호는 있는데 판매 전" on={only === 'verbal_open'} onClick={() => setOnly(only === 'verbal_open' ? 'check' : 'verbal_open')} />
          </div>
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 border-b border-slate-100">
              <button type="button" onClick={() => setOnly('check')} data-ec-only="check" className={`px-3 py-1.5 rounded-full text-xs font-bold border ${only === 'check' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>확인할 것만 {C.diff + C.only_ecount + C.no_sale + C.verbal_open}</button>
              <button type="button" onClick={() => setOnly('all')} data-ec-only="all" className={`px-3 py-1.5 rounded-full text-xs font-bold border ${only === 'all' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>전체 {res.items.length}</button>
              <span className="flex-1" />
              {editable && <button type="button" onClick={apply} disabled={busy || !okNew.length} data-ec-apply className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-violet-600 text-white disabled:opacity-40">맞은 {okNew.length}줄 판매입력 마감</button>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-xs">
                <thead className="bg-slate-50 text-slate-500 border-b-2 border-slate-200"><tr className="text-left">
                  <th className="px-3 py-2 font-bold">결과</th><th className="px-3 font-bold">명세서번호</th><th className="px-3 font-bold">PO · 구분</th><th className="px-3 font-bold">품목</th>
                  <th className="px-3 font-bold text-right">수주대장 수량 · 금액</th><th className="px-3 font-bold text-right">이카운트 수량 · 금액</th><th className="px-3 font-bold">확인할 것</th>
                </tr></thead>
                <tbody>
                  {!shown.length && <tr><td colSpan={7} className="p-8 text-center text-slate-400">해당하는 줄이 없습니다</td></tr>}
                  {shown.map((x, i) => {
                    const o = x.o, l = x.l, r = x.r
                    const q = l ? (+l.delivered_qty > 0 ? +l.delivered_qty : +l.qty) : null
                    return (
                      <tr key={i} className="border-t border-slate-100 align-top" data-ec-row={x.kind}>
                        <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${RESULT[x.kind][1]}`}>{x.kind === 'ok' && l?.sales_done_at ? '마감' : RESULT[x.kind][0]}</span></td>
                        <td className="px-3 py-2 font-mono">{r?.slip || (o?.slip_no ? normSlip(o.slip_no) : '—')}</td>
                        <td className="px-3 py-2">{o ? <><div className="font-mono font-bold text-[#5b6ee8]">{o.po_no}</div><div className="text-[10.5px] text-slate-400">{KINDS[kindOf(o)]} · {ORDER_CUSTOMERS[o.customer_code]?.name}{l?.delivered_at ? ` · 납품 ${l.delivered_at.slice(5)}` : ''}</div></> : <><div className="font-mono text-slate-500">{r?.po_no || '(PO No. 없음)'}</div><div className="text-[10.5px] text-slate-400">{r?.cust_name}</div></>}</td>
                        <td className="px-3 py-2"><div className="font-mono font-bold">{l?.items?.std_code || l?.raw_pn || r?.code}</div><div className="text-[10.5px] text-slate-400 truncate max-w-[260px]">{l?.items?.name || l?.raw_desc || r?.name}</div></td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{l ? <>{fmt(q)} · {money(o, q * (+l.unit_price || 0))}</> : '—'}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{r ? <>{fmt(r.qty)} · {money(o || {}, isUsd(o) ? (r.fsupply ?? r.supply) : r.supply)}</> : '—'}</td>
                        <td className="px-3 py-2 text-[11.5px] text-slate-600">{{
                          ok: l?.sales_done_at ? '마감됨' : '「판매입력 마감」을 누르면 마감',
                          diff: x.why || '값 확인', only_ecount: '수주대장에 PO 를 등록(구두 발주 등)하거나 이카운트 PO No. 확인',
                          no_sale: '이카운트 판매입력 — ① 파일로 올리기', verbal_open: '납품 · 판매입력 뒤 다시 대조',
                        }[x.kind]}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
