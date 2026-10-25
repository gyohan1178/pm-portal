// 업무 흐름 — 부서 탭 · 단계 상자(누르면 그 화면) · 넘어온 일 / 넘긴 일 (v4.91.0)
//   첫 화면(관제탑 위)과 「업무 흐름」 화면에서 같이 쓴다. 규칙 · 단계는 lib/workflow.js
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { flowCountsQuery, flowSnapshot, readSeen, writeSeen, grew, shrank } from '../lib/flowSeen'
import { docCountsQuery } from '../lib/docRequest'
import { useMyProfile, canAccessPath } from '../hooks/useProfile'
import { primaryCsCode } from '../lib/customers'
import { fetchControlTowerData } from '../lib/controlTowerData'
import { computeControlTower } from '../lib/controlTower'
import { visibleDepts, isLead, flowOf, ctKpiOf, DEPT_LABEL } from '../lib/workflow'

const TONE = {
  red: 'bg-red-50 text-red-600 border-red-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  gray: 'bg-slate-100 text-slate-600 border-slate-200',
  zero: 'bg-white text-slate-400 border-slate-200',
}
// 휴대폰은 숫자 배지를 채운 색으로 (테두리만 있으면 숫자가 안 띈다 · A안)
const FILL = {
  red: 'border-transparent bg-[#e0505f] text-white sm:bg-red-50 sm:text-red-600 sm:border-red-200',
  amber: 'border-transparent bg-[#f2b630] text-white sm:bg-amber-50 sm:text-amber-700 sm:border-amber-200',
  violet: 'border-transparent bg-violet-500 text-white sm:bg-violet-50 sm:text-violet-700 sm:border-violet-200',
}
const nf = (v) => Number(v || 0).toLocaleString('ko-KR')

