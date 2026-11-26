import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { fetchAxLinesSafe, chunkAll } from '../../lib/axLines'
import { fetchPlanByPo, isHot } from '../../lib/planExc'
import { needDateReady, fetchNeedByPo, needTrend } from '../../lib/needDate'
import { openPrint } from '../../lib/issueSheet'
import { toastError, toastSuccess } from '../../lib/toast'
import { useMe, useCanEdit } from '../../hooks/useProfile'
import { fetchNotes, fetchPoChanges, ackState, cellTag, changeText, atText, addNote, setPromise } from '../../lib/poNotes'
import { KpiCard, KpiRow } from '../../components/ui/Kpi'
import PlanBadge from '../../components/PlanBadge'
import TopScroll from '../../components/ui/TopScroll'
import { useConfirm } from '../../components/ux/ConfirmDialog'
import { SkeletonRows } from '../../components/ux/Skeleton'
import { useRemember } from '../../hooks/useRemember'

// 생산관리 AXCELIS › 🧵 HARN ASSY (v4.242.0)
//   하네스 작업 순서표 — 고객사 PO(수주대장) · 하네스 공정관리 출도 기록을 읽기만 한다. 출도 · 불출은 「하네스 출도」 화면에서
//   순서: HOT → need date 지남 → 7일 이내 → 14일 이내 (묶음 안은 need date 순) · FA(G 오더)는 따로
//   need date = Supplier Portal Required Date. 칸이 없으면(SQL 전) promise date 로 대신 묶는다
//   REV: 출도할 때 찍은 REV 와 지금 PO SRev 가 다르면 「재출도」
//   공정(v4.243.0): 하네스 공정관리 QR 스캔 기록(harness_logs)을 PO · 라인으로 맞춰 줄마다 거친 공정 · 지금 공정 · 마지막 스캔을 보여 준다
//     현장은 하던 대로 QR 만 찍는다 — 포털은 읽기만. 「출도」 스캔도 출도 기록으로 센다

