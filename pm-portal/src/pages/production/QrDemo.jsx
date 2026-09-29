import { useState, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { toastError } from '../../lib/toast'
import { WoSheet, WorkOrderPrinter, useWoQr } from '../../components/WorkOrderPrint'
import ScanView, { useDemoRows, useDemoStore, hm } from './ScanView'
import { QR_STEPS, nextStep, qrText, revInfo, laneOf, LANES, md } from '../../lib/prodFlow'

// 🧪 QR 공정 데모 (v4.24.0)
//
//   PC — ① 작업지시서 발행 ② 스캔 ③ 공정 흐름.  폰 — 스캔만 (ScanView, /scan 과 같은 화면).
//   셀 방식 — 한 사람이 한 호기를 맡는다. 폰마다 「이 폰 사용자」를 한 번 정해 두면 누가 했는지 남는다.
//   전장만 시작 · 완료 둘 다, 나머지 공정은 완료만. 포장 · 출하는 따로.
//
//   ⚠ 데모 — 생산관리 체크칸(production)에는 쓰지 않는다. 기록은 이 기기(브라우저)에만 남는다.
//     정식 전환 때: 기록을 pm_prod_scan 표에 남기고, 완료 스캔이 생산관리 체크칸을 켜게 한다.

const mins = (a, b) => Math.max(0, Math.round((b - a) / 60000))
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`)
const isPhone = () => typeof window !== 'undefined' && window.innerWidth < 768

export default function QrDemo() {
  const [sp, setSp] = useSearchParams()
  const tab = sp.get('t') || 'wo'
  const setTab = (t) => setSp((x) => { const s = new URLSearchParams(x); if (t === 'wo') s.delete('t'); else s.set('t', t); return s })
  const { data: rows = [], isLoading, error } = useDemoRows()
  const store = useDemoStore()
  const [phone, setPhone] = useState(isPhone)
  useEffect(() => { const f = () => setPhone(isPhone()); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])

  // 폰 — 스캔 화면만
  if (phone) return <div className="-m-4"><ScanView store={store} rows={rows} full /></div>

  const { st, put, doneOf } = store
  const tabs = [['wo', '① 작업지시서'], ['scan', '② 스캔'], ['flow', '③ 공정 흐름']]
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold text-slate-400">🏭 현장</p>
        <h1 className="text-xl font-extrabold text-slate-900">QR 공정 데모</h1>
        <p className="text-[13px] text-slate-400 mt-0.5 break-keep">
          작업지시서의 QR 을 폰으로 찍으면 그 호기의 다음 공정이 떠서, 한 번 누르면 기록됩니다.
          셀 방식 — 한 사람이 한 호기를 맡고, 전장만 시작 · 완료를 둘 다 찍습니다. 폰에서 이 메뉴를 열면 스캔 화면만 나옵니다.
        </p>
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 font-semibold break-keep">
          🧪 데모 — 생산관리 체크칸에는 기록하지 않습니다. 찍은 기록은 이 기기에만 남습니다.
        </div>
      </div>

      <div className="inline-grid grid-cols-3 rounded-lg border border-slate-200 overflow-hidden text-sm font-bold">
        {tabs.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 whitespace-nowrap border-r last:border-r-0 border-slate-200 ${tab === k ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>{l}</button>
        ))}
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">생산관리 데이터를 못 불러왔습니다 — {error.message}</div>}
      {isLoading ? <p className="py-10 text-center text-sm text-slate-400">불러오는 중…</p>
        : tab === 'wo' ? <WorkOrders rows={rows} />
        : tab === 'scan' ? <ScanTab rows={rows} store={store} />
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

/* ───────── ② 스캔 — PC 에서는 폰 화면을 옆에 띄워 보고, 폰으로 여는 QR 을 준다 ───────── */
function ScanTab({ rows, store }) {
  const url = `${window.location.origin}/scan`
  const [img, setImg] = useState('')
  useEffect(() => { QRCode.toDataURL(url, { width: 220, margin: 1 }).then(setImg).catch((e) => toastError('QR 을 만들지 못했습니다: ' + e.message)) }, [url])
  return (
    <div className="flex gap-6 items-start flex-wrap">
      <div className="w-[400px] max-w-full shadow-sm"><ScanView store={store} rows={rows} /></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-2 max-w-xs">
        <div className="text-sm font-extrabold text-slate-800">폰에서 열기</div>
        {img ? <img src={img} alt="스캔 화면 주소 QR" className="w-40 h-40" /> : <div className="w-40 h-40 bg-slate-100 rounded" />}
        <div className="font-mono text-xs text-slate-500 break-all">{url}</div>
        <p className="text-xs text-slate-500 break-keep">폰 카메라로 이 QR 을 찍으면 포털 틀 없이 스캔 화면만 꽉 차게 열립니다 (로그인 필요). 홈 화면에 추가해 두면 앱처럼 씁니다.</p>
      </div>
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
