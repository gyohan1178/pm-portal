import { useState, useMemo } from 'react'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useCustomer } from '../../hooks/useCustomers'
import { quarterOf, fmt1 } from '../../lib/utils'
import {useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import CustomerTabs from '../../components/CustomerTabs'

const AX = (pn, prefix) => {
  const t = String(pn || '').replace(/\.0$/, '').trim()
  return t ? (t.startsWith(prefix + '-') ? t : prefix + '-' + t) : ''
}
const ymOf = (v) => {
  if (v == null || v === '' || String(v).trim() === '-') return null
  if (v instanceof Date && !isNaN(v)) { const d = new Date(v.getTime() + 12*3600*1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` } // 정오 보정
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  }
  const t = String(v).trim()
  // ISO형: 2026-07 / 2026-07-15
  let m = t.match(/^(\d{4})[-./](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`
  // 미국식: M/D/YYYY 또는 M/D/YY (연도가 뒤)
  m = t.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})$/)
  if (m) {
    let yr = m[3]; if (yr.length === 2) yr = '20' + yr
    return `${yr}-${m[1].padStart(2, '0')}`
  }
  return null
}

// 고객사별 파서 → 공통 [{ std_code, item_name, year_month, qty }]
function parseForecast(wb, csCode) {
  const code = csCode.toUpperCase()
  const ws = wb.Sheets[wb.SheetNames[0]]

  if (code === 'AX') {
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
    const cols = Object.keys(rows[0] || {})
    const monthCols = cols.filter(c => /^\d{4}-\d{2}$/.test(String(c).trim()))
    const out = []
    for (const r of rows) {
      const pn = String(r['Part'] ?? '').replace(/\.0$/, '').trim()
      if (!pn || pn === 'nan') continue
      for (const m of monthCols) {
        const q = parseFloat(r[m]); if (!q) continue
        out.push({ std_code: 'AX-' + pn, item_name: String(r['DESC'] ?? ''), year_month: m.trim(), qty: q })
      }
    }
    return out
  }

  if (code === 'ED') {
    // 헤더가 3번째 행(인덱스 2)
    const arr = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    const head = arr[2].map(h => String(h).trim())
    const iItem = head.findIndex(h => /item\s*number/i.test(h))
    const iTag = head.findIndex(h => /system|tag/i.test(h))
    const iFrame = head.findIndex(h => h.includes('Frame') && h.includes('입고'))
    const out = []
    for (let i = 3; i < arr.length; i++) {
      const row = arr[i]
      const pn = String(row[iItem] ?? '').replace(/\.0$/, '').trim()
      if (!pn || pn === 'nan') continue
      const ym = ymOf(row[iFrame])
      if (!ym) continue
      const tag = String(row[iTag] ?? '').replace(/\s*#\s*\d+\s*$/, '').trim()   // 호기(#7) 제거
      out.push({ std_code: 'ED-' + pn, item_name: tag, year_month: ym, qty: 1 })
    }
    // 같은 품번×월 합산 (호기 여러 대)
    const agg = {}
    for (const r of out) {
      const k = r.std_code + '|' + r.year_month
      if (!agg[k]) agg[k] = { ...r }
      else agg[k].qty += r.qty
    }
    return Object.values(agg)
  }

  // 기본: AXCELIS형 매트릭스로 시도
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  const cols = Object.keys(rows[0] || {})
  const monthCols = cols.filter(c => /^\d{4}-\d{2}$/.test(String(c).trim()))
  const pnCol = cols.find(c => /part|품번|item/i.test(c)) || cols[0]
  const nameCol = cols.find(c => /desc|품명|name/i.test(c))
  const out = []
  for (const r of rows) {
    const pn = String(r[pnCol] ?? '').replace(/\.0$/, '').trim(); if (!pn) continue
    for (const m of monthCols) { const q = parseFloat(r[m]); if (!q) continue
      out.push({ std_code: AX(pn, code), item_name: nameCol ? String(r[nameCol] ?? '') : '', year_month: m.trim(), qty: q }) }
  }
  return out
}

async function fetchForecast(csId) {
  if (!csId) return { latest: [], months: [], prevBatch: null, latestBatch: null }
  // 최신 2개 batch 가져오기 (변화 비교)
  // 최신 2개 batch 찾기 — 한 회차가 수천 행이라 행 단위 limit으론 직전 회차가 잘림.
  // distinct batch가 2개 모일 때까지 페이징.
  const seen = []
  for (let from = 0; from < 50000 && seen.length < 2; from += 1000) {
    const { data: page } = await supabase.from('forecasts')
      .select('batch_id, received_date, created_at')
      .eq('customer_id', csId)
      .order('created_at', { ascending: false, nullsFirst: false })
      .range(from, from + 999)
    if (!page || !page.length) break
    page.forEach(b => { if (!seen.find(x => x.batch_id === b.batch_id)) seen.push(b) })
    if (page.length < 1000) break
  }
  const latestBatch = seen[0], prevBatch = seen[1]
  if (!latestBatch) return { latest: [], months: [], prevBatch: null, latestBatch: null }

  const load = async (b) => {
    if (!b) return []
    const all = []
    for (let from = 0; ; from += 1000) {
      let q = supabase.from('forecasts').select('std_code,item_name,year_month,qty')
        .eq('customer_id', csId)
      q = (b.batch_id == null) ? q.is('batch_id', null) : q.eq('batch_id', b.batch_id)
      const { data } = await q.range(from, from + 999)
      all.push(...(data || [])); if (!data || data.length < 1000) break
    }
    return all
  }
  const [cur, prev] = await Promise.all([load(latestBatch), prevBatch ? load(prevBatch) : []])
  // 매트릭스 구성
  const monthsSet = new Set(), map = {}
  cur.forEach(r => {
    monthsSet.add(r.year_month)
    const k = r.std_code
    if (!map[k]) map[k] = { std_code: r.std_code, item_name: r.item_name, cells: {}, prev: {} }
    map[k].cells[r.year_month] = (map[k].cells[r.year_month] || 0) + Number(r.qty)
  })
  prev.forEach(r => {
    monthsSet.add(r.year_month)
    const k = r.std_code
    if (!map[k]) map[k] = { std_code: r.std_code, item_name: r.item_name, cells: {}, prev: {} }
    map[k].prev[r.year_month] = (map[k].prev[r.year_month] || 0) + Number(r.qty)
  })
  const months = [...monthsSet].sort()
  const latest = Object.values(map).sort((a, b) => a.std_code.localeCompare(b.std_code))
  return { latest, months, prevBatch, latestBatch }
}

export default function Forecast() {
  const { customerId: csCode } = useParams()
  const qc = useQueryClient()
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [search, setSearch] = useState('')
  const [qview, setQview] = useState(false)

  const { data: cs } = useCustomer(csCode)
  const { data: fc = { latest: [], months: [] }, isLoading } = useQuery({
    queryKey: ['forecast', cs?.id], queryFn: () => fetchForecast(cs?.id), enabled: !!cs?.id,
  })

  const cols = useMemo(() => qview ? [...new Set((fc.months||[]).map(quarterOf))].sort() : (fc.months||[]), [qview, fc.months])
  const valFor = (r, col) => {
    if (!qview) return { cur: r.cells[col]||0, prev: r.prev[col] }
    let cur=0, prev=0, hasPrev=false
    for (const m of (fc.months||[])) { if (quarterOf(m)!==col) continue; cur += r.cells[m]||0; if (r.prev[m]!=null){ prev+=r.prev[m]; hasPrev=true } }
    return { cur, prev: hasPrev?prev:null }
  }

  function handleFile(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array', cellDates: true })
        const parsed = parseForecast(wb, csCode)
        const months = [...new Set(parsed.map(p => p.year_month))].sort()
        setPreview({ rows: parsed, months, count: parsed.length, items: new Set(parsed.map(p => p.std_code)).size })
        setResult(null)
      } catch (err) { toastError('파싱 오류: ' + err.message) }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const batch_id = crypto.randomUUID()
      const received = new Date().toISOString().split('T')[0]
      // std_code → item_id 매칭
      const { data: prevB } = await supabase.from('forecasts').select('batch_id').eq('customer_id', cs.id).limit(1)
      const hadPrev = (prevB || []).length > 0
      const codes = [...new Set(preview.rows.map(r => r.std_code))]
      const itemMap = {}
      for (let i = 0; i < codes.length; i += 300) {
        const { data } = await supabase.from('items').select('id,std_code').in('std_code', codes.slice(i, i + 300))
        ;(data || []).forEach(x => { itemMap[x.std_code] = x.id })
      }
      const payload = preview.rows.map(r => ({
        customer_id: cs.id, std_code: r.std_code, item_id: itemMap[r.std_code] || null,
        item_name: r.item_name, year_month: r.year_month, qty: r.qty,
        batch_id, received_date: received,
      }))
      for (let i = 0; i < payload.length; i += 500) {
        const { error } = await supabase.from('forecasts').insert(payload.slice(i, i + 500))
        if (error) throw error
      }
      return { count: payload.length, matched: payload.filter(p => p.item_id).length, hadPrev }
    },
    onSuccess: (r) => {
      setResult(`접수 완료 — ${r.count}건 (품목매칭 ${r.matched}건). ${r.hadPrev ? '직전 회차 대비 증감이 표시됩니다.' : '첫 회차입니다 — 다음 업로드부터 증감이 표시됩니다.'}`)
      setPreview(null); qc.invalidateQueries(['forecast', cs?.id])
    },
    onError: (e) => toastError('저장 오류: ' + e.message),
  })

  const filtered = fc.latest.filter(r => {
    const q = search.trim().toLowerCase(); if (!q) return true
    return r.std_code.toLowerCase().includes(q) || (r.item_name || '').toLowerCase().includes(q)
  })

  return (
    <div className="space-y-4">
      <CustomerTabs />
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">{cs?.name || csCode} 포캐스트</h1>
          <Link to="/forecast-shortage" className="inline-flex items-center gap-1 mt-1 text-xs font-bold text-indigo-600 hover:underline">🔍 이 포캐스트로 소요 예측(쇼티지 분석) 보기 →</Link>
          <p className="text-xs text-slate-400 mt-0.5">고객사 수요 예측 — 프로젝트/품번별 월별 수량 · 직전 접수 대비 변화 추적</p>
        </div>
        <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer">
          📤 포캐스트 업로드
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
        </label>
      </div>

      {result && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700 font-semibold">✅ {result}</div>}

      {/* 업로드 미리보기 */}
      {preview && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs font-bold text-indigo-700">미리보기 — 품목 {preview.items}개 · {preview.count}건 · {preview.months.length}개월 ({preview.months[0]}~{preview.months[preview.months.length-1]})</p>
            <div className="flex gap-2">
              <button onClick={() => setPreview(null)} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">취소</button>
              <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                {saveMut.isPending ? '저장 중...' : '⚡ 접수 (새 회차로 저장)'}
              </button>
            </div>
          </div>
          <p className="text-[11px] text-slate-400">이전 접수는 보존되고 새 회차로 쌓입니다 — 저장 후 직전 대비 증감이 표시됩니다.</p>
        </div>
      )}

      {/* 현황 매트릭스 */}
      <div className="flex items-center gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="품번·품명 검색"
          className="w-full sm:w-72 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-bold">
          <button onClick={()=>setQview(false)} className={`px-3 py-2 ${!qview?'bg-indigo-600 text-white':'bg-white text-slate-500 hover:bg-slate-50'}`}>월별</button>
          <button onClick={()=>setQview(true)} className={`px-3 py-2 ${qview?'bg-indigo-600 text-white':'bg-white text-slate-500 hover:bg-slate-50'}`}>분기별</button>
        </div>
        {fc.latestBatch && <span className="text-xs text-slate-400 ml-auto">최신 접수 {fc.latestBatch.received_date}{fc.prevBatch && ` · 직전 ${fc.prevBatch.received_date} 대비 증감`}</span>}
      </div>

      {isLoading ? <div className="text-center py-12 text-slate-400 text-sm">불러오는 중...</div>
        : fc.latest.length === 0
          ? <div className="text-center py-16 text-slate-300 text-sm">접수된 포캐스트가 없습니다. 엑셀을 업로드해주세요.</div>
          : <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
                <table className="text-xs whitespace-nowrap">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-slate-100 border-b border-slate-200 text-slate-500">
                      <th className="px-3 py-2 text-left font-bold sticky left-0 bg-slate-100 z-20">품번 · 품명</th>
                      {cols.map(c => <th key={c} className="px-3 py-2 text-right font-bold min-w-[64px]">{c.slice(2)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r, i) => (
                      <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 sticky left-0 bg-white z-10">
                          <div className="font-mono text-indigo-600">{r.std_code}</div>
                          <div className="text-[11px] text-slate-400 max-w-[200px] truncate">{r.item_name}</div>
                        </td>
                        {cols.map(m => {
                          const { cur, prev } = valFor(r, m)
                          const diff = prev != null ? Math.round((cur - prev) * 10) / 10 : null
                          return (
                            <td key={m} className="px-3 py-2 text-right">
                              {cur ? <span className="font-semibold text-slate-700">{fmt1(cur)}</span> : <span className="text-slate-200">·</span>}
                              {diff != null && diff !== 0 && (
                                <span className={`ml-1 text-[10px] font-bold ${diff > 0 ? 'text-red-500' : 'text-blue-500'}`}>
                                  {diff > 0 ? '▲' : '▼'}{fmt1(Math.abs(diff))}
                                </span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>}
    </div>
  )
}
