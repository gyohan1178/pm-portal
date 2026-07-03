import { useState, useMemo } from 'react'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

const today = () => new Date().toISOString().split('T')[0]

async function fetchAx() {
  const { data } = await supabase.from('customers').select('id').eq('code', 'ax').single()
  return data?.id
}
async function fetchCart(csId) {
  if (!csId) return []
  const { data } = await supabase.from('pm_picking').select('*').eq('customer_id', csId).order('created_at')
  return data || []
}
async function fetchHogis() {
  const { data } = await supabase.from('production')
    .select('id,pn,hogi,name,status,req_date,po_id,missing_parts,parts_done')
    .eq('customer_code', 'AX').neq('status', '완료').order('pn')
  return (data || []).filter(h => !h.parts_done)
}
// 호기 어셈블리 BOM 전개 (부분불출이면 결품만)
async function explodeHogi(h) {
  const { data: proj } = await supabase.from('projects').select('id').eq('code', 'AX-' + h.pn).maybeSingle()
  if (!proj) return { rows: [], err: `어셈블리(AX-${h.pn})를 BOM에서 못 찾음` }
  const { data: bom } = await supabase.from('bom')
    .select('qty_per_unit,item_id, items!bom_item_id_fkey(id,std_code,name,unit)')
    .eq('project_id', proj.id)
  let rows = (bom || []).filter(b => b.item_id).map(b => ({
    item_id: b.item_id, std_code: b.items?.std_code, name: b.items?.name,
    unit: b.items?.unit, qty: Number(b.qty_per_unit) || 0,
  }))
  const mp = Array.isArray(h.missing_parts) ? h.missing_parts : []
  if (mp.length) {
    const keys = new Set(mp.map(m => m.std_code || m.item_id))
    rows = rows.filter(r => keys.has(r.std_code) || keys.has(r.item_id))
  }
  return { rows, err: null }
}

