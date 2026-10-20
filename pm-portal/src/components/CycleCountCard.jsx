import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useMe } from '../hooks/useProfile'
import { useCycleBase } from '../hooks/useCycleCount'
import { todayISO } from '../lib/utils'
import {
  DAILY, ownerCells, checkMap, todayPlan, roundStats, itemsByLoc, workload, rackRanges, normLoc, loadExtra, saveExtra,
} from '../lib/cycleCount'

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')
const md = (d) => (d ? String(d).slice(5, 10) : '')
const OPEN_KEY = 'pm.cycleCard.open'
const loadOpen = () => { try { return localStorage.getItem(OPEN_KEY) !== '0' } catch { return true } }

// 재고현황 맨 위 — 「오늘 실사」 (v4.76.0)
//   로그인한 사람의 담당 렉에서 오늘 셀 칸 5개. 칸을 누르면 칸 실사 화면으로 간다.
//   다 세면 「＋5칸 더」로 더 셀 수 있다 (빈 칸이 많은 날 · 시간 남는 날).
//   아래 줄: 세 사람의 오늘 · 한 바퀴 진행 — 누르면 그 사람 목록을 본다.
export default function CycleCountCard({ inv = [], onScan }) {
  const nav = useNavigate()
  const me = useMe()
  const today = todayISO()
  const { data: base, isLoading, error } = useCycleBase()
  const [open, setOpen] = useState(loadOpen)
  const [extra, setExtra] = useState(() => loadExtra(today))
  const [view, setView] = useState(null)   // 다른 사람 목록 볼 때

  const byOwner = useMemo(() => ownerCells(base?.racks, base?.owners), [base])
  const cm = useMemo(() => checkMap(base?.checks), [base])
  const byLoc = useMemo(() => itemsByLoc(inv), [inv])
  // 오늘 칸별 마지막 기록 (맞음 / 차이 / 빈 칸)
  const todayRec = useMemo(() => {
    const m = new Map()
    for (const c of base?.checks || []) {
      if (c.id == null || String(c.check_date).slice(0, 10) !== today) continue
      const k = normLoc(c.location)
      if (!m.has(k) || m.get(k).id < c.id) m.set(k, c)
    }
    return m
  }, [base, today])

  const names = [...byOwner.keys()]
  const myName = me?.name && byOwner.has(me.name) ? me.name : null
  const who = view || myName
  const mine = who ? byOwner.get(who) : null
  const isMe = who && who === myName
  const target = isMe ? DAILY + extra * DAILY : DAILY
  const plan = useMemo(() => (mine ? todayPlan(mine.cells, cm, today, target, mine.late) : null), [mine, cm, today, target])
  const rs = useMemo(() => (mine ? roundStats(mine.cells, cm) : null), [mine, cm])
  const wl = useMemo(() => (mine ? workload(mine.cells, byLoc) : null), [mine, byLoc])

  // 최근 실사 차이 (반영된 것) — 2주
  const { data: diffs = [] } = useQuery({
    queryKey: ['cycleDiffs'],
    enabled: !!base?.setup && open,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)
      const { data, error } = await supabase.from('pm_stock_audit')
        .select('id,audit_date,location,std_code,book_qty,counted_qty,diff,counted_by,memo')
        .neq('diff', 0).gte('audit_date', since)
        .order('audit_date', { ascending: false }).order('id', { ascending: false }).limit(15)
      if (error) throw error
      const uids = [...new Set((data || []).map((r) => r.counted_by).filter(Boolean))]
      const nm = {}
      if (uids.length) {
        const { data: us } = await supabase.rpc('pm_user_names', { p_ids: uids })
        ;(us || []).forEach((u) => { nm[u.id] = u.name })
      }
      return (data || []).map((r) => ({ ...r, who: nm[r.counted_by] || '' }))
    },
  })

  const toggleOpen = () => setOpen((o) => { try { localStorage.setItem(OPEN_KEY, o ? '0' : '1') } catch { /* */ } return !o })
  const more = () => { const x = extra + 1; setExtra(x); saveExtra(today, x) }
  const less = () => { setExtra(0); saveExtra(today, 0) }

  if (isLoading) return null
  if (error) return <p className="text-xs text-rose-500">순환 실사 불러오기 실패: {error.message}</p>
  if (!base?.setup) {
    return (
      <div data-cycle-setup className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        📋 순환 실사를 쓰려면 DB 설정(순환실사_261020.sql)을 먼저 실행해야 합니다.
      </div>
    )
  }

  const dayTxt = new Date(`${today}T00:00:00`).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' })
  const pct = plan ? Math.min(100, Math.round((plan.done / Math.max(1, plan.target)) * 100)) : 0
  const goalMet = plan && plan.done >= plan.target

  return (
    <div data-cycle-card className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-[11px] text-indigo-600 font-bold">오늘 실사 · {dayTxt}</p>
          <h3 className="text-base font-bold text-slate-900">
            📋 {who ? `${who}${isMe ? '' : ' 님'} 담당` : '순환 실사'}
            {mine && <span className="ml-2 text-xs font-normal text-slate-400">{rackRanges(mine.racks.filter(c => !mine.lateRacks.includes(c)), base.racks)}{mine.lateRacks.length ? ` · ${mine.lateRacks.join(' · ')}(맨 뒤)` : ''} · {n(wl.cells)}칸 · 품목 {n(wl.items)}개</span>}
          </h3>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {plan && <span data-cycle-count className="text-sm text-slate-500"><b className="text-2xl text-slate-900">{plan.done}</b> / {plan.target}칸</span>}
          <button type="button" onClick={toggleOpen} className="text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">{open ? '접기' : '펼치기'}</button>
        </div>
      </div>

      {open && (
        <>
          {!who && (
            <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
              {me?.name ? `${me.name} 님은 담당 렉이 없습니다.` : '담당 렉이 없습니다.'} 아래에서 사람을 누르면 그 사람의 오늘 칸을 볼 수 있습니다.
            </p>
          )}

          {plan && (
            <>
              <div className="h-2 rounded-full bg-indigo-50 overflow-hidden">
                <div className={`h-full rounded-full ${goalMet ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
              </div>

              {isMe && (
                <button type="button" onClick={onScan}
                  className="sm:hidden w-full py-3 text-sm font-bold rounded-xl bg-indigo-600 text-white">📷 칸 QR 찍고 세기</button>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {plan.list.map((c) => {
                  const rec = todayRec.get(c.loc)
                  const k = byLoc.get(c.loc) || 0
                  const tone = !c.done ? 'border-slate-200 bg-white hover:border-indigo-300'
                    : rec && rec.diff_cnt > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'
                  const sub = c.done
                    ? (rec?.empty ? '빈 칸 확인 ✓' : rec && rec.diff_cnt > 0 ? `차이 ${rec.diff_cnt}품목 · 반영됨` : `맞음${rec ? ` · 품목 ${rec.item_cnt}` : ''} ✓`)
                    : `${k ? `품목 ${k}` : '빈 칸'} · ${c.last ? `마지막 ${md(c.last)}` : '처음'}`
                  return (
                    <button key={c.loc} type="button" data-cycle-cell={c.loc} onClick={() => nav(`/cell/${c.loc}`)}
                      className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${tone}`}>
                      <p className={`font-mono text-base font-bold ${!c.done ? 'text-indigo-600' : rec && rec.diff_cnt > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{c.loc}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
                    </button>
                  )
                })}
                {!plan.list.length && <p className="text-xs text-slate-400 col-span-full">담당 칸이 없습니다.</p>}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[11px] text-slate-400">
                  {goalMet ? <b className="text-emerald-600">오늘 목표 끝 ✓ </b> : null}
                  순서: 담당 렉 앞에서부터 · 안 센 칸 · 오래 안 센 칸 먼저 · 빈 칸도 포함 · 「맨 뒤」 렉(불용재고 등)은 한 바퀴 끝에 · 목록에 없는 칸을 QR 로 세도 오늘 센 칸에 들어갑니다
                </p>
                {isMe && (
                  <div className="ml-auto flex items-center gap-1.5">
                    {extra > 0 && <button type="button" onClick={less} className="text-[11px] text-slate-400 hover:text-slate-600 px-1">기본 {DAILY}칸으로</button>}
                    <button type="button" data-cycle-more onClick={more} disabled={!plan.pendingAll}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-40">＋ {DAILY}칸 더</button>
                  </div>
                )}
                {!isMe && myName && (
                  <button type="button" onClick={() => setView(null)} className="ml-auto text-xs font-semibold text-indigo-600">← 내 목록</button>
                )}
              </div>
            </>
          )}

          {/* 세 사람 — 오늘 · 한 바퀴 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {names.map((nm) => {
              const o = byOwner.get(nm)
              const p = todayPlan(o.cells, cm, today, DAILY, o.late)
              const r = roundStats(o.cells, cm)
              const w = workload(o.cells, byLoc)
              const on = nm === who
              return (
                <button key={nm} type="button" data-cycle-owner={nm} onClick={() => setView(nm === myName ? null : nm)}
                  className={`text-left rounded-xl border px-3 py-2.5 ${on ? 'border-indigo-300 bg-indigo-50/50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                  <p className="text-sm font-bold text-slate-800">{nm}
                    <span className="ml-1.5 text-xs font-normal text-slate-400">{n(w.cells)}칸 · 품목 {n(w.items)}</span></p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    오늘 <b className={p.done >= DAILY ? 'text-emerald-600' : ''}>{p.done}</b>/{DAILY}{p.done >= DAILY ? ' ✓' : ''}
                    <span className="text-slate-300"> · </span>{r.round}바퀴째 {r.pct}% <span className="text-slate-400">({n(r.counted)}/{n(r.total)}칸)</span>
                  </p>
                </button>
              )
            })}
          </div>

          {/* 최근 실사 차이 */}
          {diffs.length > 0 && (
            <div className="overflow-x-auto">
              <p className="text-xs font-bold text-slate-600 mb-1.5">최근 실사 차이 <span className="font-normal text-slate-400">(2주 · 재고에 반영됨)</span></p>
              <table data-cycle-diffs className="w-full text-xs">
                <thead><tr className="bg-slate-50 text-slate-500">
                  <th className="text-left px-2 py-1.5 font-semibold">날짜</th><th className="text-left px-2 py-1.5 font-semibold">칸</th>
                  <th className="text-left px-2 py-1.5 font-semibold">품번</th><th className="text-right px-2 py-1.5 font-semibold">장부</th>
                  <th className="text-right px-2 py-1.5 font-semibold">실제</th><th className="text-right px-2 py-1.5 font-semibold">차이</th>
                  <th className="text-left px-2 py-1.5 font-semibold">센 사람</th><th className="text-left px-2 py-1.5 font-semibold">사유</th>
                </tr></thead>
                <tbody>
                  {diffs.map((d) => (
                    <tr key={d.id} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 text-slate-500">{md(d.audit_date)}</td>
                      <td className="px-2 py-1.5 font-mono">{d.location}</td>
                      <td className="px-2 py-1.5 font-mono text-indigo-600">{d.std_code}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{n(d.book_qty)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{n(d.counted_qty)}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${d.diff < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{d.diff > 0 ? '+' : ''}{n(d.diff)}</td>
                      <td className="px-2 py-1.5 text-slate-600">{d.who || '—'}</td>
                      <td className="px-2 py-1.5 text-slate-400">{d.memo || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
