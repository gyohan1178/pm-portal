import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { fetchAll } from '../../lib/paginate'
import { must } from '../../lib/db'
import { todayISO } from '../../lib/utils'
import { toastError, toastSuccess } from '../../lib/toast'
import { downloadSheet } from '../../lib/exportSheet'
import { useCanEdit } from '../../hooks/useProfile'
import { computeSaving, candKey, byItem, byVendor, SAVING_KINDS } from '../../lib/costSaving'

// 원가절감 — 부서 KPI 보고용
//
//   ① 지표(자동)  입고 단가가 직전 12개월 가중평균보다 싸면 그만큼을 금액으로 계산한다.
//                 시장가 하락도 섞여 있어 「후보」로만 본다.
//   ② 실적 대장    후보에서 골라 등록하거나 직접 적는다. 대표 보고 숫자는 이 대장이 기준.
//
//   기준단가 = 직전 12개월 가중평균 · 수량 = 실제 입고수량 (2026-09-23 확정)

const n = (v) => Math.round(Number(v) || 0).toLocaleString('ko-KR')
const won = (v) => n(v) + '원'
const man = (v) => (Math.abs(Number(v) || 0) >= 10000 ? n((Number(v) || 0) / 10000) + '만' : n(v))
const yearOf = (d) => String(d || '').slice(0, 4)
const thisYear = () => todayISO().slice(0, 4)
const monthsBack = (k) => { const d = new Date(); d.setMonth(d.getMonth() - k); return d.toISOString().slice(0, 10) }

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
const fetchLedger = async () => must(await supabase.from('pm_cost_saving').select('*').order('ym', { ascending: false }), '실적 대장 조회') || []
const fetchSkip = async () => must(await supabase.from('pm_cost_saving_skip').select('key'), '숨긴 후보 조회') || []
const fetchTarget = async () => {
  const r = must(await supabase.from('pm_settings').select('value').eq('key', 'cost_saving_target').maybeSingle(), '목표 조회')
  return r?.value || { year: Number(thisYear()), amount: 0 }
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

  const { data: inbound = [], isLoading, error } = useQuery({ queryKey: ['csInbound'], queryFn: fetchInbound, staleTime: 5 * 60 * 1000 })
  const { data: ledger = [] } = useQuery({ queryKey: ['csLedger'], queryFn: fetchLedger })
  const { data: skips = [] } = useQuery({ queryKey: ['csSkip'], queryFn: fetchSkip })
  const { data: target } = useQuery({ queryKey: ['csTarget'], queryFn: fetchTarget })

  const calc = useMemo(() => computeSaving(inbound), [inbound])
  const skipSet = useMemo(() => new Set(skips.map((s) => s.key)), [skips])
  const doneSet = useMemo(() => new Set(ledger.map((l) => `${l.item_id}|${l.ym}`)), [ledger])

  const yRows = calc.rows.filter((r) => yearOf(r.movement_date) === year)
  const yLedger = ledger.filter((l) => String(l.ym).slice(0, 4) === year)
  const cand = calc.cand.filter((r) => yearOf(r.movement_date) === year
    && !skipSet.has(candKey(r)) && !doneSet.has(`${r.item_id}|${String(r.movement_date).slice(0, 7)}`))

  const buy = yRows.reduce((a, r) => a + r.buy, 0)
  const autoSave = yRows.reduce((a, r) => a + (r.diff > 0 ? r.diff : 0), 0)
  const autoLoss = yRows.reduce((a, r) => a + (r.diff < 0 ? -r.diff : 0), 0)
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
      x.buy += r.buy; if (r.diff > 0) x.auto += r.diff
    })
    yLedger.forEach((l) => { const x = m.get(String(l.ym)); if (x) x.fixed += Number(l.amount) || 0 })
    return [...m.values()]
  }, [yRows, yLedger, year])
  const maxM = Math.max(1, ...months.map((m) => Math.max(m.fixed, m.auto)))

  const kindSum = useMemo(() => {
    const m = new Map(SAVING_KINDS.map((k) => [k, 0]))
    yLedger.forEach((l) => m.set(l.kind, (m.get(l.kind) || 0) + (Number(l.amount) || 0)))
    return [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  }, [yLedger])

  const topItems = useMemo(() => byItem(yRows).sort((a, b) => b.diff - a.diff), [yRows])
  const vendors = useMemo(() => byVendor(yRows), [yRows])

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
  async function saveTarget(v) {
    try {
      must(await supabase.from('pm_settings').upsert({ key: 'cost_saving_target', value: { year: Number(year), amount: Number(v) || 0 }, updated_at: new Date().toISOString() }), '목표 저장')
      qc.invalidateQueries({ queryKey: ['csTarget'] }); setTargetOpen(false); toastSuccess('목표를 저장했습니다')
    } catch (e) { toastError(e.message) }
  }

  async function exportXlsx() {
    try {
      await downloadSheet({
        title: `원가절감 실적 — ${year}년`,
        sheetName: '원가절감',
        fileName: `원가절감_${year}_${todayISO()}.xlsx`,
        meta: [
          ['확정 절감액', won(fixed)], ['연간 목표', won(goal)],
          ['구매액(입고 기준)', won(buy)], ['자동 계산 단가효과', won(autoSave - autoLoss)],
          ['기준', '기준단가 = 직전 12개월 가중평균 · 수량 = 실제 입고수량'],
          ['작성', `${todayISO()} · 진선테크 구매자재팀`],
        ],
        rows: yLedger.map((l, i) => ({
          No: i + 1, 인정월: l.ym, 유형: l.kind, 기준코드: l.std_code, 품명: l.item_name,
          구매처: l.vendor_name, 발주번호: l.po_number,
          기준단가: Number(l.base_price) || '', 적용단가: Number(l.new_price) || '', 수량: Number(l.qty) || '',
          절감액: Number(l.amount) || 0, 사유: l.note, 상태: l.status,
        })),
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
            입고 단가를 <b className="text-slate-500">직전 12개월 가중평균</b>과 견주어 절감 후보를 찾고, 인정한 것만 실적 대장에 남깁니다.
            대표 보고 숫자는 <b className="text-slate-500">확정 절감액(대장)</b> 기준입니다.
          </p>
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
        <KPI t="확정 절감액 (대장)" v={man(fixed) + '원'} tone="ok"
          n={goal ? `목표 ${man(goal)}원 대비 ${Math.round((fixed / goal) * 100)}%` : '연간 목표 미설정'} />
        <KPI t="자동 계산 단가효과" v={man(autoSave - autoLoss) + '원'} tone="info"
          n={`절감 ${man(autoSave)} · 상승 ${man(autoLoss)} (시장가 포함)`} />
        <KPI t="구매액 (입고 기준)" v={man(buy) + '원'} n={`${n(yRows.length)}건 입고`} />
        <KPI t="절감율" v={buy ? ((fixed / buy) * 100).toFixed(1) + '%' : '—'} n="확정 절감액 ÷ 구매액" />
        <KPI t="등록 대기 후보" v={n(cand.length) + '건'} tone={cand.length ? 'info' : ''}
          n={cand.length ? `${man(cand.reduce((a, r) => a + r.diff, 0))}원어치 — 대장 탭에서 등록` : '새 후보 없음'} />
        <KPI t="단가 상승" v={man(autoLoss) + '원'} tone={autoLoss ? 'warn' : ''} n="올라간 품목 — 협상 대상" />
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[['kpi', '지표'], ['ledger', `실적 대장 ${yLedger.length ? `(${yLedger.length})` : ''}`]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 text-xs font-bold rounded-md ${tab === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{l}</button>
        ))}
        {canEdit && (
          <button onClick={() => setTargetOpen(true)} className="px-3 py-1.5 text-xs font-bold rounded-md text-slate-500">🎯 목표</button>
        )}
      </div>

      {isLoading ? <p className="py-10 text-center text-sm text-slate-400">불러오는 중…</p> : tab === 'kpi' ? (
        <>
          {/* 월별 */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-bold text-slate-700">월별 절감</p>
            <p className="text-[11px] text-slate-400 mb-3">진한 막대 = 확정(대장) · 연한 막대 = 자동 계산</p>
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
            {/* 거래처 */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-bold text-slate-700 mb-2">거래처별 구매액·단가효과</p>
              <table className="w-full text-xs">
                <thead><tr className="text-slate-400 text-left"><th className="py-1">구매처</th><th className="py-1 text-right">구매액</th><th className="py-1 text-right">단가효과</th></tr></thead>
                <tbody>
                  {vendors.slice(0, 8).map((v) => (
                    <tr key={v.vendor} className="border-t border-slate-100">
                      <td className="py-1.5 truncate max-w-[140px]">{v.vendor}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-600">{man(v.buy)}</td>
                      <td className={`py-1.5 text-right tabular-nums font-bold ${v.diff >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{man(v.diff)}</td>
                    </tr>
                  ))}
                  {!vendors.length && <tr><td colSpan={3} className="py-6 text-center text-slate-400">입고 기록이 없습니다.</td></tr>}
                </tbody>
              </table>
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
            <h3 className="text-base font-bold text-slate-900">🎯 {year}년 절감 목표</h3>
            <input type="number" defaultValue={goal} id="cs-goal"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg text-right" />
            <p className="text-[11px] text-slate-400">원 단위로 적습니다. 예: 3000만원 → 30000000</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setTargetOpen(false)} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-500">취소</button>
              <button onClick={() => saveTarget(document.getElementById('cs-goal').value)}
                className="px-4 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white">저장</button>
            </div>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        기준단가는 그 입고 직전 12개월의 가중평균 매입가입니다. 자동 계산에는 시장가 변동도 섞여 있으니, 팀 실적은 대장에 등록한 것만 셉니다.
      </p>
    </div>
  )
}
