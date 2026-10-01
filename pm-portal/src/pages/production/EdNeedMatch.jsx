// 생산관리 · Edwards · 📦 소요량 매칭
//   작업자 도구 「재고 파악」 탭을 옮긴 것 (계산은 lib/edNeed.js)
//   불출 예정 순으로 BOM 을 재고에서 차례로 빼 보고, 모자라는 품목과 들어올 발주를 보여 준다.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { explodeProjects } from '../../lib/bomSupply'
import { buildEvents, matchNeed, STATUS, WHICH_LABEL } from '../../lib/edNeed'
import { dday } from './EdProductionTable'

const md = (d) => (d ? String(d).slice(5, 10) : '')
const n0 = (v) => (Math.round(Number(v || 0) * 100) / 100).toLocaleString()
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) }

// Edwards 고객사 · BOM 프로젝트
export async function fetchEdProjects() {
  const { data: cs, error: e1 } = await supabase.from('customers').select('id,code')
  if (e1) throw e1
  const ed = (cs || []).find(c => String(c.code || '').toUpperCase() === 'ED')
  if (!ed) return { csId: null, projects: [] }
  const projects = await fetchAll(() => supabase.from('projects').select('id,code,name').eq('customer_id', ed.id).order('code').order('id'))
  return { csId: ed.id, projects }
}

async function fetchNeedData(csId, projIds, missPns) {
  // ① BOM 1대당 소요 (부족자재 · 소요량 화면과 같은 규칙)
  const ex = await explodeProjects(csId, projIds)
  if (ex === null) throw new Error('BOM 전개 함수(pm_bom_explode)가 없습니다 — SQL pm_bom_supply_260930 을 먼저 실행하세요')
  const bom = {}
  for (const r of ex) if (r.qty_per_unit > 0) (bom[r.project_id] ||= []).push({ item_id: r.item_id, qty: r.qty_per_unit })
  // ② 미불출 자재 품번 → 품목
  const missItem = {}
  if (missPns.length) {
    const codes = [...new Set(missPns.flatMap(p => (/^(ED|AX)-/i.test(p) ? [p] : [`ED-${p}`, p, `AX-${p}`])))]
    for (let i = 0; i < codes.length; i += 300) {
      const { data } = await supabase.from('items').select('id,std_code').in('std_code', codes.slice(i, i + 300))
      const by = Object.fromEntries((data || []).map(x => [x.std_code, x.id]))
      for (const p of missPns) missItem[p] ||= by[p] || by[`ED-${p}`] || by[`AX-${p}`]
    }
  }
  const ids = [...new Set([...Object.values(bom).flat().map(b => b.item_id), ...Object.values(missItem)].filter(Boolean))]
  const info = {}, inv = {}, orders = []
  for (let i = 0; i < ids.length; i += 300) {
    const part = ids.slice(i, i + 300)
    const [it, iv, po] = await Promise.all([
      supabase.from('items').select('id,std_code,name,manufacturer,manufacturer_code').in('id', part),
      supabase.from('inventory').select('item_id,qty').in('item_id', part),
      fetchAll(() => supabase.from('purchase_orders')
        .select('id,po_number,item_id,qty_remaining,promise_date,vendor_id')
        .eq('order_type', 'purchase').not('status', 'in', '(완료,취소)').in('item_id', part).order('id')),
    ])
    if (it.error) throw it.error
    if (iv.error) throw iv.error
    ;(it.data || []).forEach(x => { info[x.id] = x })
    ;(iv.data || []).forEach(x => { inv[x.item_id] = (inv[x.item_id] || 0) + (Number(x.qty) || 0) })
    po.forEach(o => { const q = Number(o.qty_remaining) || 0; if (q > 0) orders.push({ po: o.id, po_number: o.po_number, item_id: o.item_id, qty: q, date: o.promise_date ? String(o.promise_date).slice(0, 10) : null, vendor_id: o.vendor_id }) })
  }
  const vids = [...new Set(orders.map(o => o.vendor_id).filter(Boolean))]
  if (vids.length) {
    const { data } = await supabase.from('vendors').select('id,name').in('id', vids)
    const vn = Object.fromEntries((data || []).map(v => [v.id, v.name]))
    orders.forEach(o => { o.vendor = vn[o.vendor_id] || '' })
  }
  return { bom, missItem, info, inv, orders }
}

