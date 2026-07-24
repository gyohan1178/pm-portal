import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'

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
  const [kind, setKind] = useState('sales')
  const [view, setView] = useState('item')   // item = 품번별, quote = 견적별
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState(null)
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
                <th className="px-3 py-2 text-center w-24">최근 견적일</th>
                <th className="px-3 py-2 text-center w-20">견적 횟수</th>
                <th className="px-3 py-2 text-left w-28">최근 견적번호</th>
              </tr>
            </thead>
            <tbody>
              {codeRows.map((r) => (
                <FragRow key={r.code} r={r} />
              ))}
              {!codeRows.length && (
                <tr><td colSpan={6} className="py-10 text-center text-slate-400">이력이 없습니다.</td></tr>
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
function FragRow({ r }) {
  const [open, setOpen] = useState(false)
  const L = r.latest
  const cur = L.quote.currency
  return (
    <>
      <tr onClick={() => setOpen((v) => !v)} className="border-t border-slate-100 cursor-pointer hover:bg-indigo-50/40">
        <td className="px-3 py-2 font-mono text-indigo-600">{r.code}</td>
        <td className="px-3 py-2 text-slate-600 max-w-[280px] truncate">{L.description || '-'}</td>
        <td className="px-3 py-2 text-right font-bold">{amt(L.unit_price, cur)}</td>
        <td className="px-3 py-2 text-center text-slate-500">{L.quote.quote_date}</td>
        <td className="px-3 py-2 text-center">
          {r.count > 1
            ? <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold">{r.count}</span>
            : <span className="text-slate-400">1</span>}
        </td>
        <td className="px-3 py-2 font-mono text-slate-400">{L.quote.quote_no}</td>
      </tr>
      {open && (
        <tr className="bg-slate-50/80">
          <td colSpan={6} className="px-4 py-3">
            <p className="text-[11px] font-bold text-slate-500 mb-1.5">단가 변동 이력</p>
            <div className="space-y-1">
              {r.list.map((it, i) => {
                const prev = r.list[i + 1]
                const diff = prev ? num(it.unit_price) - num(prev.unit_price) : null
                return (
                  <div key={it.quote_id + '-' + it.line_no} className="flex items-center gap-3 text-[11px]">
                    <span className="w-24 text-slate-400">{it.quote.quote_date}</span>
                    <span className="w-28 font-mono text-slate-400">{it.quote.quote_no}</span>
                    <span className="w-24 text-right font-bold text-slate-700">{amt(it.unit_price, it.quote.currency)}</span>
                    {diff != null && (
                      <span className={`w-20 text-right font-semibold ${diff > 0 ? 'text-rose-500' : diff < 0 ? 'text-sky-600' : 'text-slate-300'}`}>
                        {diff > 0 ? '▲' : diff < 0 ? '▼' : '='} {Math.abs(diff).toFixed(2)}
                      </span>
                    )}
                    <span className="flex-1 text-slate-400 truncate">{it.quote.project_name || ''}</span>
                    {num(it.labor_krw) > 0 && <span className="text-sky-600">작업비 {won(it.labor_krw)}</span>}
                  </div>
                )
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
