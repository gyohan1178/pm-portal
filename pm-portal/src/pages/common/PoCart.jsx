import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { must } from '../../lib/db'
import { todayISO } from '../../lib/utils'
import { toastError, toastSuccess } from '../../lib/toast'
import { genPoNumber } from '../../lib/poNumber'
import { refreshProcurement } from '../../lib/refresh'
import VendorPicker from '../../components/VendorPicker'

// 발주 담기함 (장바구니) — 자재요청에서 담아 둔 것을 모아 한꺼번에 발주로 등록한다.
//
//   담을 때는 품목의 기본 구매처·필요일이 들어오고, 여기서 구매처·납기·단가를 고친다.
//   등록하면 구매처별로 발주번호 한 장(JS-YYMMDD-NN)으로 묶여 구매발주에 들어간다.
//
//   ⚠ 담은 것은 담은 사람에게만 보인다 (pm_po_cart 의 RLS).
//   ⚠ 발주 줄은 한 번에 insert 한다 — 중간에 실패하면 아무것도 안 들어간다.

// ⚠ pm_po_cart 에는 외래키를 두지 않았다. 그래서 items(...) 처럼 붙여 읽을 수 없어
//   (PostgREST 는 외래키를 보고 조인한다) 품목·구매처는 따로 읽어서 붙인다.
export async function fetchCart() {
  const rows = must(await supabase.from('pm_po_cart').select('*').order('created_at'), '발주 담기함 조회') || []
  if (!rows.length) return rows
  const itemIds = [...new Set(rows.map((r) => r.item_id).filter(Boolean))]
  const vendIds = [...new Set(rows.map((r) => r.vendor_id).filter(Boolean))]
  const items = itemIds.length
    ? must(await supabase.from('items').select('id,std_code,name,unit,type,manufacturer,manufacturer_code').in('id', itemIds), '품목 조회') || []
    : []
  const vends = vendIds.length
    ? must(await supabase.from('vendors').select('id,name').in('id', vendIds), '구매처 조회') || []
    : []
  const iOf = new Map(items.map((i) => [i.id, i])), vOf = new Map(vends.map((v) => [v.id, v]))
  return rows.map((r) => ({ ...r, items: iOf.get(r.item_id) || null, vendors: vOf.get(r.vendor_id) || null }))
}

// 자재요청 줄을 담는다. rows: pm_request_list 의 줄
export async function addToCart(rows) {
  const items = rows.filter((r) => r.item_id)
  if (!items.length) throw new Error('기준코드가 없는 건은 담을 수 없습니다')
  // 품목 기본 구매처를 채워 둔다 (나중에 담기함에서 바꿀 수 있다)
  const ids = [...new Set(items.map((r) => r.item_id))]
  const master = must(await supabase.from('items').select('id,vendor_id').in('id', ids), '품목 조회') || []
  const vOf = new Map(master.map((m) => [m.id, m.vendor_id]))
  // 고객사 — 요청에 있으면 그것, 없으면 고객사 코드로, 그것도 없으면 품목이 속한 BOM 기준
  const codes = [...new Set(items.map((r) => r.customer_code).filter(Boolean))]
  const csOf = new Map()
  if (codes.length) {
    const cs = must(await supabase.from('customers').select('id,code').in('code', codes), '고객사 조회') || []
    cs.forEach((c) => csOf.set(c.code, c.id))
  }
  const bomOf = new Map()
  const needBom = items.filter((r) => !r.customer_id && !csOf.get(r.customer_code)).map((r) => r.item_id)
  if (needBom.length) {
    const bs = must(await supabase.from('bom').select('item_id,customer_id').in('item_id', [...new Set(needBom)]), 'BOM 조회') || []
    bs.forEach((b) => { if (!bomOf.has(b.item_id)) bomOf.set(b.item_id, b.customer_id) })
  }
  const payload = items.map((r) => ({
    request_id: r.id, item_id: r.item_id,
    customer_id: r.customer_id || csOf.get(r.customer_code) || bomOf.get(r.item_id) || null,
    vendor_id: vOf.get(r.item_id) || null,
    qty: Number(r.qty) || 0, promise_date: r.need_date || null,
    memo: `자재요청 ${r.req_no || ''}${r.purpose ? ' · ' + r.purpose : ''}`.trim(),
  }))
  must(await supabase.from('pm_po_cart').insert(payload), '발주 담기')
  return { added: payload.length, skipped: rows.length - items.length }
}

const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')

