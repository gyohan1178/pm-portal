import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchAll } from '../lib/paginate'
import { useCycleBase, useCellHold, holdReasonDefault } from '../hooks/useCycleCount'
import { todayISO } from '../lib/utils'
import { isHoliday } from '../lib/bizdays'
import {
  DAILY, ownerCells, checkMap, todayPlan, roundStats, rackRanges, normLoc, loadExtra, saveExtra, isWorkday, weekStrip, heldSet,
} from '../lib/cycleCount'

// 할 일 탭의 「오늘 순환 실사」 줄 (v4.78.0)
//   · 실사하는 날(평일 · 공휴일 아님)에만 보인다. 못 한 날은 넘기지 않는다 — 매일 5칸.
//   · 오늘 목표를 채우면 「최근 완료」 묶음으로 내려간다.
//   · 줄 밑에 이번 주 월~금 센 칸 수 — 했는지 안 했는지 여기서 본다.
//   · 누르면 오늘 칸이 펼쳐지고, 칸을 누르면 칸 실사 화면으로.
//   DB 에 할 일 글을 따로 만들지 않는다 — 센 기록(pm_cell_check)으로 그때그때 계산.

const md = (d) => (d ? String(d).slice(5, 10) : '')

// who: 'me' | 'all' | 'name:이름' | 사람 id
export function useCycleTodo({ who, me, people }) {
  const { data: base } = useCycleBase()
  const today = todayISO()
  const [extra, setExtra] = useState(() => loadExtra(today))
  const byOwner = useMemo(() => ownerCells(base?.racks, base?.owners), [base])
  const cm = useMemo(() => checkMap(base?.checks), [base])
  const held = useMemo(() => heldSet(base), [base])   // 보류 칸 (v4.114.0)
  const workday = isWorkday(today, isHoliday)
  const myName = me?.name && byOwner.has(me.name) ? me.name : null

  const names = useMemo(() => {
    if (!base?.setup || !workday) return []
    if (who === 'me') return myName ? [myName] : []
    if (who === 'all') return [...byOwner.keys()]
    const nm = String(who).startsWith('name:') ? String(who).slice(5) : (people || []).find((p) => p.id === who)?.name
    return nm && byOwner.has(nm) ? [nm] : []
  }, [base, workday, who, myName, byOwner, people])

  const items = useMemo(() => names.map((name) => {
    const o = byOwner.get(name)
    const isMe = name === myName
    const target = DAILY + (isMe ? extra * DAILY : 0)
    const plan = todayPlan(o.cells, cm, today, target, o.late, held)
    const mineSet = new Set(o.cells)
    return {
      key: 'cycle:' + name, name, isMe, o, plan, target,
      complete: plan.done >= target,
      holds: (base?.holds || []).filter((h) => mineSet.has(normLoc(h.location))),
      rs: roundStats(o.cells, cm, held),
      week: weekStrip(o.cells, cm, today, isHoliday),
    }
  }), [names, byOwner, myName, extra, cm, today, held, base])

  // 사람 칩 · 사이드바 숫자용 — 오늘 아직 안 끝난 사람 이름
  const pendingNames = useMemo(() => {
    if (!base?.setup || !workday) return new Set()
    const s = new Set()
    for (const [name, o] of byOwner) if (todayPlan(o.cells, cm, today, DAILY, o.late, held).done < DAILY) s.add(name)
    return s
  }, [base, workday, byOwner, cm, today, held])

  const more = () => { const x = extra + 1; setExtra(x); saveExtra(today, x) }
  const less = () => { setExtra(0); saveExtra(today, 0) }
  return { items, pendingNames, racks: base?.racks || [], more, less, extra, today, holdSetup: !!base?.holdSetup }
}

// 칸별 품목 수 — 펼칠 때만 받는다 (재고 위치 전부라 무겁다)
function useLocCounts(enabled) {
  return useQuery({
    queryKey: ['invLocCounts'],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const rows = await fetchAll(() => supabase.from('inventory').select('id,location,qty').not('location', 'is', null).order('id'))
      const m = new Map(), neg = new Map()   // 칸별 품목 수 · 음수 품목 수 (보류 사유 미리 채움 — v4.114.0)
      rows.forEach((r) => { const k = normLoc(r.location); m.set(k, (m.get(k) || 0) + 1); if (Number(r.qty) < 0) neg.set(k, (neg.get(k) || 0) + 1) })
      m.neg = neg
      return m
    },
  })
}

