import { useState } from 'react'
import { toastError, toastSuccess } from '../../lib/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'

// 헤더 유연 매칭
const pick = (row, keys) => {
  for (const k of Object.keys(row)) {
    const kn = k.replace(/\s/g, '').toLowerCase()
    if (keys.some(t => kn.includes(t))) return row[k]
  }
  return undefined
}
const s = v => (v == null ? '' : String(v).trim())
const dnorm = v => {
  if (v == null || v === '') return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const str = String(v)
  const m = str.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return str.slice(0, 10)
}
const num = v => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0 }

export default function SalesUpload() {
  const qc = useQueryClient()
  const [rows, setRows] = useState([])       // 파싱 결과 (미리보기)
  const [only2026, setOnly2026] = useState(false)
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState(null)

  function parse(file) {
    setResult(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true })
        const rcvSheet = wb.SheetNames.find(n => /received|receive/i.test(n))
        if (!rcvSheet) { toastError('Received 시트를 찾을 수 없습니다.'); return }
        const json = XLSX.utils.sheet_to_json(wb.Sheets[rcvSheet], { defval: '' })

        const seen = new Set()
        const parsed = []
        let cancel = 0, dup = 0
        for (const r of json) {
          const hyeon = s(pick(r, ['현황']))
          if (hyeon === '발주 취소') { cancel++; continue }
          const part_no = s(pick(r, ['item', '품번'])).replace(/\.0$/, '')
          const po_number = s(pick(r, ['ordernumber', 'order number', 'po']))
          if (!part_no || !po_number) continue
          const order_line = s(pick(r, ['orderlines', 'order lines'])).replace(/\.0$/, '')
          const del_line = s(pick(r, ['delline', 'del line'])).replace(/\.0$/, '')
          // 4키 중복 제거 (item + po + order_line + del_line)
          const k = `${part_no}|${po_number}|${order_line}|${del_line}`
          if (seen.has(k)) { dup++; continue }
          seen.add(k)
          const promise_date = dnorm(pick(r, ['promisedate', 'promise date']))
          parsed.push({
            part_no, po_number, order_line, del_line,
            item_desc: s(pick(r, ['itemdesc', 'item desc', '품명'])),
            supplier_item: s(pick(r, ['supplieritem', 'supplier item'])),
            qty: num(pick(r, ['quantity', '수량', 'qty'])),
            unit_price: num(pick(r, ['unitprice', 'unit price', '단가'])),
            ccn: s(pick(r, ['ccn'])),
            promise_date,
            status_note: hyeon || s(pick(r, ['status'])),
            customer_code: 'AX',
          })
        }
        setRows(parsed)
        setFileName(file.name)
        setResult({ total: parsed.length, cancel, dup })
      } catch (err) {
        toastError('파일 파싱 오류: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  // 26년 필터 적용된 저장 대상
  const targetRows = only2026 ? rows.filter(r => (r.promise_date || '').slice(0, 4) >= '2026') : rows

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!targetRows.length) throw new Error('저장할 데이터가 없습니다.')
      // 배치 upsert (4키 충돌 시 갱신) — 500건씩
      const stamp = new Date().toISOString()
      const withStamp = targetRows.map(r => ({ ...r, updated_at: stamp }))
      let done = 0
      for (let i = 0; i < withStamp.length; i += 500) {
        const chunk = withStamp.slice(i, i + 500)
        const { error } = await supabase.from('pm_sales')
          .upsert(chunk, { onConflict: 'part_no,po_number,order_line,del_line' })
        if (error) throw error
        done += chunk.length
      }
      return done
    },
    onSuccess: (done) => {
      toastSuccess(`매출 실적 ${done}건 반영 완료`)
      setResult(r => ({ ...r, saved: done, savedAt: new Date().toLocaleString('ko-KR') }))
      qc.invalidateQueries({ queryKey: ['salesDash'], exact: false })
    },
    onError: (e) => toastError('저장 오류: ' + e.message),
  })

  // 연도별 요약 (미리보기)
  const yearSummary = {}
  for (const r of targetRows) {
    const y = (r.promise_date || '').slice(0, 4) || '(날짜없음)'
    const amt = r.qty * r.unit_price * ((r.ccn || '').toUpperCase() === 'B' ? 1 : 1)  // 환율은 대시보드에서
    yearSummary[y] ??= { cnt: 0, amt: 0 }
    yearSummary[y].cnt++
    yearSummary[y].amt += amt
  }

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-900">📥 매출 실적 업로드 (Received)</h1>
        <p className="text-xs text-slate-400 mt-0.5">AXCELIS PO 관리 엑셀의 Received 시트 → 납품 완료 매출로 반영 · Promise Date 기준월</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer">
            📎 엑셀 선택
            <input type="file" accept=".xlsx,.xlsm,.xls" className="hidden"
              onChange={e => e.target.files[0] && parse(e.target.files[0])} />
          </label>
          {fileName && <span className="text-xs text-slate-500">{fileName}</span>}
          <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 ml-auto">
            <input type="checkbox" checked={only2026} onChange={e => setOnly2026(e.target.checked)} />
            2026년부터만 반영
          </label>
        </div>

        {result && (
          <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 space-y-1">
            <div>파싱: 저장대상 <b className="text-slate-800">{targetRows.length}건</b>
              {' · '}발주취소 제외 {result.cancel}건 · 중복 제외 {result.dup}건
              {only2026 && rows.length !== targetRows.length && <span> · 26년필터로 {rows.length - targetRows.length}건 제외</span>}
            </div>
            {result.saved != null && <div className="text-emerald-600 font-semibold">✓ {result.saved}건 저장됨 · 갱신 {result.savedAt}</div>}
          </div>
        )}

        {Object.keys(yearSummary).length > 0 && (
          <div className="border border-slate-100 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr><th className="px-3 py-1.5 text-left">연도</th><th className="px-3 py-1.5 text-right">건수</th><th className="px-3 py-1.5 text-right">금액(원화·달러혼합)</th></tr>
              </thead>
              <tbody>
                {Object.keys(yearSummary).sort().map(y => (
                  <tr key={y} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 font-semibold text-slate-700">{y}</td>
                    <td className="px-3 py-1.5 text-right text-slate-500">{yearSummary[y].cnt}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{Math.round(yearSummary[y].amt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {targetRows.length > 0 && (
          <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
            className="w-full py-2.5 text-sm font-bold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            {saveMut.isPending ? '저장 중...' : `💾 ${targetRows.length}건 매출 반영 (4키 중복은 자동 갱신)`}
          </button>
        )}
      </div>

      <p className="text-[11px] text-slate-400">
        · 중복 방지: 품번 + PO번호 + Order Line + Del Line (이미 있으면 갱신, 없으면 추가)<br/>
        · 발주 취소 건은 제외 · 달러(CCN=B)는 매출 대시보드에서 환율 적용<br/>
        · 초기엔 전체, 이후 정기 업로드는 "2026년부터만"으로 가볍게
      </p>
    </div>
  )
}