export default function PoCart({ open, onClose }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [bulkVendor, setBulkVendor] = useState('')
  const [bulkDate, setBulkDate] = useState('')
  const { data: cart = [], isLoading } = useQuery({ queryKey: ['poCart'], queryFn: fetchCart, enabled: !!open })

  const groups = useMemo(() => {
    const m = new Map()
    for (const c of cart) {
      const k = c.vendor_id || '__none'
      if (!m.has(k)) m.set(k, { name: c.vendors?.name || '구매처 미지정', rows: [] })
      m.get(k).rows.push(c)
    }
    return [...m.values()]
  }, [cart])

  const reload = () => qc.invalidateQueries({ queryKey: ['poCart'] })

  async function patch(id, patchObj) {
    try {
      must(await supabase.from('pm_po_cart').update({ ...patchObj, updated_at: new Date().toISOString() }).eq('id', id), '담기함 수정')
      reload()
    } catch (e) { toastError(e.message) }
  }
  async function remove(ids) {
    if (!ids.length) return
    try {
      must(await supabase.from('pm_po_cart').delete().in('id', ids), '담기함 삭제')
      reload(); toastSuccess(`${ids.length}줄 뺐습니다`)
    } catch (e) { toastError(e.message) }
  }
  async function applyBulk(field, value) {
    if (!cart.length || !value) return
    try {
      must(await supabase.from('pm_po_cart').update({ [field]: value, updated_at: new Date().toISOString() })
        .in('id', cart.map((c) => c.id)), '일괄 수정')
      reload(); toastSuccess(field === 'vendor_id' ? '구매처를 모두 바꿨습니다' : '납기를 모두 바꿨습니다')
    } catch (e) { toastError(e.message) }
  }

  // 발주 등록 — 구매처별로 발주번호 한 장
  async function register() {
    if (!cart.length) return
    const noQty = cart.filter((c) => !(Number(c.qty) > 0))
    if (noQty.length) { toastError(`수량이 없는 줄이 ${noQty.length}개 있습니다`); return }
    const noCs = cart.filter((c) => !c.customer_id)
    if (noCs.length) { toastError(`고객사가 없는 줄이 ${noCs.length}개 있습니다 — 줄을 빼거나 자재요청에서 고객사를 채워주세요`); return }
    if (!window.confirm(`${cart.length}줄을 발주로 등록합니다.\n구매처별로 발주번호 ${groups.length}장이 만들어집니다.`)) return
    setBusy(true)
    try {
      const order_date = todayISO()
      const rows = []
      // 발주번호는 한 번만 따고 묶음마다 하나씩 올린다.
      //   ⚠ 줄은 맨 끝에 한 번에 넣으므로, 묶음마다 다시 따면 DB 에 아직 없어 같은 번호가 나온다.
      const first = await genPoNumber(order_date)
      const m = String(first).match(/^(.*-)(\d+)$/)
      const nextNo = (i) => (m ? m[1] + String(Number(m[2]) + i).padStart(2, '0') : first)
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi], po_number = nextNo(gi)
        for (const c of g.rows) {
          rows.push({
            customer_id: c.customer_id, item_id: c.item_id, vendor_id: c.vendor_id || null,
            order_type: 'purchase', type: c.items?.type || '자재', status: '진행중',
            po_number, qty_ordered: Number(c.qty), qty_received: 0,
            order_date, promise_date: c.promise_date || null,
            unit_price: c.unit_price === null || c.unit_price === '' ? null : Number(c.unit_price),
            memo: c.memo || null,
          })
        }
      }
      const made = must(await supabase.from('purchase_orders').insert(rows).select('id,item_id'), '발주 등록') || []
      // 자재요청 줄을 처리중으로 (담을 때 연결해 둔 요청만)
      const poOf = new Map()
      made.forEach((p) => { if (!poOf.has(p.item_id)) poOf.set(p.item_id, p.id) })
      const reqRows = cart.filter((c) => c.request_id)
      for (const c of reqRows) {
        const { error } = await supabase.from('pm_material_request')
          .update({ status: '처리중', handle_type: '발주', po_id: poOf.get(c.item_id) || null, handled_at: new Date().toISOString() })
          .eq('id', c.request_id)
        if (error) toastError(`자재요청 상태 반영 실패 (${c.request_id}) — ${error.message}`)
      }
      must(await supabase.from('pm_po_cart').delete().in('id', cart.map((c) => c.id)), '담기함 비우기')
      toastSuccess(`발주 ${rows.length}줄 · 발주서 ${groups.length}장 등록`)
      reload()
      refreshProcurement(qc)
      qc.invalidateQueries({ queryKey: ['materialRequests'] })
      onClose?.()
    } catch (e) { toastError('발주 등록 실패: ' + e.message) }
    finally { setBusy(false) }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-6xl my-6" onClick={(e) => e.stopPropagation()}>
        {/* 머리 */}
        <div className="px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">🛒 발주 담기함</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                담아 둔 것을 구매처·납기·단가까지 채워서 한꺼번에 발주로 등록합니다. 담은 것은 나에게만 보입니다.
              </p>
            </div>
            <button onClick={onClose} className="text-slate-300 hover:text-slate-500 text-xl leading-none">×</button>
          </div>
          {/* 일괄 */}
          <div className="flex items-end gap-3 flex-wrap mt-3">
            <div className="w-56">
              <label className="block text-[11px] font-bold text-slate-500 mb-1">구매처 일괄 지정</label>
              <VendorPicker value={bulkVendor} onChange={(id) => { setBulkVendor(id); if (id) applyBulk('vendor_id', id) }} />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">납기 일괄 지정</label>
              <input type="date" value={bulkDate}
                onChange={(e) => { setBulkDate(e.target.value); if (e.target.value) applyBulk('promise_date', e.target.value) }}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            </div>
            <span className="text-xs text-slate-400 ml-auto">
              {cart.length.toLocaleString('ko-KR')}줄 · 발주서 {groups.length}장으로 묶임
            </span>
          </div>
        </div>

        {/* 목록 */}
        <div className="max-h-[60vh] overflow-auto">
          {isLoading ? <p className="p-8 text-center text-sm text-slate-400">불러오는 중…</p>
            : !cart.length ? <p className="p-10 text-center text-sm text-slate-400">담아 둔 것이 없습니다. 자재요청에서 「🛒 발주 담기」로 담으세요.</p>
              : groups.map((g, gi) => (
                <div key={gi} className="border-b border-slate-100 last:border-0">
                  <div className="px-5 py-2 bg-slate-50 flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-600">{g.name}</span>
                    <span className="text-[11px] text-slate-400">{g.rows.length}줄 · 발주서 1장</span>
                    <button onClick={() => remove(g.rows.map((r) => r.id))}
                      className="ml-auto text-[11px] text-slate-400 hover:text-rose-600">이 묶음 빼기</button>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-400">
                        <th className="px-3 py-1.5 font-semibold">기준코드 / 품명</th>
                        <th className="px-3 py-1.5 font-semibold w-56">구매처</th>
                        <th className="px-3 py-1.5 font-semibold w-24 text-right">수량</th>
                        <th className="px-3 py-1.5 font-semibold w-36">납기</th>
                        <th className="px-3 py-1.5 font-semibold w-28 text-right">단가</th>
                        <th className="px-3 py-1.5 font-semibold">비고</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((c) => (
                        <tr key={c.id} className="border-t border-slate-100 align-top">
                          <td className="px-3 py-2">
                            <div className="font-mono text-indigo-600">{c.items?.std_code || '-'}</div>
                            <div className="text-[11px] text-slate-500 truncate max-w-[220px]" title={c.items?.name}>{c.items?.name}</div>
                            <div className="text-[10px] text-slate-400 truncate max-w-[220px]">
                              {[c.items?.manufacturer, c.items?.manufacturer_code].filter(Boolean).join(' ')}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <VendorPicker value={c.vendor_id || ''} onChange={(id) => patch(c.id, { vendor_id: id || null })} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input type="number" defaultValue={c.qty} min="0"
                              onBlur={(e) => Number(e.target.value) !== Number(c.qty) && patch(c.id, { qty: Number(e.target.value) })}
                              className="w-20 px-2 py-1.5 text-sm text-right border border-slate-200 rounded-lg" />
                            <div className="text-[10px] text-slate-400 mt-0.5">{c.items?.unit || 'EA'}</div>
                          </td>
                          <td className="px-3 py-2">
                            <input type="date" defaultValue={c.promise_date || ''}
                              onChange={(e) => patch(c.id, { promise_date: e.target.value || null })}
                              className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg" />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input type="number" defaultValue={c.unit_price ?? ''} step="0.01"
                              onBlur={(e) => patch(c.id, { unit_price: e.target.value === '' ? null : Number(e.target.value) })}
                              className="w-24 px-2 py-1.5 text-sm text-right border border-slate-200 rounded-lg" />
                          </td>
                          <td className="px-3 py-2">
                            <input defaultValue={c.memo || ''}
                              onBlur={(e) => e.target.value !== (c.memo || '') && patch(c.id, { memo: e.target.value || null })}
                              className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg" />
                          </td>
                          <td className="px-2 py-2">
                            <button onClick={() => remove([c.id])} className="text-slate-300 hover:text-rose-600">×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
        </div>

        {/* 발 */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400">
            등록하면 구매처별로 발주번호가 따로 매겨지고, 담기함은 비워집니다.
          </span>
          <button onClick={() => remove(cart.map((c) => c.id))} disabled={!cart.length || busy}
            className="ml-auto px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500 disabled:opacity-40">전부 비우기</button>
          <button onClick={onClose}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-600">닫기</button>
          <button onClick={register} disabled={!cart.length || busy}
            className="px-4 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
            {busy ? '등록 중…' : `발주 등록 (${n(cart.length)}줄 · ${groups.length}장)`}
          </button>
        </div>
      </div>
    </div>
  )
}
