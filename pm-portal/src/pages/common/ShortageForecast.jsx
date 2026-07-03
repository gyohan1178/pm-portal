import { useState, useMemo, useCallback, useRef, memo } from 'react'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useCustomer } from '../../hooks/useCustomers'
import * as XLSX from 'xlsx'
import ShortageTabs from '../../components/ShortageTabs'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, fetchAllRows } from '../../lib/supabase'
import { getCategoryCode, getCategoryName, ITEM_CATEGORIES, quarterOf } from '../../lib/utils'

const CUSTOMERS = [
  { code: 'ax', name: 'AXCELIS' }, { code: 'ed', name: 'Edwards' },
  { code: 'vm', name: 'VM' }, { code: 'csk', name: 'CSK' },
]

const cellColor = (p) => p < 0 ? 'bg-red-50 text-red-600 font-bold' : p < 5 ? 'bg-amber-50 text-amber-700' : 'text-slate-600'

// 행 단위 메모이즈 — 제외 클릭 시 바뀐 행만 다시 그림(표 전체 재렌더 방지)
const ForecastRow = memo(function ForecastRow({ it, months, cols, period, metric, isExcluded, onExclude }) {
  return (
    <tr className={`border-b border-slate-100 hover:bg-slate-50 ${isExcluded ? 'opacity-40' : ''}`}>
      <td className="px-3 py-2 sticky left-0 bg-white z-10">
        <div className="font-mono text-indigo-600">{it.std_code}</div>
        <div className="text-[11px] text-slate-400 max-w-[180px] truncate">{it.name}</div>
        {(it.manufacturer || it.manufacturer_code) && (
          <div className="text-[10px] text-slate-400 max-w-[180px] truncate">
            {it.manufacturer}{it.manufacturer && it.manufacturer_code ? ' · ' : ''}<span className="font-mono">{it.manufacturer_code}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 mt-0.5">
          {it.vendor_name && <span className="text-[10px] text-slate-300">{it.vendor_name}</span>}
          {isExcluded ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-400" title="재계산 시 목록에서 빠집니다">제외됨 ✓ (재계산 대기)</span>
          ) : (
            <button onClick={() => onExclude(it.item_id, it.std_code)}
              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 hover:bg-rose-100 hover:text-rose-500 transition-colors"
              title="재고관리 대상에서 제외 (재계산 시 반영)">제외</button>
          )}
        </div>
      </td>
      <td className="px-2 py-2">
        {(() => {
          const cat = getCategoryName(getCategoryCode(it.js_code))
          return cat === '미분류'
            ? <span className="text-slate-300 text-[10px]">-</span>
            : <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold whitespace-nowrap">{cat}</span>
        })()}
      </td>
      <td className="px-2 py-2 text-right text-slate-600">
        {it.current_stock < 0
          ? <span className="text-rose-600 font-bold" title="음수 재고 — 재고현황에서 정리 필요">⚠{it.current_stock}</span>
          : it.current_stock}
      </td>
      <td className="px-2 py-2 text-center text-slate-400">{it.lt_weeks || '-'}W</td>
      <td className="px-2 py-2 text-center">
        {it.firstShortage
          ? <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 text-[10px] font-bold">{it.firstShortage.slice(2)}</span>
          : <span className="text-emerald-500 text-[10px]">✓</span>}
      </td>
      {cols.map(col => {
        const ms = period === 'quarter' ? months.filter(m => quarterOf(m) === col) : [col]
        const cc = ms.map(m => it.cells[m]).filter(Boolean)
        if (!cc.length) return <td key={col} className="px-2 py-2 text-right text-slate-200">·</td>
        const demand = cc.reduce((s, c) => s + (Number(c.demand) || 0), 0)
        const incoming = cc.reduce((s, c) => s + (Number(c.incoming) || 0), 0)
        const projected = cc[cc.length - 1].projected   // 분기는 분기말 예상재고
        if (metric === 'all') {
          return (
            <td key={col} className="px-2 py-1.5 text-right leading-tight" title={`소요 ${Math.round(demand)} / 입고예정 ${Math.round(incoming)} / 예상재고 ${Math.round(projected)}`}>
              <div className="text-[10px] text-slate-500">소요 {Math.round(demand)}</div>
              <div className="text-[10px] text-emerald-600">입고 {Math.round(incoming)}</div>
              <div className={`text-[11px] font-bold ${projected < 0 ? 'text-red-600' : projected < 5 ? 'text-amber-600' : 'text-slate-700'}`}>{Math.round(projected)}</div>
            </td>
          )
        }
        if (metric === 'demand') {
          return (
            <td key={col} className="px-2 py-2 text-right text-slate-700" title={`소요 ${Math.round(demand)}${incoming > 0 ? ` · 입고 ${Math.round(incoming)}` : ''}`}>
              {demand ? Math.round(demand) : <span className="text-slate-200">·</span>}
            </td>
          )
        }
        return (
          <td key={col} className={`px-2 py-2 text-right ${cellColor(projected)}`} title={`소요 ${Math.round(demand)} / 입고 ${Math.round(incoming)}`}>
            {Math.round(projected)}
            {incoming > 0 && <span className="text-[9px] text-emerald-500 ml-0.5">+{Math.round(incoming)}</span>}
          </td>
        )
      })}
    </tr>
  )
})

async function fetchForecastShortage(csId) {
  if (!csId) return { rows: [], computedAt: null }
  // 캐시 테이블 병렬 로딩 + meta 동시 조회
  const [all, metaRes] = await Promise.all([
    fetchAllRows('forecast_shortage_cache', { eq: { customer_id: csId } }),
    supabase.from('forecast_shortage_meta').select('computed_at').eq('customer_id', csId).maybeSingle(),
  ])
  // 세부구분용 js_code를 item_id로 조인 (캐시엔 없음)
  const ids = [...new Set(all.map(r => r.item_id))]
  const jsMap = {}
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from('items').select('id,js_code').in('id', ids.slice(i, i + 300))
    ;(data || []).forEach(x => { jsMap[x.id] = x.js_code })
  }
  all.forEach(r => { r.js_code = jsMap[r.item_id] || null })
  return { rows: all, computedAt: metaRes.data?.computed_at || null }
}

