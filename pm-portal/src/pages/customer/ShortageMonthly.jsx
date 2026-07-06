import { useMemo, useState } from 'react'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import * as XLSX from 'xlsx'

// 확정 고객사 PO 기준 월별 소요/부족 (RPC: get_shortage_monthly) — range 페이징
export async function fetchMonthly(csId) {
  if (!csId) return []
  const PAGE = 1000
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.rpc('get_shortage_monthly', { cs_id: csId }).range(from, from + PAGE - 1)
    if (error) throw error
    const batch = data || []
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  return rows
}

const TODAY = new Date(new Date().toISOString().split('T')[0])

// 긴급도 = 발주 데드라인(첫 부족월 - LT) 기준
function tierOf(firstShort, ltWeeks) {
  if (!firstShort) return null
  const start = new Date(firstShort + '-01')
  const deadline = new Date(start.getTime() - (ltWeeks || 0) * 7 * 86400000)
  const days = Math.round((deadline - TODAY) / 86400000)
  if (days < 0) return '긴급'
  if (days <= 14) return '임박'
  return '여유'
}
const TIER_META = {
  '긴급': { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', icon: '🔴', desc: '데드라인 지남 · 즉시발주' },
  '임박': { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', icon: '🟠', desc: '2주 내 발주' },
  '여유': { color: '#059669', bg: '#F0FDF4', border: '#BBF7D0', icon: '🟢', desc: '여유 있음' },
}

export default function ShortageMonthly({ csId }) {
  const [tierFilter, setTierFilter] = useState(null)
  const [search, setSearch] = useState('')
  const [urgentOnly, setUrgentOnly] = useState(false)
  const [checked, setChecked] = useState({})
  const qc = useQueryClient()

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['shortageMonthly', csId], queryFn: () => fetchMonthly(csId), enabled: !!csId,
  })

  const orderMut = useMutation({
    mutationFn: async (selItems) => {
      const payload = selItems.map(it => ({
        customer_id: csId, item_id: it.item_id, vendor_id: it.vendor_id || null,
        qty_ordered: it.orderNeed, qty_received: 0, order_type: 'purchase', status: '진행중',
      }))
      const { error } = await supabase.from('purchase_orders').insert(payload); if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries(['purchase']); qc.invalidateQueries(['shortageMonthly']); qc.invalidateQueries(['shortage'])
      setChecked({}); toastSuccess('구매발주 생성 완료 — 구매발주 화면에서 발주번호·납기·단가를 채워주세요')
    },
    onError: (e) => toastError('오류: ' + e.message),
  })

  const { items, months, counts } = useMemo(() => {
    const monthSet = new Set(), map = {}
    rows.forEach(r => {
      monthSet.add(r.year_month)
      if (!map[r.item_id]) map[r.item_id] = {
        item_id: r.item_id, std_code: r.std_code, name: r.name, unit: r.unit, type: r.type,
        lt_weeks: Number(r.lt_weeks) || 0, dept: r.dept, manufacturer: r.manufacturer,
        manufacturer_code: r.manufacturer_code, vendor_name: r.vendor_name, vendor_id: r.vendor_id,
        current_stock: Number(r.current_stock) || 0, cells: {},
      }
      map[r.item_id].cells[r.year_month] = { demand: Number(r.demand) || 0, incoming: Number(r.incoming) || 0 }
    })
    const months = [...monthSet].sort()
    const items = []
    Object.values(map).forEach(it => {
      let bal = it.current_stock, first = null, totalDem = 0, totalInc = 0
      months.forEach(m => {
        const c = it.cells[m] || { demand: 0, incoming: 0 }
        totalDem += c.demand; totalInc += c.incoming
        bal = bal + c.incoming - c.demand
        const shortage = bal < 0 ? Math.round(-bal) : 0
        it.cells[m] = { ...c, projected: bal, shortage }
        if (shortage > 0 && !first) first = m
      })
      if (!first) return // 부족 없으면 제외
      it.firstShort = first
      it.total_need = Math.round(totalDem * 100) / 100
      it.pending = Math.round(totalInc * 100) / 100
      it.orderNeed = Math.max(0, Math.round((totalDem - it.current_stock - totalInc) * 100) / 100)
      it.tier = tierOf(first, it.lt_weeks)
      items.push(it)
    })
    const counts = { '긴급': 0, '임박': 0, '여유': 0 }
    items.forEach(it => { if (counts[it.tier] !== undefined) counts[it.tier]++ })
    const TORDER = { '긴급': 0, '임박': 1, '여유': 2 }
    items.sort((a, b) => {
      const t = (TORDER[a.tier] ?? 9) - (TORDER[b.tier] ?? 9); if (t) return t
      if (a.firstShort !== b.firstShort) return a.firstShort < b.firstShort ? -1 : 1
      return b.orderNeed - a.orderNeed
    })
    return { items, months, counts }
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(it => {
      if (urgentOnly && it.tier === '여유') return false
      if (tierFilter && it.tier !== tierFilter) return false
      if (q && ![it.std_code, it.name, it.manufacturer, it.manufacturer_code, it.vendor_name].some(x => (x || '').toLowerCase().includes(q))) return false
      return true
    })
  }, [items, search, urgentOnly, tierFilter])

  if (isLoading) return <div className="text-center py-12 text-slate-400 text-sm">쇼티지 계산 중...</div>
  if (!items.length) return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-10 text-center text-sm text-slate-400">
      부족 예상 품목이 없습니다 (고객사 PO·BOM 데이터 확인)
    </div>
  )

  const checkedItems = filtered.filter(it => checked[it.item_id] && it.orderNeed > 0)

  // 엑셀 추출 — 화면 통합표 그대로 (긴급도·제조사·제조사품번 + 월별 부족)
  function exportShortageExcel() {
    try {
      const data = filtered.map(it => {
        const row = {
          '긴급도': it.tier || '', '첫부족월': it.firstShort || '',
          '기준코드': it.std_code || '', '제조사': it.manufacturer || '', '제조사품번': it.manufacturer_code || '',
          '품명': it.name || '', '구매처': it.vendor_name || '',
          'LT(주)': it.lt_weeks || 0, '현재고': it.current_stock ?? '', '발주필요': it.orderNeed > 0 ? it.orderNeed : 0,
        }
        months.forEach(mo => {
          const c = it.cells[mo]
          row[mo.slice(2)] = c && c.shortage > 0 ? -c.shortage : (c && c.demand > 0 ? Math.round(c.demand) : '')
        })
        return row
      })
      const ws = XLSX.utils.json_to_sheet(data)
      ws['!cols'] = [{ wch: 7 }, { wch: 8 }, { wch: 15 }, { wch: 16 }, { wch: 18 }, { wch: 30 }, { wch: 14 }, { wch: 6 }, { wch: 7 }, { wch: 8 }, ...months.map(() => ({ wch: 7 }))]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '쇼티지통합')
      XLSX.writeFile(wb, `쇼티지통합_${new Date().toISOString().split('T')[0]}.xlsx`)
    } catch (e) { toastError('엑셀 생성 오류: ' + (e?.message || e)) }
  }

  return (
    <div className="space-y-3">
      {/* 긴급도 요약 카드 (클릭 필터) */}
      <div className="grid grid-cols-3 gap-2">
        {['긴급', '임박', '여유'].map(t => {
          const m = TIER_META[t], on = tierFilter === t
          return (
            <button key={t} onClick={() => setTierFilter(on ? null : t)}
              className="rounded-xl border p-3 text-left transition-all"
              style={{ borderColor: on ? m.color : m.border, background: m.bg, boxShadow: on ? `0 0 0 2px ${m.color}` : 'none' }}>
              <p className="text-xs font-bold" style={{ color: m.color }}>{m.icon} {t}</p>
              <p className="text-2xl font-bold" style={{ color: m.color }}>{counts[t]}</p>
              <p className="text-[10px] text-slate-400">{m.desc}</p>
            </button>
          )
        })}
      </div>

      {/* 검색 + 토글 */}
      <div className="flex items-center gap-2 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="품번·품명·제조사·구매처 검색"
          className="flex-1 min-w-48 px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer whitespace-nowrap">
          <input type="checkbox" checked={urgentOnly} onChange={e => setUrgentOnly(e.target.checked)} className="accent-indigo-600" />긴급·임박만
        </label>
        {tierFilter && <button onClick={() => setTierFilter(null)} className="text-xs text-slate-400 hover:text-slate-600">필터 해제 ✕</button>}
        <span className="text-xs text-slate-400 whitespace-nowrap">{filtered.length}건</span>
        <button onClick={exportShortageExcel} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 whitespace-nowrap">📥 엑셀 추출</button>
        {checkedItems.length > 0 && (
          <button onClick={() => { if (window.confirm(`${checkedItems.length}건 구매발주를 생성할까요? (발주필요 수량으로 생성)`)) orderMut.mutate(checkedItems) }}
            disabled={orderMut.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
            🛒 발주 생성 ({checkedItems.length})
          </button>
        )}
      </div>

      <div className="text-[11px] text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
        긴급도 = <b>첫 부족월 − LT</b> 기준 · 셀 = 그 달 <b className="text-red-600">부족수량</b>(현재고·입고예정 차감 누적) / 회색 = 충족 소요
      </div>

      {/* 통합 표 */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
          <table className="text-xs whitespace-nowrap">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-500">
                <th className="px-2 py-2 text-left font-bold sticky left-0 bg-slate-100 z-20">
                  <span className="inline-flex items-center gap-1.5">
                    <input type="checkbox"
                      checked={checkedItems.length>0 && checkedItems.length===filtered.filter(it=>it.orderNeed>0).length}
                      onChange={e=>{ const on=e.target.checked; const nc={}; if(on) filtered.forEach(it=>{ if(it.orderNeed>0) nc[it.item_id]=true }); setChecked(nc) }}
                      className="w-3.5 h-3.5 accent-indigo-600" title="발주필요 전체 선택" />
                    긴급도 · 기준코드·품명
                  </span>
                </th>
                <th className="px-2 py-2 text-left font-bold">제조사</th>
                <th className="px-2 py-2 text-left font-bold">제조사품번</th>
                <th className="px-2 py-2 text-center font-bold">LT</th>
                <th className="px-2 py-2 text-right font-bold">현재고</th>
                <th className="px-2 py-2 text-right font-bold">발주필요</th>
                {months.map(m => <th key={m} className="px-2 py-2 text-right font-bold min-w-[58px]">{m.slice(2)}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.map(it => {
                const m = TIER_META[it.tier] || TIER_META['여유']
                return (
                  <tr key={it.item_id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-2 py-2 sticky left-0 bg-white z-10" style={{ borderLeft: `3px solid ${m.color}` }}>
                      <div className="flex items-center gap-1.5">
                        <input type="checkbox" checked={!!checked[it.item_id]} disabled={it.orderNeed<=0}
                          onChange={e=>setChecked(prev=>({...prev,[it.item_id]:e.target.checked}))}
                          className="w-3.5 h-3.5 accent-indigo-600 disabled:opacity-30" title={it.orderNeed>0?'발주 선택':'발주필요 없음'} />
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: m.bg, color: m.color }}>{m.icon}{it.tier}</span>
                        <span className="text-[10px] text-slate-400">{it.firstShort} 부족</span>
                      </div>
                      <div className="font-mono text-indigo-600 mt-0.5">{it.std_code}</div>
                      <div className="text-[11px] text-slate-400 max-w-[210px] truncate">{it.name}</div>
                      <div className="text-[10px] text-slate-400 max-w-[210px] truncate">{it.manufacturer}{it.manufacturer && it.vendor_name ? ' · ' : ''}{it.vendor_name}</div>
                    </td>
                    <td className="px-2 py-2 text-slate-600 max-w-[110px] truncate" title={it.manufacturer}>{it.manufacturer||'-'}</td>
                    <td className="px-2 py-2 font-mono text-[11px] text-slate-500 max-w-[120px] truncate" title={it.manufacturer_code}>{it.manufacturer_code||'-'}</td>
                    <td className="px-2 py-2 text-center"><span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">{it.lt_weeks}W</span></td>
                    <td className={`px-2 py-2 text-right ${it.current_stock < 0 ? 'text-rose-600 font-bold' : 'text-slate-600'}`}>{it.current_stock}</td>
                    <td className="px-2 py-2 text-right font-bold" style={{ color: it.orderNeed > 0 ? '#DC2626' : '#059669' }}>{it.orderNeed > 0 ? it.orderNeed : '충족'}</td>
                    {months.map(mo => {
                      const c = it.cells[mo]; const s = c?.shortage || 0
                      if (!c || (c.demand === 0 && s === 0)) return <td key={mo} className="px-2 py-2 text-right text-slate-200">·</td>
                      return (
                        <td key={mo} className={`px-2 py-2 text-right ${s > 0 ? 'bg-red-50 text-red-700 font-bold' : 'text-slate-500'}`}
                          title={`소요 ${Math.round(c.demand)}${c.incoming > 0 ? ` · 입고예정 ${Math.round(c.incoming)}` : ''} · 예상재고 ${Math.round(c.projected)}`}>
                          {s > 0 ? `-${s}` : (c.demand > 0 ? Math.round(c.demand) : '·')}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