export default function WorkFlow({ hero = false }) {
  const nav = useNavigate()
  const { data: profile } = useMyProfile()
  const depts = visibleDepts(profile)
  const [dept, setDept] = useState(null)
  useEffect(() => { if (depts.length && !depts.includes(dept)) setDept(depts[0]) }, [depts.join(), dept]) // eslint-disable-line react-hooks/exhaustive-deps
  const cur = dept && depts.includes(dept) ? dept : depts[0]

  // 단계별 건수 — 가벼운 집계 한 번. 함수가 아직 없으면(SQL 전) 건수만 비운다
  const { data: c0 = null } = useQuery({ ...flowCountsQuery, enabled: !!profile })
  // 자료 요청 숫자(v4.98.0)를 같은 c 에 붙인다 — c.doc.open · c.doc.byDept[부서]
  const { data: dc = null } = useQuery({ ...docCountsQuery, enabled: !!profile })
  const c = c0 ? { ...c0, doc: dc } : null
  // 구매자재 흐름만 관제탑 숫자(부족 · 발주 필요 · 입고 지연)를 쓴다 — 무거우므로 그 탭을 볼 때만.
  //   관제탑 화면과 같은 키라 첫 화면에서는 한 번만 받는다
  const needCt = cur === '구매자재' && canAccessPath(profile, '/inbound')
  const { data: ctData } = useQuery({
    queryKey: ['controlTower', 'all'],
    queryFn: () => fetchControlTowerData('all'),
    enabled: !!profile && needCt,
    staleTime: 5 * 60 * 1000,
  })
  const ct = needCt ? ctKpiOf(ctData, computeControlTower) : null

  const known = c !== null
  const pcs = (primaryCsCode(profile) || 'ax').toLowerCase()
  const f = profile && depts.length ? flowOf(cur, { c, ct, pcs }) : null

  // ── 알림 (v4.97.0) — 마지막으로 본 숫자(기준)와 비교해 새로 늘어난 것 · 처리된 것만 움직인다 ──
  //   기준은 이 브라우저에만 저장. 화면을 3초 보거나 단계를 누르면 지금 숫자를 「봤음」으로 저장하고,
  //   이번 화면에 뜬 「신규 n」은 다른 화면으로 갈 때까지 그대로 둔다.
  const uid = profile?.id
  const snap = f && known ? flowSnapshot(f) : null
  const snapKey = snap ? JSON.stringify(snap) : ''
  const [base, setBase] = useState(null)        // { dept, map }
  const [flash, setFlash] = useState(false)     // 「처리됨 · 모두 처리」를 잠깐 띄우는 중
  const prevSnap = useRef(null)
  useEffect(() => {
    if (!snap || !cur || (base && base.dept === cur)) return
    const seen = readSeen(uid, cur)
    if (!seen) { writeSeen(uid, cur, snap); setBase({ dept: cur, map: snap }); return }
    setBase({ dept: cur, map: seen }); setFlash(true)
  }, [cur, !!snap]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!snap || !base || base.dept !== cur) return
    // 보고 있는 동안 숫자가 새로 바뀌었고 줄어든 게 있으면 「처리됨」을 다시 띄운다
    const prev = prevSnap.current
    if (prev && prev.dept === cur && Object.keys(snap).some((k) => (k.startsWith('o:') || k.startsWith('st:')) && prev.map[k] > snap[k])) setFlash(true)
    prevSnap.current = { dept: cur, map: snap }
    const t = setTimeout(() => writeSeen(uid, cur, snap), 3000)
    return () => clearTimeout(t)
  }, [snapKey, base?.dept, cur]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(false), 3200); return () => clearTimeout(t) }, [flash])

  if (!profile || !depts.length || !f) return null
  const can = (p) => canAccessPath(profile, String(p).split('?')[0])
  const go = (p) => { if (can(p)) { if (snap) writeSeen(uid, cur, snap); nav(p) } }
  const bm = base && base.dept === cur ? base.map : null
  const freshB = (t) => grew(snap, bm, 'b:' + t)
  const stepFresh = (s) => (s.other ? 0 : s.badges.reduce((a, b) => a + freshB(b.t), 0))
  const pop = (k) => (snap && bm && bm[k] !== undefined && bm[k] !== snap[k] ? 'pm-pop' : '')
  const zeroed = (s) => flash && !s.other && bm && (bm['st:' + s.name] || 0) > 0 && snap && snap['st:' + s.name] === 0
  const freshChip = (n, small) => n > 0 ? <span data-flow-fresh={n} className={`pm-chip-in shrink-0 inline-flex items-center rounded-full bg-[#6c5ce7] text-white font-bold whitespace-nowrap ${small ? 'px-1.5 text-[10px] leading-[16px]' : 'px-2 py-[1px] text-[11px]'}`}>신규 {nf(n)}</span> : null
  const zeroChip = (small) => <span data-flow-zero className={`pm-flash-out shrink-0 inline-flex items-center rounded-full bg-[#12a05f] text-white font-bold whitespace-nowrap ${small ? 'px-1.5 text-[10px] leading-[16px]' : 'px-2 py-[1px] text-[11px]'}`}>모두 처리</span>

  const hand = ({ title, sub, rows, empty, kind }) => (
    <section className="bg-white sm:border border-slate-200 rounded-2xl sm:rounded-xl shadow-[0_1px_3px_rgba(20,30,50,.05)] sm:shadow-none px-3 sm:px-4 py-3 sm:py-3.5 min-w-0">
      <h3 className="text-[13px] font-extrabold text-slate-800">{title}</h3>
      <p className="hidden sm:block text-[11.5px] text-slate-400 mb-2">{sub}</p>
      {!rows.length && <p className="text-[12px] text-slate-400 py-1">{empty}</p>}
      <div className="space-y-1.5">
        {rows.map((h, i) => {
          const k = (kind === 'in' ? 'i:' : 'o:') + h.text
          const up = kind === 'in' ? grew(snap, bm, k) : 0
          const done = kind === 'out' && flash ? shrank(snap, bm, k) : 0
          return (
          <button key={i} type="button" onClick={() => go(h.path)} disabled={!can(h.path)} data-flow-hand={h.text}
            className={`w-full flex items-center gap-2 sm:gap-2.5 px-2.5 sm:px-3 py-2 mt-1.5 sm:mt-0 rounded-lg bg-slate-50 sm:bg-white sm:border border-slate-100 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-white ${up ? 'pm-row-in' : ''}`}>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-bold whitespace-nowrap">{h.from}</span>
            <span className="flex-1 min-w-0 text-[12px] sm:text-[12.5px] text-slate-700 leading-snug">{h.text}</span>
            {freshChip(up)}
            {done > 0 && <span data-flow-done={done} className="pm-flash-out shrink-0 px-2 py-[1px] rounded-full bg-[#12a05f] text-white text-[11px] font-bold whitespace-nowrap">−{nf(done)} 처리됨</span>}
            {h.n !== null && <span className={`px-2 py-0.5 rounded-full border font-mono text-[12px] font-bold ${h.n ? FILL[h.tone] || TONE[h.tone] : TONE.zero}`}><span key={h.n} className={pop(k)}>{nf(h.n)}</span></span>}
          </button>
          )
        })}
      </div>
    </section>
  )

  // 휴대폰 A안 — 맨 위 「오늘 처리할 일」 요약 (내 부서 단계 · 보조 업무의 빨강 = 막힘, 주황 = 처리 대기, 넘어온 일 = 받은 일 합계)
  const mine = new Map()
  f.steps.filter((s) => !s.other).concat(f.subs).forEach((s) => s.badges.forEach((b) => mine.set(b.t, b)))
  const sumOf = (tone) => [...mine.values()].filter((b) => b.tone === tone).reduce((t, b) => t + b.n, 0)
  const blocked = sumOf('red'), waiting = sumOf('amber')
  const inN = f.inbox.reduce((t, h) => t + (Number(h.n) || 0), 0)
  // 기준(마지막으로 본) 값 — 요약 카드 숫자가 바뀌었는지 · 막힘이 늘었는지
  const baseSum = (tone) => [...mine.values()].filter((b) => b.tone === tone).reduce((t, b) => t + (bm && bm['b:' + b.t] !== undefined ? bm['b:' + b.t] : b.n), 0)
  const baseIn = f.inbox.reduce((t, h) => t + (bm && bm['i:' + h.text] !== undefined ? bm['i:' + h.text] : (Number(h.n) || 0)), 0)
  const bBlocked = baseSum('red'), bWaiting = baseSum('amber')
  const heroPop = (now, was) => (bm && now !== was ? 'pm-pop' : '')
  const ROW = { red: 'bg-[#fdeef0]', amber: 'bg-[#fef8e7]' }
  const SQ = { red: 'bg-[#e0505f] text-white', amber: 'bg-[#f2b630] text-white', other: 'bg-slate-200 text-slate-500', off: 'bg-slate-100 text-slate-400', none: 'bg-[#eeebfd] text-[#6c5ce7]' }
  const NUM = { red: 'text-[#e0505f]', amber: 'text-[#d99400]', violet: 'text-violet-600', gray: 'text-slate-500' }
  const SUBT = { red: 'text-[#c03545]', amber: 'text-[#8a5a00]', violet: 'text-violet-700', gray: 'text-slate-500' }

  return (
    <div className="space-y-3" data-workflow data-flow-dept={cur}>
      {/* 휴대폰 — 보라 요약 카드. 업무 흐름 화면에서는 위 보라 머리 줄과 이어 붙인다 (hero) */}
      <section data-flow-hero className={`sm:hidden text-white ${hero ? "bg-[linear-gradient(180deg,#5f52e9_0%,#6c5ce7_60%,#7566ee_100%)]" : "bg-[linear-gradient(160deg,#5b4ee8_0%,#6c5ce7_55%,#7d6ef0_100%)]"} ${hero ? '-mx-4 -mt-4 px-5 pt-2 pb-4 rounded-b-[22px]' : 'rounded-2xl px-4 py-3.5'}`}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12.5px] text-white/85">오늘 처리할 일 <span className="text-white/60">· {DEPT_LABEL[cur]}</span></span>
          {profile.name && <span className="text-[11px] text-white/60 truncate">{profile.name}</span>}
        </div>
        <div className="flex items-end gap-2">
          <span className="font-mono text-[38px] font-bold leading-[1.1]" data-flow-total><span key={blocked + waiting} className={heroPop(blocked + waiting, bBlocked + bWaiting)}>{known ? nf(blocked + waiting) : '—'}</span></span>
          <span className="text-[12.5px] text-white/80 pb-1.5">건 · 막힘 + 처리 대기</span>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-2.5">
          {[['막힘', blocked, bBlocked], ['처리 대기', waiting, bWaiting], ['넘어온 일', inN, baseIn]].map(([t, n, was]) => (
            <div key={t} className={`bg-white/[.16] rounded-xl px-2.5 py-1.5 ${t === '막힘' && bm && n > was ? 'pm-hero-flash' : ''}`} data-flow-sum={t}>
              <div className="text-[11px] text-white/80">{t}</div>
              <div className="font-mono text-[19px] font-bold leading-tight"><span key={n} className={heroPop(n, was)}>{known ? nf(n) : '—'}</span></div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex sm:flex-wrap items-center gap-1 sm:gap-2 overflow-x-auto sm:overflow-visible bg-[#e9ebf3] sm:bg-transparent rounded-xl sm:rounded-none p-1 sm:p-0 [scrollbar-width:none]" role="tablist" aria-label="부서">
        {depts.map((d) => (
          <button key={d} type="button" role="tab" aria-selected={d === cur} onClick={() => setDept(d)} data-flow-tab={d}
            className={`shrink-0 sm:shrink whitespace-nowrap flex-1 sm:flex-none min-w-fit px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-[9px] sm:rounded-full text-[12.5px] sm:text-[13px] font-bold border ${d === cur ? 'bg-white text-[#6c5ce7] border-transparent shadow-[0_1px_3px_rgba(20,30,50,.08)] sm:bg-slate-800 sm:text-white sm:border-slate-800 sm:shadow-none' : 'bg-transparent text-slate-500 border-transparent sm:bg-white sm:text-slate-600 sm:border-slate-200 sm:hover:border-slate-300'}`}>
            {DEPT_LABEL[d]}
            {d === profile.dept && <span className={`ml-1.5 px-1.5 py-[1px] rounded-full text-[10px] font-bold ${d === cur ? 'bg-violet-50 text-violet-700 sm:bg-white/20 sm:text-white' : 'bg-violet-50 text-violet-700'}`}>내 부서</span>}
          </button>
        ))}
        <span className="hidden sm:inline text-[11px] text-slate-400 ml-1" data-flow-scope>
          {isLead(profile) ? '팀장급 — 모든 부서 흐름' : '내 부서 · 제조 흐름만 보입니다 (팀장급 이상은 전체)'}
        </span>
      </div>

      <section className="sm:bg-white sm:border border-slate-200 rounded-xl sm:p-4 md:p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mb-1.5 sm:mb-4 px-0.5 sm:px-0">
          <h2 className="text-[12.5px] sm:text-[16px] font-extrabold text-slate-500 sm:text-slate-800">{f.title}</h2>
          <span className="hidden sm:inline text-[12.5px] text-slate-500" data-flow-desc>{f.desc}</span>
        </div>

        {/* 휴대폰 A안 — 테두리 없는 줄. 처리할 게 있는 단계만 색 바탕 + 큰 숫자 (v4.95.0) */}
        <div className="sm:hidden bg-white rounded-2xl p-1.5 shadow-[0_1px_3px_rgba(20,30,50,.05)]" data-flow-mobile>
          {f.steps.map((s, i) => {
            const ok = can(s.path)
            const live = s.badges.filter((b) => b.n > 0)
            const tone = !ok ? 'off' : s.other ? 'other' : s.hot ? 'red' : live.some((b) => b.tone === 'amber') ? 'amber' : 'none'
            const lead = live.find((b) => b.tone === 'red') || live.find((b) => b.tone === 'amber') || live[0]
            const total = live.reduce((t, b) => t + b.n, 0)
            return (
              <div key={i} className={`relative rounded-xl ${i ? 'mt-1' : ''} ${ROW[tone] || ''}`} data-flow-mrow={s.name}>
                {tone === 'red' && <span className="pm-ring" aria-hidden="true" />}
                <button type="button" onClick={() => go(s.path)} disabled={!ok} data-flow-mstep={s.name}
                  className="w-full min-h-[50px] flex items-center gap-2.5 px-2.5 py-2 text-left rounded-xl active:bg-black/[.03] disabled:cursor-default">
                  <span className={`shrink-0 w-[30px] h-[30px] rounded-[10px] flex items-center justify-center text-[13px] font-extrabold font-mono ${SQ[tone] || SQ.none}`}>{i + 1}</span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className={`block text-[14.5px] font-extrabold truncate ${tone === 'none' || tone === 'other' || tone === 'off' ? 'text-slate-600' : 'text-slate-800'}`}>{s.name}</span>
                      {freshChip(stepFresh(s), true)}
                      {zeroed(s) && zeroChip(true)}
                    </span>
                    {lead ? (
                      <span className={`block text-[11px] truncate ${SUBT[lead.tone] || 'text-slate-500'}`}>
                        {live.map((b) => <span key={b.t} data-flow-mbadge={b.t}>{b.t}{live.length > 1 ? ` ${nf(b.n)}` : ''}</span>).reduce((acc, el, k) => k ? [...acc, ' · ', el] : [el], [])}
                      </span>
                    ) : !ok ? <span className="block text-[11px] text-slate-400">권한 없음</span>
                      : s.other ? <span className="block text-[11px] text-slate-400">{s.other} 처리</span>
                      : s.links.length === 1 && s.links[0].label !== s.name ? <span className="block text-[11px] text-slate-400 truncate">{s.links[0].label}</span> : null}
                  </span>
                  {lead && <span className={`shrink-0 font-mono text-[22px] font-bold leading-none ${NUM[lead.tone] || 'text-slate-600'}`}><span key={total} className={pop('st:' + s.name)}>{nf(total)}</span></span>}
                  <span className={`shrink-0 text-[19px] leading-none ${lead ? 'text-black/20' : 'text-slate-300'}`} aria-hidden="true">›</span>
                </button>
                {ok && s.links.length > 1 && (
                  <div className="flex gap-1.5 pl-[50px] pr-2 pb-2 -mt-1 overflow-x-auto [scrollbar-width:none]">
                    {s.links.map((l) => (
                      <button key={l.path} type="button" onClick={() => go(l.path)} disabled={!can(l.path)} data-flow-mlink={l.label}
                        className="shrink-0 px-2.5 py-1 rounded-lg bg-[#eef0fb] text-[11.5px] font-bold text-[#5b6ee8] disabled:opacity-40">{l.label} →</button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* 주업무 — 같은 너비로 한 줄 · 단계 사이 화살표 (휴대폰은 위아래로) */}
        <div className="hidden sm:grid gap-6 [grid-template-columns:var(--flow-cols)]" style={{ '--flow-cols': `repeat(${f.steps.length}, minmax(0, 1fr))` }} data-flow-main>
          {f.steps.map((s, i) => {
            const ok = can(s.path)
            return (
              <div key={i} className={`relative flex flex-col rounded-xl transition ${
                !ok ? 'bg-slate-50 border border-slate-200 opacity-60'
                : s.other ? 'bg-slate-50 border border-dashed border-slate-300'
                : s.hot ? 'bg-white border border-red-200 shadow-[inset_0_3px_0_#e0505f] hover:shadow-md'
                : 'bg-white border border-slate-200 hover:border-violet-300 hover:shadow-md'}`}>
                {ok && s.hot && !s.other && <span className="pm-ring" aria-hidden="true" />}
                <button type="button" onClick={() => go(s.path)} disabled={!ok} data-flow-step={s.name}
                  title={ok ? `${s.links[0].label} 으로 이동` : '이 메뉴 권한이 없습니다'}
                  className={`flex-1 flex flex-col gap-1.5 text-left px-3.5 pt-3 pb-2 rounded-xl ${ok ? '' : 'cursor-not-allowed'}`}>
                  <span className="flex items-center gap-2">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-extrabold font-mono ${s.other ? 'bg-slate-200 text-slate-500' : 'bg-violet-50 text-violet-700'}`}>{i + 1}</span>
                    {s.other && <span className="ml-auto px-2 py-[2px] rounded-full bg-slate-200/70 text-slate-600 text-[11px] font-bold">{s.other} 처리</span>}
                  </span>
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[16px] font-extrabold text-slate-800 leading-snug">{s.name}</span>
                    {s.hot && !s.other && <span className="pm-dot" aria-hidden="true" />}
                    {freshChip(stepFresh(s))}
                    {zeroed(s) && zeroChip()}
                  </span>
                  {s.note && <span className="text-[12px] text-slate-500 leading-snug" data-flow-note>{s.note}</span>}
                  <span className="flex flex-wrap gap-1 mt-auto pt-1">
                    {s.badges.map((b) => (
                      <span key={b.t} className={`px-1.5 py-[1px] rounded-full border text-[11.5px] font-bold whitespace-nowrap ${TONE[b.tone]}`} data-flow-badge={b.t}>
                        {b.t} <b key={b.n} className={`font-mono ${s.other ? '' : pop('b:' + b.t)}`}>{nf(b.n)}</b>
                      </span>
                    ))}
                  </span>
                </button>
                <div className="flex flex-wrap gap-1.5 px-3.5 pb-3" data-flow-links>
                  {s.links.map((l) => {
                    const lok = can(l.path)
                    return (
                      <button key={l.path} type="button" onClick={() => go(l.path)} disabled={!lok} data-flow-menu={l.label} title={lok ? '' : '이 메뉴 권한이 없습니다'}
                        className="px-2.5 py-1 rounded-lg border border-violet-200 bg-white text-[12px] font-bold text-[#5b6ee8] hover:bg-violet-50 disabled:border-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed">
                        {lok ? `${l.label} →` : `${l.label} · 권한 없음`}
                      </button>
                    )
                  })}
                </div>
                {i < f.steps.length - 1 && (
                  <span className="hidden sm:flex absolute top-1/2 -right-[19px] -translate-y-1/2 w-[14px] justify-center text-slate-300 pointer-events-none" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* 보조업무 — 순서에 들지 않는 곁일. 흐름 아래 칸에서 따로 들어간다 */}
        {f.subs.length > 0 && (
          <div className="sm:hidden mt-3.5" data-flow-msubs>
            <div className="text-[12.5px] font-extrabold text-slate-500 mb-1.5 px-0.5">보조 업무</div>
            <div className="grid grid-cols-2 gap-2">
              {f.subs.map((s) => {
                const ok = can(s.path)
                const live = s.badges.filter((b) => b.n > 0)
                const lead = live.find((b) => b.tone === 'red') || live.find((b) => b.tone === 'amber') || live[0]
                return (
                  <button key={s.name} type="button" onClick={() => go(s.path)} disabled={!ok} data-flow-msub={s.name}
                    className="min-w-0 text-left bg-white rounded-[14px] px-3 py-2.5 shadow-[0_1px_3px_rgba(20,30,50,.05)] active:bg-slate-50 disabled:opacity-50">
                    <div className="flex items-center gap-1 min-w-0"><span className="text-[12.5px] font-bold text-slate-800 truncate">{s.name}</span>{freshChip(s.badges.reduce((a, b) => a + freshB(b.t), 0), true)}</div>
                    {lead ? (
                      <div className="flex items-baseline gap-1 mt-0.5 min-w-0">
                        <span className={`font-mono text-[19px] font-bold leading-tight ${NUM[lead.tone] || 'text-slate-600'}`}>{nf(lead.n)}</span>
                        <span className="text-[11px] text-slate-400 truncate">{live.map((b, k) => k ? `${b.t} ${nf(b.n)}` : b.t).join(' · ')}</span>
                      </div>
                    ) : <div className="text-[11px] text-slate-400 mt-1 truncate">{!ok ? '권한 없음' : s.badges.length ? '처리할 것 없음' : s.menu !== s.name ? s.menu : '바로가기'}</div>}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {f.subs.length > 0 && (
          <div className="hidden sm:block mt-3 sm:mt-4 pt-3 border-t border-dashed border-slate-200" data-flow-subs>
            <div className="text-[12px] font-bold text-slate-500 mb-2">보조 업무 <span className="hidden sm:inline font-normal text-slate-400">— 흐름 순서와 상관없이 필요할 때</span></div>
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              {f.subs.map((s) => {
                const ok = can(s.path)
                return (
                  <button key={s.name} type="button" onClick={() => go(s.path)} disabled={!ok} data-flow-sub={s.name}
                    title={ok ? '' : '이 메뉴 권한이 없습니다'}
                    className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg border border-slate-200 bg-slate-50/60 text-left hover:bg-white hover:border-violet-300 disabled:opacity-50 disabled:cursor-not-allowed">
                    <span className="text-[12.5px] sm:text-[13px] font-bold text-slate-700 whitespace-nowrap">{s.name}</span>
                    {s.menu !== s.name && <span className="hidden sm:inline text-[11.5px] text-slate-400 whitespace-nowrap" data-flow-sub-menu>{s.menu}</span>}
                    {s.badges.map((b) => (
                      <span key={b.t} className={`px-1.5 py-[1px] rounded-full border text-[10.5px] font-bold whitespace-nowrap ${TONE[b.tone]}`} data-flow-badge={b.t}>{b.t} <b key={b.n} className={`font-mono ${pop('b:' + b.t)}`}>{nf(b.n)}</b></span>
                    ))}
                    {freshChip(s.badges.reduce((a, b) => a + freshB(b.t), 0), true)}
                    <span className={`text-[12px] font-bold ${ok ? 'text-[#5b6ee8]' : 'text-slate-400'}`}>{ok ? '→' : '권한 없음'}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {c === null && <p className="mt-2 text-[11px] text-slate-400" data-flow-nocount>건수는 「업무흐름_반영」 SQL 을 실행하면 나옵니다.</p>}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {hand({ kind: 'in', title: '다른 부서에서 넘어온 일', sub: '내가 받아서 처리할 것 — 왼쪽은 보낸 부서', rows: f.inbox, empty: '넘어온 일이 없습니다' })}
        {hand({ kind: 'out', title: '내가 넘긴 일 · 상대 처리 대기', sub: '상대 부서가 아직 처리하지 않은 것 — 왼쪽은 처리할 부서', rows: f.outbox, empty: '기다리는 일이 없습니다' })}
      </div>
    </div>
  )
}
