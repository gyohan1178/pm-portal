import PageHead from '../../components/PageHead'
import ItemLink from '../../components/ItemLink'
import { codeCandidates } from '../../lib/custPrefix'
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { must } from '../../lib/db'
import { missKey, clearMissing } from '../../lib/missingBulk'
import { moveRows, pickNew, undoMoves, sinceYesterday } from '../../lib/undoMove'
import { useUndo } from '../../components/UndoBar'
import { useCanEdit, useMe } from '../../hooks/useProfile'
import { useRemember } from '../../hooks/useRemember'
import { toastError, toastSuccess } from '../../lib/toast'
import { refreshProcurement } from '../../lib/refresh'
import { supabase } from '../../lib/supabase'
import { invIn } from '../../lib/sameItem'
import { fetchAll } from '../../lib/paginate'
import { ResizableTable } from '../../components/ResizableTable'
import { SkeletonRows } from '../../components/ux/Skeleton'

const MP_COLS = [
  { key:'sel',    label:'',          defaultWidth:34, style:{textAlign:'center'} },
  { key:'cs',     label:'고객사',    defaultWidth:62  },
  { key:'pn',     label:'상위품번 · 호기', defaultWidth:150 },
  { key:'due',    label:'납품요청일', defaultWidth:84 },
  { key:'part',   label:'결품 부품', defaultWidth:240 },
  { key:'need',   label:'필요',      defaultWidth:56, style:{textAlign:'right'} },
  { key:'stock',  label:'재고',      defaultWidth:56, style:{textAlign:'right'} },
  { key:'po',     label:'발주 (PO · 발주일 · 업체)', defaultWidth:230 },
  { key:'eta',    label:'입고예정',  defaultWidth:78 },
  { key:'verdict',label:'판정',      defaultWidth:150 },
]
// 판정 (v4.247.0) — 급한 순서
const VERDICT = {
  late:  { order: 0, label: '⚠ 생산 늦음', cls: 'bg-rose-50 text-rose-600' },
  nopo:  { order: 1, label: '발주 없음', cls: 'bg-rose-50 text-rose-600' },
  tbd:   { order: 2, label: '입고일 미정', cls: 'bg-amber-50 text-amber-700' },
  ok:    { order: 3, label: '일정 OK', cls: 'bg-emerald-50 text-emerald-700' },
  ready: { order: 4, label: '재불출 가능', cls: 'bg-green-100 text-green-700 border border-green-300' },
}
const CS_LABEL = { AX: 'AXCELIS', ED: 'Edwards', VM: 'VM', CSK: 'CSK' }
const DAY = 86400000
const today = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
const ymd = (d) => (d ? String(d).slice(0, 10) : null)
const md = (d) => (d ? `${String(d).slice(5, 7)}/${String(d).slice(8, 10)}` : '')
const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY)

