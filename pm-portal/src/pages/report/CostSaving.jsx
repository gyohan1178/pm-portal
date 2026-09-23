import { useState, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { must } from '../../lib/db'
import { todayISO } from '../../lib/utils'
import { toastError, toastSuccess } from '../../lib/toast'
import { downloadSheet } from '../../lib/exportSheet'
import * as XLSX from 'xlsx'
import { useCanEdit } from '../../hooks/useProfile'
import { computeSaving, candKey, byItem, byVendor, byCustomer, custOf, CUST_NAME, stdTotals, suspects, SAVING_KINDS } from '../../lib/costSaving'

// 원가절감 — 부서 KPI 보고용
//
//   ① 지표(자동)  입고 단가를 표준단가(DB단가)와 견줘 절감액을 계산한다.
//                 표준단가가 없는 품목은 직전 12개월 가중평균으로 대신 본다(후보용).
//   ② 실적 대장    후보에서 골라 등록하거나 직접 적는다. 대표 보고 숫자는 이 대장이 기준.
//
//   기준단가 = 표준단가(pm_std_price) → 없으면 직전 12개월 가중평균 · 수량 = 실제 입고수량

const n = (v) => Math.round(Number(v) || 0).toLocaleString('ko-KR')
const won = (v) => n(v) + '원'
const man = (v) => (Math.abs(Number(v) || 0) >= 10000 ? n((Number(v) || 0) / 10000) + '만' : n(v))
const yearOf = (d) => String(d || '').slice(0, 4)
const thisYear = () => todayISO().slice(0, 4)
const monthsBack = (k) => { const d = new Date(); d.setMonth(d.getMonth() - k); return d.toISOString().slice(0, 10) }
// 포털로 입고를 받기 시작한 날. 그 전 입고는 단가가 덜 채워져 있어 지표에서 뺀다.
//   ⚠ 화면(🎯 목표·집계 기준)에서 바꿀 수 있다. 바꾼 값은 pm_settings 에 남는다.
const DEFAULT_START = '2026-07-01'

async function fetchInbound() {
  // 기준단가 계산에 직전 12개월이 필요하니 넉넉히 3년치를 본다
  const rows = await fetchAll(() => supabase.from('stock_movements')
    .select('id,item_id,qty,unit_price,movement_date,items(std_code,name),purchase_orders(po_number,vendors(name))')
    .eq('movement_type', '입고').gte('movement_date', monthsBack(36))
    .order('id'))
  return rows.map((r) => ({
    id: r.id, item_id: r.item_id, qty: r.qty, unit_price: r.unit_price, movement_date: r.movement_date,
    std_code: r.items?.std_code || '', name: r.items?.name || '',
    po_number: r.purchase_orders?.po_number || '', vendor: r.purchase_orders?.vendors?.name || '',
  }))
}
// ⚠ 표준단가는 1,000개가 넘는다. 기본 조회는 1,000행에서 잘리므로 끝까지 받는다.
const fetchStd = () => fetchAll(() => supabase.from('pm_std_price')
  .select('id,item_id,std_code,price,price_avg,avg_base,base_date,source').order('id'))
const fetchLedger = async () => must(await supabase.from('pm_cost_saving').select('*').order('ym', { ascending: false }), '실적 대장 조회') || []
const fetchSkip = async () => must(await supabase.from('pm_cost_saving_skip').select('key'), '숨긴 후보 조회') || []
const fetchTarget = async () => {
  const r = must(await supabase.from('pm_settings').select('value').eq('key', 'cost_saving_target').maybeSingle(), '목표 조회')
  return r?.value || { year: Number(thisYear()), amount: 0, start: DEFAULT_START }
}

const KPI = ({ t, v, n: note, tone = '' }) => (
  <div className={`rounded-xl border p-3 ${{
    ok: 'border-emerald-200 bg-emerald-50/60', warn: 'border-rose-200 bg-rose-50/60',
    info: 'border-indigo-200 bg-indigo-50/60', '': 'border-slate-200 bg-white',
  }[tone]}`}>
    <div className="text-[12px] font-semibold text-slate-400">{t}</div>
    <div className={`text-2xl font-extrabold tabular-nums ${{
      ok: 'text-emerald-600', warn: 'text-rose-600', info: 'text-indigo-600', '': 'text-slate-800',
    }[tone]}`}>{v}</div>
    <div className="text-[10.5px] text-slate-400 leading-snug">{note}</div>
  </div>
)

export default function CostSaving() {
  const qc = useQueryClient()
  const canEdit = useCanEdit()
  const [tab, setTab] = useState('kpi')     // kpi | ledger
  const [year, setYear] = useState(thisYear())
  const [form, setForm] = useState(null)    // 등록 모달
  const [targetOpen, setTargetOpen] = useState(false)
  const [stdQ, setStdQ] = useState('')
  const [split, setSplit] = useState('cust')   // 고객사별 / 구매처별
  const [basis, setBasis] = useState('db')     // 기준단가: db(DB단가) / avg(최근 실구매 가중평균)
  const stdFileRef = useRef(null)

  const { data: inbound = [], isLoading, error } = useQuery({ queryKey: ['csInbound'], queryFn: fetchInbound, staleTime: 5 * 60 * 1000 })
  const { data: ledger = [] } = useQuery({ queryKey: ['csLedger'], queryFn: fetchLedger })
  const { data: skips = [] } = useQuery({ queryKey: ['csSkip'], queryFn: fetchSkip })
  const { data: target } = useQuery({ queryKey: ['csTarget'], queryFn: fetchTarget })
  const { data: stdRows = [] } = useQuery({ queryKey: ['csStd'], queryFn: fetchStd, staleTime: 5 * 60 * 1000 })

  // 기준 두 가지 — ① DB단가(작년에 정한 목표가)  ② 최근 실구매 가중평균(실제로 산 값)
  //   ①은 환율·원자재가 오르면 구조적으로 마이너스가 난다. ②는 「직전 기간 대비」를 본다.
  const stdOf = useMemo(() => {
    const m = new Map()
    for (const r of stdRows) {
      const p = Number(basis === 'avg' ? r.price_avg : r.price)
      if (!(p > 0)) continue
      if (r.item_id) m.set(r.item_id, p)
      if (r.std_code) m.set(r.std_code, p)
    }
    return m
  }, [stdRows, basis])
  const hasAvg = useMemo(() => stdRows.some((r) => Number(r.price_avg) > 0), [stdRows])
  // 집계 시작일 — 포털로 입고를 받기 시작한 날. 그 전 자료는 단가가 덜 채워져 있어 지표를 망친다.
  const start = target?.start || DEFAULT_START
  const seen = useMemo(() => inbound.filter((r) => !start || String(r.movement_date) >= start), [inbound, start])
  const calc = useMemo(() => computeSaving(seen, { stdOf }), [seen, stdOf])
  const skipSet = useMemo(() => new Set(skips.map((s) => s.key)), [skips])
  const doneSet = useMemo(() => new Set(ledger.map((l) => `${l.item_id}|${l.ym}`)), [ledger])

  const yRows = calc.rows.filter((r) => yearOf(r.movement_date) === year)
  const yLedger = ledger.filter((l) => String(l.ym).slice(0, 4) === year)
  const cand = calc.cand.filter((r) => yearOf(r.movement_date) === year
    && !skipSet.has(candKey(r)) && !doneSet.has(`${r.item_id}|${String(r.movement_date).slice(0, 7)}`))

  const buy = yRows.reduce((a, r) => a + r.buy, 0)
  const autoSave = yRows.reduce((a, r) => a + (r.diff > 0 ? r.diff : 0), 0)
  const autoLoss = yRows.reduce((a, r) => a + (r.diff < 0 ? -r.diff : 0), 0)
  const st = useMemo(() => stdTotals(yRows), [yRows])           // 표준단가로 잰 것만
  const susp = useMemo(() => suspects(yRows), [yRows])          // 표준단가가 어긋나 보이는 줄
  const cover = buy ? (st.buy / buy) * 100 : 0                   // 표준단가가 있는 구매 비중
  const fixed = yLedger.reduce((a, l) => a + (Number(l.amount) || 0), 0)
  const goal = Number(target?.amount) || 0
  const years = [...new Set([...calc.rows.map((r) => yearOf(r.movement_date)), ...ledger.map((l) => String(l.ym).slice(0, 4)), thisYear()])]
    .filter(Boolean).sort().reverse()

  // 월별 — 확정(대장) vs 자동
  const months = useMemo(() => {
    const m = new Map()
    for (let i = 1; i <= 12; i++) {
      const ym = `${year}-${String(i).padStart(2, '0')}`
      m.set(ym, { ym, fixed: 0, auto: 0, buy: 0 })
    }
    yRows.forEach((r) => {
      const x = m.get(String(r.movement_date).slice(0, 7)); if (!x) return
      x.buy += r.buy
      if (r.basis === 'std') x.auto += r.diff        // 표준단가 기준 순액 (오른 것은 깎인다)
    })
    yLedger.forEach((l) => { const x = m.get(String(l.ym)); if (x) x.fixed += Number(l.amount) || 0 })
    return [...m.values()]
  }, [yRows, yLedger, year])
  const maxM = Math.max(1, ...months.map((m) => Math.max(m.fixed, Math.abs(m.auto))))

  const kindSum = useMemo(() => {
    const m = new Map(SAVING_KINDS.map((k) => [k, 0]))
    yLedger.forEach((l) => m.set(l.kind, (m.get(l.kind) || 0) + (Number(l.amount) || 0)))
    return [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  }, [yLedger])

  const topItems = useMemo(() => byItem(yRows).sort((a, b) => b.diff - a.diff), [yRows])
  const vendors = useMemo(() => byVendor(yRows), [yRows])
  const custs = useMemo(() => byCustomer(yRows), [yRows])
  const splitRows = split === 'cust' ? custs : vendors

  /* ---- 표준단가 ---- */
  const lastPrice = useMemo(() => {
    const m = new Map()
    for (const r of calc.rows) {
      const k = r.std_code || r.item_id
      const x = m.get(k)
      if (!x || String(r.movement_date) > x.d) m.set(k, { d: String(r.movement_date), p: r.price })
    }
    return m
  }, [calc.rows])
  const nameOf = useMemo(() => {
    const m = new Map()
    for (const r of calc.rows) if (r.std_code && !m.has(r.std_code)) m.set(r.std_code, r.name)
    return m
  }, [calc.rows])
  const stdView = useMemo(() => {
    const q = stdQ.trim().toUpperCase()
    return stdRows
      .map((r) => ({ ...r, price: Number(r.price), name: nameOf.get(r.std_code) || '', last: lastPrice.get(r.std_code)?.p || null }))
      .filter((r) => !q || r.std_code.toUpperCase().includes(q) || (r.name || '').toUpperCase().includes(q))
      .sort((a, b) => a.std_code.localeCompare(b.std_code))
  }, [stdRows, stdQ, nameOf, lastPrice])

  const reloadStd = () => qc.invalidateQueries({ queryKey: ['csStd'] })
  async function patchStd(code, price) {
    if (!(price > 0)) { toastError('단가는 0보다 커야 합니다'); return }
    try {
      must(await supabase.from('pm_std_price').update({ price, updated_at: new Date().toISOString() }).eq('std_code', code), '표준단가 수정')
      reloadStd(); toastSuccess(`${code} 표준단가 ${n(price)}원`)
    } catch (e) { toastError(e.message) }
  }
  async function delStd(code) {
    if (!window.confirm(`${code} 표준단가를 지울까요?`)) return
    try {
      must(await supabase.from('pm_std_price').delete().eq('std_code', code), '표준단가 삭제')
      reloadStd(); toastSuccess('지웠습니다')
    } catch (e) { toastError(e.message) }
  }
  // 엑셀 올리기 — 품목코드·단가 두 칸만 보면 된다
  async function uploadStd(file) {
    if (!file) return
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const pick = (r, keys) => { for (const k of Object.keys(r)) if (keys.some((x) => String(k).replace(/\s/g, '').includes(x))) return r[k]; return '' }
      const payload = []
      for (const r of rows) {
        const code = String(pick(r, ['품목코드', '기준코드', '품번', 'PN'])).trim().replace(/^AX-/i, '')
        const price = Number(String(pick(r, ['DB단가', '표준단가', '단가', 'PRICE'])).replace(/[,₩\s]/g, ''))
        if (!code || !(price > 0)) continue
        payload.push({ std_code: 'AX-' + code, price, base_date: todayISO(), source: '엑셀 업로드' })
      }
      if (!payload.length) { toastError('품목코드·단가 칸을 찾지 못했습니다'); return }
      // 기준코드 DB 와 연결
      const codes = payload.map((p) => p.std_code)
      const items = []
      for (let i = 0; i < codes.length; i += 200) {
        items.push(...(must(await supabase.from('items').select('id,std_code').in('std_code', codes.slice(i, i + 200)), '품목 조회') || []))
      }
      const idOf = new Map(items.map((i) => [i.std_code, i.id]))
      payload.forEach((p) => { p.item_id = idOf.get(p.std_code) || null })
      for (let i = 0; i < payload.length; i += 200) {
        must(await supabase.from('pm_std_price').upsert(payload.slice(i, i + 200), { onConflict: 'std_code' }), '표준단가 저장')
      }
      reloadStd()
      toastSuccess(`표준단가 ${payload.length.toLocaleString('ko-KR')}개 올림 · 기준코드 연결 ${idOf.size.toLocaleString('ko-KR')}개`)
    } catch (e) { toastError('엑셀 올리기 실패: ' + e.message) }
  }
  async function exportStd() {
    try {
      await downloadSheet({
        title: '표준단가 (DB단가)', sheetName: '표준단가', fileName: `표준단가_${todayISO()}.xlsx`,
        meta: [['품목수', String(stdRows.length)], ['작성', `${todayISO()} · 진선테크 구매자재팀`]],
        rows: stdView.map((r) => ({
          기준코드: r.std_code, 품명: r.name, 표준단가: Math.round(r.price),
          최근입고단가: r.last ? Math.round(r.last) : '', 차이: r.last ? Math.round(r.price - r.last) : '',
          기준일: r.base_date || '', 출처: r.source || '',
        })),
      })
    } catch (e) { toastError('내보내기 실패: ' + e.message) }
  }

  /* ---- 등록 ---- */
  function openFrom(r) {
    setForm({
      ym: String(r.movement_date).slice(0, 7), kind: '단가인하',
      item_id: r.item_id, std_code: r.std_code, item_name: r.name,
      vendor_name: r.vendor, po_number: r.po_number,
      base_price: Math.round(r.base), new_price: r.price, qty: r.qty,
      note: '', source: 'auto', _key: candKey(r),
    })
  }
  const openBlank = () => setForm({
    ym: todayISO().slice(0, 7), kind: '단가인하', std_code: '', item_name: '', vendor_name: '', po_number: '',
    base_price: '', new_price: '', qty: '', note: '', source: 'manual',
  })
  const amountOf = (f) => Math.round((Number(f.base_price) - Number(f.new_price)) * Number(f.qty)) || 0

  async function save() {
    const f = form
    if (!f.item_name && !f.std_code) { toastError('품목을 적어주세요'); return }
    const amount = amountOf(f)
    if (!amount) { toastError('절감액이 0원입니다 — 기준단가·적용단가·수량을 확인하세요'); return }
    try {
      must(await supabase.from('pm_cost_saving').insert({
        ym: f.ym, kind: f.kind, item_id: f.item_id || null, std_code: f.std_code || null, item_name: f.item_name || null,
        vendor_name: f.vendor_name || null, po_number: f.po_number || null,
        base_price: Number(f.base_price) || null, new_price: Number(f.new_price) || null,
        qty: Number(f.qty) || null, amount, note: f.note || null, source: f.source,
      }), '실적 등록')
      toastSuccess(`${won(amount)} 등록`)
      setForm(null)
      qc.invalidateQueries({ queryKey: ['csLedger'] })
    } catch (e) { toastError(e.message) }
  }
  async function skip(r) {
    try {
      must(await supabase.from('pm_cost_saving_skip').insert({ key: candKey(r), reason: '해당 없음' }), '후보 숨기기')
      qc.invalidateQueries({ queryKey: ['csSkip'] })
    } catch (e) { toastError(e.message) }
  }
  async function del(id) {
    if (!window.confirm('이 실적을 지울까요?')) return
    try {
      must(await supabase.from('pm_cost_saving').delete().eq('id', id), '실적 삭제')
      qc.invalidateQueries({ queryKey: ['csLedger'] }); toastSuccess('지웠습니다')
    } catch (e) { toastError(e.message) }
  }
  async function saveTarget(v, s) {
    try {
      const value = { year: Number(year), amount: Number(v) || 0, start: String(s || '').slice(0, 10) || null }
      must(await supabase.from('pm_settings').upsert({ key: 'cost_saving_target', value, updated_at: new Date().toISOString() }), '목표 저장')
      qc.invalidateQueries({ queryKey: ['csTarget'] }); setTargetOpen(false); toastSuccess('저장했습니다')
    } catch (e) { toastError(e.message) }
  }

  async function exportXlsx() {
    // 대장이 비어 있어도 계산 명세는 나가야 한다 — 보고는 이 표로 한다
    const rows = tab === 'ledger' && yLedger.length
      ? yLedger.map((l, i) => ({
        No: i + 1, 인정월: l.ym, 유형: l.kind, 기준코드: l.std_code, 품명: l.item_name,
        구매처: l.vendor_name, 발주번호: l.po_number,
        기준단가: Number(l.base_price) || '', 적용단가: Number(l.new_price) || '', 수량: Number(l.qty) || '',
        절감액: Number(l.amount) || 0, 사유: l.note, 상태: l.status,
      }))
      : yRows.map((r, i) => ({
        No: i + 1, 입고일: r.movement_date, 고객사: CUST_NAME[custOf(r.std_code)] || custOf(r.std_code),
        기준코드: r.std_code, 품명: r.name, 구매처: r.vendor, 발주번호: r.po_number,
        기준: r.basis === 'std' ? '표준단가' : r.basis === 'susp' ? '표준단가 점검필요' : r.basis === 'avg' ? '12개월평균' : '기준없음',
        표준단가: r.std ? Math.round(r.std) : '',
        기준단가: r.base ? Math.round(r.base) : '', 입고단가: Math.round(r.price), 수량: r.qty,
        구매액: Math.round(r.buy), 기준금액: r.base ? Math.round(r.baseBuy) : '',
        절감액: Math.round(r.diff), '차이율(%)': r.base ? Number(r.pct.toFixed(1)) : '',
      }))
    if (!rows.length) { toastError(`${year}년 입고 기록이 없습니다`); return }
    try {
      await downloadSheet({
        title: `원가절감 ${tab === 'ledger' && yLedger.length ? '실적 대장' : '계산 명세'} — ${year}년`,
        sheetName: '원가절감',
        fileName: `원가절감_${year}_${todayISO()}.xlsx`,
        meta: [
          ['표준단가 대비 절감', won(st.net)], ['절감율', st.baseBuy ? st.pct.toFixed(1) + '%' : '—'],
          ['구매액(입고 기준)', won(buy)], ['표준단가 적용률', cover.toFixed(0) + '%'],
          ['확정 절감액(대장)', won(fixed)], ['연간 목표', won(goal)],
          ['집계 시작일', start || '전체 (제한 없음)'],
          ['기준단가', basis === 'avg' ? '최근 실구매 가중평균' : '표준단가(DB단가)'],
          ['기준', '표준단가(DB단가) → 없으면 직전 12개월 가중평균 · 수량 = 실제 입고수량'],
          ['작성', `${todayISO()} · 진선테크 구매자재팀`],
        ],
        rows,
      })
    } catch (e) { toastError('엑셀 내보내기 실패: ' + e.message) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold text-slate-400">📊 분석</p>
          <h1 className="text-xl font-extrabold text-slate-900">원가절감 실적</h1>
          <p className="text-[13px] text-slate-400 mt-0.5">
            입고 단가를 <b className="text-slate-500">표준단가(DB단가)</b>와 견주어 절감액을 계산합니다. 표준단가가 없는 품목은 직전 12개월 가중평균으로 대신 봅니다.
            따로 인정할 건(업체변경·대체품 등)은 실적 대장에 남기세요.
          </p>
          <p className="text-[11.5px] text-slate-400 mt-1">
            집계 시작일 <b className="text-indigo-600">{start || '전체'}</b>
            <span className="text-slate-300"> — 그 전 입고는 지표에서 뺍니다 </span>
            <button onClick={() => setTargetOpen(true)} className="text-indigo-500 font-bold underline decoration-dotted">바꾸기</button>
          </p>
          {/* 기준단가 — 무엇과 견줄 것인가 */}
          <div className="flex items-center gap-1.5 mt-2">
            <span className="text-[11px] font-bold text-slate-400">기준단가</span>
            {[['db', 'DB단가', '작년에 정한 목표가'], ['avg', '최근 실구매', '직전 기간에 실제로 산 값']].map(([k, l, tip]) => (
              <button key={k} onClick={() => setBasis(k)} title={tip}
                disabled={k === 'avg' && !hasAvg}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border ${basis === k
                  ? 'border-violet-300 bg-violet-50 text-violet-700'
                  : k === 'avg' && !hasAvg ? 'border-slate-100 text-slate-300 cursor-not-allowed'
                    : 'border-slate-200 text-slate-400 hover:bg-slate-50'}`}>{l}</button>
            ))}
            <span className="text-[10.5px] text-slate-400">
              {basis === 'db'
                ? '작년 목표가와 견줍니다 — 환율·자재값이 오르면 구조적으로 마이너스가 납니다'
                : '직전 기간 실구매 가중평균과 견줍니다 — 「전보다 싸게 샀나」를 봅니다'}
              {!hasAvg && <b className="text-rose-500"> · 실구매 기준은 pm_std_price_avg SQL 을 돌려야 켜집니다</b>}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={(e) => setYear(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white">
            {years.map((y) => <option key={y} value={y}>{y}년</option>)}
          </select>
          <button onClick={exportXlsx} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100">📑 엑셀</button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">입고 기록을 못 불러왔습니다 — {error.message}</div>
      )}

      {/* 지표 */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <KPI t={(basis === 'avg' ? '실구매 평균' : '표준단가') + ' 대비 절감'} v={man(st.net) + '원'} tone="ok"
          n={`절감 ${man(st.save)} · 상승 ${man(st.loss)} · ${n(st.n)}건`} />
        <KPI t="절감율" v={st.baseBuy ? st.pct.toFixed(1) + '%' : '—'} tone="ok"
          n={`${basis === 'avg' ? '실구매 평균' : '표준단가'} 기준 ${man(st.baseBuy)}원 → 실구매 ${man(st.buy)}원`} />
        <KPI t="구매액 (입고 기준)" v={man(buy) + '원'} n={`${n(yRows.length)}건 입고 · 표준단가 적용 ${cover.toFixed(0)}%`} />
        <KPI t="확정 절감액 (대장)" v={man(fixed) + '원'} tone="info"
          n={goal ? `목표 ${man(goal)}원 대비 ${Math.round((fixed / goal) * 100)}%` : '연간 목표 미설정'} />
        <KPI t="등록 대기 후보" v={n(cand.length) + '건'} tone={cand.length ? 'info' : ''}
          n={cand.length ? `${man(cand.reduce((a, r) => a + r.diff, 0))}원어치 — 대장 탭에서 등록` : '새 후보 없음'} />
        <KPI t="표준단가 점검 필요" v={n(susp.length) + '건'} tone={susp.length ? 'warn' : ''}
          n={susp.length ? '표준단가와 5배 넘게 차이 — 지표에서 뺐습니다. 아래 표 확인' : '표준단가가 크게 어긋난 건 없음'} />
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[['kpi', '지표'], ['ledger', `실적 대장 ${yLedger.length ? `(${yLedger.length})` : ''}`], ['std', `표준단가 ${stdRows.length ? `(${stdRows.length})` : ''}`]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 text-xs font-bold rounded-md ${tab === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{l}</button>
        ))}
        {canEdit && (
          <button onClick={() => setTargetOpen(true)} className="px-3 py-1.5 text-xs font-bold rounded-md text-slate-500">🎯 목표</button>
        )}
      </div>

      {isLoading ? <p className="py-10 text-center text-sm text-slate-400">불러오는 중…</p> : tab === 'kpi' ? (
        <>
          {susp.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4">
              <p className="text-sm font-bold text-rose-700">⚠ 표준단가 점검 필요 {susp.length}건</p>
              <p className="text-[11px] text-slate-500 mb-2">표준단가와 입고단가가 5배 넘게 벌어진 건입니다. 단위(EA↔M)·환율·품번이 어긋났을 가능성이 큽니다. 지표에서는 뺐습니다.</p>
              <table className="w-full text-xs">
                <thead><tr className="text-slate-400 text-left">
                  <th className="py-1">입고일</th><th className="py-1">기준코드 / 품명</th>
                  <th className="py-1 text-right">표준단가</th><th className="py-1 text-right">입고단가</th>
                  <th className="py-1 text-right">배수</th><th className="py-1 text-right">수량</th><th className="py-1">구매처</th>
                </tr></thead>
                <tbody>
                  {susp.slice(0, 15).map((r) => (
                    <tr key={r.id} className="border-t border-rose-100">
                      <td className="py-1.5 text-slate-500">{r.movement_date}</td>
                      <td className="py-1.5"><span className="font-mono text-indigo-600">{r.std_code}</span>
                        <div className="text-[11px] text-slate-400 truncate max-w-[240px]">{r.name}</div></td>
                      <td className="py-1.5 text-right tabular-nums">{n(r.std)}</td>
                      <td className="py-1.5 text-right tabular-nums font-bold">{n(r.price)}</td>
                      <td className="py-1.5 text-right tabular-nums text-rose-600 font-bold">
                        {r.price > r.std ? `${(r.price / r.std).toFixed(0)}배 비쌈` : `${(r.std / r.price).toFixed(0)}배 쌈`}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-500">{n(r.qty)}</td>
                      <td className="py-1.5 text-slate-500 truncate max-w-[110px]">{r.vendor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {susp.length > 15 && <p className="text-[11px] text-slate-400 mt-1">… 외 {susp.length - 15}건. 엑셀로 내보내면 전부 보입니다.</p>}
            </div>
          )}

          {/* 월별 */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-bold text-slate-700">월별 절감</p>
            <p className="text-[11px] text-slate-400 mb-3">진한 막대 = 확정(대장) · 연한 막대 = 표준단가 대비 절감</p>
            <div className="flex items-end gap-2 h-40">
              {months.map((m) => (
                <div key={m.ym} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end justify-center gap-0.5 h-32">
                    <div className="w-1/2 bg-emerald-500 rounded-t" style={{ height: `${(m.fixed / maxM) * 100}%` }} title={`확정 ${won(m.fixed)}`} />
                    <div className="w-1/2 bg-indigo-200 rounded-t" style={{ height: `${(m.auto / maxM) * 100}%` }} title={`자동 ${won(m.auto)}`} />
                  </div>
                  <div className="text-[10px] text-slate-400">{m.ym.slice(5)}월</div>
                  <div className="text-[10px] font-bold text-emerald-700 tabular-nums">{m.fixed ? man(m.fixed) : ''}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* 유형별 */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-bold text-slate-700 mb-2">유형별 구성 (대장)</p>
              {kindSum.length ? kindSum.map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 py-1">
                  <span className="w-20 text-xs text-slate-500">{k}</span>
                  <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-400" style={{ width: `${(v / fixed) * 100}%` }} />
                  </div>
                  <span className="w-24 text-right text-xs font-bold tabular-nums text-slate-600">{won(v)}</span>
                </div>
              )) : <p className="text-xs text-slate-400 py-6 text-center">아직 등록된 실적이 없습니다.</p>}
            </div>
            {/* 고객사별 · 구매처별 — 대표 보고는 이 표로 갈라서 한다 */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-slate-700">{split === 'cust' ? '고객사별' : '구매처별'} 절감율</p>
                <div className="flex gap-1">
                  {[['cust', '고객사'], ['vendor', '구매처']].map(([k, l]) => (
                    <button key={k} onClick={() => setSplit(k)}
                      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border ${split === k
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-400 hover:bg-slate-50'}`}>{l}</button>
                  ))}
                </div>
              </div>
              <table className="w-full text-xs">
                <thead><tr className="text-slate-400 text-left">
                  <th className="py-1">{split === 'cust' ? '고객사' : '구매처'}</th>
                  <th className="py-1 text-right">구매액</th>
                  <th className="py-1 text-right">절감액</th>
                  <th className="py-1 text-right">절감율</th>
                  <th className="py-1 text-right">적용률</th>
                </tr></thead>
                <tbody>
                  {splitRows.slice(0, split === 'cust' ? 10 : 8).map((v) => (
                    <tr key={v.key} className="border-t border-slate-100">
                      <td className="py-1.5 truncate max-w-[130px]" title={v.key}>
                        {split === 'cust' ? (CUST_NAME[v.key] || v.key) : v.key}
                        <span className="text-[10px] text-slate-300"> {n(v.n)}건</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-slate-600">{man(v.buy)}</td>
                      <td className={`py-1.5 text-right tabular-nums font-bold ${v.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{man(v.net)}</td>
                      <td className={`py-1.5 text-right tabular-nums font-bold ${v.pct == null ? 'text-slate-300' : v.pct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {v.pct == null ? '—' : v.pct.toFixed(1) + '%'}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-slate-400">{v.cover.toFixed(0)}%</td>
                    </tr>
                  ))}
                  {!splitRows.length && <tr><td colSpan={5} className="py-6 text-center text-slate-400">입고 기록이 없습니다.</td></tr>}
                </tbody>
              </table>
              <p className="text-[10.5px] text-slate-400 mt-2 leading-snug">
                절감율은 표준단가로 잰 것만 세고, 「적용률」은 그 구매액 비중입니다. 적용률이 낮으면 절감율도 덜 믿을 만합니다.
              </p>
            </div>
          </div>

          {/* 품목 Top */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-bold text-slate-700 mb-2">품목별 단가효과 Top 15</p>
            <table className="w-full text-xs">
              <thead><tr className="text-slate-400 text-left">
                <th className="py-1">기준코드 / 품명</th><th className="py-1 text-right">입고수량</th>
                <th className="py-1 text-right">구매액</th><th className="py-1 text-right">단가효과</th><th className="py-1">최근 입고</th>
              </tr></thead>
              <tbody>
                {topItems.slice(0, 15).map((t) => (
                  <tr key={t.item_id} className="border-t border-slate-100">
                    <td className="py-1.5"><span className="font-mono text-indigo-600">{t.std_code}</span>
                      <div className="text-[11px] text-slate-400 truncate max-w-[280px]">{t.name}</div></td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">{n(t.qty)}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-600">{man(t.buy)}</td>
                    <td className={`py-1.5 text-right tabular-nums font-bold ${t.diff >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{man(t.diff)}</td>
                    <td className="py-1.5 text-slate-400">{t.last}</td>
                  </tr>
                ))}
                {!topItems.length && <tr><td colSpan={5} className="py-6 text-center text-slate-400">입고 기록이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : tab === 'std' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div>
              <p className="text-sm font-bold text-slate-700">표준단가 (DB단가)</p>
              <p className="text-[11px] text-slate-400">이 단가와 입고 단가를 견주어 절감액이 계산됩니다. 품번은 AX- 없이 적어도 됩니다.</p>
            </div>
            <input value={stdQ} onChange={(e) => setStdQ(e.target.value)} placeholder="품번·품명 검색"
              className="ml-auto px-3 py-1.5 text-sm border border-slate-200 rounded-lg w-56" />
            {canEdit && (
              <>
                <button onClick={() => stdFileRef.current?.click()}
                  title="엑셀 파일에 품목코드·단가 두 칸만 있으면 됩니다"
                  className="px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100">📤 엑셀로 올리기</button>
                <input ref={stdFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={(e) => { uploadStd(e.target.files?.[0]); e.target.value = '' }} />
              </>
            )}
            <button onClick={exportStd} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-emerald-50">📑 내려받기</button>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="text-slate-400 text-left">
              <th className="py-1">기준코드 / 품명</th><th className="py-1 text-right">표준단가</th>
              <th className="py-1 text-right">최근 입고단가</th><th className="py-1 text-right">차이</th>
              <th className="py-1">기준일 · 출처</th><th className="w-10" />
            </tr></thead>
            <tbody>
              {stdView.slice(0, 200).map((r) => (
                <tr key={r.std_code} className="border-t border-slate-100">
                  <td className="py-1.5"><span className="font-mono text-indigo-600">{r.std_code}</span>
                    <div className="text-[11px] text-slate-400 truncate max-w-[260px]">{r.name}</div></td>
                  <td className="py-1.5 text-right">
                    {canEdit ? (
                      <input type="number" defaultValue={Math.round(r.price)}
                        onBlur={(e) => Number(e.target.value) !== Math.round(r.price) && patchStd(r.std_code, Number(e.target.value))}
                        className="w-24 px-2 py-1 text-right border border-slate-200 rounded-lg" />
                    ) : <span className="tabular-nums">{n(r.price)}</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-slate-500">{r.last ? n(r.last) : '—'}</td>
                  <td className={`py-1.5 text-right tabular-nums font-bold ${r.last ? (r.price - r.last >= 0 ? 'text-emerald-600' : 'text-rose-600') : 'text-slate-300'}`}>
                    {r.last ? n(r.price - r.last) : '—'}</td>
                  <td className="py-1.5 text-slate-400">{r.base_date || '—'} {r.source ? `· ${r.source}` : ''}</td>
                  <td className="py-1.5 text-right">{canEdit && <button onClick={() => delStd(r.std_code)} className="text-slate-300 hover:text-rose-600">×</button>}</td>
                </tr>
              ))}
              {!stdView.length && <tr><td colSpan={6} className="py-8 text-center text-slate-400">표준단가가 없습니다. 엑셀로 올리거나 SQL 로 넣으세요.</td></tr>}
            </tbody>
          </table>
          {stdView.length > 200 && <p className="text-[11px] text-slate-400">… 200줄까지만 보입니다. 검색으로 좁혀 보세요.</p>}
        </div>
      ) : (
        <>
          {/* 후보 */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-slate-700">자동 후보 {cand.length}건</p>
              <p className="text-[11px] text-slate-400">직전 12개월 평균보다 3% 이상 · 3만원 이상 싸게 산 입고</p>
              {canEdit && <button onClick={openBlank} className="ml-auto px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 bg-white text-slate-600">+ 직접 등록</button>}
            </div>
            <table className="w-full text-xs mt-2">
              <thead><tr className="text-slate-400 text-left">
                <th className="py-1">입고일</th><th className="py-1">기준코드 / 품명</th><th className="py-1">구매처</th>
                <th className="py-1 text-right">기준단가</th><th className="py-1 text-right">이번단가</th>
                <th className="py-1 text-right">수량</th><th className="py-1 text-right">절감액</th><th className="w-28" />
              </tr></thead>
              <tbody>
                {cand.slice(0, 30).map((r) => (
                  <tr key={r.id} className="border-t border-indigo-100">
                    <td className="py-1.5 text-slate-500">{r.movement_date}</td>
                    <td className="py-1.5"><span className="font-mono text-indigo-600">{r.std_code}</span>
                      <div className="text-[11px] text-slate-400 truncate max-w-[220px]">{r.name}</div></td>
                    <td className="py-1.5 text-slate-500 truncate max-w-[110px]">{r.vendor || '—'}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">{n(r.base)}</td>
                    <td className="py-1.5 text-right tabular-nums font-bold">{n(r.price)}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">{n(r.qty)}</td>
                    <td className="py-1.5 text-right tabular-nums font-bold text-emerald-600">{n(r.diff)}<div className="text-[10px] text-slate-400">{r.pct.toFixed(0)}%↓</div></td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {canEdit && <>
                        <button onClick={() => openFrom(r)} className="px-2 py-1 rounded-lg bg-indigo-600 text-white font-bold">등록</button>
                        <button onClick={() => skip(r)} className="ml-1 px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-400">숨김</button>
                      </>}
                    </td>
                  </tr>
                ))}
                {!cand.length && <tr><td colSpan={8} className="py-6 text-center text-slate-400">새 후보가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>

          {/* 대장 */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-bold text-slate-700 mb-2">{year}년 실적 대장 — 합계 {won(fixed)}</p>
            <table className="w-full text-xs">
              <thead><tr className="text-slate-400 text-left">
                <th className="py-1">인정월</th><th className="py-1">유형</th><th className="py-1">기준코드 / 품명</th>
                <th className="py-1">구매처</th><th className="py-1 text-right">기준→적용</th><th className="py-1 text-right">수량</th>
                <th className="py-1 text-right">절감액</th><th className="py-1">사유</th><th className="w-10" />
              </tr></thead>
              <tbody>
                {yLedger.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="py-1.5 text-slate-500">{l.ym}</td>
                    <td className="py-1.5"><span className="px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-600">{l.kind}</span></td>
                    <td className="py-1.5"><span className="font-mono text-indigo-600">{l.std_code}</span>
                      <div className="text-[11px] text-slate-400 truncate max-w-[220px]">{l.item_name}</div></td>
                    <td className="py-1.5 text-slate-500 truncate max-w-[110px]">{l.vendor_name || '—'}</td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">{n(l.base_price)} → <b className="text-slate-700">{n(l.new_price)}</b></td>
                    <td className="py-1.5 text-right tabular-nums text-slate-500">{n(l.qty)}</td>
                    <td className="py-1.5 text-right tabular-nums font-bold text-emerald-600">{n(l.amount)}</td>
                    <td className="py-1.5 text-slate-400 truncate max-w-[160px]" title={l.note}>{l.note}</td>
                    <td className="py-1.5 text-right">{canEdit && <button onClick={() => del(l.id)} className="text-slate-300 hover:text-rose-600">×</button>}</td>
                  </tr>
                ))}
                {!yLedger.length && <tr><td colSpan={9} className="py-8 text-center text-slate-400">등록된 실적이 없습니다. 위 후보에서 「등록」을 누르세요.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* 등록 모달 */}
      {form && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setForm(null)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-lg space-y-3" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-base font-bold text-slate-900">원가절감 실적 등록</h3>
              <p className="text-xs text-slate-400 mt-0.5">절감액 = (기준단가 − 적용단가) × 수량</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-500">인정월
                <input type="month" value={form.ym} onChange={(e) => setForm({ ...form, ym: e.target.value })}
                  className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" /></label>
              <label className="text-xs text-slate-500">유형
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
                  className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
                  {SAVING_KINDS.map((k) => <option key={k}>{k}</option>)}
                </select></label>
              <label className="text-xs text-slate-500">기준코드
                <input value={form.std_code} onChange={(e) => setForm({ ...form, std_code: e.target.value })}
                  className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" /></label>
              <label className="text-xs text-slate-500">품명
                <input value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })}
                  className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" /></label>
              <label className="text-xs text-slate-500">구매처
                <input value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })}
                  className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" /></label>
              <label className="text-xs text-slate-500">발주번호
                <input value={form.po_number} onChange={(e) => setForm({ ...form, po_number: e.target.value })}
                  className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" /></label>
              <label className="text-xs text-slate-500">기준단가
                <input type="number" value={form.base_price} onChange={(e) => setForm({ ...form, base_price: e.target.value })}
                  className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-right" /></label>
              <label className="text-xs text-slate-500">적용단가
                <input type="number" value={form.new_price} onChange={(e) => setForm({ ...form, new_price: e.target.value })}
                  className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-right" /></label>
              <label className="text-xs text-slate-500">수량
                <input type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })}
                  className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-right" /></label>
              <div className="text-xs text-slate-500">절감액
                <div className="mt-1 px-3 py-2 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg text-right tabular-nums">{won(amountOf(form))}</div>
              </div>
            </div>
            <label className="block text-xs text-slate-500">사유 · 비고
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="예: 로이코 재비딩으로 단가 인하"
                className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" /></label>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setForm(null)} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500">취소</button>
              <button onClick={save} className="px-4 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white">등록</button>
            </div>
          </div>
        </div>
      )}

      {/* 목표 */}
      {targetOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setTargetOpen(false)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-900">🎯 {year}년 절감 목표 · 집계 기준</h3>
            <label className="block text-[11px] font-bold text-slate-400">연간 목표 (원)</label>
            <input type="number" defaultValue={goal} id="cs-goal"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-right" />
            <p className="text-[11px] text-slate-400">원 단위로 적습니다. 예: 3000만원 → 30000000</p>
            <label className="block text-[11px] font-bold text-slate-400 pt-1">집계 시작일</label>
            <input type="date" defaultValue={start} id="cs-start"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" />
            <p className="text-[11px] text-slate-400">
              포털로 입고를 받기 시작한 날을 적습니다. 이 날짜 <b className="text-slate-500">이전 입고는 지표에서 아예 뺍니다</b> —
              그때 자료는 단가가 덜 채워져 있어 절감율이 망가집니다.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setTargetOpen(false)} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500">취소</button>
              <button onClick={() => saveTarget(document.getElementById('cs-goal').value, document.getElementById('cs-start').value)}
                className="px-4 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white">저장</button>
            </div>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        기준단가는 표준단가(pm_std_price)이고, 없는 품목만 직전 12개월 가중평균으로 봅니다. 절감율은 엑셀과 같게 「표준단가 기준 금액」으로 나눕니다.
      </p>
    </div>
  )
}