// 소요량 매칭 계산 — 이 보기와 리스트(하네스 · 전장 칸의 부족 표시)가 같이 쓴다
export function useEdNeed(rows, rules, enabled = true) {
  const pq = useQuery({ queryKey: ['edNeedProjects'], queryFn: fetchEdProjects, staleTime: 300000, enabled })
  const projects = pq.data?.projects || []
  const events = useMemo(() => buildEvents(rows, rules, projects), [rows, rules, projects])
  const projIds = [...new Set(events.map(e => e.proj?.id).filter(Boolean))].sort()
  const missPns = [...new Set(events.flatMap(e => (e.missing || []).map(m => String(m.pn).trim())))].sort()
  const dq = useQuery({
    queryKey: ['edNeed', pq.data?.csId, projIds.join(','), missPns.join(',')],
    queryFn: () => fetchNeedData(pq.data.csId, projIds, missPns),
    enabled: enabled && !!pq.data?.csId,
    staleTime: 60000,
  })
  const today = todayISO()
  const res = useMemo(() => (dq.data ? matchNeed({ events, ...dq.data, today }) : null), [dq.data, events, today])
  // 줄 · 불출별 결과 — `${row.id}|harn` · `${row.id}|elec` · `${row.id}|miss`
  const byKey = useMemo(() => Object.fromEntries((res?.cards || []).map(c => [c.key, c])), [res])
  return { pq, dq, projects, events, res, byKey, info: dq.data?.info || {} }
}

