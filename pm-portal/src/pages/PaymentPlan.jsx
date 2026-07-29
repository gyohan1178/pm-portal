import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { toastError, toastSuccess } from '../lib/toast'
import { ResizableTable } from '../components/ResizableTable'

// 표 열 너비 — 마우스로 조정 가능하며 브라우저에 저장된다
const COLS = [
  { key: 'po',      label: '발주번호',     defaultWidth: 130 },
  { key: 'vendor',  label: '업체',         defaultWidth: 180 },
  { key: 'odate',   label: '발주일',       defaultWidth: 100, align: 'center' },
  { key: 'pdate',   label: '납기',         defaultWidth: 100, align: 'center' },
  { key: 'cnt',     label: '품목',         defaultWidth: 60,  align: 'center' },
  { key: 'total',   label: '발주액',       defaultWidth: 130, align: 'right' },
  { key: 'remain',  label: '미입고 잔액',  defaultWidth: 130, align: 'right' },
  { key: 'planned', label: '결제 계획',    defaultWidth: 130, align: 'right' },
  { key: 'act',     label: '관리',         defaultWidth: 70,  align: 'center' },
]

const won = (v) => Math.round(Number(v) || 0).toLocaleString('ko-KR')
const eok = (v) => (Number(v) / 100000000).toFixed(2)
const num = (v) => Number(v) || 0
const todayISO = () => new Date().toISOString().slice(0, 10)

