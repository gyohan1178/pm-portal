import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { todayISO, kstDT, kst } from '../../lib/utils'
import { revInfo, missingOf } from '../../lib/prodFlow'
import { qcIndex } from '../../lib/prodAuto'
import { progressOf, scanIndex, STAGES, CUST_NAME } from '../../lib/prodSteps'
import { useBoardData, dday, ddTone, ddText, hogiNo, isPhone } from '../../lib/prodBoard'
import { isMainRow } from './mainPns'
import { isTpRow } from '../../lib/thirdParty'
import { WorkOrderPrinter } from '../../components/WorkOrderPrint'
import { SkeletonRows } from '../../components/ux/Skeleton'
import ScanView from './ScanView'
import MissingList from './MissingList'

// 🏭 공정 현황판 (v4.165.0) — 생산 대시보드 · 생산 전광판 · QR 공정 데모를 하나로
//   한 줄 = 호기 · 진행 막대 4칸 = 불출(구매팀) → 제조(전장팀) → 검수(품질팀) → 납품대기(영업팀) — 전 고객사 같음
//   · 불출은 생산관리 체크칸(가공물 입고 + 파트 불출) · 제조 · 검수는 현장 폰으로 작업지시서 QR (lib/prodSteps.js)
//   · 「지금 팀」 = 그 호기가 지금 누구 차례인지 — 팀별로 거를 수 있다
//   · ⛶ 전체화면 = 현장 TV — /board?c=AX 처럼 고객사를 붙여 켜 두면 그 고객사만 · 30초마다 새로 · 14줄씩 넘김
//   · ⚠ 미불출 목록 탭 — 생산관리에 적힌 미불출 파트를 한 표로 (MissingList)
//   · 폰으로 열면 스캔 화면만

