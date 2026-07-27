import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { toastError, toastSuccess } from '../lib/toast'
import {
  parseEcountWorkbook, summarize, normCustomer,
  CUSTOMERS, FORECAST_CUSTOMERS,
} from '../lib/ecountPurchase'

const won = (v) => Math.round(Number(v) || 0).toLocaleString('ko-KR')
const eok = (v) => (Number(v) / 100000000).toFixed(2)

// 담당자 엑셀은 예상매입 관리용이라 여기(확정)와 성격이 다르다.
// 확정은 ecount 가 유일한 정답이고, 이 화면은 그 값을 그대로 옮겨 담기만 한다.
export default function EcountUpload() {
  const qc = useQueryClient()
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState(null)
  const [csFilter, setCsFilter] = useState('전체')

  const { data: coverage = [] } = useQuery({
    queryKey: ['ecountCoverage'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pm_ecount_coverage')
      if (error) throw error
      return data || []
    },
    staleTime: 30 * 1000,
  })

  async function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    setFile(f); setErr(''); setParsed(null); setResult(null); setBusy(true)
    try {
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const res = parseEcountWorkbook(wb, XLSX, f.name)
      if (!res.rows.length) throw new Error("'구매번호' 헤더가 있는 매입 시트를 찾지 못했습니다.")
      setParsed(res)
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  const sum = useMemo(() => (parsed ? summarize(parsed.rows) : null), [parsed])

  // 미분류 행을 화면에서 지정
  const setRowCustomer = (no, v) =>
    setParsed((p) => ({ ...p, rows: p.rows.map((r) => (r.purchase_no === no ? { ...r, customer: v || null } : r)) }))

  // 같은 조건(거래처 또는 담당자)의 미분류를 한 번에
  const bulkAssign = (key, val, cs) =>
    setParsed((p) => ({
      ...p,
      rows: p.rows.map((r) => (!r.customer && String(r[key] || '') === val ? { ...r, customer: cs } : r)),
    }))

  async function save() {
    if (!parsed?.rows.length) return
    setBusy(true); setErr(''); setProgress('')
    try {
      const rows = parsed.rows.map(({ _sheet, ...r }) => r)
      const CH = 500
      for (let i = 0; i < rows.length; i += CH) {
        setProgress(`${Math.min(i + CH, rows.length)} / ${rows.length}`)
        // 구매번호가 전 기간 유일하므로 upsert 로 재업로드해도 중복되지 않는다
        const { error } = await supabase
          .from('pm_ecount_purchases')
          .upsert(rows.slice(i, i + CH), { onConflict: 'purchase_no' })
        if (error) throw error
      }
      setResult({ count: rows.length, supply: sum.supply })
      setParsed(null); setFile(null)
      qc.invalidateQueries({ queryKey: ['ecountCoverage'] })
      qc.invalidateQueries({ queryKey: ['weeklyReport'], exact: false })
      toastSuccess(`확정매입 ${rows.length}건 반영 완료`)
    } catch (e) {
      setErr(e.message); toastError('저장 실패: ' + e.message)
    } finally { setBusy(false); setProgress('') }
  }

  const unclassified = parsed?.rows.filter((r) => !r.customer) || []
  const shown = csFilter === '전체' ? unclassified
    : unclassified.filter((r) => (csFilter === '거래처별' ? true : true))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">💳 확정매입 (ecount)</h1>
        <p className="text-xs text-slate-400">
          ecount 매입 내역을 그대로 보관합니다. 주간보고의 <b>확정매입</b>이 이 값이 되고,
          담당자 엑셀은 <b>예상매입</b>으로 쓰입니다. 연간 통합 파일·주간 다운로드 둘 다 됩니다.
        </p>
      </div>

      {/* 적재 현황 */}
      {!!coverage.length && (
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-bold text-slate-500 mb-2">적재 현황</p>
          <div className="flex flex-wrap gap-1.5">
            {coverage.map((c) => (
              <div key={`${c.year}-${c.month}`}
                className={`px-2.5 py-1.5 rounded-lg border text-xs ${c.unclassified > 0
                  ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                <div className="font-bold text-slate-700">{c.year}.{String(c.month).padStart(2, '0')}</div>
                <div className="text-[11px] text-slate-500">{c.cnt}건 · {eok(c.supply_amt)}억</div>
                {c.unclassified > 0 && (
                  <div className="text-[10px] text-amber-600 font-bold">미분류 {c.unclassified}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 업로드 */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <label className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-lg
          border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 cursor-pointer ${busy ? 'opacity-50' : ''}`}>
          📤 {busy && !parsed ? '읽는 중…' : 'ecount 매입 파일 업로드'}
          <input type="file" accept=".xlsx,.xls,.xlsm" className="hidden" onChange={handleFile} disabled={busy} />
        </label>
        {file && <span className="ml-3 text-xs text-slate-500">{file.name}</span>}
        <p className="mt-2 text-[11px] text-slate-400">
          시트명에 <b>매입</b>이 들어간 시트를 모두 읽습니다. 상단 요약 블록은 건너뛰고
          <b> 구매번호</b> 헤더부터 인식합니다. 같은 구매번호는 덮어쓰므로 여러 번 올려도 중복되지 않습니다.
        </p>
      </div>

      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</div>}

      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 font-semibold">
          ✅ 확정매입 {result.count}건 반영 — 공급가액 {won(result.supply)}원
        </div>
      )}

      {/* 미리보기 */}
      {parsed && sum && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-indigo-200 p-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
              <span className="text-sm font-bold text-slate-800">{sum.count.toLocaleString()}건</span>
              <span className="text-slate-500">{sum.from} ~ {sum.to}</span>
              <span>공급가액 <b className="text-slate-800">{won(sum.supply)}</b></span>
              <span className="text-slate-400">합계 {won(sum.total)}</span>
              {parsed.skipped > 0 && <span className="text-amber-600">날짜 인식 실패 {parsed.skipped}</span>}
              {parsed.dupInFile > 0 && <span className="text-amber-600">파일내 중복 {parsed.dupInFile} (뒤엣것 유지)</span>}
            </div>

            {!parsed.hasCustomerCol && (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                ⚠ <b>고객사 열이 없습니다.</b> ecount 파일에 <b>고객사</b> 열을 추가하면
                ({CUSTOMERS.join(' / ')}) 자동으로 분류됩니다.
                지금은 아래에서 직접 지정해야 합니다.
              </div>
            )}

            {/* 시트별 */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {parsed.sheets.map((s) => (
                <span key={s.name} className="px-2 py-1 rounded bg-slate-100 text-[11px] text-slate-600">
                  {s.name} <b>{s.count}</b>건 · {eok(s.amount)}억
                </span>
              ))}
            </div>

            {/* 고객사별 */}
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {[...CUSTOMERS, '미분류'].map((k) => {
                const v = sum.byCustomer[k]
                if (!v) return null
                const fc = FORECAST_CUSTOMERS.includes(k)
                return (
                  <div key={k} className={`rounded-lg border p-2 ${k === '미분류'
                    ? 'border-amber-300 bg-amber-50'
                    : fc ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-200'}`}>
                    <div className="text-[11px] font-bold text-slate-500">
                      {k}{fc && <span className="ml-1 text-indigo-400" title="예상매입 관리 대상">◆</span>}
                    </div>
                    <div className="text-sm font-bold text-slate-800">{eok(v.supply)}억</div>
                    <div className="text-[10px] text-slate-400">{v.cnt}건</div>
                  </div>
                )
              })}
            </div>
            <p className="mt-1.5 text-[10px] text-slate-400">
              ◆ 표시는 담당자 엑셀로 <b>예상매입</b>까지 관리하는 고객사입니다. 하네스·기타는 확정만 집계됩니다.
            </p>
          </div>

          {/* 미분류 지정 */}
          {!!unclassified.length && (
            <div className="bg-white rounded-xl border border-amber-300 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-amber-700">
                  미분류 {unclassified.length}건 — 고객사를 지정해주세요
                </p>
                <span className="text-[11px] text-slate-400">지정하지 않으면 미분류로 저장됩니다</span>
              </div>

              {/* 거래처 단위 일괄 지정 — 같은 거래처는 대개 같은 고객사 */}
              <div className="mb-3 max-h-56 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-slate-400 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left">거래처</th>
                      <th className="px-2 py-1.5 text-left w-28">담당자</th>
                      <th className="px-2 py-1.5 text-right w-14">건수</th>
                      <th className="px-2 py-1.5 text-right w-28">공급가액</th>
                      <th className="px-2 py-1.5 text-left w-56">일괄 지정</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(
                      unclassified.reduce((m, r) => {
                        const k = r.vendor || '(거래처없음)'
                        if (!m[k]) m[k] = { cnt: 0, supply: 0, mgr: new Set() }
                        m[k].cnt += 1; m[k].supply += r.supply_amt
                        if (r.manager) m[k].mgr.add(r.manager)
                        return m
                      }, {})
                    ).sort((a, b) => b[1].supply - a[1].supply).map(([v, g]) => (
                      <tr key={v} className="border-t border-slate-100">
                        <td className="px-2 py-1 text-slate-700 truncate max-w-[220px]" title={v}>{v}</td>
                        <td className="px-2 py-1 text-slate-400 truncate">{[...g.mgr].join(', ')}</td>
                        <td className="px-2 py-1 text-right text-slate-500">{g.cnt}</td>
                        <td className="px-2 py-1 text-right font-semibold">{won(g.supply)}</td>
                        <td className="px-2 py-1">
                          <div className="flex flex-wrap gap-0.5">
                            {CUSTOMERS.map((c) => (
                              <button key={c} onClick={() => bulkAssign('vendor', v, c)}
                                className="px-1.5 py-0.5 rounded border border-slate-200 text-[10px] text-slate-500 hover:border-indigo-300 hover:text-indigo-600">
                                {c}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <details>
                <summary className="text-[11px] text-slate-500 cursor-pointer">건별로 지정하기 ({unclassified.length}건)</summary>
                <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                  <table className="w-full text-[11px]">
                    <tbody>
                      {unclassified.slice(0, 300).map((r) => (
                        <tr key={r.purchase_no} className="border-t border-slate-100">
                          <td className="px-2 py-1 font-mono text-slate-400 w-32">{r.purchase_no}</td>
                          <td className="px-2 py-1 text-slate-600 truncate max-w-[160px]">{r.vendor}</td>
                          <td className="px-2 py-1 text-slate-400 truncate max-w-[200px]">{r.memo}</td>
                          <td className="px-2 py-1 text-right w-28">{won(r.supply_amt)}</td>
                          <td className="px-2 py-1 w-32">
                            <select value={r.customer || ''} onChange={(e) => setRowCustomer(r.purchase_no, e.target.value)}
                              className="w-full px-1 py-0.5 text-[11px] border border-amber-300 bg-amber-50 rounded">
                              <option value="">미분류</option>
                              {CUSTOMERS.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {unclassified.length > 300 && (
                    <p className="px-2 py-1.5 text-[11px] text-slate-400">
                      … 외 {unclassified.length - 300}건. 거래처 단위 일괄 지정을 먼저 쓰는 편이 빠릅니다.
                    </p>
                  )}
                </div>
              </details>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button onClick={save} disabled={busy}
              className="px-5 py-2.5 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
              {busy ? `저장 중… ${progress}` : `💾 확정매입 ${sum.count.toLocaleString()}건 반영`}
            </button>
            <button onClick={() => { setParsed(null); setFile(null) }} disabled={busy}
              className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
              취소
            </button>
            {!!unclassified.length && (
              <span className="text-xs text-amber-600 font-semibold">미분류 {unclassified.length}건 포함</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
