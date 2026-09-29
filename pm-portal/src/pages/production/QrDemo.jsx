import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { must } from '../../lib/db'
import { toastError, toastSuccess } from '../../lib/toast'
import QrScanner from '../../components/QrScanner'
import { WoSheet, WorkOrderPrinter, useWoQr } from '../../components/WorkOrderPrint'
import { isMainRow } from './mainPns'
import { bdMinus } from '../../lib/bizdays'
import {
  QR_STEPS, doneFromRow, nextStep, qrText, parseQr, scanRevCheck, revInfo, laneOf, LANES, md,
} from '../../lib/prodFlow'

// 🧪 QR 공정 데모 (v4.24.0)
//
//   작업지시서에 호기별 QR 을 찍어 내고 → 폰으로 찍으면 그 호기의 다음 공정이 뜨고 → 한 번 누르면 기록 → 흐름이 보인다.
//   셀 방식 — 한 사람이 한 호기를 맡는다. 폰마다 「이 폰 사용자」를 한 번 정해 두면 누가 했는지 남는다.
//   전장만 시작 · 완료 둘 다, 나머지 공정은 완료만. 포장 · 출하는 따로.
//
//   ⚠ 데모 — 생산관리 체크칸(production)에는 쓰지 않는다. 기록은 이 기기(브라우저)에만 남는다.
//     생산관리 데이터는 읽기만 한다 (지금 어디까지 끝났는지 출발점으로).
//     정식 전환 때: 기록을 pm_prod_scan 표에 남기고, 완료 스캔이 생산관리 체크칸을 켜게 한다.

