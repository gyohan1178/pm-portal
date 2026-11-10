import { SkeletonRows } from '../../components/ux/Skeleton'
import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { todayISO, kstDT, kst } from '../../lib/utils'
import { revInfo, missingOf } from '../../lib/prodFlow'
import { qcIndex } from '../../lib/prodAuto'
import { progressOf, scanIndex, STAGES, CUST_NAME } from '../../lib/prodSteps'
import { useBoardData, dday, ddText, hogiNo, isPhone } from '../../lib/prodBoard'
import { isMainRow } from './mainPns'
import { isTpRow } from '../../lib/thirdParty'
import { WorkOrderPrinter } from '../../components/WorkOrderPrint'
import ScanView from './ScanView'
import MissingList from './MissingList'

// 🏭 공정 현황판 (v4.165.0) — 생산 대시보드 · 생산 전광판 · QR 공정 데모를 하나로
//   위 띠 = 4단계 ①불출(구매팀) → ②제조(전장팀) → ③검수(품질팀) → ④납품대기(영업팀) · 몇 대 · 지연 — 누르면 그 팀 차례만
//   아래 = 한 줄 호기 · 납기(지연 빨강 띠 · 7일 안 노랑 띠) · 지금 상태 한 줄 · 단계 점 4개 · 미불출 · 차례
//   · 불출은 생산관리 체크(가공물 입고 + 파트 불출) · 제조 · 검수는 현장 폰 QR (lib/prodSteps.js)
//   · ⛶ TV = 어두운 바탕 큰 글씨 — 현장마다 /board?c=AX (ED · CSK · VM) 로 켜 두면 그 고객사만 · 30초마다 새로 · 12줄씩 넘김
//   · 📋 미불출 목록 — 생산관리에 적힌 미불출 파트를 한 표로 (MissingList)
//   · 폰으로 열면 스캔 화면만
//   ⚠ 모양은 아래 <BoardStyle> 의 pb- 클래스로 — 현장 TV(어두운 바탕)와 PC 를 한 벌로 맞추려고 Tailwind 대신 씀

const CUSTS = ['AX', 'ED', 'CSK', 'VM']
const custOk = (c) => (CUSTS.includes(String(c || '').toUpperCase()) ? String(c).toUpperCase() : 'ALL')
const md = (d) => (d ? String(d).slice(5, 10).replace('-', '/') : '')
const who = (e) => (e ? `${kstDT(e.at).slice(5).replace('-', '/')}${e.by_name ? ` · ${e.by_name}` : ''}` : '')
const urg = (dd) => (dd == null ? 'none' : dd < 0 ? 'late' : dd <= 7 ? 'soon' : 'ok')

// 지금 상태 한 줄 — { t, sub, tone }
function nowOf(p) {
  const wait = p.mat.parts.filter((x) => !x.done).map((x) => x.l)
  if (p.cur === 'wait') return { t: '납품대기', sub: p.qc.at ? `검수 완료 ${who(p.qc.at)}` : '검수 끝', tone: 'grn' }
  if (p.cur === 'qc') return { t: '검수 대기', sub: p.make.at ? `제조 완료 ${who(p.make.at)}` : '제조 끝 (생산관리 체크)' }
  if (p.make.started) return { t: '▶ 제조 중', sub: `${who(p.make.startAt)} 시작`, tone: 'amb' }
  if (p.cur === 'make') return { t: '제조 대기', sub: wait.length ? `불출 덜 됨 — ${wait.join(' · ')}` : '불출 끝' }
  if (p.mat.n > 0) return { t: '불출 일부', sub: `${p.mat.parts.filter((x) => x.done).map((x) => `${x.l} ✓`).join(' · ')} · ${wait.join(' · ')} 대기` }
  return { t: '불출 대기', sub: `${wait.join(' · ')} 대기` }
}