// 미불출 모아보기 (2026-10-08)
//   · 전 고객사 (예전엔 AXCELIS 만) · 완료된 호기는 뺀다 · 1,000줄에서 잘리지 않게 끝까지 읽는다
//   · 미불출은 저장 모양이 세 가지다 — 출고 연동 {std_code,name,qty,item_id} · 호기 편집 {pn(AX- 없음),name,maker,qty}
//     · CSV {pn,expectedDate} → 품번을 하나로 맞추고, 재고는 품번으로 찾는다 (item_id 가 없는 줄도 재고가 보이게)
//   v4.57.0: 호기 편집으로 넣은 품번은 접두 없이 저장된다 → [고객사 접두+품번, 품번] 둘 다 찾아 있는 쪽으로 (예전엔 AX 만 접두를 붙여 Edwards · VM · CSK 재고가 0 으로 보였다)
const candsOf = (m, cs) => m.std_code ? [String(m.std_code).trim()] : codeCandidates(m.pn, cs)
async function fetchMissing() {
  const prod = await fetchAll(() => supabase.from('production')
    .select('id,pn,hogi,name,missing_parts,req_date,status,customer_code')
    .order('id'))
  const rows = []
  for (const p of (prod || [])) {
    if (p.status === '완료') continue
    const mp = Array.isArray(p.missing_parts) ? p.missing_parts : []
    for (const m of mp) {
      if (!m) continue
      rows.push({
        prodId: p.id, cs: p.customer_code || 'AX', pn: p.pn, hogi: p.hogi, prodName: p.name, reqDate: p.req_date,
        item_id: m.item_id || null, _cands: candsOf(m, p.customer_code), name: m.name || '', need: Number(m.qty) || 0, mKey: missKey(m),
        due: m.expectedDate || m.date || null,
      })
    }
  }
  // 재고 — item_id 가 없으면 품번으로 품목을 찾아 붙인다
  const codes = [...new Set(rows.filter(r => !r.item_id).flatMap(r => r._cands))]
  const idOf = {}
  for (let i = 0; i < codes.length; i += 300) {
    const { data, error } = await supabase.from('items').select('id,std_code,name').in('std_code', codes.slice(i, i + 300))
    if (error) throw error
    ;(data || []).forEach(x => { idOf[x.std_code] = x })
  }
  rows.forEach(r => {
    const hit = r._cands.find(c => idOf[c])
    r.std_code = hit || r._cands[0] || ''
    if (!r.item_id && hit) { r.item_id = idOf[hit].id; if (!r.name) r.name = idOf[hit].name }
    delete r._cands
  })
  const ids = [...new Set(rows.map(r => r.item_id).filter(Boolean))]
  const invMap = {}
  for (let i = 0; i < ids.length; i += 300) {
    const { data: inv, error } = await invIn('item_id,qty', ids.slice(i, i + 300))
    if (error) throw error
    ;(inv || []).forEach(x => { invMap[x.item_id] = (invMap[x.item_id] || 0) + (Number(x.qty) || 0) })
  }
  // 진행 중 구매 발주 (v4.247.0) — 발주일 · 입고예정 · 업체 · 잔량
  const pos = {}
  for (let i = 0; i < ids.length; i += 200) {
    const part = await fetchAll(() => supabase.from('purchase_orders')
      .select('id,po_number,item_id,order_date,promise_date,qty_ordered,qty_received,status,vendors(name)')
      .eq('order_type', 'purchase').not('status', 'in', '(완료,취소)').in('item_id', ids.slice(i, i + 200)).order('id'))
    for (const po of part) {
      const left = (Number(po.qty_ordered) || 0) - (Number(po.qty_received) || 0)
      if (left > 0) (pos[po.item_id] ||= []).push({ ...po, left })
    }
  }
  return allocate(rows.map(r => ({ ...r, stock: invMap[r.item_id] ?? 0 })), pos)
}

// 같은 부품을 여러 호기가 기다리면 재고 → 발주(입고예정 빠른 순) 를 납품요청일 빠른 호기부터 채운다
//   재고로 다 채우면 재불출 가능 · 발주로 채우면 그 발주의 입고예정과 납품요청일을 견줘 늦음/OK · 입고예정이 비면 미정 · 모자라면 발주 없음
export function allocate(rows, pos) {
  const t = today()
  const byItem = new Map()
  rows.forEach((r) => { const k = r.item_id || `?${r.std_code}`; if (!byItem.has(k)) byItem.set(k, []); byItem.get(k).push(r) })
  for (const [k, list] of byItem) {
    list.sort((a, b) => String(ymd(a.reqDate) || '9999').localeCompare(String(ymd(b.reqDate) || '9999')) || String(a.pn).localeCompare(String(b.pn)) || String(a.hogi).localeCompare(String(b.hogi), undefined, { numeric: true }))
    const supply = [{ kind: 'stock', left: Number(list[0].stock) || 0 }]
    ;(pos[k] || []).slice().sort((a, b) => String(a.promise_date || '9999').localeCompare(String(b.promise_date || '9999')) || String(a.order_date || '').localeCompare(String(b.order_date || '')))
      .forEach((po) => supply.push({ kind: 'po', po, left: po.left }))
    for (const r of list) {
      let need = Number(r.need) || 0
      const used = []
      for (const s of supply) {
        if (need <= 0) break
        if (s.left <= 0) continue
        const q = Math.min(s.left, need); s.left -= q; need -= q
        used.push({ ...s, q })
      }
      const poUsed = used.filter((u) => u.kind === 'po')
      r.poUsed = poUsed.map((u) => ({ ...u.po, q: u.q }))
      r.short = need
      const due = ymd(r.reqDate)
      if (need > 0) { r.verdict = 'nopo' }
      else if (!poUsed.length) { r.verdict = 'ready' }
      else if (poUsed.some((u) => !u.po.promise_date)) {
        r.verdict = 'tbd'
        const od = poUsed.map((u) => ymd(u.po.order_date)).filter(Boolean).sort()[0]
        r.waitDays = od ? days(t, od) : null
      } else {
        r.eta = poUsed.map((u) => ymd(u.po.promise_date)).sort().at(-1)
        r.gap = due ? days(due, r.eta) : null
        r.verdict = r.gap != null && r.gap < 0 ? 'late' : 'ok'
      }
      r.ready = r.verdict === 'ready'
    }
  }
  return rows
}