export function CycleTodoRow({ it, cyc, showName }) {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const { data: byLoc } = useLocCounts(open)
  const { plan, target, complete, rs, week, o, isMe, name, holds = [] } = it
  const holdApi = useCellHold()
  const [holdForm, setHoldForm] = useState(null)   // { loc, reason } — 칸 보류 사유 칸 (v4.114.0)
  const doHold = async () => { if (await holdApi.hold(holdForm.loc, holdForm.reason)) setHoldForm(null) }
  const pct = Math.min(100, Math.round((plan.done / Math.max(1, target)) * 100))
  const late = o.lateRacks.length ? ` · ${o.lateRacks.join(' · ')}(맨 뒤)` : ''
  return (
    <div data-cycle-todo={name} className="border-t border-slate-100 bg-indigo-50/40 border-l-4 border-l-indigo-500">
      <div className="px-3 py-2.5 flex items-start gap-2.5 cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <input type="checkbox" checked={complete} readOnly className="w-4 h-4 mt-0.5 pointer-events-none" title="오늘 칸을 다 세면 저절로 체크됩니다" />
        <div className="flex-1 min-w-[180px]">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-sm font-semibold ${complete ? 'text-slate-500' : 'text-slate-800'}`}>
              🧾 오늘 순환 실사{showName ? ` — ${name}` : ''} · <b data-cycle-todo-cnt>{plan.done} / {target}칸</b>{complete ? ' ✓' : ''}
            </span>
            <span className="inline-block w-20 h-1.5 rounded-full bg-indigo-100 overflow-hidden align-middle">
              <span className={`block h-full ${complete ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
            </span>
            <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-bold">매일 · 자동</span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 flex-wrap">
            {!complete && plan.nextLoc && <span>다음 칸 <b className="font-mono text-indigo-600">{plan.nextLoc}</b></span>}
            <span>{rackRanges(o.racks.filter((c) => !o.lateRacks.includes(c)), cyc.racks)}{late}</span>
            <span>{rs.round}바퀴째 {rs.pct}%</span>
            {holds.length > 0 && <span data-cycle-held-cnt className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 font-bold">⏸ 보류 {holds.length}칸</span>}
            <span className="text-slate-400">{open ? '접기 ▴' : '칸 보기 ▾'}</span>
          </div>
          {/* 이번 주 — 했는지 안 했는지 */}
          <div data-cycle-week className="flex items-center gap-1 mt-1.5">
            <span className="text-[10px] text-slate-400 mr-0.5">이번 주</span>
            {week.map((d) => {
              const ok = d.n >= DAILY
              const cls = d.off ? 'bg-slate-50 text-slate-300 border-slate-100'
                : d.future ? 'bg-white text-slate-300 border-slate-100'
                : ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : d.n > 0 ? 'bg-amber-50 text-amber-700 border-amber-200'
                : d.today ? 'bg-white text-slate-500 border-indigo-200'
                : 'bg-red-50 text-red-600 border-red-200'
              return (
                <span key={d.d} data-cycle-day={d.d} title={`${d.d} ${d.off ? '공휴일' : `${d.n}칸`}`}
                  className={`px-1.5 py-0.5 rounded border text-[10px] font-bold tabular-nums ${cls} ${d.today ? 'ring-1 ring-indigo-300' : ''}`}>
                  {d.label} {d.off ? '휴' : d.future ? '·' : `${d.n}${ok ? '✓' : ''}`}
                </span>
              )
            })}
          </div>
        </div>
      </div>
      {open && (
        <div className="pl-9 pr-3 pb-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
            {plan.list.map((c) => {
              const k = byLoc?.get(c.loc) || 0
              const ng = byLoc?.neg?.get(c.loc) || 0
              return (
                <div key={c.loc} className="relative">
                  <button type="button" data-cycle-cell={c.loc} onClick={() => nav(`/cell/${c.loc}`)}
                    className={`w-full text-left rounded-lg border px-2.5 py-1.5 ${c.done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white hover:border-indigo-300'}`}>
                    <p className={`font-mono text-sm font-bold ${c.done ? 'text-emerald-700' : 'text-indigo-600'}`}>{c.loc}</p>
                    <p className="text-[10px] text-slate-500">{c.done ? '오늘 셈 ✓' : `${byLoc ? (k ? `품목 ${k}` : '빈 칸') : '…'} · ${c.last ? `마지막 ${md(c.last)}` : '처음'}`}
                      {!c.done && ng > 0 && <b className="text-rose-600"> · 음수 {ng}</b>}</p>
                  </button>
                  {!c.done && cyc.holdSetup && (
                    <button type="button" data-cycle-hold={c.loc} title="이 칸 보류 — 못 세는 사정이 있을 때 (음수 정리 대기 등). 오늘 목록에서 빼고 다음 칸으로 채웁니다"
                      onClick={() => setHoldForm({ loc: c.loc, reason: holdReasonDefault(ng) })}
                      className="absolute right-1.5 top-1.5 px-1.5 py-0.5 rounded-md border border-slate-200 bg-white text-[10px] text-slate-500 hover:border-amber-300 hover:text-amber-700">⏸</button>
                  )}
                </div>
              )
            })}
          </div>
          {holdForm && (
            <div data-cycle-hold-form className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
              <b className="text-xs text-amber-800">⏸ <span className="font-mono">{holdForm.loc}</span> 보류</b>
              <input data-cycle-hold-reason value={holdForm.reason} onChange={(e) => setHoldForm((f) => ({ ...f, reason: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') doHold() }}
                placeholder="사유 — 예: 음수 재고 · 입고 대기 / 칸 막힘" className="flex-1 min-w-[200px] px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white" />
              <button type="button" data-cycle-hold-ok onClick={doHold} disabled={holdApi.busy}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40">보류</button>
              <button type="button" onClick={() => setHoldForm(null)} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 bg-white text-slate-500">취소</button>
            </div>
          )}
          {holds.length > 0 && (
            <div data-cycle-held className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-2">
              <p className="text-xs font-bold text-amber-800">⏸ 보류 {holds.length}칸 <span className="font-normal text-amber-700/70">— 오늘 목록에서 빼고 다음 칸으로 채움 · 음수가 다 풀리거나 그 칸을 세면 저절로 풀림</span></p>
              {holds.map((h) => {
                const days = Math.max(0, Math.round((new Date(cyc.today) - new Date(h.held_date)) / 86400000)) + 1
                return (
                  <div key={h.location} data-cycle-held-row={h.location} className="flex flex-wrap items-center gap-2 mt-1.5 text-xs">
                    <button type="button" onClick={() => nav(`/cell/${h.location}`)} className="font-mono font-bold text-indigo-600 hover:underline">{h.location}</button>
                    <span className="text-slate-700">{h.reason || '사유 없음'}</span>
                    <span className="text-slate-400">{md(h.held_date)}부터 · {days}일째{h.held_name ? ` · ${h.held_name}` : ''}</span>
                    {h.neg_cnt > 0 && <span className="px-1.5 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-600 font-bold text-[10px]">음수 남음 {h.neg_cnt}</span>}
                    <button type="button" data-cycle-unhold={h.location} onClick={() => holdApi.release(h.location)} disabled={holdApi.busy}
                      className="ml-auto px-2.5 py-1 rounded-lg border border-slate-200 bg-white font-bold text-slate-600 hover:text-amber-700 disabled:opacity-40">풀기</button>
                  </div>
                )
              })}
            </div>
          )}
          {isMe && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[11px] text-slate-400">못 한 날은 넘기지 않습니다 — 매일 {DAILY}칸 · 시간 나면 더 세도 됩니다</span>
              {cyc.extra > 0 && <button type="button" onClick={cyc.less} className="ml-auto text-[11px] text-slate-400">기본 {DAILY}칸으로</button>}
              <button type="button" data-cycle-todo-more onClick={cyc.more} disabled={!plan.pendingAll}
                className={`${cyc.extra > 0 ? '' : 'ml-auto '}px-2.5 py-1 text-[11px] font-bold rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 disabled:opacity-40`}>＋ {DAILY}칸 더</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
