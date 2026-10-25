// 업무 흐름 지도 (v4.98.0) — 부서마다 한 줄 · 왼쪽부터 일의 순서 · 부서를 건너가는 일은 화살표 · 곁일은 오른쪽
//   숫자 공개 규칙 · 칸 정의는 lib/flowMap.js. 휴대폰은 이 지도 대신 부서별 상세(WorkFlow)를 쓴다.
import { useState, useMemo, useRef, useLayoutEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { flowCountsQuery } from '../lib/flowSeen'
import { docCountsQuery } from '../lib/docRequest'
import { useMyProfile, canAccessPath } from '../hooks/useProfile'
import { primaryCsCode } from '../lib/customers'
import { fetchControlTowerData } from '../lib/controlTowerData'
import { computeControlTower } from '../lib/controlTower'
import { ctKpiOf, menuName } from '../lib/workflow'
import { MAP_DEPTS, MAP_NODES, MAP_SUBS, MAP_KEYS, mapGeometry, mapViewer, cellOf } from '../lib/flowMap'

const nf = (v) => Number(v || 0).toLocaleString('ko-KR')
const BUB = { red: 'bg-[#e0505f] text-white', amber: 'bg-[#f2b630] text-white', violet: 'bg-[#6c5ce7] text-white', gray: 'bg-slate-400 text-white' }
const EDGE = { idle: '#c3c8d4', act: '#8b7cf0', hi: '#6c5ce7' }
const BORDER = { red: 'border-[#f2b3bb]', amber: 'border-[#f0d28f]', violet: 'border-[#cfc6fa]', gray: 'border-slate-200' }
const PHASES = [['견적 ⇠ 고객사', 0, 0], ['수주 · 회신', 1, 2], ['자재 준비 — 발주 · 입고 · 불출', 3, 5], ['생산', 6, 6], ['검수 → 납품 ⇢ 고객사', 7, 7]]

export default function FlowMap() {
  const nav = useNavigate()
  const { data: profile } = useMyProfile()
  const viewer = mapViewer(profile)
  const pcs = (primaryCsCode(profile) || 'ax').toLowerCase()

  const { data: c = null } = useQuery({ ...flowCountsQuery, enabled: !!profile })
  const { data: d = null } = useQuery({ ...docCountsQuery, enabled: !!profile })
  // 관제탑 숫자(발주 필요 · 입고 지연)는 무거워서 구매자재 숫자를 볼 수 있을 때만 받는다 — 관제탑과 같은 키
  const needCt = !!profile && (viewer.all || viewer.mine === '구매자재') && canAccessPath(profile, '/inbound')
  const { data: ctData } = useQuery({
    queryKey: ['controlTower', 'all'], queryFn: () => fetchControlTowerData('all'),
    enabled: needCt, staleTime: 5 * 60 * 1000,
  })
  const ct = needCt ? ctKpiOf(ctData, computeControlTower) : null
  const data = { c, ct, d }

  const ref = useRef(null)
  const [w, setW] = useState(1100)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const set = () => setW(el.clientWidth || 1100)
    set()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const geo = useMemo(() => mapGeometry(w), [w])
  const [sel, setSel] = useState(null)   // { id, dept, name, key, spec }

  if (!profile) return null
  const can = (p) => canAccessPath(profile, String(p).split('?')[0])
  const key = sel?.key || null
  const pick = (spec, dept) => {
    if (sel?.id === spec.id) { setSel(null); return }
    setSel({ id: spec.id, dept, name: spec.name, key: spec.keys[0] || null, spec })
  }
  const relFlow = (k) => viewer.all || MAP_NODES.some((n) => n.keys.includes(k) && n.dept === viewer.mine)
    || (MAP_SUBS[viewer.mine] || []).some((s) => s.keys.includes(k))

  const selCell = sel ? cellOf(sel.spec, sel.dept, viewer, data) : null
  const selLinks = sel ? sel.spec.go(pcs).map((p) => ({ path: p, label: menuName(p) })) : []

  return (
    <div className="space-y-2" data-flowmap>
      <div ref={ref} className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <div className="relative" style={{ width: geo.W, height: geo.H }} data-flowmap-host>
          {/* 단계 머리 */}
          {PHASES.map(([t, a, b]) => {
            const l = geo.colX(a) - 4, r = geo.colX(b) + geo.NW + 4
            return (
              <div key={t} className="absolute flex justify-center border-t-[1.5px] border-slate-100" style={{ left: l, top: 12, width: r - l }}>
                <span className="-mt-[10px] bg-white px-2 h-[18px] leading-[16px] rounded-full border border-slate-200 text-[10.5px] font-bold text-slate-400 whitespace-nowrap">{t}</span>
              </div>
            )
          })}
          <div className="absolute flex justify-center border-t-[1.5px] border-slate-100" style={{ left: geo.SUBX, top: 12, width: geo.SUB - 10 }}>
            <span className="-mt-[10px] bg-white px-2 h-[18px] leading-[16px] rounded-full border border-slate-200 text-[10.5px] font-bold text-slate-400 whitespace-nowrap">곁일 — 순서 없이 생기는 일</span>
          </div>

          {/* 부서 줄 */}
          {MAP_DEPTS.map((dept, r) => {
            const mine = dept === viewer.mine
            return (
              <div key={dept} data-flowmap-lane={dept}
                className={`absolute left-0 border-t border-slate-100 ${mine ? 'bg-violet-50/50 shadow-[inset_4px_0_0_#6c5ce7]' : ''}`}
                style={{ top: geo.laneTop(r) + 2, width: geo.W, height: geo.LH - 4 }}>
                <div className="absolute left-3 text-[13px] leading-4" style={{ top: geo.LH / 2 - 12 }}>
                  <b className="font-extrabold text-slate-800">{dept}</b>
                  {mine && <span className="block text-[10px] font-bold text-violet-600">내 부서</span>}
                </div>
              </div>
            )
          })}

          {/* 화살표 */}
          <svg className="absolute left-0 top-0 pointer-events-none" width={geo.W} height={geo.H} aria-hidden="true">
            <defs>
              {Object.entries(EDGE).map(([k, col]) => (
                <marker key={k} id={`fm-head-${k}`} viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L8 4 L0 8 Z" fill={col} />
                </marker>
              ))}
            </defs>
            {geo.edges.map((e) => {
              const state = key ? (e.key === key ? 'hi' : 'dim') : relFlow(e.key) ? 'act' : 'idle'
              const col = state === 'dim' ? EDGE.idle : EDGE[state]
              return (
                <path key={e.id} data-flowmap-edge={e.id} data-state={state}
                  d={e.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')}
                  fill="none" stroke={col} strokeWidth={state === 'hi' ? 2.6 : 1.6} strokeLinejoin="round"
                  className={state === 'act' ? 'pm-flow-dash' : ''} opacity={state === 'dim' ? 0.15 : 1}
                  markerEnd={`url(#fm-head-${state === 'dim' ? 'idle' : state})`} />
              )
            })}
          </svg>
          {geo.edges.filter((e) => e.lab).map((e) => (
            <span key={e.id} data-flowmap-label={e.id} className={`absolute -translate-x-1/2 px-1 rounded bg-white text-[10.5px] leading-[14px] font-bold text-slate-400 whitespace-nowrap pointer-events-none transition-opacity ${key && e.key !== key ? 'opacity-10' : ''}`}
              style={{ left: e.lab.x, top: e.lab.y }}>{e.label}</span>
          ))}

          {/* 칸 */}
          {MAP_NODES.map((n) => {
            const b = geo.box[n.id]
            const cell = cellOf(n, n.dept, viewer, data)
            const dim = key && !n.keys.includes(key)
            const on = sel?.id === n.id || (key && n.keys.includes(key))
            const other = !cell.show
            const bub = cell.show ? (cell.lead ? { n: cell.lead.n, cls: BUB[cell.lead.tone] || BUB.gray } : null)
              : cell.rel && cell.rel.n > 0 ? { n: cell.rel.n, cls: 'bg-white text-[#6c5ce7] border-[1.5px] border-[#6c5ce7]' } : null
            return (
              <button key={n.id} type="button" onClick={() => pick(n, n.dept)} data-flowmap-node={n.id} data-node-name={n.name}
                data-other={other ? '1' : '0'} data-rel={cell.rel ? cell.rel.n ?? '' : ''}
                title={other ? (cell.rel ? `나와 관련: ${cell.rel.t} ${nf(cell.rel.n)}` : '다른 부서 — 숫자는 담당 부서 · 팀장만') : cell.badges.map((x) => `${x.t} ${nf(x.n)}`).join(' · ')}
                className={`absolute flex items-center justify-center text-center px-1 rounded-[9px] border-[1.5px] text-[11.5px] leading-[13px] tracking-[-.3px] overflow-visible transition ${
                  other ? `${cell.rel ? 'border-[#a99cf5] text-[#5b4ee8]' : 'border-slate-200 text-slate-500'} border-dashed bg-slate-50/70 font-semibold`
                  : `bg-white font-bold text-slate-800 ${cell.lead ? BORDER[cell.lead.tone] : 'border-slate-200'}`
                } ${on ? '!border-[#6c5ce7] shadow-[0_0_0_3px_rgba(108,92,231,.35)]' : ''} ${dim ? 'opacity-25' : ''}`}
                style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
                <span className="line-clamp-2 break-keep">{n.name}</span>
                {bub && <i data-flowmap-bub className={`not-italic absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 rounded-full font-mono text-[10.5px] font-bold flex items-center justify-center ${bub.cls}`}>{nf(bub.n)}</i>}
              </button>
            )
          })}

          {/* 곁일 — 같은 크기 칸 2열 */}
          {MAP_DEPTS.map((dept, r) => (
            <div key={dept} className="absolute grid grid-cols-2 gap-x-1.5 gap-y-1 content-center" data-flowmap-subs={dept}
              style={{ left: geo.SUBX, top: geo.laneTop(r) + 6, width: geo.SUB - 12, height: geo.LH - 12, gridAutoRows: '20px' }}>
              {(MAP_SUBS[dept] || []).map((s) => {
                const cell = cellOf(s, dept, viewer, data)
                const dim = key && !s.keys.includes(key)
                const on = sel?.id === s.id || (key && s.keys.includes(key))
                const lead = cell.show ? cell.lead : null
                return (
                  <button key={s.id} type="button" onClick={() => pick(s, dept)} data-flowmap-sub={s.id} data-sub-name={s.name}
                    className={`flex items-center gap-1 min-w-0 h-5 px-1.5 rounded-md border text-[11px] text-left transition ${s.id.endsWith('9') || s.name.startsWith('📎') ? 'bg-[#fff7ec] border-[#f3d9b1]' : 'bg-slate-50 border-slate-200/80'} ${on ? '!border-[#6c5ce7] shadow-[0_0_0_2px_rgba(108,92,231,.35)]' : ''} ${dim ? 'opacity-25' : ''}`}>
                    {s.from && <span className="shrink-0 text-[10px] font-bold text-slate-400">⇠{s.from === '구매자재' ? '구매' : s.from}</span>}
                    <span className="flex-1 min-w-0 truncate font-semibold text-slate-600">{s.name}</span>
                    {s.note && cell.show && <span className="shrink-0 px-1.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold">{s.note}</span>}
                    {lead && <span className={`shrink-0 px-1.5 rounded-full text-[10px] font-bold font-mono ${BUB[lead.tone]}`}>{nf(lead.n)}</span>}
                    {!cell.show && cell.rel && cell.rel.n > 0 && <span className="shrink-0 px-1.5 rounded-full text-[10px] font-bold bg-[#eeebfd] text-[#5b4ee8]">나 {nf(cell.rel.n)}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-slate-400" data-flowmap-legend>
        <span><i className="inline-block w-3.5 h-2.5 rounded-[3px] border-[1.5px] border-[#f2b3bb] mr-1 align-[-1px]" />내 부서 숫자</span>
        <span><i className="inline-block w-3.5 h-2.5 rounded-[3px] border-[1.5px] border-dashed border-[#a99cf5] mr-1 align-[-1px]" />다른 부서 — 나와 관련된 숫자만</span>
        <span><i className="inline-block w-3.5 h-2.5 rounded-[3px] border-[1.5px] border-dashed border-slate-300 mr-1 align-[-1px]" />다른 부서 — 숫자 안 보임</span>
        <span><i className="inline-block w-5 border-t-2 border-dashed border-[#8b7cf0] mr-1 align-[3px]" />나와 이어진 흐름</span>
        <span className="ml-auto">{viewer.all ? '팀장급 — 모든 부서 숫자' : '흐름은 모두 보이고, 숫자는 내 부서와 나와 관련된 것만 보입니다'}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-[12.5px] text-slate-600 min-h-[44px]" data-flowmap-sel>
        {!sel ? <span className="text-slate-400">칸을 누르면 그 칸이 속한 흐름(화살표 · 이어진 칸)만 진하게 보이고, 여기서 화면으로 갈 수 있습니다.</span> : (
          <>
            {key && <span className="text-slate-500">🔗 {MAP_KEYS[key]}</span>}
            <span className="font-bold text-slate-800">· {sel.dept} {sel.name}</span>
            {selCell.show ? (selCell.badges.length
              ? selCell.badges.map((b) => <span key={b.t} className="px-1.5 py-[1px] rounded-full bg-slate-100 text-[11.5px] font-bold">{b.t} <b className="font-mono">{nf(b.n)}</b></span>)
              : <span className="text-slate-400">밀린 일 없음</span>)
              : selCell.rel ? <span className="px-1.5 py-[1px] rounded-full bg-[#eeebfd] text-[#5b4ee8] text-[11.5px] font-bold">나와 관련 · {selCell.rel.t} {nf(selCell.rel.n)}</span>
                : <span className="text-slate-400">다른 부서 — 숫자는 담당 부서 · 팀장만 봅니다</span>}
            <span className="ml-auto flex flex-wrap gap-1.5">
              {selLinks.map((l) => (
                <button key={l.path} type="button" disabled={!can(l.path)} onClick={() => nav(l.path)} data-flowmap-go={l.label}
                  className="px-2.5 py-1 rounded-lg border border-violet-200 bg-white text-[12px] font-bold text-[#5b6ee8] hover:bg-violet-50 disabled:border-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed">
                  {can(l.path) ? `${l.label} →` : `${l.label} · 권한 없음`}
                </button>
              ))}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