// 재불출 (v4.241.0) — 입고돼 재고가 있는 결품을 체크해 바로 출고(재고 차감) + 그 호기 미불출에서 지운다
//   호기마다 한 번씩 출고 (고객사 · 프로젝트를 그 호기 상위품번으로 남겨 출고 현황에서 추적) · 재고가 모자라면 그 호기는 안 뺀다
async function reissue(picked, by) {
  const { data: custs } = await supabase.from('customers').select('id,code')
  const custOf = (cs) => (custs || []).find((c) => String(c.code || '').toLowerCase() === String(cs || '').toLowerCase())?.id || null
  const byHogi = new Map()
  picked.forEach((r) => { const g = byHogi.get(r.prodId) || []; g.push(r); byHogi.set(r.prodId, g) })
  const itemIds = [...new Set(picked.map((r) => r.item_id))]
  const before = await moveRows({ type: '출고', itemIds, since: sinceYesterday() }).catch(() => null)
  const prodBefore = [], done = [], fail = []
  for (const [prodId, list] of byHogi) {
    const r0 = list[0]
    const custId = custOf(r0.cs)
    const pcs = codeCandidates(r0.pn, r0.cs)
    let projId = null
    if (custId && pcs.length) { const { data } = await supabase.from('projects').select('id,code').eq('customer_id', custId).in('code', pcs).limit(1); projId = data?.[0]?.id || null }
    const qty = {}
    list.forEach((r) => { qty[r.item_id] = (qty[r.item_id] || 0) + r.need })
    const lines = Object.entries(qty).map(([item_id, q]) => ({ item_id, name: list.find((r) => r.item_id === item_id)?.name || '', qty: q }))
    let { data: res, error } = await supabase.rpc('pm_process_outbound', { p_lines: lines, p_po_id: null, p_note: `결품 재불출 ${r0.pn} ${r0.hogi}`, p_mode: 'strict', p_customer_id: custId, p_project_id: projId })
    if (error && error.code === 'PGRST202') ({ data: res, error } = await supabase.rpc('pm_process_outbound', { p_lines: lines, p_po_id: null, p_note: `결품 재불출 ${r0.pn} ${r0.hogi}`, p_mode: 'strict' }))
    if (error) throw error
    if (res?.aborted) { fail.push(`${r0.pn} ${r0.hogi}: ${(res.warnings || []).join(', ')}`); continue }
    // 미불출에서 지운다 — 다시 읽어 합친다 (그 사이 다른 데서 바뀐 것 보존)
    const cur = must(await supabase.from('production').select('id,missing_parts,changes').eq('id', prodId).maybeSingle(), '호기 읽기')
    if (cur) {
      prodBefore.push(JSON.parse(JSON.stringify({ id: cur.id, missing_parts: cur.missing_parts ?? [], changes: cur.changes ?? [] })))
      const keys = list.map((r) => r.mKey)
      const { next, removed } = clearMissing(cur.missing_parts, keys)
      const now = new Date().toISOString()
      const changes = [...(Array.isArray(cur.changes) ? cur.changes : []), { type: '미불출해제', msg: `결품 재불출 ${removed}품목 — ` + list.map((r) => `${r.std_code}×${r.need}`).join(', '), at: now, by: by || null }]
      must(await supabase.from('production').update({ missing_parts: next, changes, updated_at: now }).eq('id', prodId), '호기 미불출 저장')
    }
    done.push(`${r0.pn} ${r0.hogi}`)
  }
  let moveIds = []
  if (before) { try { moveIds = pickNew(before, await moveRows({ type: '출고', itemIds, since: sinceYesterday() }), picked.map((r) => ({ item_id: r.item_id, qty: r.need }))) } catch { moveIds = [] } }
  return { done, fail, moveIds, prodBefore }
}