export default function ProcessBoard({ tv: tvProp }) {
  const nav = useNavigate()
  const [sp] = useSearchParams()
  const [tv, setTv] = useState(!!tvProp)
  const { data, isLoading, error, dataUpdatedAt } = useBoardData(tv)
  const [phone, setPhone] = useState(isPhone)
  useEffect(() => { const f = () => setPhone(isPhone()); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  const [cust, setCust] = useState(() => custOk(sp.get('c')))
  const [view, setView] = useState('all')      // all · late · week · miss
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
  const band = useMemo(() => Object.fromEntries(STAGES.map((s) => {
    const xs = inCust.filter((r) => r._p.cur === s.k)
    return [s.k, { n: xs.length, late: xs.filter((r) => r._dd != null && r._dd < 0).length, part: xs.filter((r) => !r._p.mat.done && r._p.mat.n > 0).length, doing: xs.filter((r) => r._p.make.started).length }]
  })), [inCust])
  const shown = useMemo(() => {
    const k = q.trim().toUpperCase()
    return inCust.filter((r) => (team === 'ALL' || r._p.cur === team)
      && (view === 'all' || (view === 'late' && r._dd != null && r._dd < 0) || (view === 'week' && r._dd != null && r._dd >= 0 && r._dd <= 7) || (view === 'miss' && missingOf(r).length))
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

  // ── TV : 한 화면에 들어가는 만큼씩 15초마다 넘김 · 시계
  const [page, setPage] = useState(0)
  const per = 12
  const pages = Math.max(1, Math.ceil(shown.length / per))
  useEffect(() => { if (!tv) return undefined; const t = setInterval(() => setPage((p) => (p + 1) % pages), 15000); return () => clearInterval(t) }, [tv, pages])
  useEffect(() => { setPage(0) }, [cust, view, team, q, tv])
  const [, tick] = useState(0)
  useEffect(() => { if (!tv) return undefined; const t = setInterval(() => tick((x) => x + 1), 20000); return () => clearInterval(t) }, [tv])
  const exitTv = () => { if (tvProp) nav('/production'); else setTv(false); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}) }
  const goTv = () => { setTv(true); document.documentElement.requestFullscreen?.().catch(() => {}) }

  if (phone && !tv) return <div className="-m-4"><ScanView full /></div>

  const picked = enriched.filter((r) => sel[r.id])
  const list = tv ? shown.slice(page * per, page * per + per) : shown
  const pickTeam = (k) => { setTab('flow'); setTeam(team === k ? 'ALL' : k) }

  const Band = (
    <div className="pb-band" data-pb-band>
      {STAGES.map((s, i) => {
        const b = band[s.k]
        const notes = s.k === 'mat' ? [b.late && ['red', `지연 ${b.late}`], b.part && ['', `일부 불출 ${b.part}`]]
          : s.k === 'make' ? [b.doing && ['amb', `진행 중 ${b.doing}`], b.n - b.doing > 0 && ['', `대기 ${b.n - b.doing}`], b.late && ['red', `지연 ${b.late}`]]
          : s.k === 'wait' ? [b.late && ['red', `납기 지남 ${b.late}`]]
          : [b.late && ['red', `지연 ${b.late}`]]
        const ns = notes.filter(Boolean)
        return (
          <button key={s.k} type="button" onClick={() => pickTeam(s.k)} className={`pb-st ${team === s.k ? 'on' : ''}`} data-pb-team={s.k} title={`${s.team} 차례인 호기만 보기`}>
            <div className="pb-st-k">{'①②③④'[i]} {s.l} · {s.team}</div>
            <div className="pb-st-n">{b.n}<small>대</small></div>
            <div className="pb-st-s">{ns.length ? ns.map(([c, t]) => <span key={t} className={c}>{t}</span>) : <span className="dim">—</span>}</div>
          </button>
        )
      })}
    </div>
  )

  const Table = (
    <div className="pb-list">
      <table data-pb-table>
        <thead>
          <tr>
            {!tv && <th className="pb-ck"><input type="checkbox" aria-label="전체 선택" checked={shown.length > 0 && shown.every((r) => sel[r.id])}
              onChange={(e) => setSel(e.target.checked ? Object.fromEntries(shown.map((r) => [r.id, true])) : {})} /></th>}
            <th className="pb-c-due">납기</th>
            <th>품번 · 호기</th>
            <th>지금 상태</th>
            <th className="pb-c-stp">불출 → 제조 → 검수 → 납품대기</th>
            <th>미불출</th>
            {!tv && <th className="pb-c-team">차례</th>}
          </tr>
        </thead>
        <tbody>
          {isLoading && <SkeletonRows cols={7} rows={6} />}
          {!isLoading && !list.length && <tr><td colSpan={7} className="pb-empty">조건에 맞는 호기가 없습니다</td></tr>}
          {list.map((r) => <Row key={r.id} r={r} tv={tv} sel={!!sel[r.id]} onSel={(v) => setSel((o) => ({ ...o, [r.id]: v }))}
            open={open === r.id} onOpen={() => setOpen(open === r.id ? null : r.id)} />)}
        </tbody>
      </table>
    </div>
  )

  if (tv) {
    return (
      <div className="pb pb-tv" data-pb-tv>
        <BoardStyle />
        <div className="pb-tv-head">
          <span className="pb-tv-title" data-pb-tvtitle>{cust === 'ALL' ? '공정 현황' : `${CUST_NAME[cust]} 공정 현황`}</span>
          <span className="pb-tv-sum" data-pb-tvhead>진행 {kpi.all}대 · <b className="red">지연 {kpi.late}</b> · 7일 안 {kpi.week} · 미불출 {kpi.missing}대</span>
          <span className="pb-tv-r">
            <span className="pb-tv-cust">
              {[['ALL', '전체'], ...CUSTS.map((c) => [c, CUST_NAME[c]])].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setCust(k)} data-pb-tvcust={k} className={cust === k ? 'on' : ''}>{l}</button>
              ))}
            </span>
            <span className="pb-tv-clk">{kstDT(new Date()).slice(11)}</span>
            <span className="pb-tv-u">{kstDT(new Date(dataUpdatedAt || Date.now())).slice(11)} 기준 · 30초마다 새로{pages > 1 ? ` · ${page + 1}/${pages}쪽` : ''}</span>
            <button type="button" onClick={exitTv} className="pb-tv-x" data-pb-exit>✕</button>
          </span>
        </div>
        {Band}
        {Table}
        <div className="pb-tv-foot"><Legend /><span>진선테크 PM Portal</span></div>
      </div>
    )
  }

  return (
    <div className="pb" data-process-board>
      <BoardStyle />
      {printing && <WorkOrderPrinter rows={printing} onDone={() => setPrinting(null)} />}
      <div className="pb-top">
        <div>
          <div className="pb-crumb">🏭 현장</div>
          <h1 className="pb-h1">공정 현황판</h1>
          <p className="pb-desc">진행 중인 호기가 어느 팀 차례인지 봅니다. 위 단계를 누르면 그 팀 차례인 호기만 보입니다. 불출은 생산관리 체크(가공물 입고 · 파트 불출), 제조 · 검수는 현장에서 작업지시서 QR 을 폰으로 찍으면 켜집니다.</p>
        </div>
        <div className="pb-top-r">
          <span className="pb-seg">
            {[['ALL', '전체', enriched.length], ...CUSTS.map((c) => [c, CUST_NAME[c], cnt[c]])].map(([k, l, n]) => (
              <button key={k} type="button" onClick={() => setCust(k)} data-pb-cust={k} className={cust === k ? 'on' : ''}>{l} <b>{n}</b></button>
            ))}
          </span>
          <button type="button" className="pb-btn" onClick={() => setScanOpen(true)} data-pb-scan>📷 스캔</button>
          <button type="button" className="pb-btn" disabled={!picked.length} data-pb-print
            onClick={() => picked.length && setPrinting(picked.map((r) => ({ ...r, req_date: r._due || r.req_date, _title: r.customer_code === 'AX' && isMainRow(r.pn, 'AX') && !isTpRow(r) ? 'PD 작업지시서' : `${CUST_NAME[r.customer_code] || ''} 작업지시서`.trim() })))}>🖨 작업지시서{picked.length ? ` (${picked.length})` : ''}</button>
          <button type="button" className="pb-btn pr" onClick={goTv} data-pb-tvbtn>⛶ TV</button>
        </div>
      </div>

      {Band}

      <div className="pb-tools">
        {team !== 'ALL' && tab === 'flow' && <button type="button" className="pb-chip on" onClick={() => setTeam('ALL')} data-pb-teamchip>{STAGES.find((s) => s.k === team)?.l} · {STAGES.find((s) => s.k === team)?.team} 차례 {shown.length}대 ✕</button>}
        {tab === 'flow' && <>
          <button type="button" className={`pb-chip red ${view === 'miss' ? 'on' : ''}`} onClick={() => setView(view === 'miss' ? 'all' : 'miss')} data-pb-view="miss">⚠ 미불출 {kpi.missing}대</button>
          <button type="button" className={`pb-chip ${view === 'late' ? 'on' : ''}`} onClick={() => setView(view === 'late' ? 'all' : 'late')} data-pb-view="late">지연 {kpi.late}</button>
          <button type="button" className={`pb-chip ${view === 'week' ? 'on' : ''}`} onClick={() => setView(view === 'week' ? 'all' : 'week')} data-pb-view="week">7일 안 {kpi.week}</button>
        </>}
        <input className="pb-srch" value={q} onChange={(e) => setQ(e.target.value)} placeholder="품번 · 품명 · 호기 · PO · 파트 검색" data-pb-q />
        <span className="pb-meta" data-pb-kpi>진행 {kpi.all}대 · 오늘 스캔 {kpi.scans}</span>
        {tab === 'flow'
          ? <button type="button" className="pb-chip" onClick={() => setTab('miss')} data-pb-tab="miss">📋 미불출 목록</button>
          : <button type="button" className="pb-chip on" onClick={() => setTab('flow')} data-pb-tab="flow">← 공정 현황</button>}
      </div>

      {error && <div className="pb-warn red">생산관리 데이터를 못 불러왔습니다 — {error.message}</div>}
      {data && !data.scanSetup && (
        <div className="pb-warn" data-pb-noscan>공정 스캔 기록 표가 아직 없습니다 — Supabase 에서 「공정스캔_반영_261109.sql」을 실행하면 제조 · 검수 QR 이 기록됩니다. 지금은 생산관리 체크칸만 보여 줍니다.</div>
      )}

      {tab === 'flow' ? <>{Table}<div className="pb-foot"><Legend /></div></> : <MissingList rows={enriched} cust={cust} q={q} />}

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

function Legend() {
  return (
    <span className="pb-leg">
      <span><i className="pb-dot done" />끝</span><span><i className="pb-dot cur" />지금 차례</span>
      <span><i className="pb-dot doing" />제조 중 (QR 시작)</span><span><i className="pb-dot part" />일부</span>
    </span>
  )
}

// 단계 점 4개
function Stepper({ p }) {
  const st = {
    mat: p.mat.done ? 'done' : p.mat.n > 0 ? 'part' : p.cur === 'mat' ? 'cur' : 'todo',
    make: p.make.done ? 'done' : p.make.started ? 'doing' : p.cur === 'make' ? 'cur' : 'todo',
    qc: p.qc.done ? 'done' : p.cur === 'qc' ? 'cur' : 'todo',
    wait: p.cur === 'wait' ? 'cur' : 'todo',
  }
  const tip = {
    mat: `불출 (구매팀) — ${p.mat.parts.map((x) => `${x.l} ${x.done ? '✓' : '대기'}`).join(' · ')}`,
    make: `제조 (전장팀)${p.make.startAt ? ` — 시작 ${who(p.make.startAt)}` : ''}${p.make.at ? ` · 완료 ${who(p.make.at)}` : p.make.done ? ' — 생산관리 체크' : ''}`,
    qc: `검수 (품질팀)${p.qc.at ? ` — ${who(p.qc.at)}` : p.qc.done ? ' — 생산관리 체크 · 검수 합격' : ''}`,
    wait: '납품대기 (영업팀) — 수주대장에서 납품 처리하면 현황판에서 빠집니다',
  }
  return (
    <div className="pb-stp" data-pb-bar>
      <div className="pb-stp-line">
        {STAGES.map((s, i) => (
          <span key={s.k} className="pb-stp-cell">
            {i > 0 && <i className={`pb-ln ${st[s.k] === 'done' || st[s.k] === 'cur' || st[s.k] === 'doing' ? (st[STAGES[i - 1].k] === 'done' ? 'done' : '') : ''}`} />}
            <i className={`pb-dot ${st[s.k]}`} title={tip[s.k]} data-seg={s.k} data-state={st[s.k]} />
          </span>
        ))}
      </div>
      <div className="pb-stp-lb">{STAGES.map((s) => <span key={s.k} className={p.cur === s.k ? 'on' : ''}>{s.k === 'wait' ? '납품' : s.l}</span>)}</div>
    </div>
  )
}

const TEAM_CLS = { mat: 't1', make: 't2', qc: 't3', wait: 't4' }

function Row({ r, tv, sel, onSel, open, onOpen }) {
  const p = r._p
  const rv = revInfo(r)
  const ms = missingOf(r)
  const now = nowOf(p)
  const u = urg(r._dd)
  const hist = p.list.slice().reverse()
  const st = STAGES.find((s) => s.k === p.cur)
  return (
    <>
      <tr className={`pb-row ${u} ${open ? 'open' : ''}`} data-pb-row={r.id} data-cur={p.cur}>
        {!tv && <td className="pb-ck"><input type="checkbox" checked={sel} onChange={(e) => onSel(e.target.checked)} aria-label={`${r.pn} ${r.hogi} 선택`} /></td>}
        <td className="pb-c-due"><div className={`pb-dd ${u}`}><b>{r._due ? md(r._due) : '미정'}</b>{r._dd != null && <span>{ddText(r._dd)}</span>}</div></td>
        <td className="pb-c-pn" onClick={onOpen}>
          <div><span className="pb-pn">{String(r.pn || '').replace(/^AX-/, '')}</span><span className="pb-hg">{r.hogi}</span>{r.part ? <span className="pb-part">{r.part}</span> : null}</div>
          <div className="pb-nm"><span className="pb-cs">{r.customer_code === 'ED' ? 'ED' : r.customer_code}</span>{r.name}{r._po ? ` · ${r._po}` : ''}{rv.diff ? <b className="red"> · Rev {rv.b}→{rv.s}</b> : ''}</div>
        </td>
        <td><div className={`pb-now ${now.tone || ''}`}>{now.t}<small>{now.sub}</small></div></td>
        <td className="pb-c-stp"><Stepper p={p} /></td>
        <td>{ms.length ? <span className="pb-ms" title={ms.map((m) => `${m.pn || ''} ${m.name || ''} ${m.qty || ''}`).join('\n')}>⚠ {ms.length}건 · {ms[0].pn || ms[0].name}{ms.length > 1 ? ' 외' : ''}</span> : <span className="pb-no">—</span>}</td>
        {!tv && <td className="pb-c-team"><span className={`pb-team ${TEAM_CLS[p.cur]}`} data-pb-team-of={p.cur}>{st?.team}</span></td>}
      </tr>
      {open && !tv && (
        <tr className="pb-detail-row">
          <td colSpan={7}>
            <div className="pb-detail" data-pb-detail>
              <div>
                <h4>공정 기록</h4>
                {p.mat.parts.map((x) => <div key={x.k}><span className={x.done ? 'k on' : 'k'}>불출 · {x.l}</span>{x.done ? '생산관리 체크' : '대기'}</div>)}
                <div><span className={p.make.startAt ? 'k on' : 'k'}>제조 시작</span>{who(p.make.startAt)}</div>
                <div><span className={p.make.done ? 'k on' : 'k'}>제조 완료</span>{p.make.at ? who(p.make.at) : p.make.done ? '생산관리 체크' : ''}</div>
                <div><span className={p.qc.done ? 'k on' : 'k'}>검수 완료</span>{p.qc.at ? who(p.qc.at) : p.qc.done ? '생산관리 체크 · 검수 합격' : ''}</div>
              </div>
              <div>
                <h4>미불출 파트</h4>
                {ms.length ? ms.map((m, i) => <div key={i} className="red">{m.pn} {m.name} · {m.qty} · {m.date || '입고 미정'}</div>) : <div className="dim">없음</div>}
                {r.memo && <div className="memo"><b>메모</b> {r.memo}</div>}
                <div className="dim" style={{ marginTop: 6 }}>Rev {rv.s || rv.b || '—'}{rv.diff ? ` (BREV ${rv.b})` : ''} · 상태 {r.status || 'PO접수'}</div>
              </div>
              <div>
                <h4>스캔 이력 (최근)</h4>
                {hist.length ? hist.slice(0, 8).map((e) => (
                  <div key={e.id}>{kstDT(e.at).slice(5).replace('-', '/')} · {e.step === 'make' ? '제조' : e.step === 'qc' ? '검수' : e.step} {e.kind === 'start' ? '시작' : '완료'} · {e.by_name || ''}</div>
                )) : <div className="dim">아직 찍은 기록 없음</div>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// 모양 — PC(밝은 바탕 · PM Portal 톤) / 현장 TV(.pb-tv 어두운 바탕 큰 글씨)
function BoardStyle() {
  return (
    <style>{`
.pb{--bg:#f7f8fb;--card:#fff;--bd:#e8eaf0;--bd2:#f0f2f6;--tx:#1f2430;--tx2:#4a5162;--tx3:#98a0b0;--pr:#6c5ce7;--prd:#eeebfd;--link:#5b6ee8;
  --red:#e0505f;--redbg:#fdeef0;--amb:#d99400;--ambbg:#fef8e7;--grn:#12a05f;--grnbg:#eafaf1;--blu:#3b82f6;--blubg:#eef4ff;--dot:#e4e7ee;--hl:#fff;color:var(--tx)}
.pb .red{color:var(--red)}.pb .amb{color:var(--amb)}.pb .grn{color:var(--grn)}.pb .dim{color:var(--tx3)}
.pb-top{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px;margin-bottom:16px}
.pb-crumb{font-size:11px;font-weight:700;color:var(--tx3)}.pb-h1{margin:2px 0 4px;font-size:22px;font-weight:800}.pb-desc{font-size:13px;color:var(--tx3);max-width:760px;word-break:keep-all}
.pb-top-r{margin-left:auto;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.pb-seg{display:inline-flex;background:#eef0f5;border-radius:10px;padding:3px}
.pb-seg button{padding:6px 12px;border-radius:8px;font-size:13px;font-weight:700;color:var(--tx3)}.pb-seg button b{font-weight:700;opacity:.7;margin-left:2px}
.pb-seg button.on{background:#fff;color:var(--tx);box-shadow:0 1px 2px rgba(0,0,0,.06)}
.pb-btn{height:38px;padding:0 14px;border-radius:9px;border:1px solid var(--bd);background:#fff;font-size:13px;font-weight:700;color:var(--tx2)}
.pb-btn:disabled{opacity:.45}.pb-btn.pr{background:var(--pr);border-color:var(--pr);color:#fff}
.pb-band{display:grid;grid-template-columns:repeat(4,1fr);margin:0 0 14px}
.pb-st{position:relative;text-align:left;background:var(--card);border:1px solid var(--bd);padding:14px 18px 14px 34px;cursor:pointer;transition:background .15s}
.pb-st:first-child{border-radius:14px 0 0 14px;padding-left:20px}.pb-st:last-child{border-radius:0 14px 14px 0}
.pb-st:not(:last-child)::after{content:'';position:absolute;right:-13px;top:50%;width:24px;height:24px;background:inherit;border-top:1px solid var(--bd);border-right:1px solid var(--bd);transform:translateY(-50%) rotate(45deg);z-index:2}
.pb-st:hover{background:#fafaff}.pb-st.on{background:var(--prd);border-color:#d7d1fb}.pb-st.on::after{border-color:#d7d1fb}
.pb-st-k{font-size:12px;font-weight:700;color:var(--tx3)}.pb-st.on .pb-st-k{color:var(--pr)}
.pb-st-n{font-size:30px;font-weight:800;line-height:1.15}.pb-st-n small{font-size:14px;font-weight:700;color:var(--tx3);margin-left:2px}
.pb-st-s{display:flex;gap:8px;font-size:12px;color:var(--tx2);margin-top:2px;min-height:18px}.pb-st-s .red,.pb-st-s .amb{font-weight:700}
.pb-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px}
.pb-chip{padding:6px 12px;border-radius:20px;font-size:12px;font-weight:700;border:1px solid var(--bd);background:#fff;color:var(--tx2)}
.pb-chip.on{border-color:var(--tx);color:var(--tx)}.pb-chip.red{background:var(--redbg);border-color:#f7d4d9;color:var(--red)}.pb-chip.red.on{border-color:var(--red)}
.pb-srch{flex:1;min-width:200px;height:36px;border:1px solid var(--bd);border-radius:10px;background:#fff;padding:0 12px;font-size:13px}
.pb-srch:focus{outline:2px solid var(--pr);outline-offset:-1px}
.pb-meta{font-size:12px;color:var(--tx3)}
.pb-warn{border:1px solid #f5e6b8;background:var(--ambbg);color:#8a6100;border-radius:10px;padding:8px 12px;font-size:12px;margin-bottom:10px}.pb-warn.red{border-color:#f7d4d9;background:var(--redbg);color:var(--red)}
.pb-list{background:var(--card);border:1px solid var(--bd);border-radius:14px;overflow-x:auto}
.pb-list table{width:100%;border-collapse:collapse;font-size:13px}
.pb-list th{height:40px;background:#f7f8fb;border-bottom:2px solid var(--bd);font-size:12px;font-weight:700;color:var(--tx2);text-align:left;padding:0 12px;white-space:nowrap}
.pb-list td{padding:0 12px;border-bottom:1px solid var(--bd2);vertical-align:middle}
.pb-row{height:66px}.pb-row:hover{background:#fbfbfe}.pb-row.open{background:#f6f4ff}
.pb-row td:first-child{box-shadow:inset 4px 0 0 transparent}.pb-row.late td:first-child{box-shadow:inset 4px 0 0 var(--red)}.pb-row.soon td:first-child{box-shadow:inset 4px 0 0 #f5c04a}
.pb-ck{width:36px;text-align:center}
.pb-c-due{width:84px}.pb-dd{display:flex;flex-direction:column;align-items:flex-start}.pb-dd b{font-size:15px;font-variant-numeric:tabular-nums;color:var(--tx2)}
.pb-dd span{font-size:11px;font-weight:800;padding:1px 7px;border-radius:20px;margin-top:2px;background:#f1f3f7;color:var(--tx3)}
.pb-dd.late b{color:var(--red)}.pb-dd.late span{background:var(--redbg);color:var(--red)}.pb-dd.soon b{color:var(--amb)}.pb-dd.soon span{background:var(--ambbg);color:var(--amb)}
.pb-c-pn{cursor:pointer;min-width:220px}.pb-pn{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:var(--link);font-size:14px}
.pb-hg{font-weight:800;font-size:15px;margin-left:6px}.pb-part{margin-left:6px;font-size:11px;color:var(--tx3)}
.pb-nm{font-size:11.5px;color:var(--tx3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px}
.pb-cs{font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:20px;background:var(--blubg);color:var(--blu);margin-right:6px}
.pb-now{font-size:13px;font-weight:700;min-width:170px}.pb-now small{display:block;font-size:11.5px;color:var(--tx3);font-weight:500;margin-top:1px;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pb-c-stp{width:300px}.pb-stp{width:280px}
.pb-stp-line{display:flex;align-items:center}.pb-stp-cell{display:flex;align-items:center;flex:1}.pb-stp-cell:first-child{flex:0 0 auto}
.pb-ln{height:3px;flex:1;background:var(--dot);display:block}.pb-ln.done{background:var(--pr)}
.pb-dot{width:14px;height:14px;border-radius:50%;background:var(--dot);flex:none;display:inline-block;box-sizing:border-box}
.pb-dot.done{background:var(--pr)}.pb-dot.cur{background:var(--hl);border:3px solid var(--pr);box-shadow:0 0 0 4px var(--prd)}
.pb-dot.doing{background:var(--hl);border:3px solid #f59e0b;box-shadow:0 0 0 4px #fef3c7}.pb-dot.part{background:linear-gradient(90deg,var(--pr) 50%,var(--dot) 50%)}
.pb-stp-lb{display:flex;justify-content:space-between;font-size:10.5px;color:var(--tx3);margin-top:5px}.pb-stp-lb span.on{color:var(--tx);font-weight:800}
.pb-ms{font-size:12px;font-weight:700;color:var(--red);background:var(--redbg);padding:3px 9px;border-radius:20px;white-space:nowrap}.pb-no{color:#c5cad5}
.pb-c-team{width:90px}.pb-team{font-size:11.5px;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap}
.pb-team.t1{background:#f3effe;color:#6d4fd8}.pb-team.t2{background:var(--blubg);color:var(--blu)}.pb-team.t3{background:var(--ambbg);color:var(--amb)}.pb-team.t4{background:var(--grnbg);color:var(--grn)}
.pb-empty{text-align:center;color:var(--tx3);padding:40px 0 !important}
.pb-detail-row td{background:#f6f4ff;padding:12px 18px}
.pb-detail{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;font-size:12px;color:var(--tx2)}.pb-detail h4{margin:0 0 4px;font-size:12px;font-weight:800;color:var(--tx2)}
.pb-detail div>div{padding:2px 0}.pb-detail .k{display:inline-block;width:120px;color:var(--tx3)}.pb-detail .k.on{color:var(--pr);font-weight:700}.pb-detail .memo{margin-top:6px}
.pb-foot{margin-top:8px}.pb-leg{display:inline-flex;flex-wrap:wrap;gap:14px;font-size:11.5px;color:var(--tx3);align-items:center}.pb-leg span{display:inline-flex;align-items:center;gap:5px}
.pb-leg .pb-dot{width:12px;height:12px}.pb-leg .pb-dot.cur,.pb-leg .pb-dot.doing{border-width:2px;box-shadow:none}
/* ── 현장 TV */
.pb-tv{--card:#151c31;--bd:#26304d;--bd2:#1f2842;--tx:#e8ecf5;--tx2:#c3c9d8;--tx3:#8b93a8;--pr:#7c6cf0;--prd:rgba(124,108,240,.22);--link:#c9c2ff;
  --red:#ff6b7a;--redbg:rgba(255,107,122,.14);--amb:#fbbf24;--ambbg:rgba(251,191,36,.14);--grn:#5ee0a0;--dot:#2a3452;--hl:#0f1424;
  position:fixed;inset:0;z-index:60;overflow:auto;background:#0f1424;padding:26px 32px}
.pb-tv-head{display:flex;flex-wrap:wrap;align-items:center;gap:18px;margin-bottom:18px}
.pb-tv-title{font-size:38px;font-weight:800}.pb-tv-sum{font-size:21px;color:var(--tx3);font-weight:700}.pb-tv-sum b{font-weight:800}
.pb-tv-r{margin-left:auto;display:flex;align-items:center;gap:16px}
.pb-tv-cust{display:inline-flex;gap:4px;background:#182038;border-radius:12px;padding:4px}.pb-tv-cust button{padding:6px 12px;border-radius:9px;font-size:15px;font-weight:700;color:var(--tx3)}.pb-tv-cust button.on{background:#2a3452;color:#fff}
.pb-tv-clk{font-size:30px;font-weight:800;font-variant-numeric:tabular-nums}.pb-tv-u{font-size:14px;color:var(--tx3)}
.pb-tv-x{width:40px;height:40px;border-radius:10px;background:#182038;color:var(--tx3);font-size:18px;font-weight:800}
.pb-tv .pb-band{gap:14px}.pb-tv .pb-st{border-radius:16px !important;padding:16px 22px !important;border:0;border-top:5px solid var(--pr);background:#182038}
.pb-tv .pb-st::after{display:none}.pb-tv .pb-st.on{background:#232c4d}.pb-tv .pb-st-k{font-size:20px;color:#a9b1c7}.pb-tv .pb-st-n{font-size:58px;line-height:1.05}.pb-tv .pb-st-n small{font-size:22px}.pb-tv .pb-st-s{font-size:19px}
.pb-tv .pb-list{border:0;border-radius:16px}.pb-tv .pb-list table{font-size:18px}
.pb-tv .pb-list th{height:52px;background:transparent;border-bottom:1px solid var(--bd);font-size:18px;color:var(--tx3)}
.pb-tv .pb-row{height:84px}.pb-tv .pb-row:hover{background:transparent}.pb-tv .pb-row.late{background:rgba(255,107,122,.08)}
.pb-tv .pb-row td:first-child{box-shadow:inset 7px 0 0 transparent;padding-left:24px}.pb-tv .pb-row.late td:first-child{box-shadow:inset 7px 0 0 var(--red)}.pb-tv .pb-row.soon td:first-child{box-shadow:inset 7px 0 0 #f5c04a}
.pb-tv .pb-c-due{width:130px}.pb-tv .pb-dd b{font-size:30px;color:var(--tx)}.pb-tv .pb-dd span{font-size:16px;background:transparent;padding:0}
.pb-tv .pb-pn{font-size:26px;font-weight:800;color:#fff}.pb-tv .pb-hg{font-size:30px;color:#a99cff;margin-left:10px}.pb-tv .pb-nm{font-size:16px;max-width:420px}.pb-tv .pb-cs{display:none}
.pb-tv .pb-now{font-size:24px;font-weight:800}.pb-tv .pb-now small{font-size:16px;font-weight:600;max-width:420px}
.pb-tv .pb-c-stp{width:540px}.pb-tv .pb-stp{width:500px}.pb-tv .pb-dot{width:26px;height:26px}.pb-tv .pb-dot.cur,.pb-tv .pb-dot.doing{border-width:5px;box-shadow:none}.pb-tv .pb-dot.cur{border-color:#a99cff}
.pb-tv .pb-ln{height:5px}.pb-tv .pb-stp-lb{font-size:15px;margin-top:6px}.pb-tv .pb-stp-lb span.on{color:#fff}
.pb-tv .pb-ms{font-size:19px;background:transparent;padding:0}
.pb-tv-foot{display:flex;justify-content:space-between;margin-top:14px;font-size:16px;color:var(--tx3)}.pb-tv-foot .pb-leg{font-size:16px}
`}</style>
  )
}

// /board — 포털 틀 없이 TV 화면 그대로 (/board?c=AX · ED · CSK · VM 으로 고객사 고정)
export function BoardPage() {
  return <ProcessBoard tv />
}
