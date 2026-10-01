import { useState, useMemo } from 'react'
import { useVisibleRows, MoreRows } from '../../hooks/useVisibleRows'
import { toast, toastError, toastSuccess } from '../../lib/toast'
import { useCustomer } from '../../hooks/useCustomers'
import { quarterOf, fmt1, todayISO } from '../../lib/utils'
import {useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import CustomerTabs from '../../components/CustomerTabs'
import { parseEdForecastDetail, loadRules, fetchEdProduction, planFcApply, applyFcPlan, planSummary } from '../../lib/edForecast'

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
  if (!csId) return { latest: [], months: [], analysis: null, prevBatch: null, latestBatch: null }
  // 최신 2개 batch 가져오기 (변화 비교)
  // 최신 2개 batch 찾기 — 한 회차가 수천 행이라 행 단위 limit으론 직전 회차가 잘림.
  // distinct batch가 2개 모일 때까지 페이징.
  const seen = []
  for (let from = 0; from < 50000 && seen.length < 2; from += 1000) {
    const { data: page } = await supabase.from('forecasts')
      .select('batch_id, received_date, created_at')
      .eq('customer_id', csId)
      .order('created_at', { ascending: false, nullsFirst: false }).order('batch_id')
      .range(from, from + 999)
    if (!page || !page.length) break
    page.forEach(b => { if (!seen.find(x => x.batch_id === b.batch_id)) seen.push(b) })
    if (page.length < 1000) break
  }
  const latestBatch = seen[0], prevBatch = seen[1]
  if (!latestBatch) return { latest: [], months: [], analysis: null, prevBatch: null, latestBatch: null }

  const load = async (b) => {
    if (!b) return []
    const all = []
    for (let from = 0; ; from += 1000) {
      let q = supabase.from('forecasts').select('std_code,item_name,year_month,qty')
        .eq('customer_id', csId)
      q = (b.batch_id == null) ? q.is('batch_id', null) : q.eq('batch_id', b.batch_id)
      // 정렬이 없으면 페이지마다 순서가 달라져 같은 행이 두 번 오거나 빠진다
      const { data } = await q.order('std_code').order('year_month').range(from, from + 999)
      all.push(...(data || [])); if (!data || data.length < 1000) break
    }
    return all
  }
  const [cur, prev] = await Promise.all([load(latestBatch), prevBatch ? load(prevBatch) : []])
  return { ...buildForecast(cur, prev), prevBatch, latestBatch }
}

