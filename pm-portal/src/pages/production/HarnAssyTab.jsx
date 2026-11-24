import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { fetchAxLinesSafe } from '../../lib/axLines'
import { fetchPlanByPo, isHot } from '../../lib/planExc'
import { needDateReady, fetchNeedByPo, needTrend } from '../../lib/needDate'
import { openPrint } from '../../lib/issueSheet'
import { toastError } from '../../lib/toast'
import { KpiCard, KpiRow } from '../../components/ui/Kpi'
import PlanBadge from '../../components/PlanBadge'
import { SkeletonRows } from '../../components/ux/Skeleton'
import { useRemember } from '../../hooks/useRemember'

// 생산관리 AXCELIS › 🧵 HARN ASSY (v4.242.0)
//   하네스 작업 순서표 — 고객사 PO(수주대장) · 하네스 공정관리 출도 기록을 읽기만 한다. 출도 · 불출은 「하네스 출도」 화면에서
//   순서: HOT → need date 지남 → 7일 이내 → 14일 이내 (묶음 안은 need date 순) · FA(G 오더)는 따로
//   need date = Supplier Portal Required Date. 칸이 없으면(SQL 전) promise date 로 대신 묶는다
//   REV: 출도할 때 찍은 REV 와 지금 PO SRev 가 다르면 「재출도」

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

async function loadHarn() {
  const base = await fetchAxLinesSafe()
  const lines = base.filter(p => !p.in_prod && pnOf(p.items?.std_code).startsWith('16') && p.status !== '완료' && p.status !== '취소')
  const cpo = lines.map(p => p.cpo_id).filter(Boolean)
  const plan = cpo.length ? await fetchPlanByPo(supabase, cpo) : {}
  const ready = await needDateReady(supabase)
  let need = {}
  if (ready && cpo.length) { try { need = await fetchNeedByPo(supabase, cpo) } catch (e) { console.warn('need date 조회 실패', e) } }
  const poNos = [...new Set(lines.map(p => String(p.po_number || '').trim()).filter(Boolean))]
  const ho = [], hh = []
  for (let i = 0; i < poNos.length; i += 150) {
    const part = poNos.slice(i, i + 150)
    ho.push(...await fetchAll(() => supabase.from('harness_orders').select('*').in('po', part).order('id')))
    hh.push(...await fetchAll(() => supabase.from('harness_qr_history').select('*').in('po', part).order('id')))
  }
  const iss = matchIssued(lines, ho, hh)
  return { ready, rows: lines.map(p => ({ ...p, plan_exc: p.plan_exc || (p.cpo_id && plan[p.cpo_id]) || null,
    need: (p.cpo_id && need[p.cpo_id]?.need) || null, needPrev: (p.cpo_id && need[p.cpo_id]?.prev) || null, iss: iss[p.id] })) }
}

