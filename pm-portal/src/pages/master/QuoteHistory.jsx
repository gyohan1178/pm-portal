import { useState, useMemo } from 'react'
import { useDebounced } from '../../hooks/useDebounced'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../lib/activityLog'
import { fetchAll } from '../../lib/paginate'
import { toastError, toastSuccess } from '../../lib/toast'
import { ResizableTable } from '../../components/ResizableTable'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const won = (v) => Math.round(num(v)).toLocaleString('ko-KR')
const amt = (v, cur) =>
  cur === 'KRW' ? '₩' + won(v) : '$' + num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (v) => (v == null ? '-' : (num(v) * 100).toFixed(1) + '%')

// 품번별 보기 컬럼 — 마우스로 너비 조정 가능 (localStorage 저장)
const ITEM_COLS = [
  { key: 'code',   label: '품번',          defaultWidth: 150 },
  { key: 'name',   label: '품명',          defaultWidth: 240 },
  { key: 'price',  label: '최근 단가',      defaultWidth: 110, align: 'right' },
  { key: 'buy',    label: '자재비/매입가',  defaultWidth: 120, align: 'right' },
  { key: 'labor',  label: '작업비(원)',     defaultWidth: 100, align: 'right' },
  { key: 'margin', label: '마진율',        defaultWidth: 80,  align: 'right' },
  { key: 'po',     label: 'PO',           defaultWidth: 130, align: 'center' },
  { key: 'date',   label: '최근 견적일',    defaultWidth: 100, align: 'center' },
  { key: 'cnt',    label: '횟수',          defaultWidth: 60,  align: 'center' },
]

const STATUS = {
  draft: { label: '작성중', cls: 'bg-slate-100 text-slate-500' },
  sent:  { label: '제출',   cls: 'bg-sky-100 text-sky-700' },
  won:   { label: '수주',   cls: 'bg-emerald-100 text-emerald-700' },
  lost:  { label: '실주',   cls: 'bg-rose-100 text-rose-600' },
}

async function fetchQuotes(kind) {
  const rows = await fetchAll(() => supabase
    .from('pm_quotes')
    .select('id, quote_no, quote_kind, quote_date, currency, project_name, issued_to, total_amount, total_cost_krw, margin_pct, status, memo')
    .eq('quote_kind', kind)
    .order('quote_date', { ascending: false })
    .order('created_at', { ascending: false }).order('id', { ascending: true }))
  return rows
}

async function fetchItems(quoteIds) {
  if (!quoteIds.length) return []
  const out = []
  for (let i = 0; i < quoteIds.length; i += 100) {
    const part = await fetchAll(() => supabase
      .from('pm_quote_items')
      .select('quote_id, line_no, std_code, description, rev, unit, qty, unit_price, cost_krw, material_krw, labor_krw, vendor, line_kind')
      .in('quote_id', quoteIds.slice(i, i + 100))
      .order('line_no').order('id', { ascending: true }))
    out.push(...part)
  }
  return out
}

