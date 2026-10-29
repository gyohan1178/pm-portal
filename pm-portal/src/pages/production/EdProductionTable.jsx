// 생산관리 · Edwards 화면 (호기별 자재 준비)
//
//   작업자가 따로 쓰던 「Forecast 자재 준비 현황」 HTML 을 옮긴 것.
//   AXCELIS 와 같은 칸 동작(누르면 완료 · ✎ 날짜)을 쓰고 머리글만 Edwards 에 맞춘다.
//
//   v4.118.2 — 프로젝트 #호기 / 파트 | 구분 | 발주서 | 품목 줄 | 금액 | 납기 | 상태 | 가공물 입고 |
//   하네스 · 전장 불출 | 품질 | 미불출 | 비고   (구분1·2·3 · 발주 Remark · 담당자 칸은 뺌)
//
//   ⚠ 정한 납기 · 불출 예정은 lib/edForecast.js 에서 계산한다 (저장값 아님).
//     사람이 넣는 값: 확정 납기(due_fix) · Frame 확정(arrival_date) · 발주서(po_received) · 불출 · 품질 · 미불출 · 비고
import { useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { KINDS, kindOf, ruleKindOf, dueOf, issueDueOf, issueBaseOf, qcDueOf } from '../../lib/edForecast'
import { guessBom, bomKey, WHICH_LABEL, bomGroupOf, bomProjectFor } from '../../lib/edNeed'
import Spin from '../../components/ux/Spin'
import { orderOf, edHogiKey } from '../../lib/edOrderSync'

const dayMs = 86400000
export function dday(d) {
  if (!d) return null
  const x = new Date(String(d).slice(0, 10) + 'T00:00:00')
  if (isNaN(x)) return null
  const t = new Date(); t.setHours(0, 0, 0, 0)
  return Math.round((x - t) / dayMs)
}
const md = (d) => (d ? String(d).slice(5, 10) : '')
const truthy = (v) => v === true || (typeof v === 'string' && v.trim() && v !== 'false')
const KIND_LABEL = { 'EUV': 'EUV', 'H2D-LH': 'H2D-LH', 'H2D-HPD': 'H2D-HPD' }

// 화면에 쓰는 날짜 — 정한 납기, 없으면 납품요청일
export const edDateOf = (r) => dueOf(r)?.date || (r.req_date ? String(r.req_date).slice(0, 10) : null)

// ── 걸러 보기 ────────────────────────────────────────────────────────
//   f = { kind: all|EUV|H2D|etc, po: all|no|yes, quick: null|harn|elec|nopo|fix|fc }
export function edPass(r, f, rules) {
  const k = kindOf(r)
  if (f.kind === 'EUV' && k !== 'EUV') return false
  if (f.kind === 'H2D' && !(k || '').startsWith('H2D')) return false
  if (f.kind === 'etc' && k) return false
  if (f.po === 'no' && r.po_received) return false
  if (f.po === 'yes' && !r.po_received) return false
  if (f.quick === 'harn' || f.quick === 'elec') {
    const done = f.quick === 'harn' ? truthy(r.harness_recv) : truthy(r.part_issue)
    const n = dday(issueDueOf(r, rules, f.quick))
    if (done || n == null || n > 7) return false
  }
  if (f.quick === 'nopo' && r.po_received) return false
  if (f.quick === 'fix' && !r.due_fix) return false
  if (f.quick === 'fc' && !r.fc_new) return false
  return true
}

// ── 요약 띠 ─────────────────────────────────────────────────────────
export function EdSummary({ rows, rules, quick, setQuick }) {
  const live = rows.filter(r => r.status !== '완료')
  const cnt = { EUV: 0, 'H2D-LH': 0, 'H2D-HPD': 0, etc: 0 }
  const late = { harn: [0, 0], elec: [0, 0] }
  let nopo = 0, fix = 0, fcNew = 0
  for (const r of live) {
    const k = kindOf(r)
    cnt[k || 'etc']++
    for (const w of ['harn', 'elec']) {
      const done = w === 'harn' ? truthy(r.harness_recv) : truthy(r.part_issue)
      const n = dday(issueDueOf(r, rules, w))
      if (done || n == null) continue
      if (n < 0) late[w][0]++
      else if (n <= 7) late[w][1]++
    }
    if (!r.po_received) nopo++
    if (r.due_fix) fix++
    if (r.fc_new) fcNew++
  }
  const Box = ({ id, label, children, title }) => (
    <button type="button" title={title} onClick={() => id && setQuick(quick === id ? null : id)}
      className={`flex-1 min-w-[130px] text-left px-4 py-2.5 border-r border-slate-100 last:border-0 ${id ? 'hover:bg-slate-50' : 'cursor-default'} ${quick && quick === id ? 'bg-indigo-50/70' : ''}`}>
      <div className="text-[11px] text-slate-500">{label}{quick && quick === id && <span className="ml-1 text-indigo-500 font-bold">· 보는 중</span>}</div>
      <div className="text-lg font-extrabold text-slate-800 leading-tight">{children}</div>
    </button>
  )
  return (
    <div className="flex flex-wrap bg-white border border-slate-200 rounded-xl mb-2 overflow-hidden">
      <Box label="진행 줄">
        {live.length} <span className="text-xs font-semibold text-slate-400">EUV {cnt.EUV} · LH {cnt['H2D-LH']} · HPD {cnt['H2D-HPD']} · 기타 {cnt.etc}</span>
      </Box>
      <Box id="harn" label="하네스 불출 지남 / 7일 내" title="누르면 이 줄만 봅니다">
        <span className="text-red-600">{late.harn[0]}</span> <span className="text-xs text-slate-300">/</span> <span className="text-orange-500">{late.harn[1]}</span>
      </Box>
      <Box id="elec" label="전장 불출 지남 / 7일 내" title="누르면 이 줄만 봅니다">
        <span className="text-red-600">{late.elec[0]}</span> <span className="text-xs text-slate-300">/</span> <span className="text-orange-500">{late.elec[1]}</span>
      </Box>
      <Box id="nopo" label="발주서 미접수" title="누르면 이 줄만 봅니다">{nopo}</Box>
      <Box id="fix" label="확정 납기" title="누르면 이 줄만 봅니다">{fix}</Box>
      {/* v4.118.1 — 포캐스트 반영 단추를 빼면서 「포캐스트 반영」 칸도 뺌 (포캐스트로 만든 줄이 남아 있을 때만 보임) */}
      {fcNew > 0 && (
        <Box id="fc" label="포캐스트로 만든 줄" title="예전에 포캐스트로 새로 만든 줄 — 누르면 이 줄만 봅니다">
          <span className="text-sm">{fcNew}</span>
        </Box>
      )}
    </div>
  )
}

// ── 걸러 보기 단추 ────────────────────────────────────────────────────
export function EdFilters({ f, setF }) {
  const Seg = ({ k, opts }) => (
    <span className="inline-flex bg-slate-100 rounded-lg p-0.5">
      {opts.map(([v, l]) => (
        <button key={v} type="button" onClick={() => setF(s => ({ ...s, [k]: v }))}
          className={`px-2.5 py-1 text-[11px] font-semibold rounded-md ${f[k] === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{l}</button>
      ))}
    </span>
  )
  return (
    <div className="flex flex-wrap items-center gap-2 mb-2">
      <Seg k="kind" opts={[['all', '전체'], ['EUV', 'EUV'], ['H2D', 'H2D'], ['etc', 'MFM·BDM 등']]} />
      <Seg k="po" opts={[['all', '발주 전체'], ['no', '발주서 미접수'], ['yes', '접수']]} />
      {f.quick && (
        <button type="button" onClick={() => setF(s => ({ ...s, quick: null }))}
          className="px-2 py-1 text-[11px] font-bold rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100">요약 칸 거르기 풀기 ✕</button>
      )}
    </div>
  )
}

// ── 칸들 ────────────────────────────────────────────────────────────
function DueCell({ r, onField }) {
  const [editing, setEditing] = useState(false)
  const k = kindOf(r)
  const d = dueOf(r)
  const save = (v) => {
    setEditing(false)
    const cur = r.due_fix ? String(r.due_fix).slice(0, 10) : ''
    if (!r.due_fix && v && v === d?.fc) return        // 포캐스트 날짜를 그대로 두고 나가면 확정이 아니다
    if (v !== cur) onField(r.id, 'due_fix', v || null)
  }
  if (editing) {
    return <td className="px-2 py-2 border-l border-slate-100">
      <input type="date" autoFocus defaultValue={d?.date || ''}
        onBlur={e => save(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(e.target.value); if (e.key === 'Escape') setEditing(false) }}
        className="text-[11px] border border-indigo-300 rounded px-1 py-0.5 w-28" />
      <span className="block text-[8px] text-slate-400 mt-0.5">비우면 포캐스트로</span>
    </td>
  }
  // 남은 날만 D-N 으로 띄운다 (지난 날은 표시 안 함 · 2026-09-30 확정).
  //   포캐스트 날짜가 없어 납품요청일을 대신 보여 줄 때도 D-N 을 띄운다.
  const shownDate = d?.date || (r.req_date ? String(r.req_date).slice(0, 10) : null)
  const n = shownDate ? dday(shownDate) : null
  const live = r.status !== '완료'
  const tag = live && n != null && n >= 0
    ? <span className={`ml-1 text-[10px] font-bold ${n <= 7 ? 'text-orange-600' : n <= 14 ? 'text-yellow-600' : 'text-slate-500'}`}>{n === 0 ? 'D-Day' : `D-${n}`}</span>
    : null
  const src = k === 'EUV' ? 'to 정한' : 'H2D 자재'
  return (
    <td data-no-select className="px-2 py-2 border-l border-slate-100 text-center whitespace-nowrap group"
      title={d ? (d.fixed ? `확정 납기 · 포캐스트 ${d.fc || '없음'}` : `포캐스트 ${src} 기준 · ✎ 로 확정 납기 입력`)
        : '납품요청일 (수주대장 발주 납기) · ✎ 로 확정 납기 입력'}>
      {d
        ? <span className={d.fixed ? 'font-semibold text-slate-800 border-b-2 border-emerald-400' : 'text-slate-500'}>{md(d.date)}</span>
        : r.req_date ? <span className="text-slate-700">{md(r.req_date)}</span> : <span className="text-slate-300">—</span>}
      {tag}
      <button type="button" onClick={() => setEditing(true)} title="확정 납기 입력 (비우면 포캐스트 날짜)"
        className="ml-0.5 text-[10px] text-slate-300 hover:text-indigo-600 px-0.5">✎</button>
    </td>
  )
}

function FrameCell({ r, onField }) {
  const [editing, setEditing] = useState(false)
  const manual = r.arrival_date ? String(r.arrival_date).slice(0, 10) : null
  const auto = r.fc_frame ? String(r.fc_frame).slice(0, 10) : null
  const val = manual || auto
  const done = truthy(r.machine_recv)
  const save = (v) => {
    setEditing(false)
    if (!manual && v && v === auto) return
    if (v !== (manual || '')) onField(r.id, 'arrival_date', v || null)
  }
  if (done) {
    return <td data-no-select className="px-2 py-2 border-l border-slate-100 cursor-pointer text-center" onClick={() => onField(r.id, 'machine_recv', false)} title="누르면 입고 취소">
      <span className="font-bold text-amber-600">✔ 입고</span>
      {val && <span className="block text-[9px] text-slate-300">{md(val)}</span>}
    </td>
  }
  if (editing) {
    return <td className="px-2 py-2 border-l border-slate-100">
      <input type="date" autoFocus defaultValue={val || ''}
        onBlur={e => save(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(e.target.value); if (e.key === 'Escape') setEditing(false) }}
        className="text-[11px] border border-indigo-300 rounded px-1 py-0.5 w-28" />
    </td>
  }
  if (!val) {
    return <td data-no-select className="px-2 py-2 border-l border-slate-100 cursor-pointer text-center text-slate-300 hover:text-indigo-500" onClick={() => setEditing(true)}>+ 날짜</td>
  }
  return (
    <td data-no-select className="px-2 py-2 border-l border-slate-100 cursor-pointer text-center group whitespace-nowrap"
      title={manual ? `확정 Frame 입고 · 포캐스트 ${auto || '없음'} · 누르면 입고` : '포캐스트 Frame 입고 · 누르면 입고 · ✎ 로 확정일 입력'}
      onClick={() => onField(r.id, 'machine_recv', true)}>
      <span className={manual ? 'font-semibold text-slate-700 border-b-2 border-emerald-400' : 'text-slate-400 group-hover:text-amber-600'}>{md(val)}</span>
      <button type="button" onClick={e => { e.stopPropagation(); setEditing(true) }} title="확정일 입력 (비우면 포캐스트)"
        className="ml-0.5 text-[10px] text-slate-300 hover:text-indigo-600 px-0.5">✎</button>
    </td>
  )
}

function IssueCell({ r, rules, which, onField, need, bom, onNeed }) {
  const field = which === 'harn' ? 'harness_recv' : 'part_issue'
  const done = truthy(r[field])
  const k = ruleKindOf(r)
  const due = issueDueOf(r, rules, which)
  const n = dday(due)
  const w = k ? rules?.days?.[k]?.[which] : null
  const name = which === 'harn' ? '하네스' : '전장'
  const doneCls = which === 'harn' ? 'text-teal-600' : 'text-blue-600'
  const live = r.status !== '완료'
  const cls = !live ? 'text-slate-400' : n == null ? 'text-slate-300' : n < 0 ? 'text-red-600 font-bold' : n <= 7 ? 'text-orange-600 font-bold' : 'text-slate-500'
  return (
    <td data-no-select className={`px-2 py-2 cursor-pointer text-center whitespace-nowrap group ${which === 'harn' ? 'border-l border-slate-100' : ''}`}
      title={done ? `${name} 불출 완료 · 누르면 취소`
        : due ? `${name} 불출 예정 ${due} = ${issueBaseOf(r)?.src} ${issueBaseOf(r)?.date} − ${w}일 (불출 기준)\n누르면 불출 완료`
        : (w === null || w === undefined) && k ? `${k} 불출 기준(일수)이 없습니다 — 「⚙ 불출 기준」 ① 에서 정하면 예정일이 나옵니다 · 누르면 ${name} 불출 완료`
        : k ? `납기가 없어 불출 예정을 계산할 수 없습니다 · 누르면 ${name} 불출 완료` : `누르면 ${name} 불출 완료`}
      onClick={() => onField(r.id, field, !done)}>
      {done
        ? <span className={`${doneCls} font-semibold`}>✔ 불출</span>
        : due
          ? <span className={cls}>{md(due)}</span>
          : <span className="text-slate-300 group-hover:text-teal-500">불출</span>}
      {/* 이 BOM 의 소요량 매칭 결과 — 누르면 그 건의 부족 품목 */}
      {!done && need && (
        <button type="button" onClick={e => { e.stopPropagation(); onNeed?.(need.key) }}
          title={need.bad
            ? `${bom || ''} 부족 ${need.bad}품목\n` + need.parts.filter(p => p.status !== 'ok').slice(0, 8).map(p => `· ${p.pn || ''} 부족 ${p.short}`).join('\n') + '\n누르면 소요량 매칭에서 봅니다'
            : `${bom || ''} 재고 충분 (${need.parts.length}품목)`}
          className={`block mx-auto mt-0.5 px-1 rounded text-[9px] font-bold ${need.bad ? (need.critical ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-amber-50 text-amber-700 hover:bg-amber-100') : 'text-emerald-500 hover:bg-emerald-50'}`}>
          {need.bad ? `⚠ 부족 ${need.bad}` : '✓ 재고'}
        </button>
      )}
      {!done && !need && bom === null && kindOf(r) && <span className="block text-[8px] text-orange-400" title="「⚙ 불출 기준」 ③ 에서 BOM 을 연결하세요">BOM 없음</span>}
    </td>
  )
}

// 품질 — 검수 예정일(정한 납기 − N일, 기본 4일)을 보여 주고 누르면 검수 완료 (v4.118.0)
function QualityCell({ r, rules, onField }) {
  const done = truthy(r.quality_recv)
  const due = qcDueOf(r, rules)
  const n = dday(due)
  const live = r.status !== '완료'
  const cls = !live ? 'text-slate-400' : n == null ? 'text-slate-300' : n < 0 ? 'text-red-600 font-bold' : n <= 3 ? 'text-orange-600 font-bold' : 'text-slate-500'
  return (
    <td data-no-select className="px-2 py-2 border-l border-slate-100 cursor-pointer text-center whitespace-nowrap group" data-ed-qc={due || ''}
      title={done ? '품질검수 완료 · 누르면 취소' : due ? `품질검수 예정 ${due} = ${issueBaseOf(r)?.src} ${issueBaseOf(r)?.date} − ${rules?.qcDays ?? 4}일\n누르면 품질검수 완료` : '납기가 없어 검수 예정을 계산할 수 없습니다 · 누르면 품질검수 완료'}
      onClick={() => onField(r.id, 'quality_recv', !done)}>
      {done ? <span className="text-rose-600 font-bold">✔ 완료</span>
        : due ? <span className={cls}>{md(due)}</span>
        : <span className="text-slate-300 group-hover:text-rose-500">검수</span>}
    </td>
  )
}

function MemoCell({ r, onField }) {
  const [draft, setDraft] = useState(null)
  return (
    <td data-no-select className="px-2 py-2 border-l border-slate-100 text-left max-w-[150px]">
      <input value={draft ?? r.memo ?? ''}
        onChange={e => setDraft(e.target.value)}
        onBlur={e => { const v = e.target.value; if (v !== (r.memo || '')) onField(r.id, 'memo', v || null); setDraft(null) }}
        placeholder="—"
        className="w-full px-1 py-0.5 text-[11px] bg-transparent border-0 border-b border-transparent hover:border-slate-200 focus:border-indigo-400 focus:outline-none" />
    </td>
  )
}

// ── 표 ──────────────────────────────────────────────────────────────
export const ED_COLS = 14
//   v4.118.0 — 「🗂 호기로 묶기」: 프로젝트 #호기 한 줄 아래에 파트 줄 (접고 펼치기) · 「🧾 발주서」 칸 (수주대장 발주 · 줄 · 금액)
const GROUP_KEY = 'pm.edGrouped.v1'
export function EdTable({ list, sel, setSel, rowSel, onField, onEdit, onMissing, rules, statusOpts, statusColor, partColor, projects = [], need = {}, onNeed, orderIdx = null, orderSetup = false }) {
  const ids = list.filter(r => !r._month).map(r => r.id)
  const [grouped, setGroupedRaw] = useState(() => { try { return localStorage.getItem(GROUP_KEY) !== '0' } catch { return true } })
  const setGrouped = (v) => { setGroupedRaw(v); try { localStorage.setItem(GROUP_KEY, v ? '1' : '0') } catch { /* */ } }
  // 호기 묶음 — 목록 순서(정한 납기 순) 그대로, 처음 나온 자리에
  const groups = useMemo(() => {
    const m = new Map()
    for (const r of list) {
      if (r._month) continue
      const k = edHogiKey(r.pn, r.hogi)
      if (!m.has(k)) m.set(k, { key: k, pn: r.pn, hogi: r.hogi, rows: [] })
      m.get(k).rows.push(r)
    }
    return [...m.values()].map((g) => {
      const dates = g.rows.filter(r => r.status !== '완료').map(r => edDateOf(r)).filter(Boolean).sort()
      return { ...g, first: dates[0] || null }
    })
  }, [list])
  // 접고 펼치기 — 기본: 가장 빠른 납기가 14일 안이면 펼침. 「모두 펼치기 · 접기」를 누르면 그 기준
  const [base, setBase] = useState(null)          // null 기본 · 'open' · 'close'
  const [flipped, setFlipped] = useState(() => new Set())
  const defOpen = (g) => (base === 'open' ? true : base === 'close' ? false : (() => { const n = dday(g.first); return n != null && n <= 14 })())
  const isOpen = (g) => defOpen(g) !== flipped.has(g.key)
  const flip = (g) => setFlipped((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })
  const setAll = (o) => { setBase(o ? 'open' : 'close'); setFlipped(new Set()) }
  // 구분2 = 포캐스트 품번 · 구분3 = 이 줄이 쓰는 BOM (하네스 · 전장)
  //   월간 실적(PO 업로드)의 구분2 · 3 은 마우스를 올리면 보인다.
  const bomCode = (r, which) => {
    const k = ruleKindOf(r)
    if (!k) return undefined
    const p = bomProjectFor(rules, projects, k, bomGroupOf(r), which)
    return p ? p.code : null
  }
  const monthRow = (r, i) => (
    <tr key={'m' + i} className="bg-indigo-50/60">
      <td colSpan={ED_COLS} className="px-3 py-1.5 text-[11px] font-bold text-indigo-600">
        {r._month === '미정' ? '납기 미정' : `${r._month.slice(0, 4)}년 ${+r._month.slice(5, 7)}월`}
      </td>
    </tr>
  )
  // 파트 한 줄 (호기로 묶어 볼 때는 호기 줄 아래에 들어감)
  //   v4.118.2 — 목업 모양: 파트 | 구분 | 발주서 | 품목 줄 | 금액 | 납기 | 상태 | 가공물 입고 | 하네스 · 전장 불출 | 품질 | 미불출 | 비고
  const partRow = (r, inGroup = false) => {
    const o = orderOf(orderIdx, r)
    const pos = o?.pos || []
    const mp = Array.isArray(r.missing_parts) ? r.missing_parts : []
    const first = mp[0]
    return (
      <tr key={r.id}
        onMouseDown={e => rowSel.start(r.id, e, sel.has(r.id))}
        onMouseEnter={e => rowSel.over(r.id, e)}
        data-ed-part={inGroup ? '1' : undefined}
        className={`border-b border-slate-100 hover:bg-slate-50 text-center select-none ${sel.has(r.id) ? 'bg-indigo-50/50' : 'bg-white'} ${r.status === '완료' ? 'text-slate-400' : ''}`}>
        <td className="px-1 py-2"><input type="checkbox" checked={sel.has(r.id)} readOnly className="pointer-events-none" /></td>
        <td data-no-select className={`py-2 text-left cursor-pointer whitespace-nowrap ${inGroup ? 'pl-8 pr-2' : 'px-2'}`} onClick={() => onEdit(r)}
          title={`${r.pn} ${r.hogi || ''} · ${r.part || '파트 없음'} — 누르면 편집`}>
          {r.part ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${partColor(r.part)}`}>{r.part}</span> : <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-400">미분류</span>}
          {!inGroup && <span className="ml-2 text-slate-700 hover:text-indigo-600">{r.pn} <span className="font-mono font-bold text-indigo-600">{r.hogi || ''}</span></span>}
          {r.fc_new && <span className="ml-1 px-1 rounded bg-sky-50 text-sky-600 text-[9px] font-bold align-middle" title="포캐스트로 만든 줄">FC</span>}
        </td>
        <td className="px-2 py-2 text-left text-[11px] text-slate-500 max-w-[110px] overflow-hidden text-ellipsis" title={r.part2 || ''}>{r.part2 && r.part2 !== r.part ? r.part2 : <span className="text-slate-300">—</span>}</td>
        {!orderSetup || !o ? (
          <td colSpan={3} className="px-2 py-2 text-left text-[10px] text-slate-300" title={orderSetup ? '수주대장에 진행 중인 발주가 없습니다' : 'Edwards생산_수주불러오기_반영_261029.sql 실행 전'}>{orderSetup ? '발주 없음' : '—'}</td>
        ) : (<>
          <td className="px-2 py-2 text-left whitespace-nowrap" data-ed-order={pos.join(',')}
            title={`발주서 ${pos.join(', ')}\n납기 ${o.due || '-'}${o.due_last && o.due_last !== o.due ? ` ~ ${o.due_last}` : ''}${o.guessed ? `\n파트 추정 ${o.guessed}줄 (메모에 파트가 없어 품번 이력으로 정함)` : ''}`}>
            <span className="font-mono text-[11px] text-indigo-600">{pos[0]}</span>{pos.length > 1 && <span className="text-[10px] text-slate-400"> 외 {pos.length - 1}</span>}
            {o.guessed ? <span className="block text-[9px] text-amber-600 font-bold">ⓘ 파트 추정 {o.guessed}줄</span> : null}
          </td>
          <td className="px-2 py-2 text-right tabular-nums font-mono">{o.n_lines}</td>
          <td className="px-2 py-2 text-right tabular-nums font-mono">₩{won(o.amt)}</td>
        </>)}
        <DueCell r={r} onField={onField} />
        <td data-no-select className="px-2 py-2">
          <select value={r.status || 'PO접수'} onChange={e => onField(r.id, 'status', e.target.value)} onClick={e => e.stopPropagation()}
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-400 ${statusColor[r.status] || 'bg-slate-100 text-slate-500'}`}>
            {statusOpts.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </td>
        <FrameCell r={r} onField={onField} />
        <IssueCell r={r} rules={rules} which="harn" onField={onField} need={need[`${r.id}|harn`]} bom={bomCode(r, 'harn')} onNeed={onNeed} />
        <IssueCell r={r} rules={rules} which="elec" onField={onField} need={need[`${r.id}|elec`]} bom={bomCode(r, 'elec')} onNeed={onNeed} />
        <QualityCell r={r} rules={rules} onField={onField} />
        <td data-no-select className="px-2 py-2 border-l border-slate-100 cursor-pointer text-left max-w-[170px] overflow-hidden text-ellipsis" onClick={() => onMissing(r)}
          title={mp.length ? mp.map(m => `${m.pn || ''} ${m.name || ''} ${m.qty ? '× ' + m.qty : ''}`.trim()).join('\n') : '누르면 미불출 자재 입력'}>
          {mp.length
            ? <><span className="px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px] font-bold">{mp.length}건</span>
                <span className="ml-1 text-[11px] text-slate-600">{first.pn || first.name}{first.qty ? <span className="text-slate-400"> ×{first.qty}</span> : null}{mp.length > 1 && <span className="text-slate-400"> 외 {mp.length - 1}</span>}</span></>
            : <span className="text-slate-200 hover:text-red-400">＋</span>}
        </td>
        <MemoCell r={r} onField={onField} />
      </tr>
    )
  }
  return (
    <>
    <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 border-b border-slate-100 bg-white" data-ed-groupbar>
      <span className="inline-flex bg-slate-100 rounded-lg p-0.5">
        {[[true, '🗂 호기로 묶기'], [false, '파트별 펼침']].map(([v, l]) => (
          <button key={l} type="button" onClick={() => setGrouped(v)} data-ed-grouped={v ? '1' : '0'}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md ${grouped === v ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>{l}</button>
        ))}
      </span>
      {grouped && <>
        <button type="button" onClick={() => setAll(true)} data-ed-openall className="px-2 py-1 text-[11px] font-semibold rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50">모두 펼치기</button>
        <button type="button" onClick={() => setAll(false)} data-ed-closeall className="px-2 py-1 text-[11px] font-semibold rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50">모두 접기</button>
        <span className="text-[11px] text-slate-400">호기 {groups.length} · 파트 {ids.length} — 보라 줄을 누르면 파트가 접히고 펼쳐집니다 (납기 14일 안 호기는 펼쳐 둠) · 파트를 누르면 편집</span>
      </>}
    </div>
    <table className="w-full text-xs whitespace-nowrap">
      <thead>
        <tr className="border-b-2 border-slate-200 bg-slate-50 text-slate-500 text-center">
          <th className="px-1 py-2 w-7">
            <input type="checkbox" checked={ids.length > 0 && ids.every(id => sel.has(id))}
              onChange={e => setSel(e.target.checked ? new Set(ids) : new Set())} />
          </th>
          <th className="px-2 py-2 text-left font-bold">프로젝트 #호기 / 파트</th>
          <th className="px-2 py-2 text-left font-bold" title="H2D HP · H2D LH 등 (발주서 메모 두 번째 칸)">구분</th>
          <th className="px-2 py-2 text-left font-bold" title="수주대장의 진행 중 발주 (같은 프로젝트 · 호기 · 파트)">🧾 발주서</th>
          <th className="px-2 py-2 text-right font-bold">품목 줄</th>
          <th className="px-2 py-2 text-right font-bold">금액</th>
          <th className="px-2 py-2 font-bold text-indigo-600 border-l border-slate-200" title="확정 납기 → 포캐스트 → 납품요청일(가장 빠른 발주 납기) · ✎ 로 확정">📅 납기</th>
          <th className="px-2 py-2 font-bold">상태</th>
          <th className="px-2 py-2 font-bold text-amber-600 border-l border-slate-200" title="Frame · 누르면 입고 · ✎ 로 확정일">⚙ 가공물 입고</th>
          <th className="px-2 py-2 font-bold text-teal-600 border-l border-slate-200" title="납기 − EUV 35일 · H2D 20일 · 누르면 불출 완료">⚡ 하네스 불출</th>
          <th className="px-2 py-2 font-bold text-blue-600" title="납기 − EUV 35일 · H2D 20일 · 누르면 불출 완료">⚡ 전장 불출</th>
          <th className="px-2 py-2 font-bold text-rose-600 border-l border-slate-200" title={`납기 − ${rules?.qcDays ?? 4}일 · 누르면 검수 완료`}>✅ 품질</th>
          <th className="px-2 py-2 text-left font-bold text-red-600 border-l border-slate-200">⚠ 미불출</th>
          <th className="px-2 py-2 text-left font-bold border-l border-slate-200">비고</th>
        </tr>
      </thead>
      <tbody>
        {grouped
          ? groups.flatMap((g) => [<GroupRow key={'g' + g.key} g={g} open={isOpen(g)} onToggle={() => flip(g)} sel={sel} setSel={setSel} statusOpts={statusOpts} statusColor={statusColor} partColor={partColor} orderIdx={orderIdx} orderSetup={orderSetup} />,
              ...(isOpen(g) ? g.rows.map((r) => partRow(r, true)) : [])])
          : list.map((r, i) => (r._month ? monthRow(r, i) : partRow(r)))}
        {!ids.length && <tr><td colSpan={ED_COLS} className="py-10 text-center text-slate-400">보여줄 줄이 없습니다</td></tr>}
      </tbody>
    </table>
    </>
  )
}

const won = (n) => Math.round(+n || 0).toLocaleString('ko-KR')

// 🗂 호기 줄 — 파트 칩 · 발주 합계 · 가장 빠른 납기 · 가장 늦은 파트 상태 · 진행 칸 수 (목업 모양)
function GroupRow({ g, open, onToggle, sel, setSel, statusOpts, statusColor, partColor, orderIdx, orderSetup }) {
  const rows = g.rows
  const ords = [...new Set(rows.map(r => orderOf(orderIdx, r)).filter(Boolean))]
  const oPos = [...new Set(ords.flatMap(o => o.pos || []))]
  const oLines = ords.reduce((t, o) => t + (o.n_lines || 0), 0), oAmt = ords.reduce((t, o) => t + (+o.amt || 0), 0)
  const all = rows.every(r => sel.has(r.id))
  const live = rows.filter(r => r.status !== '완료')
  const order = (s) => { const i = statusOpts.indexOf(s || 'PO접수'); return i < 0 ? 0 : i }
  const low = live.length ? live.reduce((a, r) => (order(r.status) < order(a) ? r.status || 'PO접수' : a), live[0].status || 'PO접수') : '완료'
  const n = g.first ? dday(g.first) : null
  const cnt = (f) => rows.filter(f).length
  const frame = cnt(r => truthy(r.machine_recv)), harn = cnt(r => truthy(r.harness_recv)), elec = cnt(r => truthy(r.part_issue)), qual = cnt(r => truthy(r.quality_recv))
  const miss = rows.reduce((t, r) => t + (Array.isArray(r.missing_parts) ? r.missing_parts.length : 0), 0)
  const frac = (a, cls) => <span className={a === rows.length ? `${cls} font-bold` : a ? 'text-slate-600 font-semibold' : 'text-slate-300'}>{a}/{rows.length}</span>
  const dot = (s) => { const i = order(s); return s === '완료' ? 'bg-emerald-600' : i >= 5 ? 'bg-emerald-500' : i >= 4 ? 'bg-amber-500' : i >= 3 ? 'bg-indigo-400' : i >= 1 ? 'bg-indigo-200' : 'bg-slate-200' }
  return (
    <tr data-ed-group={g.key} onClick={onToggle} className="border-b border-violet-100 bg-violet-50/50 hover:bg-violet-50 cursor-pointer text-center">
      <td className="px-1 py-2.5" onClick={e => e.stopPropagation()}>
        <input type="checkbox" checked={all} onChange={e => setSel(s => { const x = new Set(s); rows.forEach(r => (e.target.checked ? x.add(r.id) : x.delete(r.id))); return x })} />
      </td>
      <td colSpan={2} className="px-2 py-2.5 text-left">
        <span className="inline-block w-3 text-[10px] text-violet-500">{open ? '▼' : '▶'}</span>
        <span className="font-bold text-slate-800">{g.pn}</span>
        <span className="ml-1.5 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-extrabold font-mono text-[11px]">{g.hogi || '-'}</span>
        <span className="ml-2">{rows.map((r, i) => <span key={i} className={`mr-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${r.part ? partColor(r.part) : 'bg-slate-100 text-slate-400'}`}>{r.part || '미분류'}</span>)}</span>
      </td>
      <td className="px-2 py-2.5 text-left" title={oPos.length ? `발주서 ${oPos.join(', ')}` : '수주대장에 진행 중인 발주가 없습니다'}>
        {orderSetup && oPos.length ? <span className="text-[11px] font-bold text-slate-700">발주 {oPos.length}건</span> : <span className="text-[10px] text-slate-300">{orderSetup ? '발주 없음' : '—'}</span>}
      </td>
      <td className="px-2 py-2.5 text-right tabular-nums font-mono font-bold text-slate-700">{orderSetup && oPos.length ? oLines : ''}</td>
      <td className="px-2 py-2.5 text-right tabular-nums font-mono font-bold text-slate-700">{orderSetup && oPos.length ? `₩${won(oAmt)}` : ''}</td>
      <td className="px-2 py-2.5 border-l border-violet-100 whitespace-nowrap" title="가장 빠른 파트 납기">
        {g.first ? <span className={n != null && n < 0 ? 'text-red-600 font-bold' : n != null && n <= 7 ? 'text-orange-600 font-bold' : 'text-slate-700'}>{md(g.first)}{n != null && n >= 0 && <span className="ml-1 text-[10px] font-bold">{n === 0 ? 'D-Day' : `D-${n}`}</span>}</span> : <span className="text-slate-300">—</span>}
      </td>
      <td className="px-2 py-2.5 whitespace-nowrap" title="가장 늦은 파트 기준 · 칸 하나 = 파트 하나">
        <span className="inline-flex gap-0.5 align-middle mr-1">{rows.map((r, i) => <span key={i} className={`w-2 h-2 rounded-sm ${dot(r.status)}`} title={`${r.part || '-'} ${r.status || 'PO접수'}`} />)}</span>
        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${statusColor[low] || 'bg-slate-100 text-slate-500'}`}>{low}</span>
      </td>
      <td className="px-2 py-2.5 border-l border-violet-100 text-[10px]" title="가공물(Frame) 입고">{frac(frame, 'text-amber-600')}</td>
      <td className="px-2 py-2.5 border-l border-violet-100 text-[10px]" title="하네스 불출">{frac(harn, 'text-teal-600')}</td>
      <td className="px-2 py-2.5 text-[10px]" title="전장 불출">{frac(elec, 'text-blue-600')}</td>
      <td className="px-2 py-2.5 border-l border-violet-100 text-[10px]" title="품질">{frac(qual, 'text-rose-600')}</td>
      <td className="px-2 py-2.5 border-l border-violet-100 text-left">
        {miss ? <span className="px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px] font-bold">미불출 {miss}건</span> : <span className="text-slate-200">—</span>}
      </td>
      <td className="px-2 py-2.5 border-l border-violet-100" />
    </tr>
  )
}

// ── 미불출 자재 창 ────────────────────────────────────────────────────
//   불출했지만 빠진 자재를 적어 둔다. 품번을 넣으면 품명 · 제조사를 채운다.
export function MissingModal({ row, onClose, onSave, saving }) {
  const [list, setList] = useState(() => (Array.isArray(row.missing_parts) ? row.missing_parts.map(m => ({ ...m })) : []))
  const set = (i, p) => setList(l => l.map((m, k) => (k === i ? { ...m, ...p } : m)))
  async function lookup(i, v) {
    const t = String(v || '').trim()
    if (!t) return
    const up = t.toUpperCase()
    const codes = up.startsWith('ED-') || up.startsWith('AX-') ? [t] : [`ED-${t}`, t, `AX-${t}`]
    const { data } = await supabase.from('items').select('std_code,name,manufacturer,manufacturer_code').in('std_code', codes).limit(3)
    const it = (data || []).sort((a, b) => codes.indexOf(a.std_code) - codes.indexOf(b.std_code))[0]
    if (!it) return
    set(i, { pn: it.std_code.replace(/^(ED|AX)-/, ''), name: it.name || '', maker: it.manufacturer || '', makerPn: it.manufacturer_code || '' })
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-800">⚠ 미불출 자재</h3>
            <p className="text-[11px] text-slate-400">{row.pn} · {row.hogi} · {row.part}{row.part2 ? ` / ${row.part2}` : ''}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-4 overflow-y-auto space-y-1.5">
          {list.length > 0 && (
            <div className="grid grid-cols-[130px_1fr_110px_60px_120px_20px] gap-1.5 text-[10px] font-semibold text-slate-400 px-0.5">
              <span>품번</span><span>품명</span><span>제조사</span><span className="text-right">수량</span><span>입고 예정</span><span />
            </div>
          )}
          {list.map((m, i) => (
            <div key={i} className="grid grid-cols-[130px_1fr_110px_60px_120px_20px] gap-1.5 items-center">
              <input value={m.pn || ''} onChange={e => set(i, { pn: e.target.value })} onBlur={e => lookup(i, e.target.value)} placeholder="품번"
                className="px-2 py-1 text-xs font-mono border border-slate-200 rounded" />
              <input value={m.name || ''} onChange={e => set(i, { name: e.target.value })} placeholder="품명 (자동 조회)"
                className="min-w-0 px-2 py-1 text-xs border border-slate-200 rounded" />
              <input value={m.maker || ''} onChange={e => set(i, { maker: e.target.value })} placeholder="제조사"
                className="min-w-0 px-2 py-1 text-[11px] border border-slate-200 rounded" />
              <input value={m.qty || ''} type="number" onChange={e => set(i, { qty: e.target.value })} placeholder="수량"
                className="px-2 py-1 text-xs text-right font-bold border border-slate-200 rounded" />
              <input value={m.date || ''} type="date" onChange={e => set(i, { date: e.target.value })}
                className="px-1.5 py-1 text-[11px] border border-slate-200 rounded" />
              <button onClick={() => setList(l => l.filter((_, k) => k !== i))} className="text-slate-300 hover:text-rose-500 text-sm">✕</button>
            </div>
          ))}
          {!list.length && <p className="text-xs text-slate-400 py-4 text-center">빠진 자재가 없습니다 — ＋ 로 추가하세요</p>}
          <button onClick={() => setList(l => [...l, { pn: '', name: '', maker: '', makerPn: '', qty: '', date: '' }])}
            className="mt-1 px-2.5 py-1 text-[11px] font-bold rounded border border-rose-300 text-rose-600 bg-white hover:bg-rose-50">＋ 추가</button>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-500">취소</button>
          <button disabled={saving} onClick={() => onSave(list.filter(m => String(m.pn || '').trim() || String(m.name || '').trim()))}
            className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">{saving ? <span className="inline-flex items-center gap-1.5"><Spin />저장 중…</span> : '저장'}</button>
        </div>
      </div>
    </div>
  )
}

// ── 불출 기준 창 ─────────────────────────────────────────────────────
//   ① 정한 납기보다 몇 주 먼저 불출하나  ② 포캐스트 품번 → 들어가는 갈래
export function RulesModal({ rules, items, unknown, onClose, onSave, saving, defaults, projects = [], bomGroups = [], extraKinds = [] }) {
  // EUV · H2D 세 갈래 + 생산관리에 있는 다른 구분(MFM · BDM · ASML …) + 예전에 정해 둔 것
  const kindsAll = [...KINDS, ...[...new Set([...extraKinds, ...Object.keys(rules.days || {})])].filter(k => !KINDS.includes(k)).sort()]
  const [qcDays, setQcDays] = useState(() => rules.qcDays ?? 4)
  const [weeks, setWeeks] = useState(() => {     // 이름은 그대로 — 값은 일(days)
    const w = JSON.parse(JSON.stringify(rules.days || {}))
    for (const k of kindsAll) w[k] = { harn: w[k]?.harn ?? '', elec: w[k]?.elec ?? '' }
    return w
  })
  const [map, setMap] = useState(() => ({ ...rules.map }))
  const [bom, setBom] = useState(() => ({ ...(rules.bom || {}) }))
  const all = [...new Set([...Object.keys(map), ...items, ...unknown].filter(Boolean))]
    .sort((a, b) => (map[a] === undefined ? 0 : 1) - (map[b] === undefined ? 0 : 1) || a.localeCompare(b))
  const toggle = (it, k) => setMap(m => {
    const cur = Array.isArray(m[it]) ? m[it] : []
    return { ...m, [it]: cur.includes(k) ? cur.filter(x => x !== k) : KINDS.filter(x => x === k || cur.includes(x)) }
  })
  const setW = (k, w, v) => setWeeks(s => ({ ...s, [k]: { ...s[k], [w]: v === '' ? '' : Math.max(0, Math.min(180, Number(v))) } }))
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">⚙ 불출 기준 · 품번별 구분 · BOM 연결</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          <section>
            <p className="font-bold text-slate-700 mb-1">① 불출 예정일 = 납기 − N일</p>
            <table className="w-full border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 text-slate-500"><tr>
                <th className="px-3 py-1.5 text-left">구분</th><th className="px-3 py-1.5">하네스 (일 전)</th><th className="px-3 py-1.5">전장 (일 전)</th>
              </tr></thead>
              <tbody>
                {kindsAll.map(k => (
                  <tr key={k} className={`border-t border-slate-100 ${k === kindsAll[KINDS.length] ? 'border-t-2 border-t-slate-200' : ''}`}>
                    <td className="px-3 py-1.5 font-bold text-slate-700">{KIND_LABEL[k] || k}</td>
                    {['harn', 'elec'].map(w => (
                      <td key={w} className="px-3 py-1.5 text-center">
                        <input type="number" min="0" max="180" value={weeks[k]?.[w] ?? ''} placeholder={KINDS.includes(k) ? '' : '미설정'}
                          onChange={e => setW(k, w, e.target.value)}
                          className={`w-16 px-2 py-1 text-center border rounded focus:outline-none focus:ring-1 focus:ring-indigo-400 ${weeks[k]?.[w] === '' ? 'border-orange-300' : 'border-slate-200'}`} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-slate-400">납기 — EUV = 포캐스트 to 정한 · H2D = H2D 자재 (없으면 Frame − 1주) · MFM · BDM 등 = 납품요청일. 확정 납기를 넣으면 그 날짜 기준.
              <b className="text-orange-600"> 비워 둔 칸</b>은 불출 예정일을 계산하지 않습니다.</p>
            <p className="mt-2 flex items-center gap-2 font-bold text-slate-700">품질 검수 예정일 = 납기 −
              <input type="number" min="0" max="60" value={qcDays} onChange={e => setQcDays(e.target.value === '' ? '' : Math.max(0, Math.min(60, Number(e.target.value))))} data-qc-days
                className="w-14 px-2 py-1 text-center border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400" /> 일 <span className="font-normal text-slate-400">(모든 구분)</span></p>
          </section>
          <section>
            <p className="font-bold text-slate-700 mb-1">② 포캐스트 품번 → 들어가는 구분</p>
            <p className="text-[11px] text-slate-400 mb-1.5">포캐스트에만 있는 호기를 생산관리에 새로 만들 때 씁니다. 아무것도 안 고르면 「자재 준비 대상 아님」 (예: Halo).
              <b className="text-orange-600"> 미지정</b>은 같은 프로젝트의 다른 호기를 따라가고, 그것도 없으면 만들지 않습니다.</p>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
              {all.map(it => {
                const cur = map[it]
                return (
                  <div key={it} className="flex items-center gap-3 px-3 py-1.5">
                    <span className="font-mono text-[11px] text-slate-700 w-40 truncate" title={it}>{it}</span>
                    {cur === undefined && <span className="px-1 rounded bg-orange-50 text-orange-600 text-[9px] font-bold">미지정</span>}
                    {Array.isArray(cur) && !cur.length && <span className="px-1 rounded bg-slate-100 text-slate-400 text-[9px] font-bold">대상 아님</span>}
                    <span className="ml-auto flex gap-3">
                      {KINDS.map(k => (
                        <label key={k} className="inline-flex items-center gap-1 cursor-pointer">
                          <input type="checkbox" checked={Array.isArray(cur) && cur.includes(k)} onChange={() => toggle(it, k)} />{KIND_LABEL[k]}
                        </label>
                      ))}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
          <section>
            <p className="font-bold text-slate-700 mb-1">③ BOM 연결 (📦 소요량 매칭)</p>
            <p className="text-[11px] text-slate-400 mb-1.5">불출 건마다 어느 BOM 으로 소요량을 셀지 정합니다. 「자동」은 BOM 이름(예: NKB943_EUV · H2D-LH_하네스)으로 찾은 것입니다.</p>
            {!projects.length
              ? <p className="text-[11px] text-orange-600">Edwards BOM 을 불러오지 못했거나 등록된 BOM 이 없습니다.</p>
              : (
                <table className="w-full border border-slate-200 rounded-lg overflow-hidden">
                  <thead className="bg-slate-50 text-slate-500"><tr>
                    <th className="px-3 py-1.5 text-left">구분</th>
                    {['harn', 'elec'].map(w => <th key={w} className="px-3 py-1.5 text-left">{WHICH_LABEL[w]} BOM</th>)}
                  </tr></thead>
                  <tbody>
                    {bomGroups.map(({ kind, group }) => (
                      <tr key={kind + group} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 font-bold text-slate-700 whitespace-nowrap">{kind}{group !== '*' ? <span className="ml-1 font-mono text-[10px] text-slate-400">{group === '?' ? '기종 모름' : group}</span> : null}</td>
                        {['harn', 'elec'].map(w => {
                          const k = bomKey(kind, group, w)
                          const g = guessBom(projects, kind, group, w)
                          return (
                            <td key={w} className="px-2 py-1">
                              <select value={bom[k] === undefined ? '__auto' : bom[k]}
                                onChange={e => setBom(b => { const n = { ...b }; if (e.target.value === '__auto') delete n[k]; else n[k] = e.target.value; return n })}
                                className={`w-full max-w-[230px] px-1.5 py-1 text-[11px] border rounded ${bom[k] === undefined && !g && KINDS.includes(kind) ? 'border-orange-300 text-orange-600' : 'border-slate-200'}`}>
                                <option value="__auto">{g ? `자동 — ${g.code}` : KINDS.includes(kind) ? '자동 — 못 찾음' : '없음 (필요하면 고르세요)'}</option>
                                <option value="">연결 안 함</option>
                                {projects.map(p => <option key={p.id} value={p.code}>{p.code}{p.name && p.name !== p.code ? ` · ${p.name}` : ''}</option>)}
                              </select>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                    {!bomGroups.length && <tr><td colSpan={3} className="px-3 py-2 text-slate-400">진행 중인 EUV · H2D 줄이 없습니다</td></tr>}
                  </tbody>
                </table>
              )}
          </section>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2">
          <button onClick={() => { setWeeks(JSON.parse(JSON.stringify(defaults.days))); setQcDays(defaults.qcDays ?? 4) }} className="px-3 py-2 text-xs rounded-lg text-slate-400 hover:text-slate-600">일수 기본값</button>
          <button onClick={onClose} className="ml-auto px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-500">취소</button>
          <button disabled={saving} onClick={() => {
            const w = {}
            const v = (x) => (x === '' || x === null || x === undefined ? null : Number(x) || 0)
            for (const k of KINDS) w[k] = { harn: Number(weeks[k]?.harn) || 0, elec: Number(weeks[k]?.elec) || 0 }
            for (const k of kindsAll.slice(KINDS.length)) {
              const h = v(weeks[k]?.harn), e = v(weeks[k]?.elec)
              if (h !== null || e !== null) w[k] = { harn: h, elec: e }
            }
            onSave({ days: w, qcDays: qcDays === '' ? 4 : Number(qcDays), map, bom })
          }} className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">{saving ? <span className="inline-flex items-center gap-1.5"><Spin />저장 중…</span> : '저장'}</button>
        </div>
      </div>
    </div>
  )
}
