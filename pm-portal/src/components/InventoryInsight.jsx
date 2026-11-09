import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { catOf, todayISO, kst } from '../lib/utils'
import { membersByRep } from '../lib/sameItem'
import { useCustomers } from '../hooks/useCustomers'
import { addItemsToCart } from '../pages/common/PoCart'
import { toastError, toastSuccess } from '../lib/toast'
import ItemLink from './ItemLink'

// 재고현황 위 두 칸 (v4.133.0)
//   ① 재고금액은 어디에 — 지금 조건의 재고금액(현재고 × 매입가)을 고객사 · 자재 분류 · 제조사로 나눠 본다
//   ② 안전재고 미달 — 모자란 품목이 이미 발주됐는지(발주번호 · 입고 예정 · 지연) 옆에 붙인다.
//      발주가 없으면 [담기] → 발주 담기함 (모자란 만큼 · 품목 기본 구매처 · 최근 매입가). 바로 발주는 만들지 않는다.
//   같은품목(JS) 묶음 대표 줄은 묶음 품번으로 걸린 발주도 같이 본다.

const n = (v) => Math.round(Number(v) || 0).toLocaleString('ko-KR')
const won = (v) => {
  const x = Number(v) || 0
  if (Math.abs(x) >= 1e8) return `${(x / 1e8).toFixed(2)}억`
  if (Math.abs(x) >= 1e4) return `${Math.round(x / 1e4).toLocaleString('ko-KR')}만`
  return n(x)
}
const md = (d) => (d ? kst(d).slice(5, 10).replace('-', '/') : '')
const CS_OF = [['AX-', 'AXCELIS', 'ax'], ['ED-', 'Edwards', 'ed'], ['CS-', 'CSK', 'csk'], ['VM-', 'VM', 'vm']]
const csOf = (code) => CS_OF.find(([p]) => String(code || '').toUpperCase().startsWith(p)) || null
const COLORS = ['bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-cyan-500', 'bg-rose-400', 'bg-slate-300']
const GROUPS = [['cs', '고객사'], ['cat', '자재 분류'], ['maker', '제조사']]
const SHOW = 6