export default function HarnAssyTab() {
  const nav = useNavigate()
  const [range, setRange] = useRemember('harnassy.range', '14')   // '14' | 'all'
  const [kind, setKind] = useRemember('harnassy.kind', 'all')     // all | hot | miss | rev | late
  const [q, setQ] = useState('')
  const [faOpen, setFaOpen] = useState(false)
  const { data, isLoading, error } = useQuery({ queryKey: ['harnAssy'], queryFn: loadHarn, staleTime: 60 * 1000, refetchOnWindowFocus: true })
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
      return { ...p, base, d, prom, late, revChg, iRev, sRev, grp, trend: ready ? needTrend(p.needPrev, p.need) : '' }
    }).sort((a, b) => String(a.base || '9999').localeCompare(String(b.base || '9999')) || String(a.po_number).localeCompare(String(b.po_number)))
  }, [data, ready])

  const kpi = useMemo(() => ({
    hot: rows.filter(r => r.grp === 'hot').length,
    late: rows.filter(r => r.grp === 'late').length,
    w1: rows.filter(r => r.grp === 'w1').length,
    slip: rows.filter(r => r.late).length,
    miss: rows.filter(r => !r.iss && r.grp !== 'rest' && r.grp !== 'fa').length,
    rev: rows.filter(r => r.revChg).length,
    fa: rows.filter(r => r.grp === 'fa').length,
  }), [rows])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows.filter(r => {
      if (range === '14' && r.grp === 'rest') return false
      if (kind === 'hot' && r.grp !== 'hot') return false
      if (kind === 'miss' && r.iss) return false
      if (kind === 'rev' && !r.revChg) return false
      if (kind === 'late' && !r.late) return false
      if (!s) return true
      return [pnOf(r.items?.std_code), r.items?.name, r.po_number].some(v => String(v || '').toLowerCase().includes(s))
    })
  }, [rows, range, kind, q])

  const grouped = useMemo(() => {
    let no = 0
    return GROUPS.map(g => ({ ...g, label: ready ? g.label : g.label.replace(/^need (date )?/, ''), list: shown.filter(r => r.grp === g.key).map(r => ({ ...r, no: g.key === 'fa' ? '' : ++no })) })).filter(g => g.list.length)
  }, [shown, ready])

  function printSheet() {
    const groups = grouped.filter(g => g.key !== 'fa')
    if (!groups.length) { toastError('출력할 줄이 없습니다'); return }
    const t = today()
    const tr = (r) => `<tr><td class="c"><i class="ck"></i></td><td class="c">${r.no}</td><td>${r.iss ? md(String(r.iss.t).slice(0, 10)) || '출도' : '<b class="miss">미출도</b>'}</td>
<td class="mono b">${esc(pnOf(r.items?.std_code))}</td><td class="nm">${esc(r.items?.name || '')}</td><td class="c b">${esc(r.sRev)}${r.revChg ? ` <b class="k">재출도 ${esc(r.iRev)}→${esc(r.sRev)}</b>` : ''}</td><td class="r">${leftOf(r)}</td>
<td class="mono">${esc(r.po_number)} L${esc(N(r.order_line))}-${esc(N(r.del_line) || 1)}</td>
<td class="b">${md(r.base)}${r.d < 0 ? ` (${-r.d}일 지남)` : ''}${r.trend === 'up' ? ' ▲' : r.trend === 'down' ? ' ▼' : ''}</td>
<td>${ready ? md(r.prom) + (r.late ? ' <b>▶늦음</b>' : '') : ''}</td><td>${isHot(r) ? '<span class="hot">HOT</span>' : esc(r.plan_exc || '')}${r.material_issued ? ' 불출' : ''}</td></tr>`
    const body = groups.map(g => `<tr class="gh"><td colspan="11">${g.label} <span>${g.list.length}건</span></td></tr>${g.list.map(tr).join('')}`).join('')
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
<table><thead><tr><th>✔</th><th>순</th><th>출도</th><th>품번</th><th>품명</th><th>SRev</th><th class="r">수량</th><th>PO</th><th>${ready ? 'need date' : 'promise'}</th><th>${ready ? 'promise' : ''}</th><th>구분</th></tr></thead>
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
      ['Order Number', 'Order Line', 'Del Line', 'Item', 'Item Desc', 'SRev', 'Qty', 'Need Date', 'Promise Date', 'Days Late', 'Plan Exc', 'Drawing Issued', 'Reason'],
      ...list.map(r => [r.po_number, N(r.order_line), N(r.del_line), pnOf(r.items?.std_code), r.items?.name || '', r.sRev, leftOf(r), r.need, r.prom,
        dd(r.prom, r.need), r.plan_exc || '', r.iss ? 'Y' : 'N', '']),
    ])
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Delay Forecast')
    XLSX.writeFile(wb, `Harness_delay_forecast_${today()}.xlsx`)
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
          {chip(kind, 'all', setKind, '전체')}{chip(kind, 'hot', setKind, 'HOT만')}{chip(kind, 'miss', setKind, '미출도만')}{chip(kind, 'rev', setKind, 'REV 바뀜')}
          {ready && chip(kind, 'late', setKind, '▶늦음')}
        </div>
        <div className="flex-1" />
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
        <KpiCard tone="red" label={ready ? 'need 지남' : '납기 지남'} value={kpi.late} note={`FA(G 오더) ${kpi.fa}건 따로`} loading={isLoading} />
        <KpiCard tone="amber" label="7일 이내" value={kpi.w1} note="이번 주 끝내야 할 것" loading={isLoading} />
        <KpiCard tone="amber" label="▶늦음" value={ready ? kpi.slip : '—'} note={ready ? 'promise가 need보다 늦음 · Axcelis 공유' : 'need date 저장 후'} loading={isLoading}
          onClick={ready ? () => setKind(kind === 'late' ? 'all' : 'late') : undefined} on={kind === 'late'} />
        <KpiCard label="미출도" value={kpi.miss} note="14일 안쪽 중 도면 안 나감" loading={isLoading} onClick={() => setKind(kind === 'miss' ? 'all' : 'miss')} on={kind === 'miss'} />
        <KpiCard tone="red" label="REV 바뀜" value={kpi.rev} note="출도 뒤 SRev 변경 · 재출도" loading={isLoading} onClick={() => setKind(kind === 'rev' ? 'all' : 'rev')} on={kind === 'rev'} />
      </KpiRow>

      <div className="mt-3 bg-white border border-slate-200 rounded-xl overflow-auto">
        {error ? <p className="p-4 text-sm text-rose-600">불러오기 실패: {error.message}</p>
        : isLoading ? <table className="w-full"><tbody><SkeletonRows cols={9} rows={8} two={[2]} /></tbody></table>
        : !grouped.length ? <p className="p-6 text-center text-sm text-slate-400">조건에 맞는 하네스 줄이 없습니다</p>
        : (
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600 sticky top-0">
            <tr>
              <th className="px-2 py-2 text-center">순</th><th className="px-2 py-2 text-left">출도</th><th className="px-2 py-2 text-left">품번 · 품명</th>
              <th className="px-2 py-2 text-center">SRev</th><th className="px-2 py-2 text-right">수량</th><th className="px-2 py-2 text-left">PO</th>
              <th className="px-2 py-2 text-left">{ready ? 'need date' : 'promise (need 저장 전)'}</th>{ready && <th className="px-2 py-2 text-left">promise</th>}
              <th className="px-2 py-2 text-left">구분</th><th className="px-2 py-2 text-center">불출</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(g => {
              const fold = g.key === 'fa' && !faOpen
              return [
                <tr key={g.key} data-harn-group={g.key}>
                  <td colSpan={ready ? 10 : 9} className={`px-3 py-1.5 font-bold ${g.cls} ${g.key === 'fa' ? 'cursor-pointer' : ''}`} onClick={g.key === 'fa' ? () => setFaOpen(!faOpen) : undefined}>
                    {g.label} <span className="font-normal text-slate-400 ml-1">{g.list.length}건{g.key === 'fa' ? (faOpen ? ' ▾ 접기' : ' ▸ 펼치기') : ''}</span>
                  </td>
                </tr>,
                ...(fold ? [] : g.list.map(r => (
                  <tr key={r.id} data-harn-row className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-2 py-1.5 text-center text-slate-500">{r.no}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.iss ? <span className="text-slate-600" title="하네스 공정관리 출도 기록">{md(String(r.iss.t).slice(0, 10)) || '출도'}</span>
                      : <span className="px-1.5 py-0.5 rounded border border-dashed border-slate-400 text-slate-500 font-bold text-[10px]">미출도</span>}</td>
                    <td className="px-2 py-1.5"><div className="font-mono font-bold text-indigo-600">{pnOf(r.items?.std_code)}</div><div className="text-[11px] text-slate-400 truncate max-w-[280px]">{r.items?.name}</div></td>
                    <td className="px-2 py-1.5 text-center font-mono font-bold">{r.revChg
                      ? <span data-harn-rev className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 text-[11px]" title={`출도 때 REV ${r.iRev} → 지금 PO SRev ${r.sRev} · 작업 중지하고 재출도`}>⚠ {r.iRev}→{r.sRev} 재출도</span>
                      : (r.sRev || '—')}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{leftOf(r).toLocaleString('ko-KR')}</td>
                    <td className="px-2 py-1.5 font-mono whitespace-nowrap">{r.po_number} <span className="text-slate-400">L{N(r.order_line)}-{N(r.del_line) || 1}</span></td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <span className={r.d != null && r.d < 0 ? 'text-rose-600 font-bold' : 'text-slate-700'}>{md(r.base) || '—'}{r.d != null && r.d < 0 ? ` · ${-r.d}일 지남` : ''}</span>
                      {r.trend === 'up' && <span className="ml-1 text-rose-600 font-extrabold" title={`지난번 ${md(r.needPrev)} → 당겨짐`}>▲</span>}
                      {r.trend === 'down' && <span className="ml-1 text-sky-600 font-extrabold" title={`지난번 ${md(r.needPrev)} → 늦춰짐`}>▼</span>}
                    </td>
                    {ready && <td className={`px-2 py-1.5 whitespace-nowrap ${r.late ? 'text-amber-600 font-bold' : 'text-slate-600'}`}>{md(r.prom) || '—'}{r.late ? ' ▶늦음' : ''}</td>}
                    <td className="px-2 py-1.5">{r.plan_exc ? <PlanBadge plan={r.plan_exc} since={false} /> : ''}</td>
                    <td className="px-2 py-1.5 text-center">{r.material_issued ? <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold">불출</span> : <span className="text-slate-300">—</span>}</td>
                  </tr>
                ))),
              ]
            })}
          </tbody>
        </table>
        )}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">보기 전용 — 출도 · 불출은 「하네스 출도」에서 합니다. 출도일 · REV 는 하네스 공정관리 출도 기록을 읽습니다.</p>
    </div>
  )
}
