import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { toastError, toastSuccess } from '../../lib/toast'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const won = (v) => Math.round(num(v)).toLocaleString('ko-KR')
const amt = (v, cur) =>
  cur === 'KRW' ? '₩' + won(v) : '$' + num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (v) => (v == null ? '-' : (num(v) * 100).toFixed(1) + '%')

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
    .order('created_at', { ascending: false }))
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
      .order('line_no'))
    out.push(...part)
  }
  return out
}

export default function QuoteHistory() {
  const qc = useQueryClient()
  const [kind, setKind] = useState('sales')
  const [view, setView] = useState('item')   // item = 품번별, quote = 견적별
  const [q, setQ] = useState('')
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
    queryKey: ['quoteItemStatus', kind, allCodes.length],
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

  // 매입가 저장 → items 마스터 갱신 (견적서 원가 계산에 바로 반영됨)
  async function savePurchasePrice(code, val) {
    const price = val === '' || val == null ? null : Number(val)
    const { error } = await supabase.from('items').update({ purchase_price: price }).eq('std_code', code)
    if (error) { toastError('매입가 저장 실패: ' + error.message); return }
    toastSuccess(`${code} 매입가 ${price == null ? '삭제' : won(price) + '원'}`)
    qc.invalidateQueries({ queryKey: ['quoteItemStatus'], exact: false })
  }

  // 작업비 저장 → pm_labor_costs 에 오늘 날짜로 기록 (다음 견적에서 자동 조회됨)
  async function saveLabor(code, val) {
    const labor = Number(val)
    if (!Number.isFinite(labor) || labor <= 0) { toastError('작업비는 0보다 큰 숫자여야 합니다'); return }
    const { error } = await supabase.from('pm_labor_costs').upsert({
      std_code: code, labor_krw: labor,
      effective_date: new Date().toISOString().slice(0, 10),
      source: 'manual', quote_no: null, memo: '견적이력에서 직접 입력',
    }, { onConflict: 'std_code,effective_date,source,quote_no' })
    if (error) { toastError('작업비 저장 실패: ' + error.message); return }
    toastSuccess(`${code} 작업비 ${won(labor)}원 저장`)
    qc.invalidateQueries({ queryKey: ['quoteItemStatus'], exact: false })
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
    const kw = q.trim().toLowerCase()
    let rows = Object.entries(byCode).map(([code, list]) => ({
      code, list, latest: list[0], count: list.length,
    }))
    if (kw) {
      rows = rows.filter((r) =>
        r.code.toLowerCase().includes(kw) ||
        String(r.latest.description || '').toLowerCase().includes(kw))
    }
    return rows.sort((a, b) => a.code.localeCompare(b.code))
  }, [byCode, q])

  const quoteRows = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return quotes
    return quotes.filter((x) =>
      [x.quote_no, x.project_name, x.issued_to, x.memo].some((v) => String(v || '').toLowerCase().includes(kw)))
  }, [quotes, q])

  function exportXlsx() {
    const rows = items.map((it) => {
      const qq = qMap[it.quote_id] || {}
      return {
        견적구분: qq.quote_kind === 'sales' ? '매출' : '매입',
        견적번호: qq.quote_no, 견적일: qq.quote_date,
        상대처: qq.issued_to, 건명: qq.project_name,
        품번: it.std_code, 품명: it.description, REV: it.rev,
        구분: it.line_kind === 'assy' ? 'ASSY' : '단품',
        수량: num(it.qty), 통화: qq.currency,
        단가: num(it.unit_price), 금액: num(it.qty) * num(it.unit_price),
        '자재비(원)': it.material_krw == null ? '' : num(it.material_krw),
        '작업비(원)': num(it.labor_krw),
        '원가(원)': it.cost_krw == null ? '' : num(it.cost_krw),
        // 현재 마스터 기준 원가·마진 (관리용)
        '현재매입가(원)': num(statusMap[it.std_code]?.purchase_price) || '',
        '현재작업비(원)': num(statusMap[it.std_code]?.last_labor) || '',
        마진율: (() => {
          const c = num(statusMap[it.std_code]?.purchase_price) + num(statusMap[it.std_code]?.last_labor)
          const pk = qq.currency === 'KRW' ? num(it.unit_price) : num(it.unit_price) * num(sellRate)
          return pk > 0 && c > 0 ? ((pk - c) / pk * 100).toFixed(1) + '%' : ''
        })(),
        상태: STATUS[qq.status]?.label || qq.status,
      }
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), isSales ? '매출견적이력' : '매입견적이력')
    XLSX.writeFile(wb, `견적이력_${isSales ? '매출' : '매입'}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">📋 견적 이력</h1>
          <p className="text-xs text-slate-400">저장된 견적을 품번별·견적별로 조회합니다. 매출과 매입은 절대 섞이지 않습니다.</p>
        </div>
        <button onClick={exportXlsx} disabled={!items.length}
          className="px-3 py-2 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40">
          📑 엑셀 추출
        </button>
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
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">품번</th>
                <th className="px-3 py-2 text-left">품명</th>
                <th className="px-3 py-2 text-right w-28">최근 단가</th>
                <th className="px-3 py-2 text-right w-28" title="items 마스터 매입가 — 여기서 바로 수정 가능">매입가(원)</th>
                <th className="px-3 py-2 text-right w-24" title="최근 작업비 — 여기서 바로 수정 가능">작업비(원)</th>
                <th className="px-3 py-2 text-right w-20" title="(견적단가 - 원가) / 견적단가">마진율</th>
                <th className="px-3 py-2 text-center w-24">최근 견적일</th>
                <th className="px-3 py-2 text-center w-16">횟수</th>
              </tr>
            </thead>
            <tbody>
              {codeRows.map((r) => (
                <FragRow key={r.code} r={r} st={statusMap[r.code]} rate={sellRate}
                  onSavePrice={savePurchasePrice} onSaveLabor={saveLabor} />
              ))}
              {!codeRows.length && (
                <tr><td colSpan={8} className="py-10 text-center text-slate-400">이력이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 견적별 */}
      {!isLoading && view === 'quote' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
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
                    </tr>
                    {open && (
                      <tr key={x.id + '-d'} className="bg-slate-50/80">
                        <td colSpan={isSales ? 7 : 6} className="px-4 py-3">
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
                <tr><td colSpan={isSales ? 7 : 6} className="py-10 text-center text-slate-400">이력이 없습니다.</td></tr>
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
function FragRow({ r, st, rate, onSavePrice, onSaveLabor }) {
  const [open, setOpen] = useState(false)
  const [priceEdit, setPriceEdit] = useState(null)
  const [laborEdit, setLaborEdit] = useState(null)
  const L = r.latest
  const cur = L.quote.currency

  // 원가 = 매입가 + 작업비, 매출 = 견적단가(원화 환산)
  const buy = num(st?.purchase_price)
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
        <td className="px-3 py-2 font-mono text-indigo-600 cursor-pointer" onClick={() => setOpen((v) => !v)}>
          {open ? '▾ ' : '▸ '}{r.code}
        </td>
        <td className="px-3 py-2 text-slate-600 max-w-[240px] truncate cursor-pointer" onClick={() => setOpen((v) => !v)}
          title={L.description || st?.name || ''}>
          {L.description || st?.name || <span className="text-slate-300">품명없음</span>}
        </td>
        <td className="px-3 py-2 text-right font-bold">{amt(L.unit_price, cur)}</td>

        {/* 매입가 — 직접 수정 */}
        <td className="px-3 py-2 text-right">
          <input type="number" defaultValue={st?.purchase_price ?? ''} placeholder="미등록"
            onChange={(e) => setPriceEdit(e.target.value)}
            onBlur={(e) => { if (priceEdit !== null) { onSavePrice(r.code, e.target.value); setPriceEdit(null) } }}
            className={`w-24 px-1 py-0.5 text-right border rounded ${num(st?.purchase_price) > 0 ? 'border-slate-200' : 'border-amber-400 bg-amber-50'}`} />
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

        <td className="px-3 py-2 text-center text-slate-500">{L.quote.quote_date}</td>
        <td className="px-3 py-2 text-center">
          {r.count > 1
            ? <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold">{r.count}</span>
            : <span className="text-slate-400">1</span>}
        </td>
      </tr>

      {open && (
        <tr className="bg-slate-50/80">
          <td colSpan={8} className="px-4 py-3">
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
                    <tr><td className="py-0.5 text-slate-500">매입가</td>
                      <td className="py-0.5 text-right font-semibold">{buy ? won(buy) + '원' : <span className="text-amber-600">미등록</span>}</td></tr>
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
                {!buy && (
                  <p className="mt-1.5 text-[10px] text-amber-600">매입가를 입력하면 마진율이 계산됩니다</p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