// ── 최신 회차 기준 매트릭스 + 직전 회차 대비 변경점 ──────────────────────────
//   새 파일에는 이미 지난 달이 빠져 있다 → 열은 최신 회차의 달만.
//   비교는 두 회차가 모두 다루는 구간(겹치는 달)에서만 한다 — 지난 달이 빠진 걸 「감소」로 세지 않는다.
const last = a => a[a.length - 1]
const r1 = n => Math.round(Number(n || 0) * 10) / 10
const mIdx = m => { const [y, mm] = String(m).split('-'); return (+y) * 12 + (+mm) }
export function buildForecast(cur, prev) {
  const sumBy = rows => {
    const o = {}
    rows.forEach(r => {
      const k = r.std_code; if (!k || !r.year_month) return
      if (!o[k]) o[k] = { std_code: k, item_name: r.item_name || '', q: {} }
      if (!o[k].item_name && r.item_name) o[k].item_name = r.item_name
      o[k].q[r.year_month] = (o[k].q[r.year_month] || 0) + Number(r.qty || 0)
    })
    return o
  }
  const C = sumBy(cur || []), P = sumBy(prev || [])
  const curMonths = [...new Set(Object.values(C).flatMap(c => Object.keys(c.q)))].sort()
  const prevMonths = [...new Set(Object.values(P).flatMap(p => Object.keys(p.q)))].sort()
  const hasPrev = prevMonths.length > 0 && curMonths.length > 0

  // 비교 구간 = 두 회차가 모두 다루는 달 (앞: 둘 중 늦은 시작 · 뒤: 둘 중 이른 끝)
  let win = []
  if (hasPrev) {
    const lo = curMonths[0] > prevMonths[0] ? curMonths[0] : prevMonths[0]
    const hi = last(curMonths) < last(prevMonths) ? last(curMonths) : last(prevMonths)
    win = [...new Set([...curMonths, ...prevMonths])].filter(m => m >= lo && m <= hi).sort()
  }
  const W = new Set(win)
  const droppedMonths = hasPrev ? prevMonths.filter(m => m < curMonths[0]) : []        // 지나간 달 (새 파일에 없음)
  const addedMonths = hasPrev ? curMonths.filter(m => m > last(prevMonths)) : []      // 새로 붙은 뒤쪽 달
  const tailGone = hasPrev ? prevMonths.filter(m => m > last(curMonths)) : []         // 직전엔 있었는데 새 파일 끝보다 뒤인 달 (드묾)
  const sumW = q => win.reduce((s, m) => s + (q[m] || 0), 0)
  const cent = q => { let s = 0, w = 0; win.forEach(m => { const v = q[m] || 0; s += mIdx(m) * v; w += v }); return w ? s / w : null }

  // 열: 최신 회차의 달 + 비교 구간 안에서 최신엔 0 이 된 달
  const months = [...new Set([...curMonths, ...win])].sort()

  const latest = Object.values(C).map(c => {
    const p = P[c.std_code]
    const prevCells = {}
    if (hasPrev && p) win.forEach(m => { prevCells[m] = p.q[m] || 0 })
    const curW = r1(sumW(c.q)), prevW = hasPrev && p ? r1(sumW(p.q)) : null
    const moved = p ? win.some(m => r1(c.q[m]) !== r1(p.q[m])) : false
    const cc = cent(c.q), pc = p ? cent(p.q) : null
    return {
      std_code: c.std_code, item_name: c.item_name || p?.item_name || '',
      cells: c.q, prev: prevCells,
      isNew: hasPrev && !p, curW, prevW,
      diffW: prevW == null ? null : r1(curW - prevW),
      changed: hasPrev && (!p || moved),
      shift: cc != null && pc != null ? Math.round((cc - pc) * 10) / 10 : null,   // + 밀림 / − 당겨짐 (개월)
    }
  }).sort((a, b) => a.std_code.localeCompare(b.std_code))

  if (!hasPrev) return { latest, months, analysis: null }

  const removed = Object.values(P).filter(p => !C[p.std_code])
    .map(p => ({ std_code: p.std_code, item_name: p.item_name, prevW: r1(sumW(p.q)) }))
  const removedInWin = removed.filter(x => x.prevW > 0).sort((a, b) => b.prevW - a.prevW)
  const endedPast = removed.length - removedInWin.length                                   // 지난 달 수요만 있던 품목 (끝난 것)

  const both = latest.filter(r => !r.isNew)
  const up = both.filter(r => r.diffW > 0).sort((a, b) => b.diffW - a.diffW)
  const down = both.filter(r => r.diffW < 0).sort((a, b) => a.diffW - b.diffW)
  const movedOnly = both.filter(r => r.diffW === 0 && r.changed).sort((a, b) => Math.abs(b.shift || 0) - Math.abs(a.shift || 0))
  const added = latest.filter(r => r.isNew && r.curW > 0).sort((a, b) => b.curW - a.curW)
  const addedOutside = latest.filter(r => r.isNew && !(r.curW > 0)).length                   // 새로 붙은 달에만 있는 신규 품목

  const monthly = months.map(m => {
    const c = r1(Object.values(C).reduce((s, x) => s + (x.q[m] || 0), 0))
    const p = W.has(m) ? r1(Object.values(P).reduce((s, x) => s + (x.q[m] || 0), 0)) : null
    return { m, cur: c, prev: p, diff: p == null ? null : r1(c - p), kind: W.has(m) ? 'cmp' : 'new' }
  })
  const totCur = r1(monthly.filter(x => x.kind === 'cmp').reduce((s, x) => s + x.cur, 0))
  const totPrev = r1(monthly.filter(x => x.kind === 'cmp').reduce((s, x) => s + x.prev, 0))

  // 주요 110 품번(완제품 PD BOX 등) — 달마다 직전→최신을 한눈에
  const isMain = code => /^[A-Z]+-110/i.test(code || '')
  const main = [
    ...latest.filter(r => isMain(r.std_code)).map(r => ({
      std_code: r.std_code, item_name: r.item_name, cur: r.cells, prev: r.prev, isNew: r.isNew, removed: false,
      curW: r.curW, prevW: r.prevW, diffW: r.diffW, changed: r.changed, shift: r.shift,
    })),
    ...removedInWin.filter(x => isMain(x.std_code)).map(x => {
      const pq = {}; win.forEach(m => { pq[m] = P[x.std_code].q[m] || 0 })
      return { std_code: x.std_code, item_name: x.item_name, cur: {}, prev: pq, isNew: false, removed: true,
        curW: 0, prevW: x.prevW, diffW: r1(-x.prevW), changed: true, shift: null }
    }),
  ].sort((x, y) => (y.changed - x.changed) || Math.abs(y.diffW || 0) - Math.abs(x.diffW || 0) || x.std_code.localeCompare(y.std_code))

  return {
    latest, months,
    analysis: {
      main,
      win, droppedMonths, addedMonths, tailGone,
      totCur, totPrev, totDiff: r1(totCur - totPrev),
      monthly, up, down, movedOnly, added, addedOutside, removed: removedInWin, endedPast,
      same: both.filter(r => !r.changed).length,
    },
  }
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
  // 증감은 비교 구간(두 회차가 겹치는 달)에서만 — 새로 붙은 달은 비교 대상이 없어 표시 안 함
  const valFor = (r, col) => {
    if (!qview) return { cur: r.cells[col]||0, cmpCur: r.cells[col]||0, prev: r.prev[col] }
    let cur=0, cmpCur=0, prev=0, hasPrev=false
    for (const m of (fc.months||[])) { if (quarterOf(m)!==col) continue; cur += r.cells[m]||0; if (r.prev[m]!=null){ prev+=r.prev[m]; cmpCur += r.cells[m]||0; hasPrev=true } }
    return { cur, cmpCur, prev: hasPrev?prev:null }
  }
  const [chgOnly, setChgOnly] = useState('all')   // all | changed | new
  const [showAna, setShowAna] = useState(true)

  function handleFile(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array', cellDates: true })
        const parsed = parseForecast(wb, csCode)
        const months = [...new Set(parsed.map(p => p.year_month))].sort()
        // Edwards — 같은 파일로 생산관리 정한 납기도 채운다 (호기별 날짜)
        let edDetail = null
        if (String(csCode).toUpperCase() === 'ED') {
          try { edDetail = parseEdForecastDetail(wb) } catch { edDetail = null }
        }
        setPreview({ rows: parsed, months, count: parsed.length, items: new Set(parsed.map(p => p.std_code)).size, edDetail })
        setResult(null)
      } catch (err) { toastError('파싱 오류: ' + err.message) }
    }
    reader.readAsArrayBuffer(file)
    e.target.value = ''
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const batch_id = crypto.randomUUID()
      const received = todayISO()
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
      // Edwards — 생산관리에도 반영할지 묻는다. 여기서 실패해도 포캐스트 저장은 끝난 것이다.
      let prod = ''
      const ed = preview.edDetail
      if (ed?.rows?.length) {
        try {
          const [rules, prodRows] = await Promise.all([loadRules(supabase), fetchEdProduction(supabase)])
          const plan = planFcApply(ed.rows, prodRows, rules)
          if (!plan.upd.length && !plan.ins.length && !plan.goneIds.length) prod = ' · 생산관리: 바뀐 날짜 없음'
          else if (window.confirm(`포캐스트는 저장했습니다.\n\n생산관리(Edwards)의 정한 납기에도 반영할까요?\n\n${planSummary(plan)}\n\n확정 납기 · 발주서 체크 · 불출 · 미불출 · 비고 · 담당자 · 상태는 그대로 둡니다.`)) {
            const a = await applyFcPlan(supabase, plan)
            prod = ` · 생산관리 반영 — 갱신 ${a.updated ?? 0}줄 · 새 줄 ${a.inserted ?? 0}줄`
            qc.invalidateQueries({ queryKey: ['production', 'ED'] })
          } else prod = ' · 생산관리에는 반영하지 않음 (생산관리 「📅 포캐스트 반영」으로 나중에 가능)'
        } catch (e) { prod = ` · 생산관리 반영 못 함: ${e.message}` }
      }
      return { count: payload.length, matched: payload.filter(p => p.item_id).length, hadPrev, prod }
    },
    onSuccess: (r) => {
      setResult(`접수 완료 — ${r.count}건 (품목매칭 ${r.matched}건). ${r.hadPrev ? '직전 회차 대비 증감이 표시됩니다.' : '첫 회차입니다 — 다음 업로드부터 증감이 표시됩니다.'}${r.prod || ''}`)
      setPreview(null); qc.invalidateQueries(['forecast', cs?.id])
    },
    onError: (e) => toastError('저장 오류: ' + e.message),
  })

  const filtered = fc.latest.filter(r => {
    if (chgOnly === 'changed' && !r.changed) return false
    if (chgOnly === 'new' && !r.isNew) return false
    const q = search.trim().toLowerCase(); if (!q) return true
    return r.std_code.toLowerCase().includes(q) || (r.item_name || '').toLowerCase().includes(q)
  })

  // 포캐스트가 수천 건이면 필터 조작이 밀린다
  const vis = useVisibleRows(filtered, 200, [filtered.length])

  return (
    <div className="space-y-4">
      <CustomerTabs />
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">{cs?.name || csCode} 포캐스트</h1>
          <Link to={`/forecast-shortage?cs=${String(csCode || 'ax').toLowerCase()}`} className="inline-flex items-center gap-1 mt-1 text-xs font-bold text-indigo-600 hover:underline">🔍 이 포캐스트로 소요 예측(쇼티지 분석) 보기 →</Link>
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

      {/* 변경점 분석 — 직전 접수 대비 */}
      {!isLoading && fc.latestBatch && (
        fc.analysis
          ? <ForecastAnalysis a={fc.analysis} latestBatch={fc.latestBatch} prevBatch={fc.prevBatch} open={showAna} setOpen={setShowAna}
              onPick={code => { setSearch(code); setChgOnly('all') }} />
          : <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
              📊 변경점 분석 — 비교할 직전 접수가 없습니다. 다음 포캐스트를 올리면 이번 회차와 비교한 변경점이 여기에 나옵니다.
            </div>
      )}

      {/* 현황 매트릭스 */}
      <div className="flex items-center gap-2 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="품번·품명 검색"
          className="w-full sm:w-72 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-bold">
          <button onClick={()=>setQview(false)} className={`px-3 py-2 ${!qview?'bg-indigo-600 text-white':'bg-white text-slate-500 hover:bg-slate-50'}`}>월별</button>
          <button onClick={()=>setQview(true)} className={`px-3 py-2 ${qview?'bg-indigo-600 text-white':'bg-white text-slate-500 hover:bg-slate-50'}`}>분기별</button>
        </div>
        {fc.analysis && (
          <select value={chgOnly} onChange={e => setChgOnly(e.target.value)}
            className="px-2 py-2 text-xs font-bold border border-slate-200 rounded-lg bg-white text-slate-600">
            <option value="all">전체 품목</option>
            <option value="changed">바뀐 품목만</option>
            <option value="new">신규 품목만</option>
          </select>
        )}
        {fc.latestBatch && <span className="text-xs text-slate-400 ml-auto">최신 접수 {fc.latestBatch.received_date}{fc.prevBatch && ` · 직전 ${fc.prevBatch.received_date} 대비 증감 (겹치는 달만)`}</span>}
      </div>

      {isLoading ? <div className="text-center py-12 text-slate-400 text-sm">불러오는 중...</div>
        : fc.latest.length === 0
          ? <div className="text-center py-16 text-slate-300 text-sm">접수된 포캐스트가 없습니다. 엑셀을 업로드해주세요.</div>
          : <div className="rounded-xl border border-slate-200 overflow-x-auto">
              <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
                <table className="text-xs whitespace-nowrap">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-slate-100 border-b border-slate-200 text-slate-500">
                      <th className="px-3 py-2 text-left font-bold sticky left-0 bg-slate-100 z-20">품번 · 품명</th>
                      {cols.map(c => {
                        const fresh = fc.analysis && !qview && !fc.analysis.win.includes(c)
                        return <th key={c} title={fresh ? '직전 접수에 없던 달 — 증감 비교 없음' : undefined}
                          className={`px-3 py-2 text-right font-bold min-w-[64px] ${fresh ? 'text-emerald-600' : ''}`}>{c.slice(2)}{fresh && <sup className="ml-0.5">new</sup>}</th>
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {vis.shown.map((r, i) => (
                      <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 sticky left-0 bg-white z-10">
                          <div className="font-mono text-indigo-600">{r.std_code}{r.isNew && <span className="ml-1 px-1 rounded bg-emerald-100 text-emerald-700 text-[9px] font-bold align-middle">신규</span>}</div>
                          <div className="text-[11px] text-slate-400 max-w-[200px] truncate">{r.item_name}</div>
                        </td>
                        {cols.map(m => {
                          const { cur, cmpCur, prev } = valFor(r, m)
                          const diff = prev != null ? Math.round((cmpCur - prev) * 10) / 10 : null
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
                    {filtered.length === 0 && <tr><td colSpan={cols.length + 1} className="px-3 py-8 text-center text-slate-300">조건에 맞는 품목이 없습니다</td></tr>}
                  </tbody>
                </table>
                <MoreRows {...vis} />
              </div>
            </div>}
    </div>
  )
}

// ── 변경점 분석 패널 ────────────────────────────────────────────────────────
const sgn = n => (n > 0 ? '+' : '') + fmt1(n)
const pct = (d, base) => (base ? ` (${d > 0 ? '+' : ''}${Math.round(d / base * 1000) / 10}%)` : '')
const shiftTxt = s => (s == null || Math.abs(s) < 0.5 ? '' : s > 0 ? `${fmt1(s)}개월 밀림` : `${fmt1(-s)}개월 당겨짐`)
const mRange = arr => (!arr.length ? '' : arr.length === 1 ? arr[0] : `${arr[0]}~${last(arr)}`)

function ItemList({ title, tone, rows, render, onPick, empty = '없음' }) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, 8)
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className={`px-3 py-2 text-xs font-bold border-b border-slate-100 ${tone}`}>{title} <span className="text-slate-400 font-semibold">· {rows.length}개</span></div>
      {rows.length === 0 ? <div className="px-3 py-3 text-[11px] text-slate-300">{empty}</div> : (
        <div className="divide-y divide-slate-50">
          {shown.map(r => (
            <button key={r.std_code} onClick={() => onPick?.(r.std_code)} title={onPick ? '아래 표에서 이 품목 보기' : undefined}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${onPick ? 'hover:bg-indigo-50/50' : 'cursor-default'}`}>
              <span className="font-mono text-[11px] text-indigo-600 shrink-0">{r.std_code}</span>
              <span className="text-[11px] text-slate-400 truncate flex-1 min-w-0">{r.item_name}</span>
              <span className="text-[11px] font-bold shrink-0">{render(r)}</span>
            </button>
          ))}
          {rows.length > 8 && (
            <button onClick={() => setAll(v => !v)} className="w-full px-3 py-1.5 text-[11px] font-bold text-slate-400 hover:text-indigo-600">
              {all ? '접기' : `전체 ${rows.length}개 보기`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ForecastAnalysis({ a, latestBatch, prevBatch, open, setOpen, onPick }) {
  const kpi = [
    { l: '늘어난 품목', v: a.up.length, c: 'text-red-600' },
    { l: '줄어든 품목', v: a.down.length, c: 'text-blue-600' },
    { l: '일정만 바뀐 품목', v: a.movedOnly.length, c: 'text-amber-600' },
    { l: '신규 품목', v: a.added.length + a.addedOutside, c: 'text-emerald-600' },
    { l: '빠진 품목', v: a.removed.length, c: 'text-slate-600' },
    { l: '변동 없음', v: a.same, c: 'text-slate-400' },
  ]
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/20">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="text-sm font-bold text-slate-800">📊 변경점 분석 <span className="text-xs font-semibold text-slate-400">— 최신 {latestBatch?.received_date} vs 직전 {prevBatch?.received_date}</span></span>
        <span className="text-xs text-slate-400">{open ? '접기 ▲' : '펼치기 ▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="text-[11px] text-slate-500 leading-relaxed">
            비교 구간 <b className="text-slate-700">{mRange(a.win) || '없음'}</b> (두 회차가 모두 다루는 달)
            {a.droppedMonths.length > 0 && <> · 지난 달 <b>{mRange(a.droppedMonths)}</b> 는 새 파일에 없어 비교·표에서 뺐습니다</>}
            {a.addedMonths.length > 0 && <> · 새로 붙은 달 <b className="text-emerald-600">{mRange(a.addedMonths)}</b> 은 비교 대상 없음</>}
            {a.tailGone.length > 0 && <> · ⚠ 직전엔 있던 뒤쪽 달 <b className="text-red-600">{mRange(a.tailGone)}</b> 이 새 파일에 없습니다</>}
            {a.endedPast > 0 && <> · 지난 달 수요만 있던 품목 {a.endedPast}개는 끝난 것으로 봅니다</>}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <div className="rounded-lg bg-white border border-slate-200 px-3 py-2 col-span-2 sm:col-span-1">
              <div className="text-[10px] text-slate-400 font-semibold">비교 구간 총 수량</div>
              <div className="text-sm font-bold text-slate-800">{fmt1(a.totPrev)} → {fmt1(a.totCur)}</div>
              <div className={`text-[11px] font-bold ${a.totDiff > 0 ? 'text-red-500' : a.totDiff < 0 ? 'text-blue-500' : 'text-slate-400'}`}>{sgn(a.totDiff)}{pct(a.totDiff, a.totPrev)}</div>
            </div>
            {kpi.map(k => (
              <div key={k.l} className="rounded-lg bg-white border border-slate-200 px-3 py-2">
                <div className="text-[10px] text-slate-400 font-semibold">{k.l}</div>
                <div className={`text-lg font-bold ${k.c}`}>{k.v}</div>
              </div>
            ))}
          </div>

          {a.main.length > 0 && <MainChanges a={a} onPick={onPick} />}

          <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
            <table className="text-[11px] whitespace-nowrap w-full">
              <thead><tr className="bg-slate-50 text-slate-500">
                <th className="px-2 py-1.5 text-left font-bold">월별 합계</th>
                {a.monthly.map(x => <th key={x.m} className={`px-2 py-1.5 text-right font-bold ${x.kind === 'new' ? 'text-emerald-600' : ''}`}>{x.m.slice(2)}</th>)}
              </tr></thead>
              <tbody>
                <tr className="border-t border-slate-100"><td className="px-2 py-1 text-slate-400">직전</td>
                  {a.monthly.map(x => <td key={x.m} className="px-2 py-1 text-right text-slate-400">{x.prev == null ? '—' : fmt1(x.prev)}</td>)}</tr>
                <tr className="border-t border-slate-100"><td className="px-2 py-1 font-semibold text-slate-600">최신</td>
                  {a.monthly.map(x => <td key={x.m} className="px-2 py-1 text-right font-semibold text-slate-700">{fmt1(x.cur)}</td>)}</tr>
                <tr className="border-t border-slate-100"><td className="px-2 py-1 text-slate-400">증감</td>
                  {a.monthly.map(x => <td key={x.m} className={`px-2 py-1 text-right font-bold ${x.diff > 0 ? 'text-red-500' : x.diff < 0 ? 'text-blue-500' : 'text-slate-300'}`}>
                    {x.diff == null ? <span className="text-emerald-600 font-semibold">신규 월</span> : x.diff === 0 ? '·' : sgn(x.diff)}</td>)}</tr>
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ItemList title="▲ 늘어난 품목 (비교 구간 합)" tone="text-red-600" rows={a.up} onPick={onPick}
              render={r => <><span className="text-slate-400 font-normal">{fmt1(r.prevW)}→{fmt1(r.curW)}</span> <span className="text-red-500">{sgn(r.diffW)}</span>{shiftTxt(r.shift) && <span className="ml-1 text-amber-600 font-semibold">· {shiftTxt(r.shift)}</span>}</>} />
            <ItemList title="▼ 줄어든 품목 (비교 구간 합)" tone="text-blue-600" rows={a.down} onPick={onPick}
              render={r => <><span className="text-slate-400 font-normal">{fmt1(r.prevW)}→{fmt1(r.curW)}</span> <span className="text-blue-500">{sgn(r.diffW)}</span>{shiftTxt(r.shift) && <span className="ml-1 text-amber-600 font-semibold">· {shiftTxt(r.shift)}</span>}</>} />
            <ItemList title="↔ 수량은 같고 일정만 바뀐 품목" tone="text-amber-600" rows={a.movedOnly} onPick={onPick}
              render={r => <span className="text-amber-600">{shiftTxt(r.shift) || '월 배분 변경'}</span>} />
            <ItemList title="＋ 신규 품목 (직전 접수에 없음)" tone="text-emerald-600" rows={a.added} onPick={onPick}
              empty={a.addedOutside ? `새로 붙은 달에만 있는 신규 품목 ${a.addedOutside}개 — 표에서 「신규 품목만」으로 보세요` : '없음'}
              render={r => <span className="text-emerald-600">{fmt1(r.curW)}</span>} />
            <ItemList title="－ 빠진 품목 (비교 구간에 수요가 있었는데 새 파일에 없음)" tone="text-slate-600" rows={a.removed}
              render={r => <span className="text-slate-500">직전 {fmt1(r.prevW)} → 0</span>} />
          </div>
          <p className="text-[10px] text-slate-400">품목을 누르면 아래 표에서 그 품목만 보입니다 · 「밀림/당겨짐」은 비교 구간 안에서 수요의 무게중심이 옮겨 간 정도(개월)입니다 · 빠진 품목은 표에 없습니다</p>
        </div>
      )}
    </div>
  )
}

// 주요 110 품번 변동 — 품번마다 달별 「최신 수량 ▲▼증감」
function MainChanges({ a, onPick }) {
  const [onlyChg, setOnlyChg] = useState(true)
  const nChg = a.main.filter(r => r.changed).length
  const rows = onlyChg ? a.main.filter(r => r.changed) : a.main
  const ms = a.monthly.map(x => x.m)
  const W = new Set(a.win)
  return (
    <div className="rounded-lg border border-violet-200 bg-white">
      <div className="flex items-center justify-between gap-2 flex-wrap px-3 py-2 border-b border-violet-100">
        <span className="text-xs font-bold text-violet-700">⭐ 주요 110 품번 변동 <span className="text-slate-400 font-semibold">· 전체 {a.main.length}개 중 바뀐 것 {nChg}개</span></span>
        <label className="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer">
          <input type="checkbox" checked={onlyChg} onChange={e => setOnlyChg(e.target.checked)} /> 바뀐 것만
        </label>
      </div>
      {rows.length === 0 ? <div className="px-3 py-3 text-[11px] text-slate-400">110 품번은 직전 접수와 같습니다</div> : (
        <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
          <table className="text-[11px] whitespace-nowrap w-full">
            <thead className="sticky top-0 z-10"><tr className="bg-violet-50 text-slate-500">
              <th className="px-2 py-1.5 text-left font-bold sticky left-0 bg-violet-50">품번 · 품명</th>
              <th className="px-2 py-1.5 text-right font-bold">비교 구간 합</th>
              {ms.map(m => <th key={m} className={`px-2 py-1.5 text-right font-bold ${W.has(m) ? '' : 'text-emerald-600'}`}>{m.slice(2)}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.std_code} className={`border-t border-slate-100 ${r.removed ? 'bg-slate-50' : ''}`}>
                  <td className="px-2 py-1 sticky left-0 bg-white">
                    <button onClick={() => !r.removed && onPick(r.std_code)} className={`font-mono ${r.removed ? 'text-slate-400 line-through cursor-default' : 'text-indigo-600 hover:underline'}`}>{r.std_code}</button>
                    {r.isNew && <span className="ml-1 px-1 rounded bg-emerald-100 text-emerald-700 text-[9px] font-bold">신규</span>}
                    {r.removed && <span className="ml-1 px-1 rounded bg-slate-200 text-slate-600 text-[9px] font-bold">빠짐</span>}
                    {shiftTxt(r.shift) && <span className="ml-1 text-[10px] text-amber-600 font-semibold">{shiftTxt(r.shift)}</span>}
                    <div className="text-[10px] text-slate-400 max-w-[220px] truncate">{r.item_name}</div>
                  </td>
                  <td className="px-2 py-1 text-right">
                    {r.prevW == null ? <span className="text-emerald-600 font-bold">{fmt1(r.curW)}</span>
                      : <><span className="text-slate-400">{fmt1(r.prevW)}→</span><b className="text-slate-700">{fmt1(r.curW)}</b>
                        {r.diffW !== 0 && <span className={`ml-1 font-bold ${r.diffW > 0 ? 'text-red-500' : 'text-blue-500'}`}>{sgn(r.diffW)}</span>}</>}
                  </td>
                  {ms.map(m => {
                    const c = r.cur[m] || 0
                    const p = W.has(m) && r.prev[m] != null ? r.prev[m] : null
                    const d = p == null ? null : r1(c - p)
                    return (
                      <td key={m} className="px-2 py-1 text-right">
                        {c ? <span className="font-semibold text-slate-700">{fmt1(c)}</span> : <span className="text-slate-200">·</span>}
                        {d != null && d !== 0 && <span className={`ml-0.5 text-[10px] font-bold ${d > 0 ? 'text-red-500' : 'text-blue-500'}`}>{d > 0 ? '▲' : '▼'}{fmt1(Math.abs(d))}</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