const DAY = 86400000
const P = (s) => String(s ?? '').trim().toUpperCase()
const N = (s) => String(s ?? '').trim().replace(/\.0$/, '')
const pnOf = (code) => String(code || '').replace(/^AX-/i, '')
const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
const dd = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY)
const md = (d) => (d ? `${String(d).slice(5, 7)}/${String(d).slice(8, 10)}` : '')
const leftOf = (p) => (Number(p.qty_remaining) > 0 ? Number(p.qty_remaining) : Number(p.qty_ordered) || 0)
const isFA = (p) => /^G/i.test(String(p.po_number || '').trim())
const esc = (v) => String(v ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

const GROUPS = [
  { key: 'hot', label: 'HOT — 최우선', cls: 'bg-rose-50 text-rose-600' },
  { key: 'late', label: 'need date 지남', cls: 'bg-rose-50 text-rose-600' },
  { key: 'w1', label: 'need 7일 이내', cls: 'bg-amber-50 text-amber-700' },
  { key: 'w2', label: 'need 14일 이내', cls: 'bg-sky-50 text-sky-700' },
  { key: 'rest', label: '그 뒤', cls: 'bg-slate-50 text-slate-500' },
  { key: 'fa', label: 'FA (G 오더) — 따로 관리', cls: 'bg-slate-100 text-slate-600' },
]

// 머리글 정렬 값 (v4.250.0)
const SORT_VAL = {
  out: (r) => (r.iss ? String(r.iss.t || '0') : ''), pn: (r) => pnOf(r.items?.std_code), ccn: (r) => String(r.ccn || ''), rev: (r) => r.sRev || '',
  qty: (r) => leftOf(r), po: (r) => `${r.po_number}|${String(N(r.order_line)).padStart(4, '0')}|${String(N(r.del_line) || 1).padStart(3, '0')}`,
  placed: (r) => r.placed || '9999', need: (r) => r.base || '9999', prom: (r) => r.prom || '9999', plan: (r) => String(r.plan_exc || 'ZZZ'),
  issue: (r) => (r.material_issued ? 0 : 1), proc: (r) => r.proc?.last?.at || '', ack: (r) => (r.ack.open ? 0 : 1), cmt: (r) => -r.ack.comments.length,
}
const SORT_LABEL = { out: '출도', pn: '품번', ccn: 'CCN', rev: 'SRev', qty: '수량', po: 'PO', placed: '접수', need: 'need date', prom: 'promise', plan: '구분', issue: '불출', proc: '공정', ack: '확인', cmt: '코멘트' }

// 출도 기록 — 줄(PO · 라인 · 분할)로, 없으면 PO · 도번으로 (하네스 출도 화면과 같은 규칙)
function matchIssued(lines, horders, hist) {
  const byLine = new Map(), byDwg = new Map()
  const put = (m, k, o) => { const e = m.get(k); if (!e || String(o.t || '') > String(e.t || '')) m.set(k, o) }
  for (const o of horders || []) {
    if (!o.qr_printed) continue
    const po = P(o.po); if (!po) continue
    const rec = { t: o.qr_printed_at || '', rev: P(o.rev) }
    if (N(o.ord_ln)) put(byLine, `${po}|${N(o.ord_ln)}|${N(o.del_ln)}`, rec)
    else put(byDwg, `${po}|${P(o.dwg_no)}`, rec)
  }
  for (const h of hist || []) {
    if (h.deleted === true) continue
    const po = P(h.po); if (!po) continue
    const rec = { t: h.ts || '', rev: P(h.rev) }
    if (N(h.ord_ln)) put(byLine, `${po}|${N(h.ord_ln)}|${N(h.del_ln)}`, rec)
    else put(byDwg, `${po}|${P(h.dwg_no)}`, rec)
  }
  const out = {}
  for (const p of lines) {
    const po = P(p.po_number)
    out[p.id] = byLine.get(`${po}|${N(p.order_line)}|${N(p.del_line)}`) || byDwg.get(`${po}|${P(pnOf(p.items?.std_code))}`) || null
  }
  return out
}

// 공정 스캔 기록 → 줄별 { steps:[{p, at, done}], last:{p, at, who, open}, out } (출도 스캔은 out 으로)
const DONE_STEP = /출하|납품|포장/
// 하네스 공정 순서 (현황판과 같은 순서): 출도 → 재단 → 납땜 → 제작 → 검사 → 포장 → 납품
const STEP_ORDER = ['재단', '납땜', '제작', '검사', '포장', '출하', '납품']
const stepRank = (name) => { const i = STEP_ORDER.indexOf(name); return i < 0 ? STEP_ORDER.length : i }
function matchLogs(lines, logs) {
  const byLine = new Map(), byDwg = new Map()
  for (const l of logs || []) {
    const po = P(l.po); if (!po) continue
    const k = N(l.ord_ln) ? `${po}|${N(l.ord_ln)}|${N(l.del_ln) || '1'}` : `${po}|${P(l.dwg_no)}`
    const m = N(l.ord_ln) ? byLine : byDwg
    if (!m.has(k)) m.set(k, []); m.get(k).push(l)
  }
  const out = {}
  for (const p of lines) {
    const po = P(p.po_number)
    const list = byLine.get(`${po}|${N(p.order_line)}|${N(p.del_line) || '1'}`) || byDwg.get(`${po}|${P(pnOf(p.items?.std_code))}`)
    if (!list?.length) continue
    const sorted = [...list].sort((a, b) => String(a.started_at || '').localeCompare(String(b.started_at || '')))
    const issue = sorted.filter(l => String(l.process || '').trim() === '출도')
    const work = sorted.filter(l => String(l.process || '').trim() && String(l.process).trim() !== '출도')
    const steps = []
    for (const l of work) {
      const name = String(l.process).trim()
      const at = l.ended_at || l.started_at
      const e = steps.find(x => x.p === name)
      if (e) { e.done = e.done || !!l.ended_at; if (String(at) > String(e.at)) e.at = at } else steps.push({ p: name, at, done: !!l.ended_at })
    }
    // 칩은 찍힌 순서가 아니라 공정 순서로 (일괄 입력하면 순서가 뒤섞여 찍힌다) — 모르는 공정은 맨 뒤, 찍힌 순서 유지
    steps.sort((a, b) => stepRank(a.p) - stepRank(b.p))
    const lastLog = work[work.length - 1]
    out[p.id] = {
      steps,
      last: lastLog ? { p: String(lastLog.process).trim(), at: lastLog.ended_at || lastLog.started_at, who: lastLog.worker || '', open: !lastLog.ended_at } : null,
      out: issue.length ? { t: issue[issue.length - 1].started_at || '', rev: '' } : null,
    }
  }
  return out
}
const hm = (t) => { if (!t) return ''; const d = new Date(Date.parse(t) + 9 * 3600000).toISOString(); return `${d.slice(5, 7)}/${d.slice(8, 10)} ${d.slice(11, 16)}` }

async function loadHarn() {
  const base = await fetchAxLinesSafe()
  const lines = base.filter(p => !p.in_prod && pnOf(p.items?.std_code).startsWith('16') && p.status !== '완료' && p.status !== '취소')
  const cpo = lines.map(p => p.cpo_id).filter(Boolean)
  const poNos = [...new Set(lines.map(p => String(p.po_number || '').trim()).filter(Boolean))]
  // 줄을 읽은 다음은 서로 기다릴 필요가 없다 — Plan Exc · need date · 출도 · 출도 이력 · 공정 스캔을 한꺼번에 (v4.244.0)
  //   전에는 하나씩 차례로 + 150개씩 차례로 읽어 수십 번 왕복 → 10초 넘게 걸렸다
  const byPo = (table, cols) => chunkAll(poNos, 150, (part) => fetchAll(() => supabase.from(table).select(cols).in('po', part).order('id')))
    .then(parts => parts.flat())
  const [plan, needRes, ho, hh, hl, heads, chgs, notes] = await Promise.all([
    cpo.length ? fetchPlanByPo(supabase, cpo) : {},
    // need date 칸이 없으면(SQL 전) 여기서 오류 → promise date 로
    cpo.length ? fetchNeedByPo(supabase, cpo).then(v => ({ ready: true, v })).catch(() => ({ ready: false, v: {} })) : needDateReady(supabase).then(r => ({ ready: r, v: {} })),
    byPo('harness_orders', 'id,po,ord_ln,del_ln,dwg_no,rev,qr_printed,qr_printed_at'),
    byPo('harness_qr_history', 'id,po,ord_ln,del_ln,dwg_no,rev,ts,deleted'),
    // 공정 스캔 기록 — 못 읽어도 순서표는 보여 준다
    byPo('harness_logs', 'id,dwg_no,po,ord_ln,del_ln,process,started_at,ended_at,worker').catch(e => { console.warn('공정 기록 읽기 실패', e); return [] }),
    // PO 접수일 — 수주대장 머리(pm_order.order_date · AXCELIS 엑셀 「Date Placed」) (v4.245.0)
    chunkAll(poNos, 150, (part) => fetchAll(() => supabase.from('pm_order').select('id,po_no,order_date').eq('customer_code', 'AX').in('po_no', part).order('id')))
      .then(parts => parts.flat()).catch(e => { console.warn('PO 접수일 읽기 실패', e); return [] }),
    // PO 변경 이력 · 영업/제조 확인 · 코멘트 (v4.250.0)
    cpo.length ? fetchPoChanges(supabase, cpo).catch(e => { console.warn('PO 변경 이력 읽기 실패', e); return {} }) : {},
    cpo.length ? fetchNotes(supabase, cpo) : { ready: true, byPo: {} },
  ])
  const placed = new Map()
  for (const h of heads) if (h.order_date) { const k = P(h.po_no); if (!placed.has(k) || String(h.order_date) < placed.get(k)) placed.set(k, String(h.order_date).slice(0, 10)) }
  const ready = needRes.ready, need = needRes.v
  const iss = matchIssued(lines, ho, hh)
  const logs = matchLogs(lines, hl)
  return { ready, notesReady: notes.ready, rows: lines.map(p => ({ ...p, chg: (p.cpo_id && chgs[p.cpo_id]) || null, ccn: p.ccn || (p.cpo_id && chgs[p.cpo_id]?.ccn) || null, notes: (p.cpo_id && notes.byPo[String(p.cpo_id)]) || [], plan_exc: p.plan_exc || (p.cpo_id && plan[p.cpo_id]) || null, placed: placed.get(P(p.po_number)) || null,
    need: (p.cpo_id && need[p.cpo_id]?.need) || null, needPrev: (p.cpo_id && need[p.cpo_id]?.prev) || null, iss: iss[p.id] || logs[p.id]?.out || (p.material_issued ? { t: '', rev: '', byIssue: true } : null),
    proc: logs[p.id] || null })) }   // 불출했으면 출도는 이미 된 것 (출도 기록이 없어도)
}

export default function HarnAssyTab() {
  const nav = useNavigate()
  const [range, setRange] = useRemember('harnassy.range', '14')   // '14' | 'all'
  const [kind, setKind] = useRemember('harnassy.kind', 'all')     // all | hot | miss | rev | late
  const [q, setQ] = useState('')
  const [faOpen, setFaOpen] = useState(false)
  const [sort, setSort] = useRemember('harnassy.sort', null)   // { k, dir } · null = 순서표 기본(HOT → 지남 → 7일 …)
  const [hist, setHist] = useState(null)       // 이력 · 코멘트 창 (줄)
  const [promEdit, setPromEdit] = useState(null) // promise 바꾸기 창 (줄)
  const qc = useQueryClient()
  const me = useMe()
  const canEdit = useCanEdit()
  const [ask, askDialog] = useConfirm()
  const { data, isLoading, error } = useQuery({ queryKey: ['harnAssy'], queryFn: loadHarn, staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false, placeholderData: (prev) => prev })
  const ready = !!data?.ready

  const rows = useMemo(() => {
    const t = today()
    return (data?.rows || []).map(p => {
      const base = (ready && p.need) || (p.promise_date ? String(p.promise_date).slice(0, 10) : null)
      const d = base ? dd(base, t) : null
      const prom = p.promise_date ? String(p.promise_date).slice(0, 10) : null
      const late = !!(ready && p.need && prom && prom > p.need)
      const sRev = P(p.item_rev), iRev = p.iss?.rev || ''
      const revChg = !!(p.iss && iRev && sRev && iRev !== sRev)
      const grp = isFA(p) ? 'fa' : isHot(p) ? 'hot' : d == null ? 'rest' : d < 0 ? 'late' : d <= 7 ? 'w1' : d <= 14 ? 'w2' : 'rest'
      const lastAt = p.proc?.last?.at
      const idle = lastAt ? Math.floor((Date.now() - Date.parse(lastAt)) / DAY) : null
      const fin = !!(p.proc?.last && DONE_STEP.test(p.proc.last.p) && !p.proc.last.open)
      const stale = !!(p.proc?.last && !fin && idle != null && idle >= 3)
      return { ...p, base, d, prom, late, revChg, iRev, sRev, grp, idle, fin, stale, trend: ready ? needTrend(p.needPrev, p.need) : '', ack: ackState(p.chg, p.notes) }
    }).sort((a, b) => String(a.base || '9999').localeCompare(String(b.base || '9999')) || String(a.po_number).localeCompare(String(b.po_number)))
  }, [data, ready])

  const kpi = useMemo(() => ({
    hot: rows.filter(r => r.grp === 'hot').length,
    late: rows.filter(r => r.grp === 'late').length,
    w1: rows.filter(r => r.grp === 'w1').length,
    slip: rows.filter(r => r.late).length,
    miss: rows.filter(r => !r.iss && r.grp !== 'rest' && r.grp !== 'fa').length,
    rev: rows.filter(r => r.revChg).length,
    work: rows.filter(r => r.proc?.last && !r.fin).length,
    stale: rows.filter(r => r.stale).length,
    fa: rows.filter(r => r.grp === 'fa').length,
    unack: rows.filter(r => r.ack.open).length,
  }), [rows])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows.filter(r => {
      if (range === '14' && r.grp === 'rest') return false
      if (kind === 'hot' && r.grp !== 'hot') return false
      if (kind === 'miss' && r.iss) return false
      if (kind === 'rev' && !r.revChg) return false
      if (kind === 'work' && !(r.proc?.last && !r.fin)) return false
      if (kind === 'stale' && !r.stale) return false
      if (kind === 'late' && !r.late) return false
      if (kind === 'unack' && !r.ack.open) return false
      if (!s) return true
      return [pnOf(r.items?.std_code), r.items?.name, r.po_number, r.ccn].some(v => String(v || '').toLowerCase().includes(s))
    })
  }, [rows, range, kind, q])

  const grouped = useMemo(() => {
    let no = 0
    // 머리글 정렬 (v4.250.0) — 정렬하면 묶음 없이 한 목록 · FA 는 그대로 따로
    if (sort?.k) {
      const val = SORT_VAL[sort.k] || (() => '')
      const cmp = (a, b) => { const x = val(a), y = val(b); const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)); return sort.dir === 'desc' ? -c : c }
      const main = shown.filter(r => r.grp !== 'fa').sort(cmp).map(r => ({ ...r, no: ++no }))
      const fa = shown.filter(r => r.grp === 'fa').sort(cmp).map(r => ({ ...r, no: '' }))
      return [{ key: 'sorted', label: `정렬: ${SORT_LABEL[sort.k]} ${sort.dir === 'desc' ? '▼' : '▲'}`, cls: 'bg-indigo-50 text-indigo-700', list: main },
        { ...GROUPS.find(g => g.key === 'fa'), list: fa }].filter(g => g.list.length)
    }
    return GROUPS.map(g => ({ ...g, label: ready ? g.label : g.label.replace(/^need (date )?/, ''), list: shown.filter(r => r.grp === g.key).map(r => ({ ...r, no: g.key === 'fa' ? '' : ++no })) })).filter(g => g.list.length)
  }, [shown, ready, sort])

  function printSheet() {
    const groups = grouped.filter(g => g.key !== 'fa')
    if (!groups.length) { toastError('출력할 줄이 없습니다'); return }
    const t = today()
    const tr = (r) => `<tr><td class="c"><i class="ck"></i></td><td class="c">${r.no}</td><td>${r.iss ? md(String(r.iss.t).slice(0, 10)) || (r.iss.byIssue ? '불출' : '출도') : '<b class="miss">미출도</b>'}</td>
<td class="mono b">${esc(pnOf(r.items?.std_code))}</td><td class="nm">${esc(r.items?.name || '')}</td><td class="c b">${esc(r.sRev)}${r.revChg ? ` <b class="k">재출도 ${esc(r.iRev)}→${esc(r.sRev)}</b>` : ''}</td><td class="r">${leftOf(r)}</td>
<td class="mono">${esc(r.po_number)} L${esc(N(r.order_line))}-${esc(N(r.del_line) || 1)}</td><td>${r.placed ? md(r.placed) : ''}</td>
<td class="b">${md(r.base)}${r.trend === 'up' ? ' ▲' : r.trend === 'down' ? ' ▼' : ''}</td>
<td>${ready ? md(r.prom) + (r.late ? ' <b>▶늦음</b>' : '') : ''}</td><td>${isHot(r) ? '<span class="hot">HOT</span>' : esc(r.plan_exc || '')}${r.material_issued ? ' 불출' : ''}</td><td>${r.proc?.last ? esc(r.proc.last.p) + (r.proc.last.open ? ' 중' : ' 끝') + (r.stale ? ` <b>멈춤${r.idle}일</b>` : '') : ''}</td></tr>`
    const body = groups.map(g => `<tr class="gh"><td colspan="13">${g.label} <span>${g.list.length}건</span></td></tr>${g.list.map(tr).join('')}`).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>하네스 작업 순서표 ${t}</title><style>
@page{size:A4 landscape;margin:10mm}body{font-family:'Malgun Gothic',Arial,sans-serif;color:#000;margin:0}
.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #000;padding-bottom:4px}h1{margin:0;font-size:20px}
.meta{font-size:11px;text-align:right;line-height:1.5}.sum{display:flex;gap:8px;margin:8px 0}.sum div{border:1.5px solid #000;padding:4px 10px;font-size:11px}.sum b{font-size:17px;display:block}.inv{background:#000;color:#fff}
table{border-collapse:collapse;width:100%;font-size:10.5px}thead{display:table-header-group}th{border-bottom:2px solid #000;text-align:left;padding:4px 5px;font-size:10px}
td{border-bottom:1px solid #999;padding:3px 5px}tr{page-break-inside:avoid}.c{text-align:center}.r{text-align:right}.mono{font-family:Consolas,monospace}.b{font-weight:700}.nm{font-size:9.5px}
.gh td{background:#000;color:#fff;font-weight:800;font-size:11px;padding:4px 6px;-webkit-print-color-adjust:exact;print-color-adjust:exact}.gh span{font-weight:400;margin-left:6px}
.hot{background:#000;color:#fff;padding:0 4px;font-weight:800;-webkit-print-color-adjust:exact;print-color-adjust:exact}.k{border:1.5px solid #000;padding:0 3px}.miss{border:1.5px dashed #000;padding:0 3px}
.ck{display:inline-block;width:11px;height:11px;border:1.5px solid #000}.legend{font-size:9.5px;margin-top:6px;line-height:1.6}
</style></head><body>
<div class="top"><div><div style="font-size:10px">JINSUNTECH · AXCELIS 하네스</div><h1>작업 순서표</h1></div>
<div class="meta">기준 : ${t} · ${ready ? 'need date' : 'promise date (need date 저장 전)'} 기준<br>정렬 : HOT → 지남 → 7일 → 14일 (각 날짜 순)${range === 'all' ? ' → 그 뒤' : ''}</div></div>
<div class="sum"><div class="inv">HOT<b>${kpi.hot}</b></div><div>지남<b>${kpi.late}</b></div><div>7일 이내<b>${kpi.w1}</b></div>${ready ? `<div>promise가 need보다 늦음<b>${kpi.slip}</b></div>` : ''}<div>미출도<b>${kpi.miss}</b></div><div>REV 바뀜<b>${kpi.rev}</b></div></div>
<table><thead><tr><th>✔</th><th>순</th><th>출도</th><th>품번</th><th>품명</th><th>SRev</th><th class="r">수량</th><th>PO</th><th>접수</th><th>${ready ? 'need date' : 'promise'}</th><th>${ready ? 'promise' : ''}</th><th>구분</th><th>공정</th></tr></thead>
<tbody>${body}</tbody></table>
<div class="legend">▲ 지난번보다 need 당겨짐 · ▼ 늦춰짐 · <b>▶늦음</b> promise가 need보다 늦음(Axcelis 사전 공유) · <span class="miss">미출도</span> 아직 도면 안 나감 · <b class="k">재출도</b> 출도 뒤 SRev 바뀜 → 작업 중지, 구매자재 연락<br>FA(G 오더) ${kpi.fa}건은 따로 관리 · 못 하는 건 옆에 사유(자재·인력·REV·도면)</div>
</body></html>`
    openPrint(html, toastError)
  }

  async function exportLate() {
    const list = rows.filter(r => r.late)
    if (!list.length) { toastError('promise 가 need 보다 늦은 줄이 없습니다'); return }
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.aoa_to_sheet([
      ['Order Number', 'Date Placed', 'Order Line', 'Del Line', 'Item', 'Item Desc', 'SRev', 'Qty', 'Need Date', 'Promise Date', 'Days Late', 'Plan Exc', 'Drawing Issued', 'Reason'],
      ...list.map(r => [r.po_number, r.placed || '', N(r.order_line), N(r.del_line), pnOf(r.items?.std_code), r.items?.name || '', r.sRev, leftOf(r), r.need, r.prom,
        dd(r.prom, r.need), r.plan_exc || '', r.iss ? 'Y' : 'N', '']),
    ])
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Delay Forecast')
    XLSX.writeFile(wb, `Harness_delay_forecast_${today()}.xlsx`)
  }

  // ── v4.250.0 정렬 · 변경 음영 · 확인 · 코멘트 · 엑셀 ──
  const Th = ({ k, cls = '', title, children }) => (
    <th title={title} onClick={() => setSort(sort?.k === k ? (sort.dir === 'asc' ? { k, dir: 'desc' } : null) : { k, dir: 'asc' })}
      className={`px-2 py-2 text-left cursor-pointer select-none whitespace-nowrap hover:text-indigo-600 ${cls}`} data-harn-th={k}>
      {children}<span className={`ml-0.5 text-[10px] ${sort?.k === k ? 'text-indigo-600' : 'text-slate-300'}`}>{sort?.k === k ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </th>
  )
  // 영업 · 제조 둘 다 확인 전인 변경 칸 → 노란 음영
  const hl = (r, f) => (r.ack.cells[f] ? 'bg-amber-100/70 ring-2 ring-inset ring-amber-300' : '')
  const Tag = ({ r, f }) => (r.ack.cells[f] ? <span className="block text-[10px] font-bold text-amber-700 whitespace-nowrap" data-harn-chg={f}>{cellTag(r.ack.cells[f])}</span> : null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['harnAssy'] })
  // 확인 · 확인 취소 (v4.250.3) — 이미 확인한 버튼을 다시 누르면 취소를 묻는다 · 취소도 이력에 남음
  async function doAck(r, dept) {
    const done = dept === '영업' ? r.ack.sOk : r.ack.mOk
    try {
      if (done) {
        const res = await ask({ title: `${dept} 확인을 취소할까요?`, desc: `${pnOf(r.items?.std_code)} · ${r.po_number} L${N(r.order_line)}-${N(r.del_line) || 1} — 취소하면 노란 음영이 다시 켜지고, 취소 기록이 이력에 남습니다.`,
          okText: '확인 취소', danger: true, input: { label: '사유 (선택)', required: false, placeholder: '예) 잘못 누름' } })
        if (!res) return
        await addNote(supabase, { poId: r.cpo_id, kind: 'unack', dept, body: (res.value || '').trim() || null, me })
        toastSuccess(`${dept} 확인 취소 — ${pnOf(r.items?.std_code)} ${r.po_number}`)
        refresh(); return
      }
      await addNote(supabase, { poId: r.cpo_id, kind: 'ack', dept, me })
      toastSuccess(`${dept} 확인 — ${pnOf(r.items?.std_code)} ${r.po_number}`)
      refresh()
    } catch (e) { toastError(e.message) }
  }
  // 📥 엑셀 (v4.250.2) — 표 서식: 맑은 고딕 10 · 회색 머리글 · 얇은 회색 테두리 · 제목/안내 줄 · 틀 고정 · 자동 필터
  //   지난 날짜는 빨간 글씨 · 영업/제조 미확인 변경 칸은 노란 음영 (화면과 같게)
  async function exportAll() {
    const list = grouped.flatMap(g => g.list.map(r => ({ r, g })))
    if (!list.length) { toastError('내려받을 줄이 없습니다'); return }
    const t = today()
    const histTxt = (r) => [...r.ack.events.map(c => ({ at: c.at, t: changeText(c) + (c.reason ? ` (사유: ${c.reason})` : c.field === 'promise_date' && c.src !== 'portal' ? ' (PO 업로드)' : '') + (c.by ? ` · ${c.by}` : '') })),
      ...r.notes.map(n => ({ at: n.created_at, t: n.kind === 'ack' ? `${n.dept} 확인 · ${n.by_name || ''}` : n.kind === 'unack' ? `${n.dept} 확인 취소 · ${n.by_name || ''}${n.body ? ` (사유: ${n.body})` : ''}` : `[${n.dept || '-'}] ${n.by_name || ''}: ${n.body || ''}` }))]
      .sort((a, b) => String(a.at).localeCompare(String(b.at))).map(x => `${atText(x.at)} ${x.t}`).join('\n')
    const dt = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`) : '')
    // [머리글, 폭, 값, 정렬, 서식, 강조칸(변경 필드)]
    const COLS = [
      ['No', 5, (r) => r.no, 'center'],
      ['묶음', 14, (r, g) => g.label, 'left'],
      ['CCN', 6, (r) => r.ccn || '', 'center'],
      ['구분', 8, (r) => r.plan_exc || '', 'center', null, 'plan_exc'],
      ['Item', 12, (r) => pnOf(r.items?.std_code), 'center'],
      ['Rev', 6, (r) => r.sRev || '', 'center'],
      ['Item Desc', 40, (r) => r.items?.name || '', 'left'],
      ['PO', 12, (r) => r.po_number, 'center', null, 'new'],
      ['Line', 6, (r) => N(r.order_line), 'center'],
      ['Del', 5, (r) => N(r.del_line) || 1, 'center'],
      ['수량', 8, (r) => leftOf(r), 'center', '#,##0', 'qty_ordered'],
      ['접수', 10, (r) => dt(r.placed), 'center', 'mm/dd'],
      ['need date', 11, (r) => dt(ready && r.need), 'center', 'mm/dd', 'need_date'],
      ['promise', 11, (r) => dt(r.prom), 'center', 'mm/dd', 'promise_date'],
      ['출도일', 10, (r) => (r.iss ? (String(r.iss.t).slice(0, 10) ? dt(r.iss.t) : (r.iss.byIssue ? '불출' : '출도')) : '미출도'), 'center', 'mm/dd'],
      ['불출', 6, (r) => (r.material_issued ? 'Y' : ''), 'center'],
      ['진행현황', 22, (r) => (r.proc?.last ? `${r.proc.last.p} ${r.proc.last.open ? '진행 중' : '끝'} ${atText(r.proc.last.at)}` : ''), 'left'],
      ['영업 확인', 12, (r) => (r.ack.ackS ? atText(r.ack.ackS) : ''), 'center'],
      ['제조 확인', 12, (r) => (r.ack.ackM ? atText(r.ack.ackM) : ''), 'center'],
      ['미확인 변경', 26, (r) => Object.values(r.ack.cells).map(cellTag).join(' / '), 'left'],
      ['최근 코멘트', 32, (r) => { const c = r.ack.comments[r.ack.comments.length - 1]; return c ? `[${c.dept || '-'}] ${c.by_name || ''}: ${c.body || ''}` : '' }, 'left'],
      ['이력 · 코멘트', 60, (r) => histTxt(r), 'left'],
    ]
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('HARN ASSY', { views: [{ state: 'frozen', ySplit: 4, topLeftCell: 'A5', showGridLines: false }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } })
    const FONT = { name: '맑은 고딕', size: 10 }
    const B = { style: 'thin', color: { argb: 'FFA6A6A6' } }
    const border = { top: B, bottom: B, left: B, right: B }
    ws.columns = COLS.map(c => ({ width: c[1] }))
    ws.getCell('A1').value = `Axcelis 하네스 작업 순서 — HARN ASSY (${md(t)})`; ws.getCell('A1').font = { ...FONT, size: 14, bold: true }; ws.getRow(1).height = 21
    ws.getCell('A2').value = `※ 기준: ${ready ? 'need date' : 'promise date'} · 묶음 HOT → 지남 → 7일 → 14일${range === 'all' ? ' → 그 뒤' : ''}${sort?.k ? ` (정렬: ${SORT_LABEL[sort.k]} ${sort.dir === 'desc' ? '▼' : '▲'})` : ''} · 지난 need date 는 빨간 글씨`
    ws.getCell('A2').font = { ...FONT, size: 9 }
    ws.getCell('A3').value = '※ 노란 칸 = 영업 · 제조 둘 다 확인 전인 변경 (신규 HOT · need · promise · 수량 · 새 PO 줄)'
    ws.getCell('A3').font = { ...FONT, size: 9, color: { argb: 'FFFF0000' } }
    const hr = ws.getRow(4); hr.height = 22
    COLS.forEach((c, k) => { const cell = hr.getCell(k + 1); cell.value = c[0]; cell.font = { ...FONT, bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } }; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; cell.border = border })
    list.forEach(({ r, g }, n) => {
      const row = ws.getRow(5 + n)
      COLS.forEach(([, , fn, al, fmt, fld], k) => {
        const cell = row.getCell(k + 1)
        const v = fn(r, g)
        cell.value = v === '' || v == null ? null : v
        if (fmt) cell.numFmt = fmt
        const pastNeed = fld === 'need_date' && v instanceof Date && v.toISOString().slice(0, 10) < t
        const hot = fld === 'plan_exc' && String(v).toUpperCase() === 'HOT'
        cell.font = { ...FONT, ...(pastNeed || hot ? { color: { argb: 'FFFF0000' }, bold: hot } : {}) }
        cell.alignment = { horizontal: al, vertical: 'middle', wrapText: al === 'left' && typeof v === 'string' && v.includes('\n') }
        cell.border = border
        if (fld && r.ack.cells[fld]) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }
      })
    })
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + list.length, column: COLS.length } }
    const buf = await wb.xlsx.writeBuffer()
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    const a = document.createElement('a'); a.href = url; a.download = `Axcelis_하네스_순서_${t}.xlsx`
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  const chip = (cur, v, set, label) => (
    <button key={v} onClick={() => set(v)} className={`px-2.5 py-1 text-xs font-semibold rounded-md ${cur === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{label}</button>
  )

  return (
    <div data-harn-assy>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="품번 · 품명 · PO 검색"
          className="w-full sm:w-56 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <div className="flex gap-1 p-0.5 bg-slate-100 rounded-lg">{chip(range, '14', setRange, '14일 이내')}{chip(range, 'all', setRange, '전체 진행 중')}</div>
        <div className="flex gap-1 p-0.5 bg-slate-100 rounded-lg">
          {chip(kind, 'all', setKind, '전체')}{chip(kind, 'hot', setKind, 'HOT만')}{chip(kind, 'miss', setKind, '미출도만')}{chip(kind, 'rev', setKind, 'REV 바뀜')}{chip(kind, 'work', setKind, '작업 중')}{chip(kind, 'stale', setKind, '멈춤 3일+')}
          {ready && chip(kind, 'late', setKind, '▶늦음')}{chip(kind, 'unack', setKind, `미확인 ${kpi.unack || ''}`)}
        </div>
        {sort?.k && <button onClick={() => setSort(null)} data-harn-sort-reset className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700">순서표 기본</button>}
        <div className="flex-1" />
        <button onClick={refresh} data-harn-refresh className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50" title="PO 업로드 · QR 스캔 · 확인 · 코멘트를 지금 다시 읽기 (그냥 두면 5분마다)">↻ 새로고침</button>
        <button onClick={exportAll} data-harn-xlsx className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50" title="지금 보이는 줄 전부 — 확인 · 코멘트 · 변경 이력 포함">📥 엑셀</button>
        <button onClick={() => nav('/production/harness-release')} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">🧵 하네스 출도로</button>
        <button onClick={exportLate} disabled={!ready} data-harn-late
          title={ready ? 'promise 가 need 보다 늦은 줄 — Axcelis 사전 공유용 엑셀 (사유 칸은 비워 둠)' : 'need date 를 저장한 뒤(SQL 실행 후 PO 파일 업로드) 쓸 수 있습니다'}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-40">📥 지연 예상 엑셀</button>
        <button onClick={printSheet} data-harn-print className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">🖨 흑백 순서표</button>
      </div>

      {data && !ready && (
        <p data-harn-noneed className="mb-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          need date(Required Date)가 아직 저장되지 않아 <b>promise date</b> 기준으로 묶었습니다 — SQL 실행 후 AXCELIS PO 파일을 한 번 올리면 need date 기준 · ▲▼ · ▶늦음이 켜집니다.
        </p>
      )}

      <KpiRow cols={6}>
        <KpiCard tone="red" label="HOT" value={kpi.hot} note="최우선 · 오늘 먼저" loading={isLoading} onClick={() => setKind(kind === 'hot' ? 'all' : 'hot')} on={kind === 'hot'} />
        <KpiCard tone="red" label={ready ? 'need 지남' : '납기 지남'} value={kpi.late} note={`7일 이내 ${kpi.w1}건 · FA ${kpi.fa}건 따로`} loading={isLoading} />
        <KpiCard tone="amber" label="▶늦음" value={ready ? kpi.slip : '—'} note={ready ? 'promise가 need보다 늦음 · Axcelis 공유' : 'need date 저장 후'} loading={isLoading}
          onClick={ready ? () => setKind(kind === 'late' ? 'all' : 'late') : undefined} on={kind === 'late'} />
        <KpiCard label="미출도" value={kpi.miss} note="14일 안쪽 중 도면 안 나감" loading={isLoading} onClick={() => setKind(kind === 'miss' ? 'all' : 'miss')} on={kind === 'miss'} />
        <KpiCard tone="blue" label="작업 중" value={kpi.work} note={kpi.stale ? `멈춤 3일+ ${kpi.stale}건` : '공정 QR 찍힌 줄'} loading={isLoading} onClick={() => setKind(kind === 'work' ? 'all' : 'work')} on={kind === 'work'} />
        <KpiCard tone="red" label="REV 바뀜" value={kpi.rev} note="출도 뒤 SRev 변경 · 재출도" loading={isLoading} onClick={() => setKind(kind === 'rev' ? 'all' : 'rev')} on={kind === 'rev'} />
      </KpiRow>

      {/* 가로 스크롤 막대는 화면 맨 아래에 붙음 (v4.250.1) */}
      <TopScroll className="mt-3 bg-white border border-slate-200 rounded-xl" data-harn-table>
        {error ? <p className="p-4 text-sm text-rose-600">불러오기 실패: {error.message}</p>
        : isLoading ? <table className="w-full"><tbody><SkeletonRows cols={9} rows={8} two={[2]} /></tbody></table>
        : !grouped.length ? <p className="p-6 text-center text-sm text-slate-400">조건에 맞는 하네스 줄이 없습니다</p>
        : (
        <table className="w-max min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-600 sticky top-0">
            <tr>
              <th className="px-2 py-2 text-center">순</th><Th k="out">출도</Th><Th k="pn">품번 · 품명</Th><Th k="ccn" title="CCN — K · HUB · B (B = 미국 · 달러)">CCN</Th>
              <Th k="rev" cls="text-center">SRev</Th><Th k="qty" cls="text-right">수량</Th><Th k="po">PO</Th><Th k="placed" title="PO 접수일 — AXCELIS 엑셀 「Date Placed」">접수</Th>
              <Th k="need">{ready ? 'need date' : 'promise (need 저장 전)'}</Th>{ready && <Th k="prom">promise</Th>}
              <Th k="plan">구분</Th><Th k="issue" cls="text-center">불출</Th><Th k="proc">공정 (QR)</Th>
              <Th k="ack" title="변경(신규 HOT · need · promise · 수량 · 새 줄)을 영업 · 제조가 둘 다 확인하면 노란 음영이 꺼집니다">확인</Th><Th k="cmt" cls="text-center" title="이력 · 코멘트">💬</Th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(g => {
              const fold = g.key === 'fa' && !faOpen
              return [
                <tr key={g.key} data-harn-group={g.key}>
                  <td colSpan={ready ? 15 : 14} className={`px-3 py-1.5 font-bold ${g.cls} ${g.key === 'fa' ? 'cursor-pointer' : ''}`} onClick={g.key === 'fa' ? () => setFaOpen(!faOpen) : undefined}>
                    {g.label} <span className="font-normal text-slate-400 ml-1">{g.list.length}건{g.key === 'fa' ? (faOpen ? ' ▾ 접기' : ' ▸ 펼치기') : ''}</span>
                  </td>
                </tr>,
                ...(fold ? [] : g.list.map(r => (
                  <tr key={r.id} data-harn-row data-harn-open={r.ack.open ? '1' : undefined} className={`border-t border-slate-100 ${r.ack.open ? 'bg-amber-50/70 hover:bg-amber-50' : 'hover:bg-slate-50'}`}>
                    <td className="px-2 py-1.5 text-center text-slate-500">{r.no}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.iss ? <span className="text-slate-600" title="하네스 공정관리 출도 기록">{md(String(r.iss.t).slice(0, 10)) || (r.iss.byIssue ? '불출' : '출도')}</span>
                      : <span className="px-1.5 py-0.5 rounded border border-dashed border-slate-400 text-slate-500 font-bold text-[10px]">미출도</span>}</td>
                    <td className="px-2 py-1.5"><div className="font-mono font-bold text-indigo-600">{pnOf(r.items?.std_code)}</div><div className="text-[11px] text-slate-400 truncate max-w-[210px]">{r.items?.name}</div></td>
                    <td className="px-2 py-1.5 font-mono font-bold text-slate-600 whitespace-nowrap" data-harn-ccn title={r.ccn === 'B' ? 'CCN B — 미국 · 달러' : ''}>{r.ccn || '—'}</td>
                    <td className="px-2 py-1.5 text-center font-mono font-bold">{r.revChg
                      ? <span data-harn-rev className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 text-[11px]" title={`출도 때 REV ${r.iRev} → 지금 PO SRev ${r.sRev} · 작업 중지하고 재출도`}>⚠ {r.iRev}→{r.sRev} 재출도</span>
                      : (r.sRev || '—')}</td>
                    <td className={`px-2 py-1.5 text-right font-mono ${hl(r, 'qty_ordered')}`}>{leftOf(r).toLocaleString('ko-KR')}<Tag r={r} f="qty_ordered" /></td>
                    <td className={`px-2 py-1.5 font-mono whitespace-nowrap ${hl(r, 'new')}`}>{r.po_number} <span className="text-slate-400">L{N(r.order_line)}-{N(r.del_line) || 1}</span><Tag r={r} f="new" /></td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-slate-500" data-harn-placed>{r.placed ? `${md(r.placed)}${String(r.placed).slice(0, 4) !== today().slice(0, 4) ? ` '${String(r.placed).slice(2, 4)}` : ''}` : '—'}</td>
                    <td className={`px-2 py-1.5 whitespace-nowrap ${hl(r, ready ? 'need_date' : 'promise_date')}`}>
                      <span className={r.d != null && r.d < 0 ? 'text-rose-600 font-bold' : 'text-slate-700'}>{md(r.base) || '—'}</span>
                      {r.trend === 'up' && <span className="ml-1 text-rose-600 font-extrabold" title={`지난번 ${md(r.needPrev)} → 당겨짐`}>▲</span>}
                      {r.trend === 'down' && <span className="ml-1 text-sky-600 font-extrabold" title={`지난번 ${md(r.needPrev)} → 늦춰짐`}>▼</span>}
                      <Tag r={r} f={ready ? 'need_date' : 'promise_date'} />
                    </td>
                    {ready && <td className={`px-2 py-1.5 whitespace-nowrap ${hl(r, 'promise_date')}`} data-harn-prom>
                      <span className={r.late ? 'text-amber-600 font-bold' : 'text-slate-600'} title={r.late ? 'promise 가 need date 보다 늦음' : ''}>{md(r.prom) || '—'}</span>
                      <Tag r={r} f="promise_date" />
                    </td>}
                    <td className={`px-2 py-1.5 ${hl(r, 'plan_exc')}`}>{r.plan_exc ? <PlanBadge plan={r.plan_exc} since={false} /> : ''}<Tag r={r} f="plan_exc" /></td>
                    <td className="px-2 py-1.5 text-center">{r.material_issued ? <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold">불출</span> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 py-1.5" data-harn-proc>{r.proc?.steps?.length ? (
                      <div>
                        <div className="flex flex-wrap gap-1">{r.proc.steps.map(st => {
                          const cur = r.proc.last?.open && r.proc.last.p === st.p
                          return <span key={st.p} className={`px-1.5 py-0.5 rounded border text-[10.5px] font-bold ${cur ? 'bg-indigo-600 border-indigo-600 text-white' : st.done ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-400'}`}>{st.done && !cur ? '✓' : ''}{st.p}</span>
                        })}</div>
                        <div className="text-[10.5px] text-slate-400 mt-0.5 whitespace-nowrap">{r.proc.last.p} {r.proc.last.open ? '진행 중' : '끝'} · {hm(r.proc.last.at)}{r.proc.last.who ? ` · ${r.proc.last.who}` : ''}
                          {r.stale && <b data-harn-stale className="text-amber-600"> · 멈춤 {r.idle}일</b>}{r.fin && <b className="text-emerald-600"> → 납품 대기</b>}</div>
                      </div>) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap" data-harn-ack>
                      <span className="inline-flex gap-1">
                        {['영업', '제조'].map(dp => {
                          const ok = dp === '영업' ? r.ack.sOk : r.ack.mOk
                          return <button key={dp} disabled={!canEdit || !r.cpo_id || !data?.notesReady} onClick={() => doAck(r, dp)}
                            title={!canEdit ? '편집 권한이 있어야 누를 수 있습니다' : ok ? `${dp} 확인함 · ${atText(dp === '영업' ? r.ack.ackS : r.ack.ackM)} — 다시 누르면 확인 취소` : `${dp} 확인 — 누르면 이력에 남습니다`}
                            className={`px-1.5 py-0.5 rounded border text-[10.5px] font-bold ${ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : r.ack.open ? 'bg-white border-amber-300 text-amber-700 hover:bg-amber-50' : 'bg-white border-slate-200 text-slate-400'} disabled:opacity-50`}>
                            {dp}{ok ? ' ✓' : ' 확인'}</button>
                        })}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => setHist(r)} data-harn-hist className="text-[11px] font-bold text-indigo-600 hover:underline" title="이력 · 코멘트">{r.ack.comments.length || '+'}</button>
                    </td>
                  </tr>
                ))),
              ]
            })}
          </tbody>
        </table>
        )}
      </TopScroll>
      {data && !data.notesReady && (
        <p data-harn-nonotes className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          영업 · 제조 확인과 코멘트를 저장할 표가 아직 없습니다 — SQL <b>pm_po_notes_261125</b> 를 실행하면 켜집니다. (변경 음영 · promise 바꾸기는 지금도 됩니다)
        </p>
      )}
      {askDialog}
      {hist && <HistDialog r={rows.find(x => x.id === hist.id) || hist} me={me} canEdit={canEdit} notesReady={!!data?.notesReady} onAck={doAck} onClose={() => setHist(null)} onSaved={refresh} />}
      {promEdit && <PromiseDialog r={promEdit} me={me} onClose={() => setPromEdit(null)} onSaved={refresh} />}
      <p className="mt-2 text-[11px] text-slate-400">보기 전용 — 출도 · 불출은 「하네스 출도」에서 합니다. 출도일 · REV · 공정은 하네스 공정관리 기록(출도 · QR 스캔)을 PO · 라인으로 맞춰 읽습니다 — PO 없이 찍힌 스캔은 안 붙습니다.</p>
    </div>
  )
}

