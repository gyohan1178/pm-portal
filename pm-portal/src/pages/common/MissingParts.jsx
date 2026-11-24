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
import { toastError, toastSuccess } from '../../lib/toast'
import { refreshProcurement } from '../../lib/refresh'
import { supabase } from '../../lib/supabase'
import { invIn } from '../../lib/sameItem'
import { fetchAll } from '../../lib/paginate'
import { ResizableTable } from '../../components/ResizableTable'
import { SkeletonRows } from '../../components/ux/Skeleton'

const MP_COLS = [
  { key:'sel',    label:'',          defaultWidth:34, style:{textAlign:'center'} },
  { key:'cs',     label:'고객사',    defaultWidth:70  },
  { key:'pn',     label:'품번',      defaultWidth:120 },
  { key:'hogi',   label:'호기',      defaultWidth:70  },
  { key:'part',   label:'결품 품목', defaultWidth:220 },
  { key:'need',   label:'필요',      defaultWidth:70, style:{textAlign:'right'} },
  { key:'stock',  label:'재고',      defaultWidth:70, style:{textAlign:'right'} },
  { key:'status', label:'상태',      defaultWidth:100 },
]

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
  return rows.map(r => {
    const stock = invMap[r.item_id] ?? 0
    return { ...r, stock, ready: stock >= r.need && r.need > 0 }
  })
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

  const sorted = useMemo(() =>
    [...rows].sort((a, b) => (b.ready - a.ready) || String(a.pn).localeCompare(String(b.pn))), [rows])
  const readyCnt = rows.filter(r => r.ready).length
  const hogiCnt = new Set(rows.map(r => r.prodId)).size

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <PageHead crumb="구매" title="결품 현황"
        desc="불출 못 한 부품 모아보기 (전 고객사 · 완료 호기 제외) · 입고돼 「재불출 가능」인 줄을 체크해 「📤 재불출」하면 재고에서 빼고 그 호기 미불출을 지웁니다" />

      <div className="flex gap-2 flex-wrap">
        <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-50 text-red-600">결품 {rows.length}건</span>
        <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-500">호기 {hogiCnt}대</span>
        <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700">입고됨 · 재불출 가능 {readyCnt}건</span>
        {canEdit && readyCnt > 0 && (
          <span className="ml-auto flex items-center gap-2">
            <button data-mp-allready onClick={() => setSel(new Set(rows.filter(pickable).map(rid)))} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">재불출 가능 전체 체크</button>
            <button data-mp-reissue onClick={() => reMut.mutate()} disabled={!selCnt || reMut.isPending}
              title="체크한 줄을 재고에서 출고하고 그 호기 미불출에서 지웁니다 (호기마다 한 번씩 · 출고 현황에 「결품 재불출」로 남음)"
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40">{reMut.isPending ? '처리 중…' : `📤 재불출${selCnt ? ` ${selCnt}줄` : ''}`}</button>
          </span>
        )}
      </div>
      {undoBar}

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">불러오지 못했습니다 — {error.message}</p>}
      {isLoading ? (
        <ResizableTable cols={MP_COLS} storageKey="missing_cols2" fill fillMin={360}>
          {() => <tbody data-mp-loading><SkeletonRows cols={MP_COLS.length} rows={8} two={[3]} /></tbody>}
        </ResizableTable>
      ) : rows.length === 0 ? (
        <div className="border border-slate-200 rounded-xl"><p className="px-3 py-8 text-center text-sm text-slate-400">결품이 없습니다 👍</p></div>
      ) : (
        <ResizableTable cols={MP_COLS} storageKey="missing_cols2" fill fillMin={360}>
          {() => (
            <tbody>
              {sorted.map((r, i) => (
                <tr key={i} className={`border-t border-slate-100 ${r.ready ? 'bg-emerald-50/40' : ''}`}>
                  <td className="px-2 py-2 text-center">{canEdit && pickable(r) && <input type="checkbox" data-mp-sel checked={sel.has(rid(r))} onChange={() => setSel((v) => { const n = new Set(v); n.has(rid(r)) ? n.delete(rid(r)) : n.add(rid(r)); return n })} />}</td>
                  <td className="px-3 py-2 text-[11px] font-bold text-slate-500 overflow-hidden truncate">{r.cs}</td>
                  <td className="px-3 py-2 font-mono text-slate-500 overflow-hidden truncate">{r.pn}</td>
                  <td className="px-3 py-2 font-mono font-bold text-indigo-600 overflow-hidden truncate">{r.hogi}</td>
                  <td className="px-3 py-2 overflow-hidden truncate"><ItemLink code={r.std_code} className="font-mono font-semibold text-slate-700" /> <span className="text-slate-500">{r.name}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.need}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.stock <= 0 ? 'text-red-500' : 'text-slate-600'}`}>{r.stock}</td>
                  <td className="px-3 py-2">
                    {r.ready
                      ? <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700">재불출 가능</span>
                      : <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700">입고 대기</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </ResizableTable>
      )}
    </div>
  )
}
