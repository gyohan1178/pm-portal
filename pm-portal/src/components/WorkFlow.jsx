// 🧭 업무 흐름 — 부서 탭 · 단계 상자(누르면 그 화면) · 넘어온 일 / 넘긴 일 (v4.91.0)
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
  const can = (p) => canAccessPath(profile, p)
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

      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-3">
          <h2 className="text-[15px] font-extrabold text-slate-800">{f.title}</h2>
          <span className="text-[12px] text-slate-400">{f.desc}</span>
        </div>
        <div className="flex flex-wrap items-stretch gap-y-2">
          {f.steps.map((s, i) => {
            const ok = can(s.path)
            return (
              <div key={i} className="flex items-stretch w-full sm:w-auto">
                <button type="button" onClick={() => go(s.path)} disabled={!ok} data-flow-step={s.name}
                  title={ok ? `${s.where} 으로 이동` : '이 메뉴 권한이 없습니다'}
                  className={`w-full sm:w-[168px] sm:min-h-[138px] flex flex-col gap-1 text-left px-3 py-2.5 rounded-xl transition ${
                    !ok ? 'bg-slate-50 border border-slate-200 opacity-60 cursor-not-allowed'
                    : s.other ? 'bg-slate-50 border border-dashed border-slate-300 hover:bg-white'
                    : s.hot ? 'bg-white border border-red-200 shadow-[inset_0_3px_0_#e0505f] hover:shadow-md'
                    : 'bg-white border border-slate-200 hover:border-violet-300 hover:shadow-md'}`}>
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] font-semibold text-slate-400">{s.no}</span>
                    <span className="text-[17px] leading-none">{s.icon}</span>
                    {s.other && <span className="ml-auto px-1.5 py-[1px] rounded-full bg-slate-200/70 text-slate-600 text-[10px] font-bold">{s.other}</span>}
                  </span>
                  <span className="text-[13.5px] font-extrabold text-slate-800">{s.name}</span>
                  <span className="text-[11px] text-slate-400 leading-snug">{s.where}</span>
                  <span className="flex flex-wrap gap-1 mt-auto pt-1">
                    {s.soon && <span className="px-1.5 py-[1px] rounded-full border border-violet-200 bg-violet-50 text-violet-700 text-[10.5px] font-bold">{s.soon}</span>}
                    {s.badges.map((b) => (
                      <span key={b.t} className={`px-1.5 py-[1px] rounded-full border text-[10.5px] font-bold whitespace-nowrap ${TONE[b.tone]}`} data-flow-badge={b.t}>
                        {b.t} <b className="font-mono">{nf(b.n)}</b>
                      </span>
                    ))}
                  </span>
                  <span className={`text-[11.5px] font-bold ${ok ? 'text-[#5b6ee8]' : 'text-slate-400'}`}>{ok ? '바로가기 →' : '권한 없음'}</span>
                </button>
                {i < f.steps.length - 1 && (
                  <span className="hidden sm:flex items-center px-1 text-slate-300" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                  </span>
                )}
              </div>
            )
          })}
        </div>
        {c === null && <p className="mt-2 text-[11px] text-slate-400" data-flow-nocount>건수는 「업무흐름_반영」 SQL 을 실행하면 나옵니다.</p>}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Hand title="⬅ 다른 부서에서 넘어온 일" sub="내가 받아서 처리할 것" rows={f.inbox} empty="넘어온 일이 없습니다" />
        <Hand title="➡ 내가 넘긴 일 · 상대 처리 대기" sub="상대 부서가 아직 처리하지 않은 것" rows={f.outbox} empty="기다리는 일이 없습니다" />
      </div>
    </div>
  )
}