// 발주는 한 번, 결제는 여러 달에 나눠 하는 건을 관리한다.
//
// ※ 매입 금액은 입고 시점에 잡히므로 매입 대시보드는 이 화면과 무관하다.
//   '8월 매입이 왜 이렇게 큰가' 같은 질문에, 실제 대금은 나눠 나간다는 것을
//   보여주기 위한 자료다.
export default function PaymentPlan() {
  const qc = useQueryClient()
  const [year] = useState(new Date().getFullYear())
  const [openPo, setOpenPo] = useState(null)
  const [rows, setRows] = useState([])        // 편집 중인 분할 행
  const [search, setSearch] = useState('')

  // 발주서 묶음 (업체·발주일 기준)
  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['poGroups'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_po_groups', { p_from: null, p_to: null })
      if (error) throw error
      return data || []
    },
  })

  // 월별 결제 계획 요약
  const { data: monthly = [] } = useQuery({
    queryKey: ['paymentMonthly', year],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_payment_monthly', { p_year: year })
      if (error) throw error
      return data || []
    },
  })

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups.slice(0, 200)
    return groups.filter((g) =>
      [g.po_number, g.vendor_name].some((x) => String(x || '').toLowerCase().includes(q))
    ).slice(0, 200)
  }, [groups, search])

  // 월별 합계 (고객사 무관, 전사 자금 계획)
  const byMonth = useMemo(() => {
    const m = {}
    monthly.forEach((r) => { m[r.month] = (m[r.month] || 0) + num(r.amount) })
    return m
  }, [monthly])

  async function openPlan(g) {
    setOpenPo(g)
    const { data } = await supabase.from('pm_payment_plan')
      .select('*').eq('po_number', g.po_number).order('pay_date')
    setRows((data || []).map((r) => ({ ...r, _saved: true })))
  }

  const addRow = () => setRows((v) => [...v, { pay_date: todayISO(), amount: '', memo: '' }])
  const delRow = (i) => setRows((v) => v.filter((_, k) => k !== i))
  const patch = (i, k, val) => setRows((v) => v.map((r, k2) => (k2 === i ? { ...r, [k]: val } : r)))

  // 남은 금액을 n개월로 균등 분할
  function split(n) {
    const total = num(openPo?.total_amt)
    if (!total) { toastError('발주액이 0원이라 분할할 수 없습니다. 단가·수량을 확인하세요.'); return }
    if (n < 1) return

    const per = Math.round(total / n)
    // 납기가 있으면 그 달부터, 없으면 다음 달부터 시작한다
    const start = openPo?.promise_date ? new Date(openPo.promise_date) : new Date()
    const out = []
    for (let i = 0; i < n; i++) {
      // 각 달 말일. toISOString 은 UTC 로 바뀌어 하루 밀릴 수 있으므로 직접 만든다
      const d = new Date(start.getFullYear(), start.getMonth() + i + 1, 0)
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      out.push({
        pay_date: ymd,
        amount: i === n - 1 ? total - per * (n - 1) : per,   // 끝수는 마지막 달에
        memo: `${n}개월 분할 ${i + 1}/${n}`,
      })
    }
    setRows(out)
  }

  async function save() {
    if (!openPo) return
    const valid = rows.filter((r) => r.pay_date && num(r.amount) > 0)
    try {
      // 이 발주서의 기존 계획을 지우고 새로 넣는다 (부분 수정보다 단순하고 안전)
      const { error: e1 } = await supabase.from('pm_payment_plan')
        .delete().eq('po_number', openPo.po_number)
      if (e1) throw e1

      if (valid.length) {
        const { error: e2 } = await supabase.from('pm_payment_plan').insert(
          valid.map((r) => ({
            po_number: openPo.po_number,
            vendor_id: openPo.vendor_id,
            vendor_name: openPo.vendor_name,
            pay_date: r.pay_date,
            amount: num(r.amount),
            memo: r.memo || null,
          }))
        )
        if (e2) throw e2
      }
      toastSuccess(`${openPo.po_number} 결제 계획 ${valid.length}건 저장`)
      qc.invalidateQueries({ queryKey: ['poGroups'] })
      qc.invalidateQueries({ queryKey: ['paymentMonthly'] })
      setOpenPo(null); setRows([])
    } catch (e) {
      toastError('저장 실패: ' + e.message)
    }
  }

  const planned = rows.reduce((a, r) => a + num(r.amount), 0)
  const diff = num(openPo?.total_amt) - planned

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">💳 결제 계획</h1>
        <p className="text-xs text-slate-400">
          발주는 한 번, 결제는 나눠 하는 건을 기록합니다.
          매입 금액은 입고 시점 기준이라 <b>매입 대시보드는 바뀌지 않습니다</b> —
          대금이 언제 얼마씩 나가는지 보여주기 위한 자료입니다.
        </p>
      </div>

      {/* 월별 요약 */}
      {!!monthly.length && (
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-bold text-slate-500 mb-2">{year}년 월별 결제 계획</p>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <div key={m} className={`px-2.5 py-1.5 rounded-lg border text-xs ${byMonth[m]
                ? 'border-indigo-200 bg-indigo-50' : 'border-slate-100 text-slate-300'}`}>
                <div className="font-bold text-slate-600">{m}월</div>
                <div className="text-[11px]">{byMonth[m] ? eok(byMonth[m]) + '억' : '-'}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <input value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="발주번호·업체 검색"
        className="w-full sm:w-80 px-3 py-2 text-sm border border-slate-200 rounded-lg" />

      {/* 발주서 묶음 */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <ResizableTable cols={COLS} storageKey="payment_plan_cols">
          {() => (
          <tbody>
            {isLoading && (
              <tr><td colSpan={COLS.length} className="py-10 text-center text-slate-400">불러오는 중…</td></tr>
            )}
            {shown.map((g) => {
              const has = num(g.planned_amt) > 0
              const gap = num(g.total_amt) - num(g.planned_amt)
              return (
                <tr key={g.po_number} className="border-t border-slate-100 hover:bg-indigo-50/40">
                  <td className="px-3 py-2 font-mono text-indigo-600">{g.po_number}</td>
                  <td className="px-3 py-2 text-slate-700 max-w-[200px] truncate">{g.vendor_name || '-'}</td>
                  <td className="px-3 py-2 text-center text-slate-500">{g.order_date}</td>
                  <td className="px-3 py-2 text-center text-slate-500">{g.promise_date || '-'}</td>
                  <td className="px-3 py-2 text-center text-slate-500">{g.item_count}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${num(g.total_amt) ? '' : 'text-rose-400'}`}
                    title={num(g.total_amt) ? '' : '단가가 없어 발주액이 0원입니다'}>
                    {won(g.total_amt)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-500">{won(g.remain_amt)}</td>
                  <td className="px-3 py-2 text-right">
                    {has ? (
                      <span className={Math.abs(gap) < 1 ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}
                        title={Math.abs(gap) < 1 ? '발주액과 일치' : `${won(Math.abs(gap))}원 ${gap > 0 ? '미배분' : '초과'}`}>
                        {won(g.planned_amt)}
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => openPlan(g)}
                      className="px-2 py-0.5 text-[11px] rounded border border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600">
                      {has ? '수정' : '분할'}
                    </button>
                  </td>
                </tr>
              )
            })}
            {!isLoading && !shown.length && (
              <tr><td colSpan={COLS.length} className="py-10 text-center text-slate-400">발주가 없습니다.</td></tr>
            )}
          </tbody>
          )}
        </ResizableTable>
      </div>

      {/* 분할 입력 */}
      {openPo && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => { setOpenPo(null); setRows([]) }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-800">💳 결제 분할</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              <span className="font-mono text-indigo-600">{openPo.po_number}</span> ·
              {' '}{openPo.vendor_name} · 발주액 <b>{won(openPo.total_amt)}원</b>
            </p>

            <div className="flex gap-1.5 mt-3">
              <span className="text-xs text-slate-400 self-center">균등 분할</span>
              {[2, 3, 4, 5, 6].map((n) => (
                <button key={n} onClick={() => split(n)}
                  className="px-2.5 py-1 text-xs font-bold rounded border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600">
                  {n}개월
                </button>
              ))}
            </div>

            <div className="mt-3 space-y-1.5 max-h-72 overflow-y-auto">
              {rows.map((r, i) => (
                <div key={i} className="flex gap-1.5 items-center">
                  <input type="date" value={r.pay_date || ''} onChange={(e) => patch(i, 'pay_date', e.target.value)}
                    className="px-2 py-1.5 text-xs border border-slate-200 rounded w-36" />
                  <input type="number" value={r.amount} onChange={(e) => patch(i, 'amount', e.target.value)}
                    placeholder="금액" className="flex-1 px-2 py-1.5 text-xs text-right border border-slate-200 rounded" />
                  <input value={r.memo || ''} onChange={(e) => patch(i, 'memo', e.target.value)}
                    placeholder="메모" className="w-28 px-2 py-1.5 text-xs border border-slate-200 rounded" />
                  <button onClick={() => delRow(i)} className="text-slate-300 hover:text-rose-500 px-1">✕</button>
                </div>
              ))}
              {!rows.length && <p className="text-xs text-slate-400 py-4 text-center">위 버튼으로 분할하거나 행을 추가하세요.</p>}
            </div>

            <button onClick={addRow} className="mt-2 text-xs text-indigo-600 hover:text-indigo-700">＋ 행 추가</button>

            <div className="mt-3 pt-3 border-t border-slate-200 flex justify-between text-sm">
              <span className="text-slate-500">배분 합계</span>
              <span className={Math.abs(diff) < 1 ? 'font-bold text-emerald-600' : 'font-bold text-amber-600'}>
                {won(planned)}원
                {Math.abs(diff) >= 1 && (
                  <span className="ml-2 text-xs">
                    ({diff > 0 ? won(diff) + ' 미배분' : won(-diff) + ' 초과'})
                  </span>
                )}
              </span>
            </div>

            <div className="flex gap-2 mt-4">
              <button onClick={() => { setOpenPo(null); setRows([]) }}
                className="flex-1 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                취소
              </button>
              <button onClick={save}
                className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