export default function Issue() {
  const qc = useQueryClient()
  const [hogiSel, setHogiSel] = useState('')
  const [itemSearch, setItemSearch] = useState('')
  const [itemHits, setItemHits] = useState([])
  const [msg, setMsg] = useState('')
  const [cartView, setCartView] = useState('hogi') // hogi=호기별 | item=품목합계

  const { data: csId } = useQuery({ queryKey: ['axId'], queryFn: fetchAx })
  const { data: cart = [] } = useQuery({ queryKey: ['picking', csId], queryFn: () => fetchCart(csId), enabled: !!csId })
  const { data: hogis = [] } = useQuery({ queryKey: ['pickHogis'], queryFn: fetchHogis, enabled: !!csId })

  const addMut = useMutation({
    mutationFn: async (rows) => {
      const payload = rows.map(r => ({ ...r, customer_id: csId }))
      const { error } = await supabase.from('pm_picking').insert(payload); if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries(['picking', csId]),
    onError: e => toastError('담기 오류: ' + e.message),
  })
  const updMut = useMutation({
    mutationFn: async ({ id, patch }) => { const { error } = await supabase.from('pm_picking').update(patch).eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries(['picking', csId]),
  })
  const delMut = useMutation({
    mutationFn: async (id) => { const { error } = await supabase.from('pm_picking').delete().eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries(['picking', csId]),
  })
  const clearMut = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('pm_picking').delete().eq('customer_id', csId); if (error) throw error },
    onSuccess: () => { qc.invalidateQueries(['picking', csId]) },
    onError: e => toastError('초기화 오류: ' + e.message),
  })

  // 호기 담기
  async function addHogi() {
    const h = hogis.find(x => x.id === hogiSel); if (!h) return
    const { rows, err } = await explodeHogi(h)
    if (err) { toastError(err); return }
    if (!rows.length) { toastError('전개된 부품이 없습니다 (이미 결품 0)'); return }
    addMut.mutate(rows.map(r => ({
      item_id: r.item_id, std_code: r.std_code, name: r.name, unit: r.unit, qty: r.qty, issue_qty: r.qty,
      source: 'hogi', production_id: h.id, hogi: h.hogi, pn: h.pn, po_id: h.po_id || null, issued: true,
    })))
    setHogiSel('')
  }
  // 직접 품목 검색 (16* 등)
  async function searchItem(v) {
    setItemSearch(v)
    if (v.trim().length < 2) { setItemHits([]); return }
    const { data } = await supabase.from('items')
      .select('id,std_code,name,unit')
      .or(`std_code.ilike.%${v}%,name.ilike.%${v}%`).limit(8)
    setItemHits(data || [])
  }
  function addDirect(it) {
    addMut.mutate([{ item_id: it.id, std_code: it.std_code, name: it.name, unit: it.unit, qty: 1, issue_qty: 1, source: 'direct', issued: true }])
    setItemSearch(''); setItemHits([])
  }

  // 일괄 출고 처리
  // ④ 결품 자동 연동 — 출고 성공 후 생산관리 missing_parts 동기화
  //    결품 발생 → 해당 호기에 자동 기록 / 결품이던 품목이 전량 불출되면 → 자동 해제
  async function syncMissingToProduction(snapshot) {
    const byBox = {}
    snapshot.filter(l => l.source === 'hogi' && l.pn && l.hogi).forEach(l => {
      const k = `${l.pn}|${l.hogi}`
      byBox[k] ??= { pn: l.pn, hogi: l.hogi, shorts: [], cleared: [] }
      const sq = Math.max(0, (Number(l.qty) || 0) - (Number(l.issue_qty ?? l.qty) || 0))
      if (sq > 0) byBox[k].shorts.push({ std_code: l.std_code, name: l.name, qty: sq })
      else if ((Number(l.issue_qty ?? l.qty) || 0) > 0) byBox[k].cleared.push(l.std_code)
    })
    const boxes = Object.values(byBox)
    if (!boxes.length) return
    for (const b of boxes) {
      try {
        const { data: prod } = await supabase.from('production')
          .select('id,missing_parts').eq('pn', b.pn).eq('hogi', b.hogi).neq('status', '완료').limit(1)
        const box = prod?.[0]; if (!box) continue
        let mp = Array.isArray(box.missing_parts) ? [...box.missing_parts] : []
        // 전량 불출된 품목은 결품에서 해제
        mp = mp.filter(m => !b.cleared.includes(m.std_code))
        // 이번 결품은 갱신/추가
        b.shorts.forEach(sh => {
          const i = mp.findIndex(m => m.std_code === sh.std_code)
          if (i >= 0) mp[i] = { ...mp[i], ...sh }; else mp.push(sh)
        })
        await supabase.from('production').update({ missing_parts: mp, updated_at: new Date().toISOString() }).eq('id', box.id)
      } catch (e) { console.warn('결품 연동 실패', b.pn, b.hogi, e) }
    }
  }

  const processMut = useMutation({
    mutationFn: async () => {
      if (!cart.length) return []
      const snapshot = cart.map(l => ({ ...l })) // 처리 후 비워지므로 스냅샷
      // 출고 처리 전체를 Postgres 함수에서 트랜잭션으로 — 전부 성공 아니면 전부 취소(부분 실패 없음)
      const { data, error } = await supabase.rpc('pm_process_issue', { p_customer_id: csId })
      if (error) throw error
      await syncMissingToProduction(snapshot) // 결품 ↔ 생산관리 동기화 (실패해도 출고는 유지)
      return (data && data.warnings) || []
    },
    onSuccess: (warnings) => {
      qc.invalidateQueries(['picking', csId]); qc.invalidateQueries(['pickHogis'])
      qc.invalidateQueries(['inventory']); qc.invalidateQueries(['shortage']); qc.invalidateQueries(['cpo'])
      qc.invalidateQueries(['production']); qc.invalidateQueries(['prodBoard'])
      setMsg(warnings.length ? `출고 완료 (재고부족 경고 ${warnings.length}건):\n` + warnings.join('\n') : '출고 처리 완료')
    },
    onError: e => toastError('출고 오류: ' + e.message),
  })

  const shortQ = (c) => Math.max(0, (Number(c.qty) || 0) - (Number(c.issue_qty ?? c.qty) || 0))
  // 제조사·제조사품번 메타 (장바구니 품목들)
  const metaIds = [...new Set(cart.map(c => c.item_id).filter(Boolean))]
  const { data: itemMeta = {} } = useQuery({
    queryKey: ['issueItemMeta', metaIds.join(',')],
    enabled: metaIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('items')
        .select('id,manufacturer,manufacturer_code').in('id', metaIds)
      return Object.fromEntries((data || []).map(i => [i.id, i]))
    },
  })

  // 품목별 합계 (여러 호기 합산)
  const itemAgg = useMemo(() => {
    const g = {}
    cart.forEach(ln => {
      const k = ln.std_code || ln.item_id
      g[k] ??= { std_code: ln.std_code, name: ln.name, item_id: ln.item_id, qty: 0, issue: 0, short: 0, srcs: new Set() }
      g[k].qty += Number(ln.qty) || 0
      g[k].issue += Number(ln.issue_qty ?? ln.qty) || 0
      g[k].short += shortQ(ln)
      g[k].srcs.add(ln.source === 'hogi' ? `${ln.pn} ${ln.hogi}` : '직접')
    })
    return Object.values(g).sort((a, b) => String(a.std_code).localeCompare(String(b.std_code)))
  }, [cart])

  const issuedCnt = cart.filter(c => (Number(c.issue_qty ?? c.qty) || 0) > 0).length
  const shortCnt = cart.filter(c => shortQ(c) > 0).length

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <h1 className="text-lg font-bold text-slate-800">📤 출고 작업 <span className="text-xs font-normal text-slate-400">· 장바구니에 담아 한 번에 출고</span></h1>

      {/* 담기 영역 */}
      <div className="grid md:grid-cols-2 gap-3">
        <div className="border border-slate-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-bold text-slate-600">① 생산 호기 (BOM 전개)</p>
          <div className="flex gap-2">
            <select value={hogiSel} onChange={e => setHogiSel(e.target.value)} className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-lg">
              <option value="">호기 선택 (불출 미완료만)</option>
              {hogis.map(h => <option key={h.id} value={h.id}>{h.pn} {h.hogi} · {h.name?.slice(0, 20)} {Array.isArray(h.missing_parts) && h.missing_parts.length ? `(결품 ${h.missing_parts.length})` : ''}</option>)}
            </select>
            <button onClick={addHogi} disabled={!hogiSel} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white disabled:opacity-40">담기</button>
          </div>
          <p className="text-[11px] text-slate-400">결품 있는 호기는 못 챙긴 부품만 전개됩니다</p>
        </div>

        <div className="border border-slate-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-bold text-slate-600">② 직접 품목 (16* 등)</p>
          <input value={itemSearch} onChange={e => searchItem(e.target.value)} placeholder="기준코드·품명 검색" className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg" />
          {itemHits.length > 0 && (
            <div className="border border-slate-100 rounded-lg divide-y max-h-40 overflow-auto">
              {itemHits.map(it => (
                <button key={it.id} onClick={() => addDirect(it)} className="w-full text-left px-2 py-1.5 text-xs hover:bg-indigo-50">
                  <span className="font-mono font-semibold text-indigo-600">{it.std_code}</span> <span className="text-slate-500">{it.name}</span>
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-400">고객사 PO에서 체크 → 담기로도 들어옵니다</p>
        </div>
      </div>

      {/* 장바구니 */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-3 py-2 bg-slate-50 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-600">장바구니 {cart.length}건 · 불출 {issuedCnt} / 결품 {shortCnt}</span>
          <div className="flex gap-0.5 p-0.5 bg-slate-200/60 rounded-lg">
            <button onClick={() => setCartView('hogi')} className={`px-2 py-0.5 text-[11px] font-semibold rounded-md ${cartView==='hogi'?'bg-white text-slate-800 shadow-sm':'text-slate-500'}`}>호기별</button>
            <button onClick={() => setCartView('item')} className={`px-2 py-0.5 text-[11px] font-semibold rounded-md ${cartView==='item'?'bg-white text-slate-800 shadow-sm':'text-slate-500'}`}>품목합계</button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { if (cart.length && window.confirm(`장바구니 ${cart.length}건을 전부 비울까요?\n(출고 처리는 안 되고 목록만 초기화)`)) clearMut.mutate() }}
              disabled={!cart.length || clearMut.isPending} className="px-3 py-1 text-xs font-semibold rounded border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-40">🗑 초기화</button>
            <button onClick={() => window.print()} disabled={!cart.length} className="px-3 py-1 text-xs font-semibold rounded border border-slate-200 text-slate-500 disabled:opacity-40">🖨 출력</button>
            <button onClick={() => { if (cart.length && window.confirm(`불출분 출고처리 / 결품 ${shortCnt}건 기록. 진행할까요?`)) processMut.mutate() }}
              disabled={!cart.length || processMut.isPending} className="px-3 py-1 text-xs font-bold rounded bg-teal-600 text-white disabled:opacity-40">
              ✅ 출고 처리
            </button>
          </div>
        </div>
        {cart.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-slate-400">담긴 품목이 없습니다</p>
        ) : cartView === 'item' ? (
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-50 text-slate-400">
              <th className="px-2 py-1.5 text-left">기준코드</th><th className="px-2 py-1.5 text-left">품명</th>
              <th className="px-2 py-1.5 text-left">제조사</th><th className="px-2 py-1.5 text-left">제조사품번</th>
              <th className="px-2 py-1.5 text-left">호기</th>
              <th className="px-2 py-1.5 text-right">총소요</th><th className="px-2 py-1.5 text-right">총불출</th><th className="px-2 py-1.5 text-right">총결품</th>
            </tr></thead>
            <tbody>
              {itemAgg.map(a => (
                <tr key={a.std_code} className={`border-t border-slate-100 ${a.short > 0 ? 'bg-red-50/40' : ''}`}>
                  <td className="px-2 py-1.5 font-mono font-semibold text-indigo-600">{a.std_code}</td>
                  <td className="px-2 py-1.5 text-slate-600 max-w-[170px] truncate">{a.name}</td>
                  <td className="px-2 py-1.5 text-slate-500 max-w-[90px] truncate">{itemMeta[a.item_id]?.manufacturer || '—'}</td>
                  <td className="px-2 py-1.5 font-mono text-violet-600 max-w-[120px] truncate">{itemMeta[a.item_id]?.manufacturer_code || '—'}</td>
                  <td className="px-2 py-1.5 text-slate-400 max-w-[130px] truncate" title={[...a.srcs].join(', ')}>{[...a.srcs].join(', ')}</td>
                  <td className="px-2 py-1.5 text-right font-bold text-slate-700">{a.qty}</td>
                  <td className="px-2 py-1.5 text-right font-bold text-teal-600">{a.issue}</td>
                  <td className={`px-2 py-1.5 text-right font-bold ${a.short > 0 ? 'text-red-500' : 'text-slate-300'}`}>{a.short || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-50 text-slate-400">
              <th className="px-2 py-1.5 text-left">기준코드</th><th className="px-2 py-1.5 text-left">품명</th>
              <th className="px-2 py-1.5 text-left">호기</th><th className="px-2 py-1.5 text-right">소요</th>
              <th className="px-2 py-1.5 text-right">불출</th><th className="px-2 py-1.5 text-right">결품</th><th className="px-2 py-1.5"></th>
            </tr></thead>
            <tbody>
              {cart.map(ln => {
                const sh = shortQ(ln)
                return (
                <tr key={ln.id} className={`border-t border-slate-100 ${sh > 0 ? 'bg-red-50/40' : ''}`}>
                  <td className="px-2 py-1.5 font-mono font-semibold text-indigo-600">{ln.std_code}</td>
                  <td className="px-2 py-1.5 text-slate-600 max-w-[180px]">
                    <div className="truncate">{ln.name}</div>
                    {itemMeta[ln.item_id]?.manufacturer_code && (
                      <div className="truncate text-[10px] text-violet-500 font-mono">{itemMeta[ln.item_id]?.manufacturer} · {itemMeta[ln.item_id]?.manufacturer_code}</div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-slate-400">{ln.source === 'hogi' ? `${ln.pn} ${ln.hogi}` : '직접'}</td>
                  <td className="px-2 py-1.5 text-right text-slate-500">{ln.qty}</td>
                  <td className="px-2 py-1.5 text-right">
                    <input type="number" value={ln.issue_qty ?? ln.qty} onChange={e => updMut.mutate({ id: ln.id, patch: { issue_qty: Number(e.target.value) } })}
                      className="w-16 px-1 py-0.5 text-right border border-slate-200 rounded" />
                  </td>
                  <td className={`px-2 py-1.5 text-right font-bold ${sh > 0 ? 'text-red-500' : 'text-slate-300'}`}>{sh || '-'}</td>
                  <td className="px-2 py-1.5 text-right">
                    <button onClick={() => delMut.mutate(ln.id)} className="text-slate-300 hover:text-red-500">✕</button>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        )}
      </div>

      {msg && <pre className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap text-slate-600">{msg}</pre>}
    </div>
  )
}