const thisMonth = () => new Date().toISOString().slice(0, 7)
const monthsAhead = (n) => {
  const d = new Date(); d.setMonth(d.getMonth() + n)
  return d.toISOString().slice(0, 7)
}

export default function ShortageForecast() {
  const navigate = useNavigate()
  const [csCode, setCsCode] = useState('ax')
  const [search, setSearch] = useState('')
  const [onlyRisk, setOnlyRisk] = useState(true)
  const [period, setPeriod] = useState('month')   // month | quarter
  const [metric, setMetric] = useState('stock')   // stock(예상재고) | demand(소요량)
  const [catSel, setCatSel] = useState(() => new Set())  // 선택된 카테고리(다중)
  const [preorder, setPreorder] = useState(false)        // 선발주 모드(장납기+부족, 데드라인순)
  const [ltThreshold, setLtThreshold] = useState(8)      // 장납기 기준 LT(주)
  const [selMat, setSelMat] = useState(() => new Set())  // 선발주: 선택한 자재(item_id)
  const [excluded, setExcluded] = useState(new Set())  // 방금 제외한 항목(재계산 전까지 표시)

  const qc = useQueryClient()
  const { data: cs } = useCustomer(csCode)
  const { data: cache = { rows: [], computedAt: null }, isLoading } = useQuery({
    queryKey: ['forecastShortage', cs?.id], queryFn: () => fetchForecastShortage(cs?.id), enabled: !!cs?.id,
  })
  const rows = cache.rows

  const refreshMut = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('refresh_shortage_cache', { cs_id: cs.id }); if (error) throw error },
    onSuccess: () => { setExcluded(new Set()); qc.invalidateQueries(['forecastShortage', cs?.id]) },
    onError: (e) => toastError('재계산 오류: ' + e.message),
  })
  // 제외 처리 — 연속 클릭 지원. useCallback([])로 고정해 행 memo가 깨지지 않게 함
  const excludedRef = useRef(excluded)
  excludedRef.current = excluded
  const handleExclude = useCallback((itemId, stdCode) => {
    if (excludedRef.current.has(itemId)) return
    if (!window.confirm(`${stdCode}를 재고관리 제외할까요?\n재계산하면 쇼티지 예측에서 빠집니다.`)) return
    setExcluded(prev => new Set(prev).add(itemId))
    supabase.from('items').update({ stock_managed: false }).eq('id', itemId)
      .then(({ error }) => {
        if (error) {
          toastError('제외 실패: ' + error.message)
          setExcluded(prev => { const n = new Set(prev); n.delete(itemId); return n })
        }
      })
  }, [])

  // 부품별로 묶기 (월 타임라인)
  const { items, months, summary } = useMemo(() => {
    const monthSet = new Set(), map = {}
    rows.forEach(r => {
      monthSet.add(r.year_month)
      if (!map[r.item_id]) map[r.item_id] = {
        item_id: r.item_id, std_code: r.std_code, name: r.name, unit: r.unit, js_code: r.js_code,
        lt_weeks: r.lt_weeks, vendor_name: r.vendor_name, current_stock: r.current_stock,
        manufacturer: r.manufacturer, manufacturer_code: r.manufacturer_code,
        parents: r.parents, cells: {},
      }
      map[r.item_id].cells[r.year_month] = { demand: r.demand, incoming: r.incoming, projected: r.projected }
    })
    const months = [...monthSet].sort()
    let list = Object.values(map)
    // 각 부품의 첫 쇼티지 월 계산
    list.forEach(it => {
      let firstNeg = null
      for (const m of months) {
        const c = it.cells[m]
        if (c && c.projected < 0) { firstNeg = m; break }
      }
      it.firstShortage = firstNeg
      it.minProjected = Math.min(...months.map(m => it.cells[m]?.projected ?? Infinity).filter(x => x !== Infinity))
      // 발주 데드라인 = 첫 부족월 − LT(주→월), 부족수량 = 최저 예상재고의 절대값
      const ltM = Math.ceil((it.lt_weeks || 0) / 4)
      if (firstNeg) { const d = new Date(firstNeg + '-01'); d.setMonth(d.getMonth() - ltM); it.orderDeadline = d.toISOString().slice(0, 7) }
      else it.orderDeadline = null
      it.shortageQty = it.minProjected < 0 ? Math.round(-it.minProjected) : 0
    })
    // 요약
    const horizon3 = monthsAhead(3)
    const risk = list.filter(it => it.firstShortage)
    const within3 = risk.filter(it => it.firstShortage <= horizon3)
    // 지금 발주해야 하는 것: 쇼티지월 − LT < 현재 (LT 주 → 월 근사)
    const urgent = within3.filter(it => {
      if (!it.firstShortage) return false
      const ltMonths = Math.ceil((it.lt_weeks || 0) / 4)
      const d = new Date(it.firstShortage + '-01'); d.setMonth(d.getMonth() - ltMonths)
      return d.toISOString().slice(0, 7) <= thisMonth()
    })
    return { items: list, months, summary: { risk: risk.length, within3: within3.length, urgent: urgent.length } }
  }, [rows])

  // 상위품목(parents) 코드 → 품명 매핑
  const parentCodes = useMemo(() => {
    const set = new Set()
    for (const r of rows) String(r.parents || '').split(',').map(s => s.trim()).filter(Boolean).forEach(c => set.add(c))
    return [...set]
  }, [rows])
  const { data: parentNames = {} } = useQuery({
    queryKey: ['parentNames', csCode, parentCodes.length],
    enabled: parentCodes.length > 0,
    queryFn: async () => {
      const map = {}
      for (let i = 0; i < parentCodes.length; i += 300) {
        const { data } = await supabase.from('items').select('std_code,name').in('std_code', parentCodes.slice(i, i + 300))
        ;(data || []).forEach(it => { map[it.std_code] = it.name })
      }
      return map
    },
  })

  // 데이터에 실제 존재하는 카테고리만 (칩으로 표시)
  const availableCats = useMemo(() => {
    const present = new Set(items.map(it => getCategoryCode(it.js_code)).filter(Boolean))
    return ITEM_CATEGORIES.filter(c => present.has(c.code))
  }, [items])

  const filtered = useMemo(() => {
    let list = onlyRisk ? items.filter(it => it.firstShortage) : items
    if (catSel.size) list = list.filter(it => catSel.has(getCategoryCode(it.js_code)))
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(it => it.std_code.toLowerCase().includes(q) || (it.name || '').toLowerCase().includes(q) || (it.manufacturer || '').toLowerCase().includes(q) || (it.manufacturer_code || '').toLowerCase().includes(q))
    }
    // 선발주 모드: 장납기(LT≥기준) + 부족 품목만, 발주 데드라인 임박순
    if (preorder) {
      list = list.filter(it => it.firstShortage && (it.lt_weeks || 0) >= ltThreshold)
      return [...list].sort((a, b) => (a.orderDeadline || '9999').localeCompare(b.orderDeadline || '9999'))
    }
    // 쇼티지 임박순
    return list.sort((a, b) => (a.firstShortage || '9999') < (b.firstShortage || '9999') ? -1 : 1)
  }, [items, search, onlyRisk, catSel, preorder, ltThreshold])

  // 선발주: 선택한 자재 + 그 자재가 들어간 ASSY (코드순)
  const selectedMats = useMemo(() => filtered.filter(it => selMat.has(it.item_id)), [filtered, selMat])
  const assyResult = useMemo(() => {
    const pmap = {}
    for (const it of selectedMats) {
      const parents = String(it.parents || '').split(',').map(s => s.trim()).filter(Boolean)
      for (const p of (parents.length ? parents : ['(상위미상)'])) {
        if (!pmap[p]) pmap[p] = { parent: p, mats: [], deadline: '9999-99' }
        pmap[p].mats.push(it)
        if (it.orderDeadline && it.orderDeadline < pmap[p].deadline) pmap[p].deadline = it.orderDeadline
      }
    }
    return Object.values(pmap).sort((a, b) => a.parent.localeCompare(b.parent))  // ASSY 코드순
  }, [selectedMats])

  const toggleCat = (code) => setCatSel(prev => {
    const n = new Set(prev)
    n.has(code) ? n.delete(code) : n.add(code)
    return n
  })

  const cols = period === 'quarter' ? [...new Set(months.map(quarterOf))].sort() : months

  function exportAuditTemplate() {
    try {
      if (!filtered.length) { toastError('내보낼 데이터가 없습니다'); return }
      const data = filtered.map(it => ({
        '기준코드': it.std_code,
        '품명': it.name || '',
        '세부구분': getCategoryName(getCategoryCode(it.js_code)),
        '제조사': it.manufacturer || '',
        '제조사품번': it.manufacturer_code || '',
        '현재고(참고)': Number(it.current_stock) || 0,
        '실사수량': '',
      }))
      const ws = XLSX.utils.json_to_sheet(data)
      ws['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 11 }, { wch: 10 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '실사')
      XLSX.writeFile(wb, `소요기준_실사양식_${new Date().toISOString().split('T')[0]}.xlsx`)
    } catch (e) {
      toastError('엑셀 생성 오류: ' + (e?.message || e))
    }
  }

  function exportPreorder() {
    try {
      if (!selectedMats.length) { toastError('자재를 먼저 선택하세요'); return }
      // 시트1: 선택 자재가 들어간 ASSY (코드순) — 고객사 선발주 제안
      const s1 = assyResult.map(g => {
        const mats = [...g.mats].sort((a, b) => (a.orderDeadline || '9999-99').localeCompare(b.orderDeadline || '9999-99'))
        return {
          '상위품목': g.parent,
          '상위품목명': parentNames[g.parent] || '',
          'PO 필요시점': g.deadline === '9999-99' ? '' : g.deadline.slice(2),
          '관련 장납기자재': mats.map(m => m.std_code).join(', '),
          '자재 수': g.mats.length,
        }
      })
      // 시트2: 선택한 자재 상세
      const s2 = selectedMats.map(it => ({
        '기준코드': it.std_code, '품명': it.name || '', '제조사': it.manufacturer || '', '제조사품번': it.manufacturer_code || '', '구매처': it.vendor_name || '',
        'LT(주)': it.lt_weeks || '', '첫부족월': it.firstShortage ? it.firstShortage.slice(2) : '',
        '발주데드라인': it.orderDeadline ? it.orderDeadline.slice(2) : '', '부족수량': it.shortageQty || 0,
        '현재고': Number(it.current_stock) || 0, '들어간ASSY': it.parents || '',
      }))
      const wb = XLSX.utils.book_new()
      const ws1 = XLSX.utils.json_to_sheet(s1); ws1['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 11 }, { wch: 40 }, { wch: 7 }]
      ws1['!autofilter'] = { ref: `A1:E${s1.length + 1}` }
      XLSX.utils.book_append_sheet(wb, ws1, '선발주제안_ASSY')
      const ws2 = XLSX.utils.json_to_sheet(s2); ws2['!cols'] = [{ wch: 14 }, { wch: 26 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 7 }, { wch: 9 }, { wch: 11 }, { wch: 9 }, { wch: 9 }, { wch: 24 }]
      XLSX.utils.book_append_sheet(wb, ws2, '선택자재')
      XLSX.writeFile(wb, `선발주제안_ASSY_${new Date().toISOString().split('T')[0]}.xlsx`)
    } catch (e) { toastError('엑셀 생성 오류: ' + (e?.message || e)) }
  }

  function exportExcel() {
    try {
      if (!filtered.length) { toastError('내보낼 데이터가 없습니다'); return }
      const periodLabel = period === 'quarter' ? '분기' : '월'
      const fixed = ['기준코드', '품명', '세부구분', '제조사', '제조사품번', '구매처', '현재고', 'LT(주)', '첫부족월']
      const today = new Date().toISOString().split('T')[0]

      // 3분할(소요·입고·과부족): 품목 1행, 월마다 3칸, 월 병합헤더 + 과부족 음수 빨강
      if (metric === 'all') {
        const NF = fixed.length  // 고정열 수(9)
        const row0 = [...fixed, ...cols.flatMap(c => [c.slice(2), '', ''])]
        const row1 = [...fixed.map(() => ''), ...cols.flatMap(() => ['소요', '입고', '과부족'])]
        const aoa = [row0, row1]
        for (const it of filtered) {
          const vals = cols.flatMap(col => {
            const ms = period === 'quarter' ? months.filter(m => quarterOf(m) === col) : [col]
            const cc = ms.map(m => it.cells[m]).filter(Boolean)
            if (!cc.length) return ['', '', '']
            const demand = cc.reduce((s, c) => s + (Number(c.demand) || 0), 0)
            const incoming = cc.reduce((s, c) => s + (Number(c.incoming) || 0), 0)
            const projected = cc[cc.length - 1].projected
            return [Math.round(demand), Math.round(incoming), Math.round(projected)]
          })
          aoa.push([
            it.std_code, it.name || '', getCategoryName(getCategoryCode(it.js_code)), it.manufacturer || '', it.manufacturer_code || '', it.vendor_name || '',
            Number(it.current_stock) || 0, it.lt_weeks || '', it.firstShortage ? it.firstShortage.slice(2) : '',
            ...vals,
          ])
        }
        const ws = XLSX.utils.aoa_to_sheet(aoa)
        ws['!cols'] = [{ wch: 14 }, { wch: 26 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 9 }, { wch: 7 }, { wch: 9 }, ...cols.flatMap(() => [{ wch: 7 }, { wch: 7 }, { wch: 8 }])]
        ws['!freeze'] = { xSplit: 1, ySplit: 2 }
        // 병합: 고정열은 세로 2행 병합, 월은 가로 3칸 병합
        const merges = []
        for (let c = 0; c < NF; c++) merges.push({ s: { r: 0, c }, e: { r: 1, c } })
        cols.forEach((_, i) => { const c = NF + i * 3; merges.push({ s: { r: 0, c }, e: { r: 0, c: c + 2 } }) })
        ws['!merges'] = merges
        // 숫자서식: 소요/입고 일반, 과부족 음수 빨강
        const R = XLSX.utils.decode_range(ws['!ref'])
        for (let r = 2; r <= R.e.r; r++) {
          const cs = ws[XLSX.utils.encode_cell({ r, c: 6 })]; if (cs && typeof cs.v === 'number') cs.z = '#,##0'
          cols.forEach((_, i) => {
            const base = NF + i * 3
            for (let k = 0; k < 3; k++) {
              const cell = ws[XLSX.utils.encode_cell({ r, c: base + k })]
              if (cell && typeof cell.v === 'number') cell.z = k === 2 ? '#,##0;[Red]-#,##0' : '#,##0'
            }
          })
        }
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, '쇼티지예측')
        XLSX.writeFile(wb, `쇼티지예측_소요입고과부족_${periodLabel}별_${today}.xlsx`)
        return
      }

      const metricLabel = metric === 'demand' ? '소요량' : '예상재고'
      const head = [...fixed, ...cols.map(c => c.slice(2))]
      const aoa = [head]
      for (const it of filtered) {
        const vals = cols.map(col => {
          const ms = period === 'quarter' ? months.filter(m => quarterOf(m) === col) : [col]
          const cc = ms.map(m => it.cells[m]).filter(Boolean)
          if (!cc.length) return ''
          const demand = cc.reduce((s, c) => s + (Number(c.demand) || 0), 0)
          const projected = cc[cc.length - 1].projected
          return Math.round(metric === 'demand' ? demand : projected)
        })
        aoa.push([
          it.std_code, it.name || '', getCategoryName(getCategoryCode(it.js_code)), it.manufacturer || '', it.manufacturer_code || '', it.vendor_name || '',
          Number(it.current_stock) || 0, it.lt_weeks || '', it.firstShortage ? it.firstShortage.slice(2) : '',
          ...vals,
        ])
      }
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      ws['!cols'] = [{ wch: 14 }, { wch: 26 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 9 }, { wch: 7 }, { wch: 9 }, ...cols.map(() => ({ wch: 8 }))]
      ws['!freeze'] = { xSplit: 1, ySplit: 1 }
      const R = XLSX.utils.decode_range(ws['!ref'])
      for (let r = 1; r <= R.e.r; r++) {
        for (let c = 9; c <= R.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })]
          if (cell && typeof cell.v === 'number') cell.z = '#,##0'
        }
      }
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '쇼티지예측')
      XLSX.writeFile(wb, `쇼티지예측_${metricLabel}_${periodLabel}별_${today}.xlsx`)
    } catch (e) {
      toastError('엑셀 생성 오류: ' + (e?.message || e))
    }
  }

  return (
    <div className="space-y-4">
      <ShortageTabs cs={csCode} />
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">🔮 소요 예측</h1>
          <p className="text-xs text-slate-400 mt-0.5">포캐스트 × BOM 전개 − 재고 − 입고예정 · 약속일 1개월 전 재고 확보 기준</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">
            {cache.computedAt ? `계산: ${new Date(cache.computedAt).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}` : '미계산'}
          </span>
          <button onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending || !cs?.id}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-200 text-indigo-600 bg-white hover:bg-indigo-50 disabled:opacity-40">
            {refreshMut.isPending ? '계산 중...' : '↻ 재계산'}
          </button>
        </div>
      </div>

      {/* 고객사 탭 */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {CUSTOMERS.map(c => (
          <button key={c.code} onClick={() => { setCsCode(c.code); setExcluded(new Set()) }}
            className={`px-4 py-1.5 text-xs font-semibold rounded-lg ${csCode === c.code ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{c.name}</button>
        ))}
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-1">🚨 지금 발주 필요</p>
          <p className="text-2xl font-bold text-red-600">{summary.urgent}</p>
          <p className="text-[11px] text-red-400 mt-0.5">LT 고려 시 이미 늦거나 임박</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-bold text-amber-500 uppercase tracking-wide mb-1">⚠️ 3개월 내 쇼티지</p>
          <p className="text-2xl font-bold text-amber-700">{summary.within3}</p>
          <p className="text-[11px] text-amber-500 mt-0.5">~{monthsAhead(3)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">전체 쇼티지 예상</p>
          <p className="text-2xl font-bold text-slate-700">{summary.risk}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">예측 기간 내</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="품번·품명·제조사품번 검색"
          className="w-full sm:w-72 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <label className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
          <input type="checkbox" checked={onlyRisk} onChange={e => setOnlyRisk(e.target.checked)} /> 쇼티지 예상만
        </label>
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-bold">
          <button onClick={()=>setPeriod('month')} className={`px-2.5 py-2 ${period==='month'?'bg-indigo-600 text-white':'bg-white text-slate-500 hover:bg-slate-50'}`}>월별</button>
          <button onClick={()=>setPeriod('quarter')} className={`px-2.5 py-2 ${period==='quarter'?'bg-indigo-600 text-white':'bg-white text-slate-500 hover:bg-slate-50'}`}>분기별</button>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-bold">
          <button onClick={()=>setMetric('stock')} className={`px-2.5 py-2 ${metric==='stock'?'bg-slate-700 text-white':'bg-white text-slate-500 hover:bg-slate-50'}`}>예상재고</button>
          <button onClick={()=>setMetric('demand')} className={`px-2.5 py-2 ${metric==='demand'?'bg-slate-700 text-white':'bg-white text-slate-500 hover:bg-slate-50'}`}>소요량</button>
          <button onClick={()=>setMetric('all')} className={`px-2.5 py-2 ${metric==='all'?'bg-slate-700 text-white':'bg-white text-slate-500 hover:bg-slate-50'}`}>소요·입고·과부족</button>
        </div>
        <button onClick={exportExcel} title="현재 목록을 엑셀로 (품목 1행 · 현재 보기 기준)"
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">📥 엑셀</button>
        <button onClick={exportAuditTemplate} title="현재 목록을 실사양식으로 (현재고+실사수량 빈칸) — 채워서 재고현황 실사 업로드에 올리면 반영"
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border border-sky-300 text-sky-700 bg-sky-50 hover:bg-sky-100">🧮 실사용</button>
        <button onClick={() => setPreorder(p => !p)} title="장납기(LT≥기준) 부족 품목만, 발주 데드라인 임박순"
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg border ${preorder ? 'border-orange-400 bg-orange-500 text-white' : 'border-orange-300 text-orange-700 bg-orange-50 hover:bg-orange-100'}`}>🚚 선발주</button>
        {preorder && (
          <label className="flex items-center gap-1 text-xs text-slate-500 font-semibold">
            LT≥<input type="number" value={ltThreshold} onChange={e => setLtThreshold(Number(e.target.value) || 0)}
              className="w-14 px-1.5 py-1.5 text-right border border-slate-200 rounded" />주
          </label>
        )}
        <span className="text-xs text-slate-400 ml-auto">{filtered.length}건</span>
      </div>

      {preorder && (
        <div className="space-y-3">
          {/* ① 자재 선택 */}
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-3">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
              <p className="text-xs font-bold text-orange-700">① 선발주할 장납기 자재 선택 (LT≥{ltThreshold}주 · {filtered.length}건) — 위 검색창으로 좁히기</p>
              <div className="flex gap-1.5">
                <button onClick={() => setSelMat(new Set(filtered.map(it => it.item_id)))} className="text-[11px] px-2 py-1 rounded border border-orange-300 text-orange-700 bg-white hover:bg-orange-100">전체선택</button>
                <button onClick={() => setSelMat(new Set())} className="text-[11px] px-2 py-1 rounded border border-slate-200 text-slate-500 bg-white hover:bg-slate-50">해제</button>
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-0.5 bg-white rounded-lg border border-orange-100 p-2">
              {filtered.length === 0 ? <p className="text-xs text-slate-400 py-2 text-center">대상 없음 — LT 기준을 낮춰보세요.</p>
                : filtered.map(it => (
                  <label key={it.item_id} className="flex items-center gap-2 text-xs px-1.5 py-1 rounded hover:bg-orange-50 cursor-pointer">
                    <input type="checkbox" checked={selMat.has(it.item_id)} onChange={() => setSelMat(s => { const n = new Set(s); n.has(it.item_id) ? n.delete(it.item_id) : n.add(it.item_id); return n })} className="accent-orange-500" />
                    <span className="font-mono font-bold text-slate-700 w-28 shrink-0">{it.std_code}</span>
                    <span className="text-slate-500 flex-1 truncate min-w-[100px]">{it.name}</span>
                    <span className="text-slate-400 w-40 shrink-0 truncate">{it.manufacturer || ''}{it.manufacturer && it.manufacturer_code ? ' · ' : ''}<span className="font-mono">{it.manufacturer_code || ''}</span></span>
                    <span className="text-slate-400 shrink-0 w-16 text-right">LT {it.lt_weeks || '-'}주</span>
                    <span className="text-orange-600 font-semibold w-14 text-right shrink-0">{it.orderDeadline ? it.orderDeadline.slice(2) : '-'}</span>
                  </label>
                ))}
            </div>
          </div>

          {/* ② 선택한 자재가 들어간 ASSY */}
          {selMat.size > 0 && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                <p className="text-xs font-bold text-indigo-700">② 선택 자재가 들어간 ASSY — {assyResult.length}건 (코드순) · 선택자재 {selMat.size}</p>
                <button onClick={exportPreorder} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">📋 엑셀 (고객사 제안)</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {assyResult.map(g => (
                  <span key={g.parent} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white border border-indigo-200 text-xs">
                    <span className="font-mono font-bold text-slate-700">{g.parent}</span>
                    {parentNames[g.parent] && <span className="text-slate-400 max-w-[140px] truncate">{parentNames[g.parent]}</span>}
                    <span className="text-indigo-600 font-semibold">{g.deadline === '9999-99' ? '-' : g.deadline.slice(2) + '까지'}</span>
                    <span className="text-slate-300">자재 {g.mats.length}</span>
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">선택한 자재가 들어간 ASSY만 표시. 이 ASSY들을 PO 필요시점까지 선발주 요청 → 장납기 자재 제때 발주.</p>
            </div>
          )}
        </div>
      )}

      {/* 카테고리 다중선택 (JS- 코드 전환 후 자동 표시) */}
      {availableCats.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-slate-400 font-semibold mr-1">카테고리</span>
          {availableCats.map(c => {
            const on = catSel.has(c.code)
            return (
              <button key={c.code} onClick={() => toggleCat(c.code)} title={c.desc}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-full border transition-colors ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
                {c.name}
              </button>
            )
          })}
          {catSel.size > 0 && (
            <button onClick={() => setCatSel(new Set())} className="px-2 py-1 text-[11px] text-slate-400 hover:text-slate-600">초기화</button>
          )}
        </div>
      )}

      {!preorder && (isLoading ? <div className="text-center py-12 text-slate-400 text-sm">예측 계산 중...</div>
        : filtered.length === 0
          ? <div className="text-center py-16 text-slate-300 text-sm">
              {items.length === 0 ? '포캐스트가 없습니다. 먼저 포캐스트를 접수해주세요.' : '쇼티지 예상 품목이 없습니다 👍'}
            </div>
          : <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
                <table className="text-xs whitespace-nowrap">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-slate-100 border-b border-slate-200 text-slate-500">
                      <th className="px-3 py-2 text-left font-bold sticky left-0 bg-slate-100 z-20">품번 · 품명</th>
                      <th className="px-2 py-2 text-left font-bold">세부구분</th>
                      <th className="px-2 py-2 text-right font-bold">현재고</th>
                      <th className="px-2 py-2 text-center font-bold">LT</th>
                      <th className="px-2 py-2 text-center font-bold">쇼티지</th>
                      {(period==='quarter' ? [...new Set(months.map(quarterOf))].sort() : months).map(c => <th key={c} className="px-2 py-2 text-right font-bold min-w-[58px]">{c.slice(2)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(it => (
                      <ForecastRow key={it.item_id} it={it} months={months} cols={period==='quarter' ? [...new Set(months.map(quarterOf))].sort() : months} period={period} metric={metric}
                        isExcluded={excluded.has(it.item_id)} onExclude={handleExclude} />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-400 flex gap-4 flex-wrap">
                <span>숫자 = 월말 예상재고</span>
                <span className="text-red-500">● 빨강 = 부족(마이너스)</span>
                <span className="text-amber-600">● 주황 = 임박(5 미만)</span>
                <span className="text-emerald-500">+N = 그 달 입고예정</span>
              </div>
            </div>)}
    </div>
  )
}