const CUST_TONE = { AX: 'bg-indigo-50 text-indigo-700 border-indigo-200', ED: 'bg-sky-50 text-sky-700 border-sky-200', CSK: 'bg-amber-50 text-amber-700 border-amber-200', VM: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
const CUSTS = ['AX', 'ED', 'CSK', 'VM']
const TEAM_TONE = { mat: 'bg-violet-50 text-violet-700', make: 'bg-sky-50 text-sky-700', qc: 'bg-amber-50 text-amber-700', wait: 'bg-emerald-50 text-emerald-700' }
const custOk = (c) => (CUSTS.includes(String(c || '').toUpperCase()) ? String(c).toUpperCase() : 'ALL')

export default function ProcessBoard({ tv: tvProp }) {
  const nav = useNavigate()
  const [sp] = useSearchParams()
  const [tv, setTv] = useState(!!tvProp)
  const { data, isLoading, error, dataUpdatedAt } = useBoardData(tv)
  const [phone, setPhone] = useState(isPhone)
  useEffect(() => { const f = () => setPhone(isPhone()); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  const [cust, setCust] = useState(() => custOk(sp.get('c')))
  const [view, setView] = useState('all')      // all · late · week
  const [team, setTeam] = useState('ALL')      // ALL · mat · make · qc · wait
  const [q, setQ] = useState('')
  const [sel, setSel] = useState({})
  const [open, setOpen] = useState(null)
  const [printing, setPrinting] = useState(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [tab, setTab] = useState('flow')        // flow 공정 · miss 미불출 목록

  const rows = data?.rows || []
  const scans = useMemo(() => scanIndex(data?.scans), [data?.scans])
  const qcLatest = useMemo(() => qcIndex(data?.qc).latest, [data?.qc])
  const today = todayISO()

  const enriched = useMemo(() => rows.map((r) => ({ ...r, _p: progressOf(r, scans, qcLatest), _dd: dday(r._due) }))
    .sort((a, b) => (a._due || '9999').localeCompare(b._due || '9999') || String(a.pn).localeCompare(String(b.pn)) || hogiNo(a.hogi) - hogiNo(b.hogi)),
  [rows, scans, qcLatest])

  const inCust = useMemo(() => enriched.filter((r) => cust === 'ALL' || r.customer_code === cust), [enriched, cust])
  const cnt = useMemo(() => Object.fromEntries(CUSTS.map((c) => [c, enriched.filter((r) => r.customer_code === c).length])), [enriched])
  const teamCnt = useMemo(() => Object.fromEntries(STAGES.map((s) => [s.k, inCust.filter((r) => r._p.cur === s.k).length])), [inCust])
  const shown = useMemo(() => {
    const k = q.trim().toUpperCase()
    return inCust.filter((r) => (team === 'ALL' || r._p.cur === team)
      && (view === 'all' || (view === 'late' && r._dd != null && r._dd < 0) || (view === 'week' && r._dd != null && r._dd >= 0 && r._dd <= 7))
      && (!k || [r.pn, r.name, r.hogi, r._po, r.part, r.company].some((x) => String(x || '').toUpperCase().includes(k))))
  }, [inCust, team, view, q])

  const inIds = useMemo(() => new Set(inCust.map((r) => String(r.id))), [inCust])
  const kpi = {
    all: inCust.length,
    late: inCust.filter((r) => r._dd != null && r._dd < 0).length,
    week: inCust.filter((r) => r._dd != null && r._dd >= 0 && r._dd <= 7).length,
    scans: (data?.scans || []).filter((s) => kst(s.at).slice(0, 10) === today && inIds.has(String(s.production_id))).length,
    missing: inCust.filter((r) => missingOf(r).length).length,
  }

  // ── TV : 한 화면에 들어가는 만큼씩 15초마다 넘김
  const [page, setPage] = useState(0)
  const per = 14
  const pages = Math.max(1, Math.ceil(shown.length / per))
  useEffect(() => { if (!tv) return undefined; const t = setInterval(() => setPage((p) => (p + 1) % pages), 15000); return () => clearInterval(t) }, [tv, pages])
  useEffect(() => { setPage(0) }, [cust, view, team, q, tv])
  const exitTv = () => { if (tvProp) nav('/production'); else setTv(false); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}) }
  const goTv = () => { setTv(true); document.documentElement.requestFullscreen?.().catch(() => {}) }

  if (phone && !tv) return <div className="-m-4"><ScanView full /></div>

  const picked = enriched.filter((r) => sel[r.id])
  const list = tv ? shown.slice(page * per, page * per + per) : shown
  const COLS = tv ? 9 : 10

  const table = (
    <>
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">생산관리 데이터를 못 불러왔습니다 — {error.message}</div>}
      {data && !data.scanSetup && !tv && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-pb-noscan>
          공정 스캔 기록 표가 아직 없습니다 — Supabase 에서 「공정스캔_반영_261109.sql」을 실행하면 제조 · 검수 QR 이 기록됩니다. 지금은 생산관리 체크칸만 보여 줍니다.
        </div>
      )}
      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        <table className={`w-full ${tv ? 'text-[17px]' : 'text-[13px]'}`} data-pb-table>
          <thead className="bg-[#f7f8fb] text-slate-500 border-b-2 border-slate-200">
            <tr>
              {!tv && <th className="w-8 px-2"><input type="checkbox" aria-label="전체 선택" checked={shown.length > 0 && shown.every((r) => sel[r.id])}
                onChange={(e) => setSel(e.target.checked ? Object.fromEntries(shown.map((r) => [r.id, true])) : {})} /></th>}
              <th className="px-2 py-2 text-left">고객사</th>
              <th className="px-2 py-2 text-left">품번 · 품명</th>
              <th className="px-2 py-2">호기</th>
              <th className="px-2 py-2 text-left">PO</th>
              <th className="px-2 py-2">Rev</th>
              <th className="px-2 py-2">납기</th>
              <th className="px-2 py-2 text-left">미불출</th>
              <th className="px-2 py-2 text-left">진행 <span className="font-normal text-slate-400">불출 → 제조 → 검수 → 납품대기</span></th>
              <th className="px-2 py-2">지금 팀</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonRows cols={COLS} rows={8} first={1} two={[2]} />}
            {!isLoading && !list.length && <tr><td colSpan={COLS} className="py-10 text-center text-slate-400">조건에 맞는 호기가 없습니다</td></tr>}
            {list.map((r) => <BoardRow key={r.id} r={r} tv={tv} sel={!!sel[r.id]} onSel={(v) => setSel((o) => ({ ...o, [r.id]: v }))}
              open={open === r.id} onOpen={() => setOpen(open === r.id ? null : r.id)} cols={COLS} />)}
          </tbody>
        </table>
      </div>
    </>
  )

  if (tv) {
    return (
      <div className="fixed inset-0 z-50 overflow-auto bg-[#f7f8fb] p-5 space-y-4" data-pb-tv>
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-[30px] font-extrabold text-slate-900" data-pb-tvtitle>🏭 {cust === 'ALL' ? '공정 현황판' : `${CUST_NAME[cust]} 공정 현황`}</span>
          <div className="flex gap-2">
            {[['ALL', '전체'], ...CUSTS.map((c) => [c, CUST_NAME[c]])].map(([k, l]) => (
              <button key={k} onClick={() => setCust(k)} data-pb-tvcust={k} className={`px-4 py-1.5 rounded-full text-[17px] font-bold border ${cust === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}>{l}</button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-5 text-[18px]" data-pb-tvhead>
            <span className="text-red-600 font-extrabold">지연 {kpi.late}</span>
            <span className="text-amber-600 font-extrabold">7일 안 {kpi.week}</span>
            {STAGES.map((s) => <span key={s.k} className="font-extrabold text-slate-700">{s.l} {teamCnt[s.k]}</span>)}
            <span className="text-slate-500 tabular-nums">{pages > 1 ? `${page + 1} / ${pages} 쪽 · ` : ''}{kstDT(new Date(dataUpdatedAt || Date.now())).slice(11)} 기준</span>
            <button onClick={exitTv} className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-[15px] font-bold text-slate-600" data-pb-exit>✕ 나가기</button>
          </div>
        </div>
        {table}
      </div>
    )
  }

  return (
    <div className="space-y-4" data-process-board>
      {printing && <WorkOrderPrinter rows={printing} onDone={() => setPrinting(null)} />}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold text-slate-400">🏭 현장</p>
          <h1 className="text-xl font-extrabold text-slate-900">공정 현황판</h1>
          <p className="text-[13px] text-slate-400 mt-0.5 break-keep">
            진행 중인 호기가 불출(구매팀) → 제조(전장팀) → 검수(품질팀) → 납품대기(영업팀) 중 어디까지 왔는지 봅니다.
            불출은 생산관리 체크(가공물 입고 · 파트 불출), 제조 · 검수는 현장에서 작업지시서 QR 을 폰으로 찍으면 켜집니다. ⛶ 전체화면은 현장 TV 용입니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setScanOpen(true)} className="h-[38px] px-3 rounded-[9px] border border-slate-200 bg-white text-[13px] font-bold text-slate-700 hover:bg-slate-50" data-pb-scan>📷 스캔</button>
          <button onClick={() => picked.length && setPrinting(picked.map((r) => ({ ...r, req_date: r._due || r.req_date, _title: r.customer_code === 'AX' && isMainRow(r.pn, 'AX') && !isTpRow(r) ? 'PD 작업지시서' : `${CUST_NAME[r.customer_code] || ''} 작업지시서`.trim() })))} disabled={!picked.length} data-pb-print
            className="h-[38px] px-3 rounded-[9px] border border-slate-200 bg-white text-[13px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40">🖨 작업지시서 {picked.length ? `(${picked.length})` : ''}</button>
          <button onClick={goTv} className="h-[38px] px-4 rounded-[9px] bg-[#6c5ce7] text-white text-[13px] font-bold hover:opacity-90" data-pb-tvbtn>⛶ 전체화면 (TV)</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3" data-pb-kpi>
        <Kpi l="진행 호기" v={kpi.all} n="완료(납품) 전 전체" />
        <Kpi l="납기 지연" v={kpi.late} n="납기가 지났는데 납품 전" tone={kpi.late ? 'red' : 'green'} onClick={() => { setTab('flow'); setView('late') }} />
        <Kpi l="7일 안 납기" v={kpi.week} n="오늘 ~ 7일" tone="amber" onClick={() => { setTab('flow'); setView('week') }} />
        <Kpi l="오늘 스캔" v={kpi.scans} n="현장에서 찍은 제조 · 검수" tone="blue" />
        <Kpi l="미불출 있음" v={kpi.missing} n="누르면 미불출 목록" tone={kpi.missing ? 'red' : 'green'} onClick={() => setTab('miss')} />
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {[['flow', '🏭 공정 현황'], ['miss', `⚠ 미불출 목록 ${kpi.missing ? `(${kpi.missing})` : ''}`]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} data-pb-tab={k}
            className={`px-4 py-2 -mb-px text-[13px] font-bold border-b-2 ${tab === k ? 'border-[#6c5ce7] text-[#6c5ce7]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{l}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {[['ALL', '전체', enriched.length], ...CUSTS.map((c) => [c, CUST_NAME[c], cnt[c]])].map(([k, l, n]) => (
            <button key={k} onClick={() => setCust(k)} data-pb-cust={k}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border ${cust === k ? 'bg-white border-slate-800 text-slate-900' : 'bg-white border-slate-200 text-slate-500'}`}>{l} <span className="text-slate-400">{n}</span></button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="품번 · 품명 · 호기 · PO · 파트 검색" data-pb-q
          className="flex-1 min-w-[200px] px-3 py-2 text-sm rounded-[10px] border border-slate-200" />
      </div>
      {tab === 'flow' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500">지금 팀</span>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {[['ALL', '전체', inCust.length], ...STAGES.map((s) => [s.k, `${s.l} · ${s.team}`, teamCnt[s.k]])].map(([k, l, n]) => (
              <button key={k} onClick={() => setTeam(k)} data-pb-team={k}
                className={`px-2.5 py-1 text-xs font-bold rounded-md ${team === k ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>{l} <span className={team === k ? 'text-slate-300' : 'text-slate-400'}>{n}</span></button>
            ))}
          </div>
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {[['all', '납기 전체'], ['late', '지연'], ['week', '7일 안']].map(([k, l]) => (
              <button key={k} onClick={() => setView(k)} data-pb-view={k}
                className={`px-2.5 py-1 text-xs font-bold rounded-md ${view === k ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>{l}</button>
            ))}
          </div>
          <span className="text-xs text-slate-400">{shown.length}대</span>
          <span className="ml-auto flex items-center gap-3 text-[11.5px] text-slate-500">
            {[['#2f6fe4', '#2f6fe4', '끝'], ['#dbe7fd', '#9dbcf5', '일부'], ['#fbbf24', '#f59e0b', '제조 중'], ['#fff', '#1e293b', '지금 차례']].map(([bg, bd, l]) => (
              <span key={l} className="inline-flex items-center gap-1"><span style={{ background: bg, border: `${bd === '#1e293b' ? 2 : 1}px solid ${bd}` }} className="inline-block w-3.5 h-3.5 rounded" />{l}</span>
            ))}
          </span>
        </div>
      )}

      {tab === 'flow' ? table : <MissingList rows={enriched} cust={cust} q={q} />}

      {scanOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setScanOpen(false)}>
          <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <ScanView onClose={() => setScanOpen(false)} />
          </div>
        </div>
      )}
    </div>
  )
}

function Kpi({ l, v, n, tone, onClick }) {
  const t = { red: 'bg-[#fdeef0] border-[#f7d4d9] text-[#e0505f]', green: 'bg-[#eafaf1] border-[#c7ecd8] text-[#12a05f]', amber: 'bg-[#fef8e7] border-[#f5e6b8] text-[#d99400]',
    blue: 'bg-[#eef4ff] border-[#d5e2fb] text-[#3b82f6]' }[tone] || 'bg-white border-slate-200 text-slate-800'
  return (
    <div onClick={onClick} className={`rounded-xl border px-4 py-3 ${t} ${onClick ? 'cursor-pointer hover:shadow-sm' : ''}`} data-pb-kpi-card={l}>
      <div className="text-[13px] text-slate-500">{l}</div>
      <div className="text-[28px] font-extrabold leading-tight">{Number(v || 0).toLocaleString()}</div>
      <div className="text-[11px] text-slate-400">{n}</div>
    </div>
  )
}

const who = (e) => (e ? `${kstDT(e.at).slice(5)}${e.by_name ? ` · ${e.by_name}` : ''}` : '')

// 진행 막대 한 칸 — 색은 style 로 (현장 TV 에서도 그대로)
function Seg({ k, l, state, sub, tip, tv }) {
  const sty = state === 'done' ? { background: '#2f6fe4', color: '#fff', borderColor: '#2f6fe4' }
    : state === 'part' ? { background: '#dbe7fd', color: '#1d4ed8', borderColor: '#9dbcf5' }
    : state === 'doing' ? { background: '#fbbf24', color: '#451a03', borderColor: '#f59e0b' }
    : state === 'cur' ? { background: '#fff', color: '#0f172a', borderColor: '#1e293b', borderWidth: 2 }
    : { background: '#f1f5f9', color: '#94a3b8', borderColor: '#e2e8f0' }
  return (
    <span title={tip} data-seg={k} data-state={state} style={{ ...sty, height: tv ? 40 : 32, fontSize: tv ? 15 : 12 }}
      className="flex-1 min-w-0 inline-flex flex-col items-center justify-center rounded-md border font-bold leading-tight whitespace-nowrap px-1">
      <span>{state === 'doing' ? `▶ ${l}` : l}</span>
      {sub && <span style={{ fontSize: tv ? 11 : 9.5, fontWeight: 600, opacity: 0.85 }}>{sub}</span>}
    </span>
  )
}

function Bar({ p, tv }) {
  const { mat, make, qc, cur } = p
  const matTip = `불출 (구매팀) — ${mat.parts.map((x) => `${x.l} ${x.done ? '✓' : '대기'}`).join(' · ')}`
  return (
    <div className="flex gap-[3px]" style={{ minWidth: tv ? 440 : 340 }} data-pb-bar>
      <Seg k="mat" l="불출" tv={tv} tip={matTip}
        state={mat.done ? 'done' : mat.n > 0 ? 'part' : cur === 'mat' ? 'cur' : 'todo'}
        sub={!mat.done && mat.n > 0 ? mat.parts.filter((x) => !x.done).map((x) => x.l.replace(' 불출', '').replace('가공물 입고', '가공물')).join('·') + ' 대기' : ''} />
      <Seg k="make" l="제조" tv={tv} tip={`제조 (전장팀)${make.startAt ? ` — 시작 ${who(make.startAt)}` : ''}${make.at ? ` · 완료 ${who(make.at)}` : make.done ? ' — 생산관리 체크' : ''}`}
        state={make.done ? 'done' : make.started ? 'doing' : cur === 'make' ? 'cur' : 'todo'} sub={make.started ? `${kstDT(make.startAt.at).slice(5, 10).replace('-', '/')}~` : ''} />
      <Seg k="qc" l="검수" tv={tv} tip={`검수 (품질팀)${qc.at ? ` — ${who(qc.at)}` : qc.done ? ' — 생산관리 체크 · 검수 합격' : ''}`}
        state={qc.done ? 'done' : cur === 'qc' ? 'cur' : 'todo'} />
      <Seg k="wait" l="납품대기" tv={tv} tip="납품대기 (영업팀) — 수주대장에서 납품 처리하면 현황판에서 빠집니다"
        state={cur === 'wait' ? 'cur' : 'todo'} />
    </div>
  )
}

function BoardRow({ r, tv, sel, onSel, open, onOpen, cols }) {
  const p = r._p
  const rv = revInfo(r)
  const ms = missingOf(r)
  const st = STAGES.find((s) => s.k === p.cur)
  const hist = p.list.slice().reverse()
  return (
    <>
      <tr className={`border-b border-slate-100 align-middle ${open ? 'bg-indigo-50/40' : 'hover:bg-slate-50/70'} ${tv ? 'h-[58px]' : 'h-[50px]'}`} data-pb-row={r.id} data-cur={p.cur}>
        {!tv && <td className="px-2 text-center"><input type="checkbox" checked={sel} onChange={(e) => onSel(e.target.checked)} aria-label={`${r.pn} ${r.hogi} 선택`} /></td>}
        <td className="px-2"><span className={`px-2 py-[1px] rounded-full border text-[11px] font-bold ${CUST_TONE[r.customer_code] || 'bg-slate-50 text-slate-500 border-slate-200'}`}>{CUST_NAME[r.customer_code] || r.customer_code}</span></td>
        <td className="px-2 cursor-pointer" onClick={onOpen}>
          <div className={`font-mono font-bold ${tv ? 'text-[18px]' : ''} text-[#5b6ee8]`}>{String(r.pn || '').replace(/^AX-/, '')}{r.part ? <span className="ml-1 text-slate-500 font-sans text-[11px]">{r.part}</span> : null}</div>
          <div className={`${tv ? 'text-[13px]' : 'text-[11.5px]'} text-slate-400 truncate max-w-[300px]`} title={r.name}>{r.name}{r.company && !/axcelis|edwards/i.test(r.company) && r.customer_code === 'AX' ? ` · ${r.company}` : ''}</div>
        </td>
        <td className={`px-2 text-center font-extrabold ${tv ? 'text-[20px]' : 'text-[14px]'} text-indigo-700`}>{r.hogi}</td>
        <td className="px-2 font-mono text-slate-600 whitespace-nowrap">{r._po || '—'}</td>
        <td className={`px-2 text-center font-bold whitespace-nowrap ${rv.diff ? 'text-red-600' : 'text-slate-600'}`} title={rv.diff ? `SREV ${rv.s} ≠ BREV ${rv.b}` : ''}>{rv.s || rv.b || '—'}{rv.diff ? ` / ${rv.b}` : ''}</td>
        <td className="px-2 text-center whitespace-nowrap">
          <div className={`font-bold tabular-nums ${ddTone(r._dd)}`}>{r._due ? r._due.slice(5).replace('-', '/') : '미정'}</div>
          <div className={`text-[10.5px] font-bold ${ddTone(r._dd)}`}>{ddText(r._dd)}</div>
        </td>
        <td className="px-2 text-[11.5px] max-w-[170px]">
          {ms.length ? <span className="font-bold text-red-600" title={ms.map((m) => `${m.pn || ''} ${m.name || ''} ${m.qty || ''}`).join('\n')}>⚠ {ms.length}건 <span className="font-normal text-red-500">{ms[0].pn || ms[0].name}{ms.length > 1 ? ' 외' : ''}</span></span> : <span className="text-slate-300">—</span>}
        </td>
        <td className="px-2"><Bar p={p} tv={tv} /></td>
        <td className="px-2 text-center"><span className={`px-2 py-[2px] rounded-full font-bold whitespace-nowrap ${tv ? 'text-[15px]' : 'text-[11.5px]'} ${TEAM_TONE[p.cur]}`} data-pb-team-of={p.cur}>{st?.team}</span></td>
      </tr>
      {open && !tv && (
        <tr className="bg-indigo-50/40 border-b border-slate-100">
          <td colSpan={cols} className="px-4 py-3">
            <div className="grid md:grid-cols-3 gap-4 text-[12px]" data-pb-detail>
              <div>
                <div className="font-bold text-slate-600 mb-1">공정 기록</div>
                {p.mat.parts.map((x) => (
                  <div key={x.k} className="flex gap-2 py-0.5"><span className={`w-28 ${x.done ? 'text-blue-700 font-bold' : 'text-slate-400'}`}>불출 · {x.l}</span><span className="text-slate-500">{x.done ? '생산관리 체크' : '대기'}</span></div>
                ))}
                <div className="flex gap-2 py-0.5"><span className={`w-24 ${p.make.startAt ? 'text-blue-700 font-bold' : 'text-slate-400'}`}>제조 시작</span><span className="text-slate-500">{who(p.make.startAt)}</span></div>
                <div className="flex gap-2 py-0.5"><span className={`w-24 ${p.make.done ? 'text-blue-700 font-bold' : 'text-slate-400'}`}>제조 완료</span><span className="text-slate-500">{p.make.at ? who(p.make.at) : p.make.done ? '생산관리 체크' : ''}</span></div>
                <div className="flex gap-2 py-0.5"><span className={`w-24 ${p.qc.done ? 'text-blue-700 font-bold' : 'text-slate-400'}`}>검수 완료</span><span className="text-slate-500">{p.qc.at ? who(p.qc.at) : p.qc.done ? '생산관리 체크 · 검수 합격' : ''}</span></div>
              </div>
              <div>
                <div className="font-bold text-slate-600 mb-1">미불출 파트</div>
                {ms.length ? ms.map((m, i) => <div key={i} className="py-0.5 text-red-700">{m.pn} {m.name} · {m.qty} · {m.date || '입고 미정'}</div>) : <div className="text-slate-400">없음</div>}
                {r.memo && <div className="mt-2 text-slate-600"><b>메모</b> {r.memo}</div>}
              </div>
              <div>
                <div className="font-bold text-slate-600 mb-1">스캔 이력 (최근)</div>
                {hist.length ? hist.slice(0, 8).map((e) => (
                  <div key={e.id} className="py-0.5 text-slate-600">{kstDT(e.at).slice(5)} · {e.step === 'make' ? '제조' : e.step === 'qc' ? '검수' : e.step} {e.kind === 'start' ? '시작' : '완료'} · {e.by_name || ''}</div>
                )) : <div className="text-slate-400">아직 찍은 기록 없음</div>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// /board — 포털 틀 없이 TV 화면 그대로 (/board?c=AX · ED · CSK · VM 으로 고객사 고정)
export function BoardPage() {
  return <ProcessBoard tv />
}