export default function EdNeedMatch({ rows, rules, onOpenRules, focus, onClearFocus }) {
  const [only, setOnly] = useState('bad')       // bad | all
  const [tab, setTab] = useState('card')        // card | item
  const [open, setOpen] = useState({})
  const { pq, dq, events, res } = useEdNeed(rows, rules)

  if (pq.isLoading || dq.isLoading) return <div className="py-12 text-center text-sm text-slate-400">소요량 계산 중…</div>
  if (pq.error || dq.error) return <div className="p-6 text-sm text-red-600">소요량을 불러오지 못했습니다: {(pq.error || dq.error).message}</div>
  if (!pq.data?.csId) return <div className="p-6 text-sm text-slate-500">Edwards 고객사(코드 ED)를 찾을 수 없습니다.</div>

  const info = dq.data?.info || {}
  const noBom = events.filter(e => e.which !== 'miss' && !e.proj)
  const cards = (res?.cards || []).filter(c => c.which === 'miss' || c.proj)
  // 리스트의 부족 표시를 눌러 들어오면 그 건만
  const shown = focus ? cards.filter(c => c.key === focus) : only === 'bad' ? cards.filter(c => c.bad) : cards
  const badItems = new Set(cards.flatMap(c => c.parts.filter(p => p.status !== 'ok').map(p => p.item_id || p.pn)))
  const itemLabel = (id, p) => { const it = info[id]; return it ? String(it.std_code).replace(/^(ED|AX)-/, '') : (p?.pn || '?') }

  return (
    <div className="p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-0 bg-white border border-slate-200 rounded-xl overflow-hidden text-xs">
          <div className="px-4 py-2 border-r border-slate-100"><div className="text-slate-500">불출 건</div><div className="text-lg font-extrabold">{cards.length}</div></div>
          <div className="px-4 py-2 border-r border-slate-100"><div className="text-slate-500">부족 있는 건</div><div className="text-lg font-extrabold text-red-600">{cards.filter(c => c.bad).length}</div></div>
          <div className="px-4 py-2 border-r border-slate-100"><div className="text-slate-500">부족 품목</div><div className="text-lg font-extrabold text-red-600">{badItems.size}</div></div>
          <button type="button" onClick={onOpenRules} className={`px-4 py-2 text-left ${noBom.length ? 'bg-orange-50 hover:bg-orange-100' : 'hover:bg-slate-50'}`}
            title="「⚙ 불출 기준」 ③ 에서 BOM 을 연결합니다">
            <div className="text-slate-500">BOM 연결 안 된 건</div><div className={`text-lg font-extrabold ${noBom.length ? 'text-orange-600' : ''}`}>{noBom.length}</div>
          </button>
        </div>
        <span className="inline-flex bg-slate-100 rounded-lg p-0.5">
          {[['card', '불출 건별'], ['item', '품목별 부족']].map(([v, l]) => (
            <button key={v} type="button" onClick={() => setTab(v)} className={`px-2.5 py-1 text-[11px] font-semibold rounded-md ${tab === v ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>
          ))}
        </span>
        {focus && (
          <button type="button" onClick={onClearFocus} className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100">한 건만 보는 중 · 전체 보기 ✕</button>
        )}
        {tab === 'card' && !focus && (
          <span className="inline-flex bg-slate-100 rounded-lg p-0.5">
            {[['bad', '부족만'], ['all', '전체']].map(([v, l]) => (
              <button key={v} type="button" onClick={() => setOnly(v)} className={`px-2.5 py-1 text-[11px] font-semibold rounded-md ${only === v ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>
            ))}
          </span>
        )}
        <span className="text-[11px] text-slate-400">재고 · 미입고 구매발주(입고요청일) 기준 · 불출 예정 순으로 차례로 뺌 · 지난 입고요청일 발주는 더하지 않음</span>
      </div>

      {tab === 'item' ? (
        <table className="w-full text-xs bg-white border border-slate-200 rounded-xl overflow-hidden">
          <thead className="bg-slate-50 text-slate-500"><tr>
            <th className="px-3 py-2 text-left">품번</th><th className="px-3 py-2 text-left">품명</th><th className="px-3 py-2 text-left">제조사</th>
            <th className="px-3 py-2">현재고</th><th className="px-3 py-2">부족 시작</th><th className="px-3 py-2 text-left">처음 모자라는 건</th>
            <th className="px-3 py-2">최대 부족</th><th className="px-3 py-2 text-left">풀리는 때</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {(res?.periods || []).map((p, i) => {
              const it = info[p.item_id] || {}
              const n = dday(p.start)
              return (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono font-semibold text-slate-700">{itemLabel(p.item_id)}</td>
                  <td className="px-3 py-2 text-slate-600 max-w-[240px] truncate" title={it.name}>{it.name}</td>
                  <td className="px-3 py-2 text-slate-500">{it.manufacturer} <span className="font-mono text-[10px] text-slate-400">{it.manufacturer_code}</span></td>
                  <td className="px-3 py-2 text-center">{n0(dq.data.inv[p.item_id])}</td>
                  <td className={`px-3 py-2 text-center font-bold ${n != null && n < 0 ? 'text-red-600' : n != null && n <= 14 ? 'text-orange-600' : 'text-slate-600'}`}>{p.start === '9999-12-31' ? '날짜 없음' : md(p.start)}</td>
                  <td className="px-3 py-2 text-slate-500">{p.first ? `${p.first.row.pn} ${p.first.row.hogi} ${p.first.kind} ${WHICH_LABEL[p.first.which] || '미불출'}` : ''}</td>
                  <td className="px-3 py-2 text-center font-bold text-red-600">{n0(p.max)}</td>
                  <td className="px-3 py-2">{p.end
                    ? <span className="text-emerald-700">{md(p.end)} 입고 {n0(p.by?.qty)}{p.by?.vendor ? ` (${p.by.vendor})` : ''}</span>
                    : <span className="font-bold text-red-600">입고 예정 없음</span>}</td>
                </tr>
              )
            })}
            {!(res?.periods || []).length && <tr><td colSpan={8} className="py-10 text-center text-slate-400">모자라는 품목이 없습니다 ✓</td></tr>}
          </tbody>
        </table>
      ) : (
        <div className="space-y-2">
          {shown.map(c => {
            const n = dday(c.due)
            const isOpen = open[c.key] ?? (!!c.bad || c.key === focus)
            const sorted = [...c.parts].sort((a, b) => (a.status === 'ok') - (b.status === 'ok') || b.short - a.short)
            return (
              <div key={c.key} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <button type="button" onClick={() => setOpen(o => ({ ...o, [c.key]: !isOpen }))}
                  className="w-full flex flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 text-xs">
                  <span className="text-slate-400">{isOpen ? '▾' : '▸'}</span>
                  <span className="font-semibold text-slate-800">{c.row.pn}</span>
                  <span className="font-mono font-bold text-indigo-600">{c.row.hogi}</span>
                  <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 text-[10px] font-bold">{c.kind}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${c.which === 'harn' ? 'bg-teal-50 text-teal-700' : c.which === 'elec' ? 'bg-blue-50 text-blue-700' : 'bg-rose-50 text-rose-600'}`}>{WHICH_LABEL[c.which] || '미불출 자재'}</span>
                  {c.proj && <span className="text-[10px] text-slate-400 font-mono" title="연결된 BOM">BOM {c.proj.code}</span>}
                  <span className={`font-semibold ${n == null ? 'text-slate-300' : n < 0 ? 'text-red-600' : n <= 7 ? 'text-orange-600' : 'text-slate-500'}`}>
                    불출 {c.due ? md(c.due) : '날짜 없음'}{n != null && n >= 0 ? ` (D-${n})` : ''}
                  </span>
                  <span className="ml-auto">
                    {!c.bad ? <span className="text-emerald-600 font-bold">✓ 충분 ({c.parts.length}품목)</span>
                      : <span className={`font-bold ${c.critical ? 'text-red-600' : 'text-amber-600'}`}>{c.critical ? '🔴' : '🟡'} {c.bad}품목 부족 / {c.parts.length}</span>}
                  </span>
                </button>
                {isOpen && (
                  <table className="w-full text-[11px] border-t border-slate-100">
                    <thead className="bg-slate-50 text-slate-400"><tr>
                      <th className="px-3 py-1.5 text-left">품번</th><th className="px-3 py-1.5 text-left">품명</th><th className="px-3 py-1.5 text-left">제조사</th>
                      <th className="px-3 py-1.5">소요</th><th className="px-3 py-1.5" title="앞 불출 건을 뺀 뒤 남은 재고 (그 사이 들어올 발주 포함)">불출 전 재고</th>
                      <th className="px-3 py-1.5">부족</th><th className="px-3 py-1.5 text-left">입고 예정 (구매발주)</th><th className="px-3 py-1.5 text-left">상태</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-50">
                      {sorted.map((p, i) => {
                        const it = info[p.item_id] || {}
                        const st = STATUS[p.status] || STATUS.ok
                        const o = p.next
                        return (
                          <tr key={i} className={p.status === 'ok' ? '' : p.status === 'warn' || p.status === 'after' ? 'bg-amber-50/40' : 'bg-red-50/40'}>
                            <td className="px-3 py-1.5 font-mono text-slate-700">{itemLabel(p.item_id, p)}</td>
                            <td className="px-3 py-1.5 text-slate-600 max-w-[220px] truncate" title={it.name || p.missName}>{it.name || p.missName}</td>
                            <td className="px-3 py-1.5 text-slate-500">{it.manufacturer}</td>
                            <td className="px-3 py-1.5 text-center font-semibold">{n0(p.qty)}</td>
                            <td className={`px-3 py-1.5 text-center ${p.before != null && p.before < p.qty ? 'text-red-600 font-bold' : ''}`}>{p.before == null ? '—' : n0(p.before)}</td>
                            <td className="px-3 py-1.5 text-center font-bold text-red-600">{p.short > 0 && p.status !== 'ok' ? n0(p.short) : ''}</td>
                            <td className="px-3 py-1.5 text-slate-500" title={(dq.data.orders || []).filter(x => x.item_id === p.item_id).map(x => `${x.po_number || ''} ${x.date || '날짜 없음'} ${x.qty}개 ${x.vendor || ''}`).join('\n')}>
                              {o ? <span className={p.overdue?.length && o === p.overdue[0] ? 'text-red-600 font-semibold' : ''}>
                                {p.overdue?.length && o === p.overdue[0] ? '⚠ 지연 ' : '📦 '}{o.date ? md(o.date) : '날짜 없음'} {n0(o.qty)}개{o.vendor ? ` · ${o.vendor}` : ''}
                              </span> : <span className="text-slate-300">—</span>}
                            </td>
                            <td className={`px-3 py-1.5 font-semibold ${st.cls}`}><span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle ${st.dot}`} />{st.label}</td>
                          </tr>
                        )
                      })}
                      {!sorted.length && <tr><td colSpan={8} className="px-3 py-3 text-slate-400">BOM 에 품목이 없습니다 (BOM {c.proj?.code})</td></tr>}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
          {!shown.length && <div className="py-10 text-center text-sm text-slate-400">{only === 'bad' ? '모자라는 불출 건이 없습니다 ✓' : '불출할 건이 없습니다'}</div>}
          {noBom.length > 0 && (
            <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-3 text-xs text-orange-700">
              BOM 이 연결 안 돼 계산에서 빠진 불출 {noBom.length}건 —{' '}
              {[...new Set(noBom.map(e => `${e.kind}${e.group && e.group !== '*' ? ' ' + e.group : ''} ${WHICH_LABEL[e.which]}`))].join(' · ')}
              <button type="button" onClick={onOpenRules} className="ml-2 font-bold underline">⚙ 불출 기준에서 연결</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