async function fetchOpenPOs(ids) {
  const out = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('purchase_orders')
      .select('id,item_id,po_number,promise_date,qty_remaining,status')
      .eq('order_type', 'purchase').not('status', 'in', '(완료,취소)').gt('qty_remaining', 0)
      .in('item_id', ids.slice(i, i + 200))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

export default function InventoryInsight({ rows, same, brandFilter, onBrand, onOpenCart }) {
  const qc = useQueryClient()
  const { data: customers = [] } = useCustomers()
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('inv_insight_open') !== '0' } catch { return true } })
  const [by, setBy] = useState('cs')
  const [tab, setTab] = useState('none')
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(null)
  const toggle = () => setOpen((v) => { try { localStorage.setItem('inv_insight_open', v ? '0' : '1') } catch { /* 저장 안 돼도 됨 */ } return !v })

  // ① 재고금액 나누기 — 음수 재고는 0 으로 (금액이 마이너스로 섞이면 막대가 틀어진다)
  const value = useMemo(() => {
    const m = new Map(); let total = 0, noPrice = 0
    for (const r of rows || []) {
      const q = Math.max(Number(r.qty) || 0, 0)
      if (!q) continue
      const p = Number(r.items?.purchase_price) || 0
      if (!p) { noPrice++; continue }
      const k = by === 'cs' ? (csOf(r.items?.std_code)?.[1] || '공용 · 기타')
        : by === 'cat' ? (catOf(r.items) || '-')
        : (String(r.items?.manufacturer || '').trim() || '(제조사 없음)')
      const v = q * p
      m.set(k, (m.get(k) || 0) + v); total += v
    }
    let list = [...m.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v)
    if (list.length > 6) {
      const rest = list.slice(5).reduce((a, b) => a + b.v, 0)
      list = [...list.slice(0, 5), { k: `그 외 ${list.length - 5}곳`, v: rest, rest: true }]
    }
    return { list, total, noPrice }
  }, [rows, by])

  // ② 안전재고 미달 + 발주 여부
  const low = useMemo(() => (rows || []).filter((r) => {
    const s = Number(r.items?.safety_stock) || 0
    return s > 0 && (Number(r.qty) || 0) < s
  }), [rows])
  const reps = useMemo(() => membersByRep(same), [same])
  const askIds = useMemo(() => {
    const s = new Set()
    for (const r of low) { s.add(r.item_id); for (const m of reps.get(r.item_id) || []) s.add(m.id) }
    return [...s].sort()
  }, [low, reps])
  const { data: pos = [], isFetching } = useQuery({
    queryKey: ['invLowPO', askIds.join(',')],
    queryFn: () => fetchOpenPOs(askIds),
    enabled: open && askIds.length > 0,
    staleTime: 60 * 1000,
  })
  const today = todayISO()
  const lowRows = useMemo(() => {
    const byItem = new Map()
    for (const p of pos) {
      const rep = same?.get(p.item_id)?.rep || p.item_id
      if (!byItem.has(rep)) byItem.set(rep, [])
      byItem.get(rep).push(p)
    }
    return low.map((r) => {
      const ps = (byItem.get(r.item_id) || []).sort((a, b) => String(a.promise_date || '9999').localeCompare(String(b.promise_date || '9999')))
      const late = ps.some((p) => p.promise_date && p.promise_date < today)
      const safety = Number(r.items?.safety_stock) || 0
      const qty = Number(r.qty) || 0
      return { r, ps, late, safety, qty, need: Math.max(safety - Math.max(qty, 0), 0), onOrder: ps.reduce((a, p) => a + (Number(p.qty_remaining) || 0), 0) }
    }).sort((a, b) => (a.qty / a.safety) - (b.qty / b.safety))
  }, [low, pos, same, today])
  const none = lowRows.filter((x) => !x.ps.length)
  const ordered = lowRows.filter((x) => x.ps.length).sort((a, b) => (b.late - a.late) || (a.qty / a.safety) - (b.qty / b.safety))
  const lateCnt = ordered.filter((x) => x.late).length
  const list = tab === 'none' ? none : ordered
  const shown = all ? list : list.slice(0, SHOW)

  async function addCart(xs) {
    const csId = new Map(customers.map((c) => [String(c.code || '').toLowerCase(), c.id]))
    const lines = xs.filter((x) => x.need > 0).map((x) => ({
      item_id: x.r.item_id,
      customer_id: csId.get(csOf(x.r.items?.std_code)?.[2]) || null,
      qty: x.need,
      memo: `재고현황 안전재고 미달 (재고 ${n(x.qty)} · 안전 ${n(x.safety)})`,
    }))
    if (!lines.length) { toastError('담을 수량이 없습니다'); return }
    setBusy(xs.length > 1 ? 'all' : xs[0].r.item_id)
    try {
      const { added } = await addItemsToCart(lines)
      qc.invalidateQueries({ queryKey: ['poCart'] })
      toastSuccess(`${added}건 담았습니다 — 🛒 담기함에서 구매처 · 납기를 확인하세요`)
      onOpenCart?.()
    } catch (e) { toastError('담기 실패: ' + e.message) } finally { setBusy(null) }
  }

  if (!open) {
    return (
      <button onClick={toggle} data-inv-insight-open
        className="w-full text-left rounded-xl border border-dashed border-slate-200 bg-white px-4 py-2 text-xs text-slate-500 hover:bg-slate-50">
        📊 재고금액은 어디에 · 안전재고 미달 <b className="text-amber-600">{n(low.length)}</b> 발주 여부 — 펼치기 ▾
      </button>
    )
  }

  return (
    <div className="grid lg:grid-cols-2 gap-3" data-inv-insight>
      {/* ① 재고금액은 어디에 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-slate-800">💰 재고금액은 어디에</h3>
          <div className="flex items-center gap-1">
            {GROUPS.map(([k, l]) => (
              <button key={k} onClick={() => setBy(k)} data-inv-value-by={k}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${by === k ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{l}</button>
            ))}
            <button onClick={toggle} title="접기" className="ml-1 px-1.5 text-slate-300 hover:text-slate-500 text-xs">접기 ▴</button>
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2 flex-wrap">
          <span className="text-2xl font-bold text-slate-900 tabular-nums" data-inv-value-total>₩{n(value.total)}</span>
          <span className="text-[11px] text-slate-400">지금 조건 · 현재고 × 매입가{value.noPrice ? ` · 매입가 없는 ${n(value.noPrice)}품목 제외` : ''}</span>
        </div>
        {value.total > 0 && (
          <div className="flex h-3.5 rounded-full overflow-hidden gap-0.5 my-3" aria-hidden="true">
            {value.list.map((g, i) => <span key={g.k} className={COLORS[g.rest ? 6 : i]} style={{ flex: g.v }} />)}
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-x-5 gap-y-1.5" data-inv-value-list>
          {value.list.map((g, i) => {
            const click = by === 'maker' && !g.rest && g.k !== '(제조사 없음)'
            const on = click && brandFilter === g.k
            return (
              <button key={g.k} disabled={!click} onClick={() => onBrand?.(on ? '전체' : g.k)}
                title={click ? (on ? '브랜드 거르기 풀기' : `${g.k} 만 보기`) : ''}
                className={`flex items-center gap-2 min-w-0 text-left rounded px-1 -mx-1 ${click ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'} ${on ? 'bg-indigo-50' : ''}`}>
                <i className={`w-2.5 h-2.5 rounded-sm flex-none ${COLORS[g.rest ? 6 : i]}`} />
                <span className="flex-1 text-xs text-slate-600 truncate">{g.k}</span>
                <span className="text-xs text-slate-800 tabular-nums">₩{won(g.v)}</span>
                <span className="text-[11px] text-slate-400 w-9 text-right tabular-nums">{value.total ? Math.round(g.v / value.total * 100) : 0}%</span>
              </button>
            )
          })}
          {!value.list.length && <p className="text-xs text-slate-400">금액이 잡히는 재고가 없습니다</p>}
        </div>
      </div>

      {/* ② 안전재고 미달 · 발주 여부 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-slate-800">⚠ 안전재고 미달 <span className="ml-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-600 text-[11px]">{n(lowRows.length)}</span></h3>
          <div className="flex items-center gap-1">
            <button onClick={() => { setTab('none'); setAll(false) }} data-inv-low-tab="none"
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${tab === 'none' ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>발주 없음 {isFetching ? '…' : n(none.length)}</button>
            <button onClick={() => { setTab('po'); setAll(false) }} data-inv-low-tab="po"
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${tab === 'po' ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>발주 중 {isFetching ? '…' : n(ordered.length)}{lateCnt ? <span className={tab === 'po' ? 'text-rose-200' : 'text-rose-500'}> · 지연 {lateCnt}</span> : null}</button>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 mt-1">안전재고가 잡힌 품목 중 현재고가 적은 것 · 모자란 비율 큰 순. 발주가 없으면 [담기] → 발주 담기함 (모자란 만큼).</p>
        <div className={`mt-2 ${all ? 'max-h-80 overflow-y-auto pr-1' : ''}`} data-inv-low-list>
          {!shown.length && (
            <p className="text-xs text-slate-400 py-6 text-center">{isFetching ? '발주 확인 중…' : tab === 'none' ? '발주 없이 모자란 품목이 없습니다 👍' : '발주 중인 미달 품목이 없습니다'}</p>
          )}
          {shown.map((x) => {
            const r = x.r, mem = reps.get(r.item_id)
            const p0 = x.ps[0]
            return (
              <div key={r.id} className="flex items-center justify-between gap-3 py-2 border-t border-slate-100 first:border-0" data-inv-low-row={r.items?.std_code}>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-mono text-indigo-600"><ItemLink code={r.items?.std_code} /></span>
                    {mem && <span className="px-1.5 rounded-full bg-violet-50 text-violet-500 text-[10px] font-bold" title={`묶음: ${mem.map((m) => m.code).join(', ')}`}>JS 묶음</span>}
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">{r.items?.name}{r.items?.manufacturer ? ` · ${r.items.manufacturer}` : ''}</p>
                  <p className="text-[11px] text-slate-600">재고 <b className={`tabular-nums ${x.qty < 0 ? 'text-rose-600' : 'text-amber-600'}`}>{n(x.qty)}</b> · 안전 {n(x.safety)}{x.onOrder ? <> · 발주잔 <b className="tabular-nums">{n(x.onOrder)}</b></> : null}</p>
                </div>
                {x.ps.length ? (
                  <span className={`flex-none px-2 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ${x.late ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-blue-50 border-blue-200 text-blue-600'}`}
                    title={x.ps.map((p) => `${p.po_number || '-'} · 잔량 ${n(p.qty_remaining)} · ${p.promise_date || '납기 없음'}`).join('\n')}>
                    {x.late ? '지연' : '발주 중'} · {p0.po_number || '번호 없음'}{p0.promise_date ? ` · ${md(p0.promise_date)}${x.late ? ' 약속' : ' 입고'}` : ''}{x.ps.length > 1 ? ` 외 ${x.ps.length - 1}` : ''}
                  </span>
                ) : (
                  <button onClick={() => addCart([x])} disabled={!!busy || !x.need} data-inv-low-add
                    className="flex-none px-3 h-8 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 disabled:opacity-40 whitespace-nowrap">
                    {busy === r.item_id ? '…' : `🛒 담기 ${n(x.need)}`}
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <div className="flex items-center justify-between gap-2 mt-2">
          {list.length > SHOW
            ? <button onClick={() => setAll((v) => !v)} className="text-[11px] font-bold text-indigo-500 hover:underline">{all ? '접기' : `전체 ${n(list.length)}개 보기`}</button>
            : <span />}
          {tab === 'none' && none.length > 1 && (
            <button onClick={() => addCart(none)} disabled={!!busy} data-inv-low-addall
              className="px-3 h-7 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 text-[11px] font-bold hover:bg-violet-100 disabled:opacity-40">
              {busy === 'all' ? '…' : `발주 없음 ${n(none.length)}건 전부 담기`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
