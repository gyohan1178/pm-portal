import { useState, useMemo } from 'react'
import { useDebounced } from '../hooks/useDebounced'
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
  { key: 'gap',     label: '차이',        defaultWidth: 110, align: 'right' },
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
  // 목록이 커지면 한 글자마다 재계산되어 입력이 멈춘다
  const dq = useDebounced(search, 250)

  // 발주서 묶음 (업체·발주일 기준)
  const { data: groups = [], isLoading } = useQuery({
    // 검색어를 DB 로 넘겨 전체에서 찾는다.
    // 화면에서 받은 것만 거르면 목록 밖의 건이 검색되지 않는다.
    queryKey: ['poGroups', dq],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_po_groups', {
        p_from: null, p_to: null, p_q: dq.trim() || null, p_limit: 300,
      })
      if (error) throw error
      return data || []
    },
    keepPreviousData: true,
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

  // DB 에서 이미 검색·제한을 마쳤으므로 그대로 쓴다
  const shown = groups

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

  // 남은 금액을 n회로 균등 분할.
  //   ⚠ 발주 전액이 아니라 미입고 잔액으로 나눈다.
  //     이미 들어온 것은 대금이 나갔거나 나갈 예정이라 다시 나눌 대상이 아니다.
  //     지금 들어 있는 계획들도 그렇게 짜여 있다.
  function split(n) {
    const total = num(openPo?.remain_amt)
    if (!total) {
      toastError('미입고 잔액이 0원입니다. 다 들어왔거나 단가가 없습니다.'); return
    }
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

  // 회차는 그대로 두고 금액만 다시 나눈다.
  //   계획을 짠 뒤 입고가 더 들어와 금액이 어긋났을 때 쓴다.
  function reslice() {
    const total = num(openPo?.remain_amt)
    const n = rows.length
    if (!n) { toastError('나눌 회차가 없습니다'); return }
    if (!total) { toastError('미입고 잔액이 0원입니다'); return }
    const per = Math.round(total / n)
    setRows(v => v.map((r, i) => ({
      ...r,
      amount: i === n - 1 ? total - per * (n - 1) : per,
    })))
    toastSuccess(`${n}회로 다시 나눔 — 회당 ${won(per)}원`)
  }

  // 회당 금액을 지키고 회차 수를 늘리거나 줄인다.
  //   "매달 1억씩" 을 약속한 경우다. 남은 금액이 늘면 기간이 밀린다.
  function keepPer() {
    const total = num(openPo?.remain_amt)
    if (!total) { toastError('미입고 잔액이 0원입니다'); return }
    const per = num(rows[0]?.amount)
    if (per <= 0) { toastError('첫 회차 금액이 있어야 합니다'); return }

    const n = Math.max(1, Math.ceil(total / per))
    const base = rows[0]?.pay_date ? new Date(rows[0].pay_date) : new Date()
    const out = []
    let left = total
    for (let i = 0; i < n; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() + i + 1, 0)
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const amt = Math.min(per, left)
      left -= amt
      out.push({ pay_date: ymd, amount: amt, memo: `회당 ${won(per)} ${i + 1}/${n}` })
    }
    setRows(out)
    toastSuccess(`회당 ${won(per)}원 유지 — ${n}회로 나눔`)
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
  // ⚠ 발주 전액이 아니라 미입고 잔액과 견준다.
  //   계획을 짠 뒤 입고가 더 들어오면 계획이 실제보다 커진다.
  const remain = num(openPo?.remain_amt)
  const diff = remain - planned

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

      <div className="flex items-center gap-2 flex-wrap">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="발주번호·업체 검색"
          className="w-full sm:w-80 px-3 py-2 text-sm border border-slate-200 rounded-lg" />
        <span className="text-xs text-slate-400">
          {isLoading ? '조회 중…' : `${shown.length}건`}
          {shown.length >= 300 && ' (상위 300건 · 검색으로 좁혀주세요)'}
        </span>
        <span className="text-xs text-slate-400 ml-auto">입고가 끝난 발주는 표시되지 않습니다</span>
      </div>

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
              // ⚠ 발주액이 아니라 미입고 잔액과 견준다.
              //   계획은 남은 금액을 나눈 것이라, 발주액과 비교하면 늘 어긋나 보인다.
              const gap = num(g.remain_amt) - num(g.planned_amt)
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
                        title={Math.abs(gap) < 1 ? '미입고 잔액과 일치'
                               : `미입고 잔액보다 ${won(Math.abs(gap))}원 ${gap > 0 ? '적음 (미배분)' : '많음 — 입고가 더 들어옴'}`}>
                        {won(g.planned_amt)}
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {has
                      ? (Math.abs(gap) < 1
                          ? <span className="text-emerald-600 text-xs">맞음</span>
                          : <span className={gap < 0 ? 'text-amber-600 font-semibold' : 'text-sky-600'}>
                              {gap < 0 ? '+' : '−'}{won(Math.abs(gap))}
                            </span>)
                      : <span className="text-slate-300">—</span>}
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
              {' '}{openPo.vendor_name}
            </p>
            <div className="mt-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs space-y-0.5">
              <div className="flex justify-between">
                <span className="text-slate-400">발주액</span>
                <span className="text-slate-500">{won(openPo.total_amt)}원</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-bold">미입고 잔액</span>
                <span className="font-bold text-slate-800">{won(remain)}원</span>
              </div>
              <p className="text-[11px] text-slate-400 pt-0.5">
                이미 들어온 것은 빼고, <b>남은 금액</b>을 나눕니다.
              </p>
            </div>

            {/* 계획을 짠 뒤 입고가 더 들어오면 계획이 실제보다 커진다 */}
            {rows.length > 0 && Math.abs(diff) >= 1 && (
              <div className={`mt-2 rounded-xl border-2 px-3 py-2 ${
                diff < 0 ? 'border-amber-200 bg-amber-50' : 'border-sky-200 bg-sky-50'}`}>
                <p className={`text-xs font-bold ${diff < 0 ? 'text-amber-800' : 'text-sky-800'}`}>
                  {diff < 0
                    ? `⚠️ 계획이 남은 금액보다 ${won(-diff)}원 많습니다`
                    : `계획이 남은 금액보다 ${won(diff)}원 적습니다`}
                </p>
                <p className={`text-[11px] mt-0.5 ${diff < 0 ? 'text-amber-600' : 'text-sky-600'}`}>
                  {diff < 0
                    ? '계획을 짠 뒤 입고가 더 들어왔습니다. 아래 버튼으로 다시 나누세요.'
                    : '아직 배분하지 않은 금액이 있습니다.'}
                </p>
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  <button onClick={reslice}
                    title="회차 수는 그대로 두고 금액만 다시 나눕니다"
                    className="px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
                    균등 재분배 · {rows.length}회
                  </button>
                  <button onClick={keepPer}
                    title="첫 회차 금액을 지키고 회차 수를 늘리거나 줄입니다"
                    className="px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
                    회당 {won(num(rows[0]?.amount))}원 유지
                  </button>
                </div>
              </div>
            )}

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
