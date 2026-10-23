// 업무 흐름 — 부서 탭 · 단계 상자(누르면 그 화면) · 넘어온 일 / 넘긴 일 (v4.91.0)
//   첫 화면(관제탑 위)과 「업무 흐름」 화면에서 같이 쓴다. 규칙 · 단계는 lib/workflow.js
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
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
const nf = (v) => Number(v || 0).toLocaleString('ko-KR')

export default function WorkFlow() {
  const nav = useNavigate()
  const { data: profile } = useMyProfile()
  const depts = visibleDepts(profile)
  const [dept, setDept] = useState(null)
  useEffect(() => { if (depts.length && !depts.includes(dept)) setDept(depts[0]) }, [depts.join(), dept]) // eslint-disable-line react-hooks/exhaustive-deps
  const cur = dept && depts.includes(dept) ? dept : depts[0]

  // 단계별 건수 — 가벼운 집계 한 번. 함수가 아직 없으면(SQL 전) 건수만 비운다
  const { data: c = null } = useQuery({
    queryKey: ['flowCounts'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_flow_counts')
      if (error) return null
      return data || null
    },
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    enabled: !!profile,
  })
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

  if (!profile || !depts.length) return null
  const pcs = (primaryCsCode(profile) || 'ax').toLowerCase()
  const f = flowOf(cur, { c, ct, pcs })
  const can = (p) => canAccessPath(profile, String(p).split('?')[0])
  const go = (p) => { if (can(p)) nav(p) }

  const Hand = ({ title, sub, rows, empty }) => (
    <section className="bg-white border border-slate-200 rounded-xl px-4 py-3.5 min-w-0">
      <h3 className="text-[13px] font-extrabold text-slate-800">{title}</h3>
      <p className="text-[11.5px] text-slate-400 mb-2">{sub}</p>
      {!rows.length && <p className="text-[12px] text-slate-400 py-1">{empty}</p>}
      <div className="space-y-1.5">
        {rows.map((h, i) => (
          <button key={i} type="button" onClick={() => go(h.path)} disabled={!can(h.path)} data-flow-hand={h.text}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-100 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-white">
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-bold whitespace-nowrap">{h.from}</span>
            <span className="flex-1 min-w-0 text-[12.5px] text-slate-700">{h.text}</span>
            {h.n !== null && <span className={`px-2 py-0.5 rounded-full border font-mono text-[12px] font-bold ${TONE[h.n ? h.tone : 'zero']}`}>{nf(h.n)}</span>}
          </button>
        ))}
      </div>
    </section>
  )

  return (
    <div className="space-y-3" data-workflow data-flow-dept={cur}>
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="부서">
        {depts.map((d) => (
          <button key={d} type="button" role="tab" aria-selected={d === cur} onClick={() => setDept(d)} data-flow-tab={d}
            className={`px-3.5 py-2 rounded-full text-[13px] font-bold border ${d === cur ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
            {DEPT_LABEL[d]}
            {d === profile.dept && <span className={`ml-1.5 px-1.5 py-[1px] rounded-full text-[10px] font-bold ${d === cur ? 'bg-white/20 text-white' : 'bg-violet-50 text-violet-700'}`}>내 부서</span>}
          </button>
        ))}
        <span className="text-[11px] text-slate-400 ml-1" data-flow-scope>
          {isLead(profile) ? '팀장급 — 모든 부서 흐름' : '내 부서 · 제조 흐름만 보입니다 (팀장급 이상은 전체)'}
        </span>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-4 md:p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mb-4">
          <h2 className="text-[16px] font-extrabold text-slate-800">{f.title}</h2>
          <span className="text-[12.5px] text-slate-500" data-flow-desc>{f.desc}</span>
        </div>

        {/* 주업무 — 같은 너비로 한 줄 · 단계 사이 화살표 (휴대폰은 위아래로) */}
        <div className="grid grid-cols-1 gap-3 sm:gap-6 sm:[grid-template-columns:var(--flow-cols)]" style={{ '--flow-cols': `repeat(${f.steps.length}, minmax(0, 1fr))` }} data-flow-main>
          {f.steps.map((s, i) => {
            const ok = can(s.path)
            return (
              <div key={i} className={`relative flex flex-col rounded-xl transition ${
                !ok ? 'bg-slate-50 border border-slate-200 opacity-60'
                : s.other ? 'bg-slate-50 border border-dashed border-slate-300'
                : s.hot ? 'bg-white border border-red-200 shadow-[inset_0_3px_0_#e0505f] hover:shadow-md'
                : 'bg-white border border-slate-200 hover:border-violet-300 hover:shadow-md'}`}>
                <button type="button" onClick={() => go(s.path)} disabled={!ok} data-flow-step={s.name}
                  title={ok ? `${s.links[0].label} 으로 이동` : '이 메뉴 권한이 없습니다'}
                  className={`flex-1 flex flex-col gap-1.5 text-left px-3.5 pt-3 pb-2 rounded-xl ${ok ? '' : 'cursor-not-allowed'}`}>
                  <span className="flex items-center gap-2">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-extrabold font-mono ${s.other ? 'bg-slate-200 text-slate-500' : 'bg-violet-50 text-violet-700'}`}>{i + 1}</span>
                    {s.other && <span className="ml-auto px-2 py-[2px] rounded-full bg-slate-200/70 text-slate-600 text-[11px] font-bold">{s.other} 처리</span>}
                  </span>
                  <span className="text-[16px] font-extrabold text-slate-800 leading-snug">{s.name}</span>
                  {s.note && <span className="text-[12px] text-slate-500 leading-snug" data-flow-note>{s.note}</span>}
                  <span className="flex flex-wrap gap-1 mt-auto pt-1">
                    {s.badges.map((b) => (
                      <span key={b.t} className={`px-1.5 py-[1px] rounded-full border text-[11.5px] font-bold whitespace-nowrap ${TONE[b.tone]}`} data-flow-badge={b.t}>
                        {b.t} <b className="font-mono">{nf(b.n)}</b>
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
          <div className="mt-4 pt-3 border-t border-dashed border-slate-200" data-flow-subs>
            <div className="text-[12px] font-bold text-slate-500 mb-2">보조 업무 <span className="font-normal text-slate-400">— 흐름 순서와 상관없이 필요할 때</span></div>
            <div className="flex flex-wrap gap-2">
              {f.subs.map((s) => {
                const ok = can(s.path)
                return (
                  <button key={s.name} type="button" onClick={() => go(s.path)} disabled={!ok} data-flow-sub={s.name}
                    title={ok ? '' : '이 메뉴 권한이 없습니다'}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50/60 text-left hover:bg-white hover:border-violet-300 disabled:opacity-50 disabled:cursor-not-allowed">
                    <span className="text-[13px] font-bold text-slate-700 whitespace-nowrap">{s.name}</span>
                    {s.menu !== s.name && <span className="text-[11.5px] text-slate-400 whitespace-nowrap" data-flow-sub-menu>{s.menu}</span>}
                    {s.badges.map((b) => (
                      <span key={b.t} className={`px-1.5 py-[1px] rounded-full border text-[10.5px] font-bold whitespace-nowrap ${TONE[b.tone]}`} data-flow-badge={b.t}>{b.t} <b className="font-mono">{nf(b.n)}</b></span>
                    ))}
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
        <Hand title="다른 부서에서 넘어온 일" sub="내가 받아서 처리할 것 — 왼쪽은 보낸 부서" rows={f.inbox} empty="넘어온 일이 없습니다" />
        <Hand title="내가 넘긴 일 · 상대 처리 대기" sub="상대 부서가 아직 처리하지 않은 것 — 왼쪽은 처리할 부서" rows={f.outbox} empty="기다리는 일이 없습니다" />
      </div>
    </div>
  )
}