// 이력 · 코멘트 창 (v4.250.0) — PO 변경(업로드 · 포털)과 확인 · 코멘트를 시간순으로. 지우지 않는다
const DEPT_CLS = { 영업: 'bg-blue-50 text-blue-600', 제조: 'bg-amber-50 text-amber-700', 구매자재: 'bg-violet-50 text-violet-700' }
function HistDialog({ r, me, canEdit, notesReady, onAck, onClose, onSaved }) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const myDept = ['영업', '제조', '구매자재'].includes(me?.dept) ? me.dept : (me?.dept || '')
  const all = (r.chg?.changes || []).filter(c => c && c.at)
  const items = [
    ...all.map(c => ({ at: String(c.at), k: 'chg', c })),
    ...(r.chg?.created ? [{ at: String(r.chg.created), k: 'new' }] : []),
    ...(r.notes || []).map(n => ({ at: String(n.created_at), k: n.kind, n })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  async function save() {
    if (!body.trim()) return
    setBusy(true)
    try { await addNote(supabase, { poId: r.cpo_id, kind: 'comment', dept: myDept, body: body.trim(), me }); setBody(''); toastSuccess('코멘트 저장'); onSaved?.() }
    catch (e) { toastError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center p-4" data-harn-hist-dialog>
      <div className="bg-white rounded-2xl w-full max-w-[640px] max-h-[90vh] flex flex-col p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <h3 className="text-base font-extrabold text-slate-800">{pnOf(r.items?.std_code)} · {r.po_number} L{N(r.order_line)}-{N(r.del_line) || 1} — 이력 · 코멘트</h3>
            <p className="text-xs text-slate-400 mt-0.5">PO 업로드 · 포털 수정 · 영업/제조 확인 · 코멘트가 시간순으로 쌓입니다 (지워지지 않음)</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>
        <ul className="mt-3 overflow-y-auto flex-1 border-l-2 border-slate-100 ml-1 space-y-2 text-xs" data-harn-timeline>
          {!items.length && <li className="pl-3 text-slate-400">기록이 없습니다</li>}
          {items.map((x, i) => (
            <li key={i} className="pl-3 relative">
              <span className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-violet-300" />
              <span className="text-slate-400 mr-1.5">{atText(x.at)}</span>
              {x.k === 'chg' && <>{x.c.src === 'portal' ? '✏' : '📥 PO 업로드 —'} <b className={x.c.field === 'plan_exc' && String(x.c.to).toUpperCase() === 'HOT' ? 'text-rose-600' : 'text-slate-700'}>{changeText(x.c)}</b>
                {x.c.by && <span className="text-slate-500"> · {x.c.by}</span>}{x.c.reason && <span className="text-slate-600"> · 사유: {x.c.reason}</span>}</>}
              {x.k === 'new' && <>📥 PO 줄 등록 (promise {r.prom ? r.prom.slice(5).replace('-', '/') : '—'})</>}
              {x.k === 'ack' && <><span className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold mr-1 ${DEPT_CLS[x.n.dept] || 'bg-slate-100 text-slate-600'}`}>{x.n.dept}</span><b>{x.n.by_name}</b> ✓ 확인</>}
              {x.k === 'unack' && <><span className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold mr-1 ${DEPT_CLS[x.n.dept] || 'bg-slate-100 text-slate-600'}`}>{x.n.dept}</span><b>{x.n.by_name}</b> <span className="text-rose-600 font-bold">↺ 확인 취소</span>{x.n.body && <span className="text-slate-600"> · 사유: {x.n.body}</span>}</>}
              {x.k === 'comment' && <><span className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold mr-1 ${DEPT_CLS[x.n.dept] || 'bg-slate-100 text-slate-600'}`}>{x.n.dept || '—'}</span><b>{x.n.by_name}</b> 💬 <span className="text-slate-700 whitespace-pre-wrap">{x.n.body}</span></>}
            </li>
          ))}
        </ul>
        {notesReady ? (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <div className="text-xs font-bold text-slate-600">코멘트 남기기 <span className="font-normal text-slate-400">— 부서 {myDept || '(프로필 부서 없음)'} · {me?.name || ''}</span></div>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={2} placeholder="예) 자재 11/26 입고 예정" disabled={!canEdit}
              className="mt-1.5 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <div className="mt-2 flex gap-2 justify-end">
              {['영업', '제조'].map(dp => { const ok = dp === '영업' ? r.ack.sOk : r.ack.mOk
                return <button key={dp} disabled={!canEdit} onClick={() => onAck(r, dp)} className={`px-3 py-1.5 text-xs font-bold rounded-lg border disabled:opacity-40 ${ok ? 'border-rose-200 text-rose-600 hover:bg-rose-50' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{dp} {ok ? '확인 취소' : '확인'}</button> })}
              <button disabled={!canEdit || busy || !body.trim()} onClick={save} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">코멘트 저장</button>
            </div>
          </div>
        ) : <p className="mt-3 text-[11px] text-amber-700">확인 · 코멘트는 SQL pm_po_notes_261125 실행 후 쓸 수 있습니다</p>}
      </div>
    </div>
  )
}

// promise date 바꾸기 (v4.250.0) — 사유 없으면 저장 안 됨 · 이력에 누가 · 언제 · 전→후 · 사유
function PromiseDialog({ r, me, onClose, onSaved }) {
  const [to, setTo] = useState(r.prom || '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try { await setPromise(supabase, { poId: r.cpo_id, to, reason, me }); toastSuccess(`promise ${r.prom || '-'} → ${to}`); onSaved?.(); onClose() }
    catch (e) { toastError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center p-4" data-harn-prom-dialog>
      <div className="bg-white rounded-2xl w-full max-w-[440px] p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <h3 className="text-base font-extrabold text-slate-800">promise date 바꾸기</h3>
            <p className="text-xs text-slate-400 mt-0.5">{pnOf(r.items?.std_code)} · {r.po_number} L{N(r.order_line)}-{N(r.del_line) || 1} · 지금 <b className="text-slate-600">{r.prom || '—'}</b></p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>
        <label className="block text-xs font-bold text-slate-600">새 promise date
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </label>
        <label className="block text-xs font-bold text-slate-600">사유 <span className="text-rose-500">*</span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="예) 하네스 검사 지연 · 고객사 합의 (필수)" className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </label>
        <p className="text-[11px] text-slate-400">사유 없이는 저장되지 않습니다 · 이력에 남고, 노란 음영이 켜져 영업 · 제조 확인을 다시 받습니다. PO 파일 업로드로 바뀐 promise 는 이력에 「PO 업로드」로 남습니다.</p>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-100 text-slate-600">취소</button>
          <button type="button" disabled={busy || !to || !reason.trim()} onClick={save} data-harn-prom-save className="px-3 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white disabled:opacity-40">사유 입력 후 적용</button>
        </div>
      </div>
    </div>
  )
}