export default function MissingParts() {
  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ['missingParts'], queryFn: fetchMissing })
  const qc = useQueryClient()
  const canEdit = useCanEdit()
  const me = useMe()
  const { remember, bar: undoBar } = useUndo()
  const [sel, setSel] = useState(new Set())
  const [cs, setCs] = useRemember('missing.cs', 'all')
  const [vf, setVf] = useState('all')
  const [q, setQ] = useState('')
  const rid = (r) => `${r.prodId}|${r.mKey}`
  const pickable = (r) => r.ready && r.item_id
  const reMut = useMutation({
    mutationFn: () => reissue(rows.filter((r) => sel.has(rid(r)) && pickable(r)), me?.name),
    onSuccess: (x) => {
      if (x.done.length) toastSuccess(`재불출 — ${x.done.length}대 출고 · 미불출 지움`)
      if (x.fail.length) toastError('재고 부족으로 안 뺀 호기 — ' + x.fail.join(' / '))
      if (x.moveIds.length || x.prodBefore.length) remember(`결품 재불출 ${x.done.length}대`, async () => {
        const u = x.moveIds.length ? await undoMoves(x.moveIds) : { cnt: 0 }
        for (const b of x.prodBefore) must(await supabase.from('production').update({ missing_parts: b.missing_parts, changes: b.changes, updated_at: new Date().toISOString() }).eq('id', b.id), '호기 되돌리기')
        return `출고 ${u.cnt}줄 · 호기 ${x.prodBefore.length}대 미불출을 되돌렸습니다`
      }, { note: '방금 재불출한 출고 줄을 지우고(재고 복구) 호기 미불출을 되돌립니다', after: () => { refreshProcurement(qc); qc.invalidateQueries({ queryKey: ['missingParts'] }); qc.invalidateQueries({ queryKey: ['production'] }) } })
      setSel(new Set())
      refreshProcurement(qc)
      qc.invalidateQueries({ queryKey: ['missingParts'] }); qc.invalidateQueries({ queryKey: ['production'] }); qc.invalidateQueries({ queryKey: ['outboundHistory'], exact: false })
    },
    onError: (e) => toastError('재불출 오류: ' + e.message),
  })
  const selCnt = rows.filter((r) => sel.has(rid(r)) && pickable(r)).length

  const csList = useMemo(() => {
    const c = {}; rows.forEach((r) => { c[r.cs] = (c[r.cs] || 0) + 1 })
    return Object.entries(c).sort((a, b) => b[1] - a[1])
  }, [rows])
  const inCs = useMemo(() => rows.filter((r) => cs === 'all' || r.cs === cs), [rows, cs])
  const cnt = useMemo(() => { const c = {}; inCs.forEach((r) => { c[r.verdict] = (c[r.verdict] || 0) + 1 }); return c }, [inCs])
  const sorted = useMemo(() => {
    const s = q.trim().toLowerCase()
    return inCs.filter((r) => (vf === 'all' || r.verdict === vf) && (!s || [r.pn, r.hogi, r.std_code, r.name, ...(r.poUsed || []).flatMap((p) => [p.po_number, p.vendors?.name])].some((v) => String(v || '').toLowerCase().includes(s))))
      .sort((a, b) => (VERDICT[a.verdict]?.order ?? 9) - (VERDICT[b.verdict]?.order ?? 9) || String(ymd(a.reqDate) || '9999').localeCompare(String(ymd(b.reqDate) || '9999')) || String(a.pn).localeCompare(String(b.pn)))
  }, [inCs, vf, q])
  const readyCnt = inCs.filter(r => r.ready).length
  const hogiCnt = new Set(inCs.map(r => r.prodId)).size

  async function exportXlsx() {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.aoa_to_sheet([
      ['판정', '고객사', '상위품번', '호기', '납품요청일', '결품 부품', '품명', '필요', '재고', '발주번호', '발주일', '업체', '입고예정', '늦음/여유(일)'],
      ...sorted.map((r) => { const p = r.poUsed?.[0]; return [VERDICT[r.verdict]?.label.replace('⚠ ', '') || '', CS_LABEL[r.cs] || r.cs, r.pn, r.hogi, ymd(r.reqDate) || '', r.std_code, r.name, r.need, r.stock,
        (r.poUsed || []).map((x) => x.po_number).join(', '), p ? ymd(p.order_date) || '' : '', p?.vendors?.name || '', r.eta || (r.verdict === 'tbd' ? '미정' : ''), r.gap ?? ''] }),
    ])
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '결품 현황')
    XLSX.writeFile(wb, `결품현황_${cs === 'all' ? '전체' : (CS_LABEL[cs] || cs)}_${today()}.xlsx`)
  }

  const kpi = (key, label, note, tone) => (
    <button key={key} data-mp-kpi={key} onClick={() => setVf(vf === key ? 'all' : key)}
      className={`flex-1 min-w-[140px] text-left rounded-xl border px-3.5 py-2.5 ${tone} ${vf === key ? 'ring-2 ring-indigo-400' : ''}`}>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="text-2xl font-extrabold">{(cnt[key] || 0).toLocaleString('ko-KR')}</div>
      <div className="text-[11px] text-slate-400">{note}</div>
    </button>
  )

  return (
    <div className="p-4 w-full space-y-3">
      <PageHead crumb="구매" title="결품 현황"
        desc="불출 못 한 부품 — 발주가 언제 나갔고 언제 들어오는지, 호기 납품요청일에 늦는 건 무엇인지 봅니다. 같은 부품을 여러 호기가 기다리면 재고 · 발주를 납품요청일 빠른 호기부터 채워 판정합니다. 「재불출 가능」 줄을 체크해 「📤 재불출」하면 재고에서 빼고 그 호기 미불출을 지웁니다" />

      <div className="flex gap-1 flex-wrap" data-mp-cs>
        {[['all', rows.length], ...csList].map(([c, n]) => (
          <button key={c} onClick={() => { setCs(c); setSel(new Set()) }}
            className={`px-3 py-1.5 text-xs font-bold rounded-full border ${cs === c ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            {c === 'all' ? '전체' : (CS_LABEL[c] || c)} <span className="opacity-60 font-semibold">{n}</span></button>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="flex-1 min-w-[140px] rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
          <div className="text-xs font-semibold text-slate-500">결품</div>
          <div className="text-2xl font-extrabold">{inCs.length.toLocaleString('ko-KR')}</div>
          <div className="text-[11px] text-slate-400">호기 {hogiCnt}대</div>
        </div>
        {kpi('late', '⚠ 생산 늦음', '입고예정이 납품요청일보다 늦음', 'bg-rose-50 border-rose-200 text-rose-600')}
        {kpi('nopo', '발주 없음', '재고도 발주도 모자람 → 발주 필요', 'bg-rose-50 border-rose-200 text-rose-600')}
        {kpi('tbd', '입고일 미정', '발주는 나갔는데 입고예정일 없음', 'bg-amber-50 border-amber-200 text-amber-600')}
        {kpi('ok', '일정 OK', '납품요청일 전에 들어옴', 'bg-white border-slate-200 text-emerald-600')}
        {kpi('ready', '재불출 가능', '재고 있음 · 바로 불출', 'bg-emerald-50 border-emerald-200 text-emerald-600')}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="상위품번 · 호기 · 부품 · PO · 업체 검색"
          className="w-full sm:w-72 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        {vf !== 'all' && <button onClick={() => setVf('all')} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700">{VERDICT[vf]?.label} 만 보는 중 ✕</button>}
        <span className="ml-auto flex items-center gap-2">
          <button data-mp-xlsx onClick={exportXlsx} disabled={!sorted.length} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40">📥 엑셀</button>
          {canEdit && readyCnt > 0 && <>
            <button data-mp-allready onClick={() => setSel(new Set(inCs.filter(pickable).map(rid)))} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">재불출 가능 전체 체크</button>
            <button data-mp-reissue onClick={() => reMut.mutate()} disabled={!selCnt || reMut.isPending}
              title="체크한 줄을 재고에서 출고하고 그 호기 미불출에서 지웁니다 (호기마다 한 번씩 · 출고 현황에 「결품 재불출」로 남음)"
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40">{reMut.isPending ? '처리 중…' : `📤 재불출${selCnt ? ` ${selCnt}줄` : ''}`}</button>
          </>}
        </span>
      </div>
      {undoBar}

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">불러오지 못했습니다 — {error.message}</p>}
      {isLoading ? (
        <ResizableTable cols={MP_COLS} storageKey="missing_cols3" fill fillMin={360}>
          {() => <tbody data-mp-loading><SkeletonRows cols={MP_COLS.length} rows={8} two={[4, 7]} /></tbody>}
        </ResizableTable>
      ) : sorted.length === 0 ? (
        <div className="border border-slate-200 rounded-xl"><p className="px-3 py-8 text-center text-sm text-slate-400">{rows.length ? '조건에 맞는 결품이 없습니다' : '결품이 없습니다 👍'}</p></div>
      ) : (
        <ResizableTable cols={MP_COLS} storageKey="missing_cols3" fill fillMin={360}>
          {() => (
            <tbody>
              {sorted.map((r) => {
                const v = VERDICT[r.verdict] || {}
                const p = r.poUsed?.[0]
                return (
                <tr key={rid(r)} data-mp-row={r.verdict} className={`border-t border-slate-100 ${r.verdict === 'late' || r.verdict === 'nopo' ? 'bg-rose-50/30' : r.ready ? 'bg-emerald-50/40' : ''}`}>
                  <td className="px-2 py-2 text-center">{canEdit && pickable(r) && <input type="checkbox" data-mp-sel checked={sel.has(rid(r))} onChange={() => setSel((v) => { const n = new Set(v); n.has(rid(r)) ? n.delete(rid(r)) : n.add(rid(r)); return n })} />}</td>
                  <td className="px-3 py-2 text-[11px] font-bold text-slate-500 overflow-hidden truncate">{CS_LABEL[r.cs] || r.cs}</td>
                  <td className="px-3 py-2 overflow-hidden truncate"><span className="font-mono text-slate-500">{r.pn}</span> <b className="font-mono text-indigo-600">{r.hogi}</b></td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">{ymd(r.reqDate) ? md(r.reqDate) : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2 overflow-hidden truncate" title={r.name}><ItemLink code={r.std_code} className="font-mono font-semibold text-slate-700" /> <span className="text-slate-500">{r.name}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.need}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.stock <= 0 ? 'text-red-500' : 'text-slate-600'}`}>{r.stock}</td>
                  <td className="px-3 py-2 overflow-hidden" data-mp-po>{p ? (
                    <div className="truncate" title={(r.poUsed || []).map((x) => `${x.po_number} · 발주 ${ymd(x.order_date) || '-'} · ${x.vendors?.name || ''} · 이 호기 몫 ${x.q} / 잔량 ${x.left}`).join('\n')}>
                      <span className="font-mono text-slate-700">{p.po_number}</span>{r.poUsed.length > 1 && <span className="text-slate-400"> 외 {r.poUsed.length - 1}</span>}
                      <div className="text-[11px] text-slate-400 truncate">{md(p.order_date) || '발주일 —'} · {p.vendors?.name || '업체 —'} · 잔량 {p.left}</div>
                    </div>) : <span className="text-slate-300">{r.verdict === 'nopo' ? `— 부족 ${r.short}` : '—'}</span>}</td>
                  <td className={`px-3 py-2 tabular-nums ${r.verdict === 'late' ? 'text-rose-600 font-bold' : 'text-slate-600'}`}>{r.eta ? md(r.eta) : r.verdict === 'tbd' ? <span className="text-amber-600">미정</span> : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${v.cls || ''}`}>
                    {v.label}{r.verdict === 'late' ? ` +${-r.gap}일` : r.verdict === 'ok' && r.gap != null ? ` · ${r.gap}일 여유` : r.verdict === 'tbd' && r.waitDays != null ? ` · ${r.waitDays}일째` : ''}</span></td>
                </tr>
              )})}
            </tbody>
          )}
        </ResizableTable>
      )}
    </div>
  )
}