export default function QuoteHistory() {
  const qc = useQueryClient()
  const [kind, setKind] = useState('sales')
  const [view, setView] = useState('item')   // item = 품번별, quote = 견적별
  const [q, setQ] = useState('')
  // 목록이 커지면 한 글자마다 재계산되어 입력이 멈춘다
  const dq = useDebounced(q, 250)
  const [openId, setOpenId] = useState(null)
  // 마진율 계산용 판매환율 (외화 견적단가를 원화 원가와 비교)
  const [sellRate, setSellRate] = useState(() => {
    const v = Number(localStorage.getItem('pm_quote_sellrate'))
    return Number.isFinite(v) && v > 0 ? v : 1400
  })
  const isSales = kind === 'sales'

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ['quoteHistory', kind],
    queryFn: () => fetchQuotes(kind),
    staleTime: 60 * 1000,
  })

  const { data: items = [] } = useQuery({
    queryKey: ['quoteHistoryItems', kind, quotes.map((x) => x.id).join(',')],
    enabled: quotes.length > 0,
    queryFn: () => fetchItems(quotes.map((x) => x.id)),
    staleTime: 60 * 1000,
  })

  const qMap = useMemo(() => Object.fromEntries(quotes.map((x) => [x.id, x])), [quotes])

  // 품번별 관리 현황 — 매입가·작업비·마진율
  const allCodes = useMemo(
    () => [...new Set(items.map((i) => i.std_code).filter(Boolean))],
    [items])

  const { data: statusMap = {} } = useQuery({
    // 품목 수만 키로 쓰면 작업비가 바뀌어도 갱신되지 않는다
    queryKey: ['quoteItemStatus', kind, allCodes.join(',')],
    enabled: allCodes.length > 0 && kind === 'sales',
    queryFn: async () => {
      const out = {}
      for (let i = 0; i < allCodes.length; i += 200) {
        const { data, error } = await supabase.rpc('pm_quote_item_status', { p_codes: allCodes.slice(i, i + 200) })
        if (error) throw error
        ;(data || []).forEach((r) => { out[r.std_code] = r })
      }
      return out
    },
    staleTime: 60 * 1000,
  })

  // PO 조회 기간 (개월). null 이면 전체
  const [poMonths, setPoMonths] = useState(6)

  // 고객사 PO 접수 현황 — 견적이 수주로 이어졌는지
  const { data: poMap = {} } = useQuery({
    queryKey: ['quotePoStatus', allCodes.length, poMonths],
    enabled: allCodes.length > 0 && kind === 'sales',
    queryFn: async () => {
      const out = {}
      for (let i = 0; i < allCodes.length; i += 200) {
        const { data, error } = await supabase.rpc('pm_quote_po_status', {
          p_codes: allCodes.slice(i, i + 200), p_months: poMonths,
        })
        if (error) throw error
        ;(data || []).forEach((r) => { out[r.std_code] = r })
      }
      return out
    },
    staleTime: 60 * 1000,
  })

  // 견적 삭제 — 품목·작업비 이력까지 함께 정리된다
  async function deleteQuote(q) {
    if (!confirm(`${q.quote_no} 견적을 삭제할까요?\n\n· 견적 품목이 모두 삭제됩니다\n· 이 견적에서 기록된 작업비 이력도 삭제됩니다\n· 되돌릴 수 없습니다`)) return
    const { error } = await supabase.rpc('pm_delete_quote', { p_quote_id: q.id })
    if (error) { toastError('삭제 실패: ' + error.message); return }
    logActivity('delete', 'pm_quotes', q.quote_no, `견적 삭제 · ${q.issued_to || ''} ${q.quote_date || ''}`)
    toastSuccess(`${q.quote_no} 삭제됨`)
    qc.invalidateQueries({ queryKey: ['quoteHistory'], exact: false })
    qc.invalidateQueries({ queryKey: ['quoteHistoryItems'], exact: false })
    setOpenId(null)
  }

  // ASSY 자재비 — 어셈블리는 매입가가 없고 BOM 전개 합산이 원가다
  const { data: assyCost = {} } = useQuery({
    queryKey: ['assyMaterialCost', allCodes.length],
    enabled: allCodes.length > 0 && kind === 'sales',
    queryFn: async () => {
      const out = {}
      for (let i = 0; i < allCodes.length; i += 200) {
        const { data, error } = await supabase.rpc('pm_assy_material_cost', { p_codes: allCodes.slice(i, i + 200) })
        if (error) throw error
        ;(data || []).forEach((r) => { out[r.std_code] = r })
      }
      return out
    },
    staleTime: 60 * 1000,
  })

  // 매입가 저장 → items 마스터 갱신 (견적서 원가 계산에 바로 반영됨)
  async function savePurchasePrice(code, val) {
    const price = val === '' || val == null ? null : Number(val)
    const { error } = await supabase.from('items').update({ purchase_price: price }).eq('std_code', code)
    if (error) { toastError('매입가 저장 실패: ' + error.message); return }
    toastSuccess(`${code} 매입가 ${price == null ? '삭제' : won(price) + '원'}`)
    qc.invalidateQueries({ queryKey: ['quoteItemStatus'], exact: false })
  }

  // 작업비 저장 → pm_labor_costs 에 오늘 날짜로 기록.
  // 견적서에서 그 품번을 담으면 pm_labor_latest 가 이 값을 자동으로 불러온다.
  // 같은 날 다시 저장하면 덮어쓴다(upsert). 0 을 넣으면 오늘 기록을 지운다.
  async function saveLabor(code, val) {
    const today = new Date().toISOString().slice(0, 10)
    const labor = Number(val)

    if (val === '' || labor === 0) {
      const { error } = await supabase.from('pm_labor_costs')
        .delete().eq('std_code', code).eq('effective_date', today).eq('source', 'manual')
      if (error) { toastError('작업비 삭제 실패: ' + error.message); return }
      toastSuccess(`${code} 오늘 작업비 기록 삭제`)
      qc.invalidateQueries({ queryKey: ['quoteItemStatus'], exact: false })
      return
    }
    if (!Number.isFinite(labor) || labor < 0) { toastError('작업비는 숫자여야 합니다'); return }

    const { error } = await supabase.from('pm_labor_costs').upsert({
      std_code: code, labor_krw: labor,
      effective_date: today,
      source: 'manual', quote_no: null, memo: '견적이력에서 직접 입력',
    }, { onConflict: 'std_code,effective_date,source,quote_no' })
    if (error) { toastError('작업비 저장 실패: ' + error.message); return }
    toastSuccess(`${code} 작업비 ${won(labor)}원 저장 — 다음 견적에서 자동 적용`)
    qc.invalidateQueries({ queryKey: ['quoteItemStatus'], exact: false })
  }

  // 작업비 이력 조회 (행 펼쳤을 때)
  async function loadLaborHistory(code) {
    const { data, error } = await supabase.rpc('pm_labor_history', { p_code: code })
    if (error) { toastError('작업비 이력 조회 실패: ' + error.message); return [] }
    return data || []
  }

  // 품번별 — 같은 품번의 견적을 최신순으로 묶는다
  const byCode = useMemo(() => {
    const m = {}
    for (const it of items) {
      if (!it.std_code) continue
      const qq = qMap[it.quote_id]
      if (!qq) continue
      ;(m[it.std_code] ||= []).push({ ...it, quote: qq })
    }
    Object.values(m).forEach((arr) =>
      arr.sort((a, b) => String(b.quote.quote_date).localeCompare(String(a.quote.quote_date))))
    return m
  }, [items, qMap])

  const codeRows = useMemo(() => {
    const kw = dq.trim().toLowerCase()
    let rows = Object.entries(byCode).map(([code, list]) => ({
      code, list, latest: list[0], count: list.length,
    }))
    if (kw) {
      rows = rows.filter((r) =>
        r.code.toLowerCase().includes(kw) ||
        String(r.latest.description || '').toLowerCase().includes(kw))
    }
    return rows.sort((a, b) => a.code.localeCompare(b.code))
  }, [byCode, dq])

  const quoteRows = useMemo(() => {
    const kw = dq.trim().toLowerCase()
    if (!kw) return quotes
    return quotes.filter((x) =>
      [x.quote_no, x.project_name, x.issued_to, x.memo].some((v) => String(v || '').toLowerCase().includes(kw)))
  }, [quotes, dq])

  function exportXlsx() {
    const rows = buildExportRows()
    if (!rows.length) { toastError('내보낼 데이터가 없습니다'); return }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), isSales ? '매출견적이력' : '매입견적이력')
    XLSX.writeFile(wb, `견적이력_${isSales ? '매출' : '매입'}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  // 내보낼 행 만들기 (엑셀·CSV 공용)
  function buildExportRows() {
    return items.map((it) => {
      const qq = qMap[it.quote_id] || {}
      const st = statusMap[it.std_code] || {}
      const cost = num(st.purchase_price) + num(st.last_labor)
      const pk = qq.currency === 'KRW' ? num(it.unit_price) : num(it.unit_price) * num(sellRate)
      return {
        견적구분: qq.quote_kind === 'sales' ? '매출' : '매입',
        견적번호: qq.quote_no, 견적일: qq.quote_date,
        상대처: qq.issued_to, 건명: qq.project_name,
        품번: it.std_code, 품명: it.description || st.name || '', REV: it.rev,
        구분: it.line_kind === 'assy' ? 'ASSY' : '단품',
        수량: num(it.qty), 통화: qq.currency,
        단가: num(it.unit_price), 금액: num(it.qty) * num(it.unit_price),
        '자재비(원)': it.material_krw == null ? '' : num(it.material_krw),
        '작업비(원)': num(it.labor_krw),
        '원가(원)': it.cost_krw == null ? '' : num(it.cost_krw),
        '현재매입가(원)': num(st.purchase_price) || '',
        '현재작업비(원)': num(st.last_labor) || '',
        '현재원가(원)': cost || '',
        '견적단가(원)': Math.round(pk) || '',
        마진율: pk > 0 && cost > 0 ? ((pk - cost) / pk * 100).toFixed(1) + '%' : '',
        [`PO건수(${poMonths ? poMonths + 'M' : '전체'})`]: num(poMap[it.std_code]?.po_count) || '',
        'PO진행중': num(poMap[it.std_code]?.open_count) || '',
        'PO완료': num(poMap[it.std_code]?.done_count) || '',
        '최근PO번호': poMap[it.std_code]?.last_po_no || '',
        '최근PO일자': poMap[it.std_code]?.last_po_date || '',
        상태: STATUS[qq.status]?.label || qq.status,
      }
    })
  }

  // CSV — 엑셀에서 바로 열리도록 BOM 포함
  function exportCsv() {
    const rows = buildExportRows()
    if (!rows.length) { toastError('내보낼 데이터가 없습니다'); return }
    const keys = Object.keys(rows[0])
    const cell = (v) => {
      const t = String(v ?? '')
      return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t
    }
    const csv = '\uFEFF' + [keys.join(','), ...rows.map(r => keys.map(k => cell(r[k])).join(','))].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `견적이력_${isSales ? '매출' : '매입'}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toastSuccess(`CSV ${rows.length}행 내보냄`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">📋 견적 이력</h1>
          <p className="text-xs text-slate-400">저장된 견적을 품번별·견적별로 조회합니다. 매출과 매입은 절대 섞이지 않습니다.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} disabled={!items.length}
            className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            📄 CSV
          </button>
          <button onClick={exportXlsx} disabled={!items.length}
            className="px-3 py-2 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40">
            📑 엑셀 추출
          </button>
        </div>
      </div>

      {/* 매출/매입 + 보기 전환 */}
      <div className={`rounded-xl border-2 p-3 flex flex-wrap items-center gap-2 ${isSales ? 'border-indigo-300 bg-indigo-50/50' : 'border-amber-400 bg-amber-50/60'}`}>
        <div className="flex gap-1 bg-white rounded-lg p-1 border border-slate-200">
          {[['sales', '📤 매출견적'], ['purchase', '📥 매입견적']].map(([k, l]) => (
            <button key={k} onClick={() => { setKind(k); setOpenId(null) }}
              className={`px-3 py-1.5 text-xs font-bold rounded-md ${kind === k
                ? (k === 'sales' ? 'bg-indigo-600 text-white' : 'bg-amber-500 text-white')
                : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
          ))}
        </div>
        <div className="flex gap-1 bg-white rounded-lg p-1 border border-slate-200">
          {[['item', '품번별'], ['quote', '견적별']].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-3 py-1.5 text-xs font-bold rounded-md ${view === k ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>{l}</button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={view === 'item' ? '품번·품명 검색' : '견적번호·건명·상대처 검색'}
          className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg w-64" />
        {view === 'item' && isSales && (
          <label className="flex items-center gap-1 text-xs text-slate-500">
            PO 기간
            <select value={poMonths ?? ''} onChange={(e) => setPoMonths(e.target.value === '' ? null : Number(e.target.value))}
              className="px-1.5 py-1 text-xs border border-slate-200 rounded">
              {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{m}개월</option>)}
              <option value="">전체</option>
            </select>
          </label>
        )}
        {view === 'item' && isSales && (
          <label className="flex items-center gap-1 text-xs text-slate-500">
            판매환율
            <input type="number" value={sellRate}
              onChange={(e) => { const v = Number(e.target.value); setSellRate(v); localStorage.setItem('pm_quote_sellrate', String(v)) }}
              title="USD 견적단가를 원화 원가와 비교해 마진율을 계산합니다"
              className="w-20 px-2 py-1 text-xs text-right border border-slate-200 rounded" />
          </label>
        )}
        <span className="text-xs text-slate-500 ml-auto">
          견적 <b>{quotes.length}</b>건 · 품목 <b>{items.length}</b>행
        </span>
      </div>

      {isLoading && <p className="text-sm text-slate-400 py-8 text-center">불러오는 중…</p>}

      {/* 품번별 */}
      {!isLoading && view === 'item' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <ResizableTable cols={ITEM_COLS} storageKey="quote_hist_cols">
            {() => (
            <tbody>
              {codeRows.map((r) => (
                <FragRow key={r.code} r={r} st={statusMap[r.code]} assy={assyCost[r.code]} po={poMap[r.code]} rate={sellRate}
                  onSavePrice={savePurchasePrice} onSaveLabor={saveLabor} onLoadLabor={loadLaborHistory} />
              ))}
              {!codeRows.length && (
                <tr><td colSpan={ITEM_COLS.length} className="py-10 text-center text-slate-400">이력이 없습니다.</td></tr>
              )}
            </tbody>
            )}
          </ResizableTable>
        </div>
      )}

      {/* 견적별 */}
      {!isLoading && view === 'quote' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left w-28">견적번호</th>
                <th className="px-3 py-2 text-center w-24">일자</th>
                <th className="px-3 py-2 text-left">건명</th>
                <th className="px-3 py-2 text-left">상대처</th>
                <th className="px-3 py-2 text-right w-28">금액</th>
                {isSales && <th className="px-3 py-2 text-right w-20">마진율</th>}
                <th className="px-3 py-2 text-center w-20">상태</th>
                <th className="px-3 py-2 text-center w-14">삭제</th>
              </tr>
            </thead>
            <tbody>
              {quoteRows.map((x) => {
                const st = STATUS[x.status] || { label: x.status, cls: 'bg-slate-100 text-slate-500' }
                const lines = items.filter((it) => it.quote_id === x.id)
                const open = openId === x.id
                return (
                  <>
                    <tr key={x.id} onClick={() => setOpenId(open ? null : x.id)}
                      className="border-t border-slate-100 cursor-pointer hover:bg-indigo-50/40">
                      <td className={`px-3 py-2 font-mono font-bold ${isSales ? 'text-indigo-600' : 'text-amber-600'}`}>{x.quote_no}</td>
                      <td className="px-3 py-2 text-center text-slate-500">{x.quote_date}</td>
                      <td className="px-3 py-2 text-slate-700">{x.project_name || '-'}</td>
                      <td className="px-3 py-2 text-slate-500">{x.issued_to || '-'}</td>
                      <td className="px-3 py-2 text-right font-bold">{amt(x.total_amount, x.currency)}</td>
                      {isSales && <td className="px-3 py-2 text-right text-slate-600">{pct(x.margin_pct)}</td>}
                      <td className="px-3 py-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={(e) => { e.stopPropagation(); deleteQuote(x) }}
                          title="견적 삭제 — 품목과 작업비 이력도 함께 삭제됩니다"
                          className="px-1.5 py-0.5 text-[11px] rounded border border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-600">
                          삭제
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr key={x.id + '-d'} className="bg-slate-50/80">
                        <td colSpan={isSales ? 8 : 7} className="px-4 py-3">
                          <p className="text-[11px] font-bold text-slate-500 mb-1.5">품목 {lines.length}건</p>
                          <table className="w-full text-[11px]">
                            <thead className="text-slate-400">
                              <tr>
                                <th className="text-left py-1 w-8">NO</th>
                                <th className="text-left">품번</th>
                                <th className="text-left">품명</th>
                                <th className="text-right w-14">수량</th>
                                <th className="text-right w-24">단가</th>
                                <th className="text-right w-24">금액</th>
                                {isSales && <th className="text-right w-24">작업비(원)</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {lines.map((it) => (
                                <tr key={it.quote_id + '-' + it.line_no} className="border-t border-slate-200/60">
                                  <td className="py-1 text-slate-400">{it.line_no}</td>
                                  <td className="py-1 font-mono">
                                    {it.std_code}
                                    {it.line_kind === 'assy' && <span className="ml-1 text-[9px] font-bold text-sky-600">ASSY</span>}
                                  </td>
                                  <td className="py-1 text-slate-600">{it.description}</td>
                                  <td className="py-1 text-right">{num(it.qty)}</td>
                                  <td className="py-1 text-right">{amt(it.unit_price, x.currency)}</td>
                                  <td className="py-1 text-right font-semibold">{amt(num(it.qty) * num(it.unit_price), x.currency)}</td>
                                  {isSales && <td className="py-1 text-right text-sky-700">{num(it.labor_krw) ? won(it.labor_krw) : '-'}</td>}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {x.memo && <p className="mt-2 text-[11px] text-slate-400">메모: {x.memo}</p>}
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
              {!quoteRows.length && (
                <tr><td colSpan={isSales ? 8 : 7} className="py-10 text-center text-slate-400">이력이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// 품번별 행 — 펼치면 그 품번의 견적 변동 이력
// 품번별 행 — 펼치면 단가 변동 이력. 매입가·작업비를 여기서 바로 수정한다.
function FragRow({ r, st, assy, po, rate, onSavePrice, onSaveLabor, onLoadLabor }) {
  const [open, setOpen] = useState(false)
  const [laborHist, setLaborHist] = useState(null)
  const [priceEdit, setPriceEdit] = useState(null)
  const [laborEdit, setLaborEdit] = useState(null)
  const L = r.latest
  const cur = L.quote.currency

  // ★ 어셈블리(ASSY)는 매입가가 없다. BOM 전개 합산이 자재비다.
  //   단품은 items.purchase_price 가 그대로 자재비.
  const isAssy = !!assy
  const buy = isAssy ? num(assy.material_krw) : num(st?.purchase_price)
  const labor = num(st?.last_labor)
  const cost = buy + labor
  const priceKrw = cur === 'KRW' ? num(L.unit_price) : num(L.unit_price) * num(rate)
  const margin = priceKrw > 0 && cost > 0 ? (priceKrw - cost) / priceKrw : null
  const marginCls = margin == null ? 'text-slate-300'
    : margin < 0 ? 'text-rose-600 font-bold'
    : margin < 0.15 ? 'text-amber-600 font-bold' : 'text-emerald-600 font-semibold'

  return (
    <>
      <tr className="border-t border-slate-100 hover:bg-indigo-50/40">
        <td className="px-3 py-2 font-mono text-indigo-600 cursor-pointer"
          onClick={() => {
            const next = !open
            setOpen(next)
            if (next && laborHist === null && onLoadLabor) onLoadLabor(r.code).then(setLaborHist)
          }}>
          {open ? '▾ ' : '▸ '}{r.code}
        </td>
        <td className="px-3 py-2 text-slate-600 max-w-[240px] truncate cursor-pointer" onClick={() => setOpen((v) => !v)}
          title={L.description || st?.name || ''}>
          {L.description || st?.name || <span className="text-slate-300">품명없음</span>}
        </td>
        <td className="px-3 py-2 text-right font-bold">{amt(L.unit_price, cur)}</td>

        {/* 자재비 — ASSY 는 BOM 합산(읽기전용), 단품은 매입가 직접 수정 */}
        <td className="px-3 py-2 text-right">
          {isAssy ? (
            <span className="inline-flex items-center gap-1" title={`BOM 부품 ${assy.part_count}건 합산${assy.no_price_count > 0 ? ` · 단가없음 ${assy.no_price_count}건` : ''}`}>
              <span className="px-1 py-0.5 rounded bg-sky-100 text-sky-700 text-[10px] font-bold">ASSY</span>
              <span className="font-semibold">{won(buy)}</span>
              {assy.no_price_count > 0 && (
                <span className="text-amber-600 text-[10px] font-bold">▲{assy.no_price_count}</span>
              )}
            </span>
          ) : (
            <input type="number" defaultValue={st?.purchase_price ?? ''} placeholder="미등록"
              onChange={(e) => setPriceEdit(e.target.value)}
              onBlur={(e) => { if (priceEdit !== null) { onSavePrice(r.code, e.target.value); setPriceEdit(null) } }}
              className={`w-24 px-1 py-0.5 text-right border rounded ${num(st?.purchase_price) > 0 ? 'border-slate-200' : 'border-amber-400 bg-amber-50'}`} />
          )}
        </td>

        {/* 작업비 — 직접 수정 */}
        <td className="px-3 py-2 text-right">
          <input type="number" defaultValue={st?.last_labor ?? ''} placeholder="—"
            onChange={(e) => setLaborEdit(e.target.value)}
            onBlur={(e) => { if (laborEdit !== null && e.target.value !== '') { onSaveLabor(r.code, e.target.value); setLaborEdit(null) } }}
            title={st?.labor_date ? `최근 ${st.labor_date}` : '작업비 이력 없음'}
            className="w-20 px-1 py-0.5 text-right border border-slate-200 rounded" />
        </td>

        {/* 마진율 */}
        <td className={`px-3 py-2 text-right ${marginCls}`}
          title={margin == null ? '매입가가 없어 계산 불가' : `견적 ${won(priceKrw)}원 − 원가 ${won(cost)}원`}>
          {margin == null ? '—' : (margin * 100).toFixed(1) + '%'}
        </td>

        {/* PO 접수 — 진행 / 완료 */}
        <td className="px-3 py-2 text-center whitespace-nowrap">
          {num(po?.po_count) > 0 ? (
            <span className="inline-flex gap-1"
              title={`PO ${po.po_count}건${po.last_po_no ? `\n최근 ${po.last_po_no} (${po.last_po_date || '-'})` : ''}`}>
              {num(po.open_count) > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">진행 {po.open_count}</span>
              )}
              {num(po.done_count) > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">완료 {po.done_count}</span>
              )}
            </span>
          ) : <span className="text-slate-300 text-[10px]" title="고객사 PO 없음 — 미수주">—</span>}
        </td>

        <td className="px-3 py-2 text-center text-slate-500">{L.quote.quote_date}</td>
        <td className="px-3 py-2 text-center">
          {r.count > 1
            ? <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold">{r.count}</span>
            : <span className="text-slate-400">1</span>}
        </td>
      </tr>

      {open && (
        <tr className="bg-slate-50/80">
          <td colSpan={9} className="px-4 py-3">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 단가 변동 이력 */}
              <div>
                <p className="text-[11px] font-bold text-slate-500 mb-1.5">견적단가 변동</p>
                <div className="space-y-1">
                  {r.list.map((it, i) => {
                    const prev = r.list[i + 1]
                    const diff = prev ? num(it.unit_price) - num(prev.unit_price) : null
                    return (
                      <div key={it.quote_id + '-' + it.line_no} className="flex items-center gap-3 text-[11px]">
                        <span className="w-20 text-slate-400">{it.quote.quote_date}</span>
                        <span className="w-24 font-mono text-slate-400">{it.quote.quote_no}</span>
                        <span className="w-20 text-right font-bold text-slate-700">{amt(it.unit_price, it.quote.currency)}</span>
                        {diff != null && (
                          <span className={`w-16 text-right font-semibold ${diff > 0 ? 'text-rose-500' : diff < 0 ? 'text-sky-600' : 'text-slate-300'}`}>
                            {diff > 0 ? '▲' : diff < 0 ? '▼' : '='} {Math.abs(diff).toFixed(2)}
                          </span>
                        )}
                        {num(it.labor_krw) > 0 && <span className="text-sky-600">작업 {won(it.labor_krw)}</span>}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 원가 구성 */}
              <div className="rounded-lg bg-white border border-slate-200 p-3">
                <p className="text-[11px] font-bold text-slate-500 mb-2">원가 구성</p>
                <table className="w-full text-[11px]">
                  <tbody>
                    <tr><td className="py-0.5 text-slate-500">{isAssy ? `자재비 (BOM ${assy.part_count}건)` : '매입가'}</td>
                      <td className="py-0.5 text-right font-semibold">{buy ? won(buy) + '원' : <span className="text-amber-600">{isAssy ? '0 (부품 단가 미등록)' : '미등록'}</span>}</td></tr>
                    {isAssy && assy.no_price_count > 0 && (
                      <tr><td className="py-0.5 text-[10px] text-amber-600" colSpan={2}>
                        ▲ 매입가 없는 부품 {assy.no_price_count}건 — 자재비가 실제보다 낮게 잡혀 마진이 과대 표시됩니다
                      </td></tr>
                    )}
                    <tr><td className="py-0.5 text-slate-500">작업비</td>
                      <td className="py-0.5 text-right font-semibold">{labor ? won(labor) + '원' : '—'}</td></tr>
                    <tr className="border-t border-slate-200"><td className="py-0.5 font-bold text-slate-600">원가 계</td>
                      <td className="py-0.5 text-right font-bold">{cost ? won(cost) + '원' : '—'}</td></tr>
                    <tr><td className="py-0.5 text-slate-500">견적단가</td>
                      <td className="py-0.5 text-right">{amt(L.unit_price, cur)}{cur !== 'KRW' && <span className="text-slate-400"> = {won(priceKrw)}원</span>}</td></tr>
                    <tr className="border-t border-slate-200"><td className="py-0.5 font-bold text-slate-600">마진</td>
                      <td className={`py-0.5 text-right font-bold ${marginCls}`}>
                        {margin == null ? '—' : `${won(priceKrw - cost)}원 (${(margin * 100).toFixed(1)}%)`}
                      </td></tr>
                  </tbody>
                </table>
                {margin != null && margin < 0 && (
                  <p className="mt-1.5 text-[10px] text-rose-600 font-semibold">⚠ 원가가 견적단가보다 높습니다</p>
                )}
                {!buy && !isAssy && (
                  <p className="mt-1.5 text-[10px] text-amber-600">매입가를 입력하면 마진율이 계산됩니다</p>
                )}
                {isAssy && (
                  <p className="mt-1.5 text-[10px] text-slate-400">
                    어셈블리 자재비는 BOM 부품 매입가의 합계입니다. 직접 수정할 수 없고,
                    부품 매입가를 채우면 자동으로 반영됩니다. (견적 제외로 지정한 부품은 합산에서 빠집니다)
                  </p>
                )}

                {/* 작업비 이력 — 언제 얼마로 잡았는지 */}
                {!!laborHist?.length && (
                  <div className="mt-2 pt-2 border-t border-slate-200">
                    <p className="text-[10px] font-bold text-slate-500 mb-1">작업비 이력</p>
                    {laborHist.slice(0, 6).map((h, i) => (
                      <div key={i} className="flex items-center gap-2 text-[10px] text-slate-500">
                        <span className="w-16">{h.effective_date}</span>
                        <span className="w-16 text-right font-semibold text-sky-700">{won(h.labor_krw)}원</span>
                        <span className="text-slate-400">
                          {h.source === 'quote' ? `견적 ${h.quote_no || ''}` : h.source === 'manual' ? '직접입력' : h.source}
                        </span>
                      </div>
                    ))}
                    {laborHist.length > 6 && <p className="text-[10px] text-slate-400">… 외 {laborHist.length - 6}건</p>}
                  </div>
                )}
                {laborHist?.length === 0 && (
                  <p className="mt-2 pt-2 border-t border-slate-200 text-[10px] text-slate-400">작업비 이력 없음</p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