const LS = 'pm_qr_demo_v1'
const load = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}') } catch { return {} } }
const save = (v) => { try { localStorage.setItem(LS, JSON.stringify(v)); return true } catch { return false } }
const hm = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) }
const mins = (a, b) => Math.max(0, Math.round((b - a) / 60000))
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`)
const calcElec = (r, qc) => r.elec_done || bdMinus(r.req_date, Math.max(1, Math.ceil(Number(qc) || 2)))

async function fetchRows() {
  const prod = await fetchAll(() => supabase.from('production')
    .select('id,pn,hogi,name,status,req_date,elec_done,arrival_date,machine_recv,harness_recv,part_issue,elec_recv,quality_recv,missing_parts,rev,brev,ccn,po_id,customer_code')
    .eq('customer_code', 'AX').neq('status', '완료').order('id'))
  const main = prod.filter((r) => isMainRow(r.pn, r.customer_code))
  const ids = [...new Set(main.map((r) => r.po_id).filter(Boolean))]
  const po = {}
  for (let i = 0; i < ids.length; i += 200) {
    const part = must(await supabase.from('purchase_orders').select('id,po_number').in('id', ids.slice(i, i + 200)), 'PO 조회') || []
    part.forEach((p) => { po[p.id] = p.po_number })
  }
  const items = must(await supabase.from('items').select('std_code,qc_md_days').like('std_code', 'AX-11%'), '품목 조회') || []
  const qc = Object.fromEntries(items.map((i) => [String(i.std_code).replace('AX-', ''), i.qc_md_days]))
  return main.map((r) => ({ ...r, _po: po[r.po_id] || '', _elec: calcElec(r, qc[r.pn]) }))
    .sort((a, b) => String(a.req_date || '9').localeCompare(String(b.req_date || '9')) || String(a.pn).localeCompare(String(b.pn)))
}

export default function QrDemo() {
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('t') || 'wo'
  const setTab = (t) => setSp((x) => { const s = new URLSearchParams(x); if (t === 'wo') s.delete('t'); else s.set('t', t); return s })
  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ['qrDemoRows'], queryFn: fetchRows, staleTime: 60 * 1000 })
  const [st, setSt] = useState(() => { const v = load(); return { worker: v.worker || '', events: Array.isArray(v.events) ? v.events : [] } })
  const put = (next) => { setSt(next); if (!save(next)) toastError('이 브라우저에 저장하지 못했습니다 (사생활 보호 모드?) — 새로고침하면 사라집니다') }

  // 호기별 끝난 공정 = 생산관리 체크칸 + 데모 기록
  const doneOf = useCallback((r) => {
    const s = doneFromRow(r)
    st.events.filter((e) => String(e.pid) === String(r.id)).forEach((e) => s.add(e.step))
    return s
  }, [st.events])

  const tabs = [['wo', '① 작업지시서'], ['scan', '② 스캔'], ['flow', '③ 공정 흐름']]
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold text-slate-400">🏭 현장</p>
        <h1 className="text-xl font-extrabold text-slate-900">QR 공정 데모</h1>
        <p className="text-[13px] text-slate-400 mt-0.5 break-keep">
          작업지시서의 QR 을 폰으로 찍으면 그 호기의 다음 공정이 떠서, 한 번 누르면 기록됩니다.
          셀 방식 — 한 사람이 한 호기를 맡고, 전장만 시작 · 완료를 둘 다 찍습니다.
        </p>
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 font-semibold break-keep">
          🧪 데모 — 생산관리 체크칸에는 기록하지 않습니다. 찍은 기록은 이 기기에만 남습니다.
        </div>
      </div>

      <div className="grid grid-cols-3 sm:inline-grid sm:w-auto rounded-lg border border-slate-200 overflow-hidden text-sm font-bold">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-2 sm:px-4 py-2.5 whitespace-nowrap border-r last:border-r-0 border-slate-200 ${tab === k ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>{l}</button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">생산관리 데이터를 못 불러왔습니다 — {error.message}</div>}
      {isLoading ? <p className="py-10 text-center text-sm text-slate-400">불러오는 중…</p>
        : tab === 'wo' ? <WorkOrders rows={rows} />
        : tab === 'scan' ? <ScanTab rows={rows} st={st} put={put} doneOf={doneOf} />
        : <FlowTab rows={rows} st={st} put={put} doneOf={doneOf} />}
    </div>
  )
}

/* ───────── ① 작업지시서 발행 ───────── */
//   작업지시서 모양 · 인쇄는 components/WorkOrderPrint.jsx — 생산관리(PD BOX)의 「🖨 작업지시서」도 같은 것을 쓴다.
function WorkOrders({ rows }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState({})
  const [printing, setPrinting] = useState(null)
  const list = rows.filter((r) => { const k = q.trim().toUpperCase(); return !k || [r.pn, r.hogi, r.name, r._po].some((x) => String(x || '').toUpperCase().includes(k)) })
  const picked = rows.filter((r) => sel[r.id])
  const preview = picked[0] || list[0] || null
  const qr = useWoQr(preview ? [preview] : [])

  return (
    <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_820px] gap-4 items-start">
      <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품번 · 호기 · 품명 · PO"
            className="flex-1 min-w-0 sm:flex-none sm:w-60 px-3 py-2 text-sm border border-slate-200 rounded-lg" />
          <span className="text-xs text-slate-400 whitespace-nowrap">{rows.length}대 · 고름 {picked.length}</span>
          <button onClick={() => { if (!picked.length) { toastError('인쇄할 호기를 고르세요'); return } setPrinting(picked) }} disabled={!picked.length || !!printing}
            className="w-full sm:w-auto sm:ml-auto px-4 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">🖨 작업지시서 인쇄 ({picked.length})</button>
        </div>
        <div className="max-h-[62vh] overflow-auto rounded-lg border border-slate-100">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-400 sticky top-0"><tr>
              <th className="px-2 py-2 w-8"><input type="checkbox" aria-label="모두 고르기" checked={list.length > 0 && list.every((r) => sel[r.id])}
                onChange={(e) => setSel((s) => { const n = { ...s }; list.forEach((r) => { n[r.id] = e.target.checked }); return n })} /></th>
              <th className="px-2 py-2 text-left">품번 · 호기</th>
              <th className="px-2 py-2 text-left hidden sm:table-cell">품명</th>
              <th className="px-2 py-2 text-left hidden md:table-cell">PO</th>
              <th className="px-2 py-2 text-left">납기</th>
              <th className="px-2 py-2 text-left">S / B</th>
              <th className="px-2 py-2 text-left hidden sm:table-cell">지금</th>
            </tr></thead>
            <tbody>
              {list.map((r) => {
                const rv = revInfo(r)
                return (
                  <tr key={r.id} className={`border-t border-slate-100 ${sel[r.id] ? 'bg-indigo-50/60' : ''}`}>
                    <td className="px-2 py-2 text-center"><input type="checkbox" aria-label={`${r.pn} ${r.hogi} 고르기`} checked={!!sel[r.id]} onChange={(e) => setSel((s) => ({ ...s, [r.id]: e.target.checked }))} /></td>
                    <td className="px-2 py-2">
                      <div className="font-mono font-bold whitespace-nowrap">{r.pn} <span className="text-indigo-600">{r.hogi}</span></div>
                      <div className="sm:hidden text-[11px] text-slate-400 truncate max-w-[46vw]">{r.name}</div>
                    </td>
                    <td className="px-2 py-2 max-w-[220px] truncate text-slate-600 hidden sm:table-cell">{r.name}</td>
                    <td className="px-2 py-2 font-mono text-slate-500 hidden md:table-cell">{r._po}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{md(r.req_date)}</td>
                    <td className={`px-2 py-2 font-mono font-bold whitespace-nowrap ${rv.diff ? 'text-rose-600' : 'text-slate-500'}`}>{rv.s || '-'}/{rv.b || '-'}{rv.diff ? ' ⚠' : ''}</td>
                    <td className="px-2 py-2 text-slate-500 whitespace-nowrap hidden sm:table-cell">{LANES.find((L) => L.k === laneOf(r))?.l}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-400 break-keep">
          QR 에는 「PD|호기번호|출력 당시 BREV」만 들어갑니다 (짧아야 잘 읽힘). PO Rev 가 바뀌면 스캔할 때 「작업지시서 재출력」이 뜹니다.
          생산관리 → PD BOX 에서 호기를 체크하고 「🖨 작업지시서」로도 뽑을 수 있습니다.
        </p>
      </div>

      <div className="hidden md:block space-y-2">
        <div className="text-xs font-bold text-slate-500">미리보기 {preview ? `— ${preview.pn} ${preview.hogi}` : ''}</div>
        {preview ? (
          <div className="overflow-auto rounded-xl bg-slate-200 p-3">
            <div style={{ transform: 'scale(0.9)', transformOrigin: 'top left', width: '210mm' }}>
              <WoSheet r={preview} qr={qr[qrText(preview)]} />
            </div>
          </div>
        ) : <p className="text-sm text-slate-400">호기가 없습니다</p>}
      </div>

      {printing && <WorkOrderPrinter rows={printing} onDone={() => setPrinting(null)} />}
    </div>
  )
}

/* ───────── ② 스캔 (폰) ───────── */
function ScanTab({ rows, st, put, doneOf }) {
  const [name, setName] = useState(st.worker)
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState(null)      // { id, qrRev }
  const [last, setLast] = useState(null)    // 방금 기록 { ev, at }
  const [, tick] = useState(0)
  useEffect(() => { if (!last) return undefined; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t) }, [last])

  const onScan = useCallback((p) => {
    setOpen(false)
    if (!rows.some((r) => String(r.id) === String(p.id))) { toastError('진행 중인 PD 호기가 아닙니다 (완료됐거나 다른 QR)'); return }
    setCur({ id: p.id, qrRev: p.rev }); setLast(null)
  }, [rows])

  const r = cur ? rows.find((x) => String(x.id) === String(cur.id)) : null
  const done = r ? doneOf(r) : null
  const nx = done ? nextStep(done) : null
  const checks = r ? scanRevCheck(r, cur.qrRev) : []

  function record() {
    if (!st.worker) { toastError('먼저 「이 폰 사용자」를 정하세요'); return }
    if (!r || !nx) return
    const ev = { id: `${Date.now()}`, pid: String(r.id), step: nx.k, at: Date.now(), by: st.worker }
    put({ ...st, events: [...st.events, ev] })
    setLast({ ev, at: Date.now() })
    toastSuccess(`${r.pn} ${r.hogi} — ${nx.l} 기록 (데모)`)
  }
  function undo() {
    if (!last) return
    put({ ...st, events: st.events.filter((e) => e.id !== last.ev.id) })
    setLast(null)
  }
  const undoLeft = last ? Math.max(0, 8 - Math.floor((Date.now() - last.at) / 1000)) : 0

  return (
    <div className="max-w-md mx-auto sm:mx-0 space-y-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
        <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-500">이 폰 사용자 (처음 한 번만)
          <div className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" aria-label="이 폰 사용자"
              className="flex-1 px-3 py-2.5 text-base font-normal border border-slate-200 rounded-lg" />
            <button onClick={() => { put({ ...st, worker: name.trim() }); toastSuccess('이 폰 사용자를 저장했습니다') }} disabled={!name.trim() || name.trim() === st.worker}
              className="shrink-0 px-4 py-2.5 text-sm font-bold rounded-lg bg-slate-800 text-white disabled:opacity-30">저장</button>
          </div>
        </label>
        {st.worker && <p className="text-xs text-slate-500">지금 <b className="text-slate-800">{st.worker}</b>(으)로 기록됩니다</p>}
      </div>

      <button onClick={() => setOpen(true)} className="w-full py-5 text-lg font-extrabold rounded-2xl bg-indigo-600 text-white hover:bg-indigo-700">📷 작업지시서 QR 찍기</button>
      <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-500">카메라 없이 호기 고르기
        <select value={cur?.id || ''} onChange={(e) => { const x = rows.find((y) => String(y.id) === e.target.value); if (x) { setCur({ id: String(x.id), qrRev: revInfo(x).b }); setLast(null) } }}
          className="px-3 py-2.5 text-sm font-normal border border-slate-200 rounded-lg bg-white">
          <option value="">— 호기 —</option>
          {rows.map((x) => <option key={x.id} value={x.id}>{x.pn} {x.hogi}</option>)}
        </select>
      </label>

      {r && (
        <div className="rounded-2xl border-2 border-indigo-200 bg-white p-4 space-y-3" data-scan-card>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-2xl font-extrabold">{r.pn}</span>
              <span className="font-mono text-2xl font-extrabold text-indigo-600">{r.hogi}</span>
            </div>
            <div className="text-sm text-slate-600 truncate">{r.name}</div>
            <div className="text-xs text-slate-400 whitespace-nowrap">납기 {md(r.req_date)} · 전장 완료예정 {md(r._elec)}</div>
          </div>
          {checks.map((c, i) => (
            <div key={i} className="rounded-lg border-2 border-rose-400 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">⚠ {c.t}</div>
          ))}
          <ol className="grid grid-cols-2 gap-1.5">
            {QR_STEPS.map((s, i) => {
              const on = done.has(s.k)
              const isNext = nx?.k === s.k
              return (
                <li key={s.k} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-bold whitespace-nowrap ${on ? 'bg-emerald-100 text-emerald-800' : isNext ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                  <span className={`w-5 text-center text-xs ${on ? '' : 'opacity-70'}`}>{on ? '✔' : i + 1}</span>{s.l}
                </li>
              )
            })}
          </ol>
          {nx ? (
            <button onClick={record} disabled={!st.worker}
              className="w-full py-5 text-xl font-extrabold rounded-2xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
              {nx.l}{nx.k === 'elec_start' ? ' ▶' : ' ✔'}
            </button>
          ) : <p className="text-center text-sm font-bold text-emerald-700">모든 공정이 끝났습니다</p>}
          {!st.worker && <p className="text-xs text-rose-600 font-semibold">위에서 「이 폰 사용자」를 먼저 저장하세요</p>}
          {last && undoLeft > 0 && (
            <button onClick={undo} className="w-full py-3 text-sm font-bold rounded-xl border border-slate-300 text-slate-700 bg-white">잘못 찍었어요 — 되돌리기 ({undoLeft}초)</button>
          )}
        </div>
      )}

      {open && (
        <QrScanner onScan={onScan} onClose={() => setOpen(false)} parse={parseQr}
          hint="작업지시서 오른쪽 위 QR 을 비추세요" placeholder="직접 입력 (예: PD|123|E)" />
      )}
    </div>
  )
}

/* ───────── ③ 공정 흐름 ───────── */
function FlowTab({ rows, st, put, doneOf }) {
  const [all, setAll] = useState(false)
  const now = Date.now()
  const touched = new Set(st.events.map((e) => String(e.pid)))
  const list = rows.filter((r) => all || touched.has(String(r.id)))
  const evOf = (r, k) => st.events.filter((e) => String(e.pid) === String(r.id) && e.step === k).slice(-1)[0]
  // 오늘 누가 무엇을 — 셀 방식이라 사람별로
  const byWorker = useMemo(() => {
    const m = {}
    st.events.forEach((e) => { (m[e.by || '-'] ??= []).push(e) })
    return m
  }, [st.events])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap text-xs">
        <label className="inline-flex items-center gap-1.5 font-semibold text-slate-600 whitespace-nowrap">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> 찍지 않은 호기도 보기 ({rows.length})
        </label>
        <span className="text-slate-400">데모 기록 {st.events.length}건</span>
        {st.events.length > 0 && (
          <button onClick={() => { if (window.confirm('이 기기의 데모 기록을 모두 지울까요? (생산관리 데이터는 그대로)')) put({ ...st, events: [] }) }}
            className="ml-auto px-3 py-1.5 font-bold rounded-lg border border-slate-200 text-slate-500 hover:text-rose-600">데모 기록 지우기</button>
        )}
      </div>

      {Object.keys(byWorker).length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {Object.entries(byWorker).map(([w, evs]) => {
            const working = rows.find((r) => evOf(r, 'elec_start') && !doneOf(r).has('elec') && evOf(r, 'elec_start').by === w)
            return (
              <div key={w} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs">
                <b className="text-slate-800">{w}</b> <span className="text-slate-400">기록 {evs.length}</span>
                {working && <span className="ml-2 text-emerald-700 font-bold">● {working.pn} {working.hogi} 전장 중 {dur(mins(evOf(working, 'elec_start').at, now))}</span>}
              </div>
            )
          })}
        </div>
      )}

      {list.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">아직 찍은 호기가 없습니다 — 「② 스캔」에서 찍거나, 「찍지 않은 호기도 보기」를 켜세요</p>
      ) : (<>
        {/* 폰 — 호기마다 카드, 공정은 세로로 */}
        <div className="md:hidden space-y-2">
          {list.map((r) => {
            const done = doneOf(r)
            const nx = nextStep(done)
            const es = evOf(r, 'elec_start')
            const working = es && !done.has('elec')
            return (
              <div key={r.id} data-flow-card={r.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono font-bold whitespace-nowrap">{r.pn} <span className="text-indigo-600">{r.hogi}</span></span>
                  <span className={`text-xs font-bold whitespace-nowrap ${working ? 'text-emerald-700' : 'text-slate-500'}`}>
                    {working ? `● 전장 중 ${dur(mins(es.at, now))}` : nx ? `${nx.l} 대기` : '끝'}
                  </span>
                </div>
                <ol className="mt-2 space-y-1">
                  {QR_STEPS.map((s) => {
                    const ev = evOf(r, s.k)
                    const on = done.has(s.k)
                    const isNext = nx?.k === s.k
                    return (
                      <li key={s.k} className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs ${ev ? 'bg-emerald-50' : isNext ? 'bg-indigo-50' : ''}`}>
                        <span className={`w-2 h-2 rounded-full shrink-0 ${ev ? 'bg-emerald-500' : on ? 'bg-slate-400' : isNext ? 'bg-indigo-500' : 'bg-slate-200'}`} />
                        <span className={`w-20 shrink-0 font-semibold whitespace-nowrap ${on || isNext ? 'text-slate-800' : 'text-slate-400'}`}>{s.l}</span>
                        <span className="text-slate-500 truncate">{ev ? `${hm(ev.at)} · ${ev.by}` : on ? '생산관리 체크' : isNext ? '다음' : ''}</span>
                      </li>
                    )
                  })}
                </ol>
              </div>
            )
          })}
        </div>
        <div className="hidden md:block rounded-2xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-400"><tr>
              <th className="px-3 py-2 text-left">품번 · 호기</th>
              {QR_STEPS.map((s) => <th key={s.k} className="px-2 py-2 text-center whitespace-nowrap">{s.l}</th>)}
              <th className="px-3 py-2 text-left">지금</th>
            </tr></thead>
            <tbody>
              {list.map((r) => {
                const done = doneOf(r)
                const nx = nextStep(done)
                const es = evOf(r, 'elec_start')
                const working = es && !done.has('elec')
                return (
                  <tr key={r.id} className="border-t border-slate-100" data-flow-row={r.id}>
                    <td className="px-3 py-2 font-mono font-bold whitespace-nowrap">{r.pn} <span className="text-indigo-600">{r.hogi}</span></td>
                    {QR_STEPS.map((s) => {
                      const ev = evOf(r, s.k)
                      const on = done.has(s.k)
                      return (
                        <td key={s.k} className="px-1.5 py-2 text-center">
                          <div className={`rounded-md px-1 py-1 leading-tight ${ev ? 'bg-emerald-100 text-emerald-800' : on ? 'bg-slate-100 text-slate-500' : nx?.k === s.k ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-300' : 'text-slate-300'}`}>
                            {ev ? <><b>{hm(ev.at)}</b><br />{ev.by}</> : on ? '✔ 생산관리' : nx?.k === s.k ? '다음' : '·'}
                          </div>
                        </td>
                      )
                    })}
                    <td className="px-3 py-2 whitespace-nowrap">
                      {working ? <span className="font-bold text-emerald-700">● 전장 작업 중 {dur(mins(es.at, now))} · {es.by}</span>
                        : nx ? <span className="text-slate-600">{nx.l} 대기</span> : <span className="text-emerald-700 font-bold">끝</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </>)}
      <p className="text-[11px] text-slate-400 break-keep">「✔ 생산관리」(폰에서는 「생산관리 체크」) = 생산관리 체크칸으로 이미 끝난 공정, 초록 = 이 기기에서 찍은 데모 기록. 정식 전환하면 찍는 순간 생산관리 체크칸과 전광판이 같이 움직입니다.</p>
    </div>
  )
}
