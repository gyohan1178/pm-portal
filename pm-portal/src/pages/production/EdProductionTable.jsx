// 생산관리 · Edwards 화면 (호기별 자재 준비)
//
//   작업자가 따로 쓰던 「Forecast 자재 준비 현황」 HTML 을 옮긴 것.
//   AXCELIS 와 같은 칸 동작(누르면 완료 · ✎ 날짜)을 쓰고 머리글만 Edwards 에 맞춘다.
//
//   구분1 · 구분2 · 구분3 · 프로젝트 · 호기 | 발주 | 상태 | 정한 납기 | Frame 입고 |
//   불출(하네스 · 전장) | 품질 | 미불출 자재(건수 · 품목) | 비고 | 담당자
//
//   ⚠ 정한 납기 · 불출 예정은 lib/edForecast.js 에서 계산한다 (저장값 아님).
//     사람이 넣는 값: 확정 납기(due_fix) · Frame 확정(arrival_date) · 발주서(po_received) · 불출 · 품질 · 미불출 · 비고
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { KINDS, kindOf, dueOf, issueDueOf } from '../../lib/edForecast'
import { guessBom, bomKey, WHICH_LABEL, bomGroupOf, bomProjectFor } from '../../lib/edNeed'

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
  let nopo = 0, fix = 0, fcNew = 0, fcAt = null
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
  for (const r of rows) if (r.fc_at && (!fcAt || r.fc_at > fcAt)) fcAt = r.fc_at
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
      <Box id="fc" label="포캐스트 반영" title="포캐스트로 새로 만든 줄 — 누르면 이 줄만 봅니다">
        <span className="text-sm">{fcAt ? `${md(fcAt)} ${String(fcAt).slice(11, 16)}` : '아직 없음'}</span>
        {fcNew > 0 && <span className="ml-1 text-xs font-semibold text-sky-600">새 줄 {fcNew}</span>}
      </Box>
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
function RemarkCell({ r, onField }) {
  const rm = String(r.fc_remark || '').toUpperCase()
  const cls = rm === 'PO' ? 'text-indigo-600' : rm === 'CO' ? 'text-amber-600' : 'text-slate-400'
  const on = !!r.po_received
  return (
    <td data-no-select className="px-2 py-2 cursor-pointer text-center whitespace-nowrap"
      title={`포캐스트 Remark ${r.fc_remark || '없음'} · 네모 = 발주서 접수 (누르면 바뀜)`}
      onClick={() => onField(r.id, 'po_received', !on)}>
      <span className={`text-[10px] font-bold mr-1 ${cls}`}>{r.fc_remark || '—'}</span>
      <span className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-[3px] border align-[-2px] ${on ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'}`}>
        {on && <span className="text-[9px] leading-none">✓</span>}
      </span>
    </td>
  )
}

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
  if (!k) {
    return <td className="px-2 py-2 border-l border-slate-100 text-center text-slate-300 whitespace-nowrap"
      title="MFM · BDM · 단품 — 자재 준비 대상이 아닙니다 (회색 = 납품요청일)">{md(r.req_date) || '—'}{tag}</td>
  }
  const src = k === 'EUV' ? 'to 정한' : 'H2D 자재'
  return (
    <td data-no-select className="px-2 py-2 border-l border-slate-100 text-center whitespace-nowrap group"
      title={d ? (d.fixed ? `확정 납기 · 포캐스트 ${d.fc || '없음'}` : `포캐스트 ${src} 기준 · ✎ 로 확정 납기 입력`) : '포캐스트 날짜 없음 · ✎ 로 확정 납기 입력'}>
      {d
        ? <span className={d.fixed ? 'font-semibold text-slate-800 border-b-2 border-emerald-400' : 'text-slate-500'}>{md(d.date)}</span>
        : <span className="text-slate-300">{md(r.req_date) || '—'}</span>}
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
  const k = kindOf(r)
  const due = issueDueOf(r, rules, which)
  const n = dday(due)
  const w = k ? rules?.weeks?.[k]?.[which] : null
  const name = which === 'harn' ? '하네스' : '전장'
  const doneCls = which === 'harn' ? 'text-teal-600' : 'text-blue-600'
  const live = r.status !== '완료'
  const cls = !live ? 'text-slate-400' : n == null ? 'text-slate-300' : n < 0 ? 'text-red-600 font-bold' : n <= 7 ? 'text-orange-600 font-bold' : 'text-slate-500'
  return (
    <td data-no-select className={`px-2 py-2 cursor-pointer text-center whitespace-nowrap group ${which === 'harn' ? 'border-l border-slate-100' : ''}`}
      title={done ? `${name} 불출 완료 · 누르면 취소` : due ? `${name} 불출 예정 = 정한 납기 − ${w}주 · 누르면 불출 완료` : `누르면 ${name} 불출 완료`}
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

function QualityCell({ r, onField }) {
  const done = truthy(r.quality_recv)
  return (
    <td data-no-select className="px-2 py-2 border-l border-slate-100 cursor-pointer text-center" title={done ? '품질검수 완료 · 누르면 취소' : '누르면 품질검수 완료'}
      onClick={() => onField(r.id, 'quality_recv', !done)}>
      {done ? <span className="text-rose-600 font-bold">✔ 완료</span> : <span className="text-slate-300 hover:text-rose-500">검수</span>}
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
export const ED_COLS = 17
export function EdTable({ list, sel, setSel, rowSel, onField, onEdit, onMissing, rules, statusOpts, statusColor, partColor, projects = [], need = {}, onNeed }) {
  const ids = list.filter(r => !r._month).map(r => r.id)
  // 구분2 = 포캐스트 품번 · 구분3 = 이 줄이 쓰는 BOM (하네스 · 전장)
  //   월간 실적(PO 업로드)의 구분2 · 3 은 마우스를 올리면 보인다.
  const bomCode = (r, which) => {
    const k = kindOf(r)
    if (!k) return undefined
    const p = bomProjectFor(rules, projects, k, bomGroupOf(r), which)
    return p ? p.code : null
  }
  return (
    <table className="w-full text-xs whitespace-nowrap">
      <thead>
        <tr className="border-b border-slate-200 bg-slate-50 text-slate-400 text-center">
          <th rowSpan={2} className="px-1 py-1.5 w-7">
            <input type="checkbox" checked={ids.length > 0 && ids.every(id => sel.has(id))}
              onChange={e => setSel(e.target.checked ? new Set(ids) : new Set())} />
          </th>
          <th rowSpan={2} className="px-2 py-1.5 font-bold">구분1</th>
          <th rowSpan={2} className="px-2 py-1.5 text-left font-bold" title="EUV · H2D 줄은 포캐스트 품번 (Item number)">구분2<br /><span className="text-[9px] font-normal text-slate-300">품번</span></th>
          <th rowSpan={2} className="px-2 py-1.5 text-left font-bold" title="EUV · H2D 줄은 쓰는 BOM — 위 하네스 · 아래 전장">구분3<br /><span className="text-[9px] font-normal text-slate-300">BOM 하네스 / 전장</span></th>
          <th rowSpan={2} className="px-2 py-1.5 text-left font-bold">프로젝트</th>
          <th rowSpan={2} className="px-2 py-1.5 font-bold">호기</th>
          <th rowSpan={2} className="px-2 py-1.5 font-bold" title="포캐스트 Remark (FCT · CO · PO) · 네모 = 발주서 접수">발주</th>
          <th rowSpan={2} className="px-2 py-1.5 font-bold">상태</th>
          <th rowSpan={2} className="px-2 py-1.5 font-bold text-indigo-600 border-l border-slate-200">📅 정한 납기<br /><span className="text-[9px] font-normal text-slate-300">D-남은날 · ✎확정</span></th>
          <th rowSpan={2} className="px-2 py-1.5 font-bold text-amber-600 border-l border-slate-200">⚙ Frame 입고<br /><span className="text-[9px] font-normal text-slate-300">클릭=입고 · ✎확정</span></th>
          <th colSpan={2} className="px-2 py-1 font-bold text-violet-600 border-l border-slate-200">⚡ 불출 <span className="text-[9px] font-normal text-slate-300">(정한 납기 − N주)</span></th>
          <th rowSpan={2} className="px-2 py-1.5 font-bold text-rose-600 border-l border-slate-200">✅ 품질</th>
          <th colSpan={2} className="px-2 py-1 font-bold text-red-600 border-l border-slate-200">⚠ 미불출 자재</th>
          <th rowSpan={2} className="px-2 py-1.5 text-left font-bold border-l border-slate-200">비고</th>
          <th rowSpan={2} className="px-2 py-1.5 text-left font-bold">담당자</th>
        </tr>
        <tr className="border-b border-slate-200 bg-slate-50/50 text-[10px] text-slate-400 text-center">
          <th className="px-2 py-1 font-semibold border-l border-slate-200">하네스</th>
          <th className="px-2 py-1 font-semibold">전장</th>
          <th className="px-2 py-1 font-semibold border-l border-slate-200">건수</th>
          <th className="px-2 py-1 font-semibold text-left">품목</th>
        </tr>
      </thead>
      <tbody>
        {list.map((r, i) => r._month ? (
          <tr key={'m' + i} className="bg-indigo-50/60">
            <td colSpan={ED_COLS} className="px-3 py-1.5 text-[11px] font-bold text-indigo-600">
              {r._month === '미정' ? '정한 납기 미정' : `${r._month.slice(0, 4)}년 ${+r._month.slice(5, 7)}월`}
            </td>
          </tr>
        ) : (
          <tr key={r.id}
            onMouseDown={e => rowSel.start(r.id, e, sel.has(r.id))}
            onMouseEnter={e => rowSel.over(r.id, e)}
            className={`border-b border-slate-100 hover:bg-slate-50 text-center select-none ${sel.has(r.id) ? 'bg-indigo-50/50' : ''} ${r.status === '완료' ? 'text-slate-400' : ''}`}>
            <td className="px-1 py-2"><input type="checkbox" checked={sel.has(r.id)} readOnly className="pointer-events-none" /></td>
            <td className="px-2 py-2">
              {r.part ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${partColor(r.part)}`}>{r.part}</span> : <span className="text-slate-300">-</span>}
            </td>
            {(() => {
              const k = kindOf(r)
              const hb = bomCode(r, 'harn'), eb = bomCode(r, 'elec')
              const orig = `PO 업로드(월간 실적) 구분2 ${r.part2 || '-'} · 구분3 ${r.part3 || '-'}`
              if (!k) return (<>
                <td className="px-2 py-2 text-slate-600 text-left max-w-[100px] overflow-hidden text-ellipsis" title={r.part2}>{r.part2 || '-'}</td>
                <td className="px-2 py-2 text-slate-600 text-left max-w-[100px] overflow-hidden text-ellipsis" title={r.part3}>{r.part3 || '-'}</td>
              </>)
              return (<>
                <td className="px-2 py-2 text-left font-mono text-[11px] text-slate-700 max-w-[120px] overflow-hidden text-ellipsis" title={`포캐스트 품번 ${r.fc_item || '없음'}\n${orig}`}>
                  {r.fc_item || <span className="text-slate-400 font-sans">{r.part2 || '-'}</span>}
                </td>
                <td className="px-2 py-2 text-left text-[10px] leading-tight max-w-[190px]" title={`하네스 BOM ${hb || '연결 안 됨'}\n전장 BOM ${eb || '연결 안 됨'}\n${orig}`}>
                  <span className={`block truncate ${hb ? 'text-teal-700' : 'text-orange-400'}`}>{hb || '하네스 BOM 없음'}</span>
                  <span className={`block truncate ${eb ? 'text-blue-700' : 'text-orange-400'}`}>{eb || '전장 BOM 없음'}</span>
                </td>
              </>)
            })()}
            <td data-no-select className="px-2 py-2 text-slate-700 text-left max-w-[200px] overflow-hidden text-ellipsis cursor-pointer hover:text-indigo-600"
              title={`${r.pn}${r.fc_tag ? ` · 포캐스트 ${r.fc_tag}` : ''} — 누르면 편집`} onClick={() => onEdit(r)}>
              {r.pn}
              {r.fc_new && <span className="ml-1 px-1 rounded bg-sky-50 text-sky-600 text-[9px] font-bold align-middle" title="포캐스트로 새로 만든 줄 — PO 업로드(월간 실적)가 들어오면 이 줄과 이어집니다">FC</span>}
              {r.fc_gone && r.status !== '완료' && <span className="ml-1 px-1 rounded bg-slate-100 text-slate-400 text-[9px] font-bold align-middle" title="최근 포캐스트에 이 호기가 없습니다 (지우지 않음)">FC 없음</span>}
            </td>
            <td className="px-2 py-2 font-mono font-bold text-indigo-600">{r.hogi || '-'}</td>
            <RemarkCell r={r} onField={onField} />
            <td data-no-select className="px-2 py-2">
              <select value={r.status || 'PO접수'} onChange={e => onField(r.id, 'status', e.target.value)} onClick={e => e.stopPropagation()}
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border-0 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-400 ${statusColor[r.status] || 'bg-slate-100 text-slate-500'}`}>
                {statusOpts.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </td>
            <DueCell r={r} onField={onField} />
            <FrameCell r={r} onField={onField} />
            <IssueCell r={r} rules={rules} which="harn" onField={onField} need={need[`${r.id}|harn`]} bom={bomCode(r, 'harn')} onNeed={onNeed} />
            <IssueCell r={r} rules={rules} which="elec" onField={onField} need={need[`${r.id}|elec`]} bom={bomCode(r, 'elec')} onNeed={onNeed} />
            <QualityCell r={r} onField={onField} />
            {(() => {
              const mp = Array.isArray(r.missing_parts) ? r.missing_parts : []
              const first = mp[0]
              return (<>
                <td data-no-select className="px-2 py-2 border-l border-slate-100 cursor-pointer" onClick={() => onMissing(r)} title="누르면 미불출 자재 입력">
                  {mp.length
                    ? <span className="px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px] font-bold">{mp.length}건</span>
                    : <span className="text-slate-200 hover:text-red-400">＋</span>}
                </td>
                <td data-no-select className="px-2 py-2 text-left max-w-[170px] overflow-hidden text-ellipsis cursor-pointer text-[11px] text-slate-600"
                  onClick={() => onMissing(r)}
                  title={mp.map(m => `${m.pn || ''} ${m.name || ''} ${m.qty ? '× ' + m.qty : ''}`.trim()).join('\n')}>
                  {first ? <>{first.pn || first.name}{first.qty ? <span className="text-slate-400"> ×{first.qty}</span> : null}{mp.length > 1 && <span className="text-slate-400"> 외 {mp.length - 1}</span>}</> : <span className="text-slate-200">—</span>}
                </td>
              </>)
            })()}
            <MemoCell r={r} onField={onField} />
            <td className="px-2 py-2 text-left max-w-[110px] overflow-hidden text-ellipsis">
              {r.manager ? <span className="font-semibold text-slate-600">{r.manager}</span> : <span className="text-slate-200">—</span>}
            </td>
          </tr>
        ))}
        {!ids.length && <tr><td colSpan={ED_COLS} className="py-10 text-center text-slate-400">보여줄 줄이 없습니다</td></tr>}
      </tbody>
    </table>
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
            className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">{saving ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </div>
  )
}

// ── 불출 기준 창 ─────────────────────────────────────────────────────
//   ① 정한 납기보다 몇 주 먼저 불출하나  ② 포캐스트 품번 → 들어가는 갈래
export function RulesModal({ rules, items, unknown, onClose, onSave, saving, defaults, projects = [], bomGroups = [] }) {
  const [weeks, setWeeks] = useState(() => JSON.parse(JSON.stringify(rules.weeks)))
  const [map, setMap] = useState(() => ({ ...rules.map }))
  const [bom, setBom] = useState(() => ({ ...(rules.bom || {}) }))
  const all = [...new Set([...Object.keys(map), ...items, ...unknown].filter(Boolean))]
    .sort((a, b) => (map[a] === undefined ? 0 : 1) - (map[b] === undefined ? 0 : 1) || a.localeCompare(b))
  const toggle = (it, k) => setMap(m => {
    const cur = Array.isArray(m[it]) ? m[it] : []
    return { ...m, [it]: cur.includes(k) ? cur.filter(x => x !== k) : KINDS.filter(x => x === k || cur.includes(x)) }
  })
  const setW = (k, w, v) => setWeeks(s => ({ ...s, [k]: { ...s[k], [w]: v === '' ? '' : Math.max(0, Math.min(26, Number(v))) } }))
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">⚙ 불출 기준 · 품번별 구분 · BOM 연결</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          <section>
            <p className="font-bold text-slate-700 mb-1">① 불출 예정일 = 정한 납기 − N주</p>
            <table className="w-full border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 text-slate-500"><tr>
                <th className="px-3 py-1.5 text-left">구분</th><th className="px-3 py-1.5">하네스 (주 전)</th><th className="px-3 py-1.5">전장 (주 전)</th>
              </tr></thead>
              <tbody>
                {KINDS.map(k => (
                  <tr key={k} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 font-bold text-slate-700">{KIND_LABEL[k]}</td>
                    {['harn', 'elec'].map(w => (
                      <td key={w} className="px-3 py-1.5 text-center">
                        <input type="number" min="0" max="26" value={weeks[k][w]} onChange={e => setW(k, w, e.target.value)}
                          className="w-16 px-2 py-1 text-center border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-slate-400">정한 납기 — EUV = 포캐스트 to 정한 · H2D = H2D 자재 (없으면 Frame − 1주). 확정 납기를 넣으면 그 날짜 기준.</p>
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
                                className={`w-full max-w-[230px] px-1.5 py-1 text-[11px] border rounded ${bom[k] === undefined && !g ? 'border-orange-300 text-orange-600' : 'border-slate-200'}`}>
                                <option value="__auto">자동 — {g ? g.code : '못 찾음'}</option>
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
          <button onClick={() => setWeeks(JSON.parse(JSON.stringify(defaults.weeks)))} className="px-3 py-2 text-xs rounded-lg text-slate-400 hover:text-slate-600">주수 기본값</button>
          <button onClick={onClose} className="ml-auto px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-500">취소</button>
          <button disabled={saving} onClick={() => {
            const w = {}
            for (const k of KINDS) w[k] = { harn: Number(weeks[k].harn) || 0, elec: Number(weeks[k].elec) || 0 }
            onSave({ weeks: w, map, bom })
          }} className="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">{saving ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </div>
  )
}
