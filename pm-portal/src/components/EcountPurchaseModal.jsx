// 입고 현황 → 이카운트 「구매입력」 엑셀 변환 창 (v4.112.0)
//   체크한 입고 줄을 전표(같은 입고일 · 구매처 · 프로젝트)로 묶어 미리 보여 주고, 엑셀로 내려받는다.
//   내려받으면 그 줄에 「이카운트 ✓」 표시를 남긴다 (입고_이카운트표시_반영_261029.sql 필요 — 없으면 엑셀만 받고 안내)
import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { buildPurchase, purchaseWorkbook, ECOUNT_WH } from '../lib/ecountPurchaseInput'
import { ecountStaffOf } from '../lib/ecountStaff'
import { supabase } from '../lib/supabase'
import { toastError, toastSuccess } from '../lib/toast'
import { todayISO } from '../lib/utils'

const won = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR')
const KIND_TAG = { nopo: '발주외', nocode: '거래처코드', noprice: '단가 0', noitem: '기준코드', fx: '외화' }

export default function EcountPurchaseModal({ rows, customers = [], email, onClose, onMarked }) {
  const done = rows.filter((r) => r.ecount_purchase_at)
  const [withDone, setWithDone] = useState(false)
  const [open, setOpen] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const target = useMemo(() => (withDone ? rows : rows.filter((r) => !r.ecount_purchase_at)), [rows, withDone])
  const staff = ecountStaffOf(email)
  const custCodeOf = useMemo(() => { const m = new Map(customers.map((c) => [c.id, c.code])); return (id) => m.get(id) || '' }, [customers])
  const built = useMemo(() => buildPurchase(target, { custCodeOf, staff }), [target, custCodeOf, staff])
  const supply = built.slips.reduce((t, g) => t + g.supply, 0)
  const vat = built.slips.reduce((t, g) => t + g.vat, 0)
  const issueIds = new Set(built.issues.map((i) => i.id))
  const today = todayISO()
  const futureN = target.filter((r) => String(r.movement_date || '') > today).length

  async function mark(ids, clear) {
    try {
      const { data, error } = await supabase.rpc('pm_movement_ecount_mark', { p_ids: ids, p_clear: !!clear })
      if (error) throw error
      return Number(data) || 0
    } catch (e) {
      toastError(`「이카운트 ✓」 표시를 못 남겼습니다 — ${e.message || e} (입고_이카운트표시_반영_261029.sql 실행 여부 확인)`)
      return -1
    }
  }

  async function download() {
    if (!built.slips.length) return
    setBusy(true)
    try {
      const d = today.replace(/-/g, '')
      XLSX.writeFile(purchaseWorkbook(XLSX, built.aoa), `이카운트_구매입력_${d}.xlsx`)
      const n = await mark(target.map((r) => r.id), false)
      if (n >= 0) toastSuccess(`구매입력 엑셀 ${built.slips.length}전표 · ${target.length}줄 — 입고 현황에 「이카운트 ✓」 표시 ${n}줄`)
      onMarked?.()
      onClose()
    } finally { setBusy(false) }
  }

  async function clearDone() {
    setBusy(true)
    const n = await mark(done.map((r) => r.id), true)
    setBusy(false)
    if (n >= 0) { toastSuccess(`「이카운트 ✓」 표시 ${n}줄 지움`); onMarked?.(); onClose() }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div data-ecp-modal className="bg-white rounded-2xl p-5 w-full max-w-6xl max-h-[90vh] overflow-hidden grid grid-cols-[1fr_230px] gap-5" onClick={(e) => e.stopPropagation()}>
        <div className="min-h-0 overflow-auto pr-1">
          <h3 className="text-base font-bold text-slate-900">📤 이카운트 구매입력 변환</h3>
          <p className="text-xs text-slate-400 mt-0.5 mb-3">체크한 입고 {target.length}줄 → 이카운트 「구매입력」 엑셀 업로드 양식(21칸). 같은 입고일 · 같은 구매처 · 같은 프로젝트 = 전표 1장(같은 순번).</p>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 mb-3">
            ⚠ 이카운트 엑셀 업로드에는 <b>발주서 연결 칸이 없습니다</b> — 올리면 구매는 잡히지만 이카운트 발주서 잔량은 줄지 않으니, 이카운트 발주서 조회에서 직접 정리해 주세요.
          </div>
          {done.length > 0 && (
            <div data-ecp-done className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800 mb-3 flex flex-wrap items-center gap-2">
              <span>✓ 고른 줄 중 <b>{done.length}줄</b>은 이미 구매입력 엑셀로 내려받았습니다 ({[...new Set(done.map((r) => String(r.ecount_purchase_at).slice(0, 10)))].join(', ')}).</span>
              <label className="inline-flex items-center gap-1 font-bold cursor-pointer">
                <input data-ecp-withdone type="checkbox" checked={withDone} onChange={(e) => setWithDone(e.target.checked)} /> 그래도 포함 (두 번 올리면 이카운트에 두 번 잡힘)</label>
              <button data-ecp-clear onClick={clearDone} disabled={busy} className="ml-auto px-2 py-1 rounded border border-indigo-200 bg-white font-bold hover:bg-indigo-100 disabled:opacity-40"
                title="내려받기만 하고 이카운트에 올리지 않았을 때 — 표시만 지웁니다">↩ 표시 지우기 {done.length}줄</button>
            </div>
          )}
          {built.slips.length === 0 && <p className="text-sm text-slate-400 py-10 text-center">변환할 줄이 없습니다 — 이미 내려받은 줄만 골랐습니다.</p>}
          {built.slips.map((g) => {
            const isOpen = open.has(g.seq) || g.lines.length <= 3
            const shown = isOpen ? g.lines : g.lines.slice(0, 2)
            return (
              <div key={g.seq} data-ecp-slip={g.seq} className="rounded-xl border border-slate-200 mb-2.5 overflow-hidden">
                <div className="bg-slate-50 px-3 py-2 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-700">
                  <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">순번 {g.seq}</span>
                  <span>{g.date} · {g.vendorName || <span className="text-rose-600">구매처 없음</span>}</span>
                  <span className="font-mono font-normal text-slate-400">{g.vendorCode || ''}</span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-normal">프로젝트 {g.project}</span>
                  {g.date > today && <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">미래 날짜</span>}
                  <span className="ml-auto tabular-nums">{g.lines.length}줄 · 공급가 {won(g.supply)} · 부가세 {won(g.vat)}</span>
                </div>
                {g.memo && <div className="px-3 py-1 text-[11px] text-slate-400 border-b border-slate-100">메모: {g.memo}</div>}
                <table className="w-full text-xs">
                  <thead><tr className="text-slate-400 border-b border-slate-100">
                    {['품목코드', '품목명', '규격', '수량', '단가', '공급가액', '부가세', '적요(발주번호)'].map((h, i) =>
                      <th key={h} className={`px-3 py-1.5 font-semibold whitespace-nowrap ${i >= 3 && i <= 6 ? 'text-right' : 'text-left'}`}>{h}</th>)}
                  </tr></thead>
                  <tbody>{shown.map((l) => (
                    <tr key={l.r.id} className={`border-b border-slate-50 ${issueIds.has(l.r.id) ? 'bg-rose-50/50' : ''}`}>
                      <td className="px-3 py-1.5 font-mono text-slate-600 whitespace-nowrap">{l.code || '-'}</td>
                      <td className="px-3 py-1.5 text-slate-700 max-w-[260px] truncate" title={l.name}>{l.name}</td>
                      <td className="px-3 py-1.5 text-slate-500 max-w-[180px] truncate" title={l.spec}>{l.spec || '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{won(l.qty)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{won(l.price)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{won(l.supply)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{won(l.vat)}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-400 whitespace-nowrap">{l.po || '—'}</td>
                    </tr>))}
                  </tbody>
                </table>
                {!isOpen && <button data-ecp-more={g.seq} onClick={() => setOpen((s) => new Set(s).add(g.seq))} className="w-full text-left px-3 py-1.5 text-xs text-indigo-600 hover:bg-slate-50">… {g.lines.length - 2}줄 더 보기</button>}
              </div>
            )
          })}
          {built.issues.length > 0 && (
            <div data-ecp-issues className="rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-2 text-xs text-rose-700 space-y-0.5">
              <div className="font-bold mb-1">확인 필요 {built.issues.length}건 — 엑셀은 만들어지고, 이카운트에서 확인</div>
              {built.issues.slice(0, 12).map((i, k) => <div key={k}><span className="inline-block min-w-[64px] font-bold">[{KIND_TAG[i.kind]}]</span> {i.msg}</div>)}
              {built.issues.length > 12 && <div>… {built.issues.length - 12}건 더</div>}
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-2 min-h-0 overflow-auto">
          <div className="text-sm font-extrabold text-slate-800">선택 요약</div>
          {[['전표 (순번)', `${built.slips.length}장`, 'text-violet-600'], ['줄', won(target.length), ''], ['공급가액 합계', won(supply), ''], ['부가세 (줄마다 10%)', won(vat), ''],
            ['확인 필요', won(built.issues.length), built.issues.length ? 'text-rose-600' : 'text-emerald-600']].map(([l, v, c]) => (
            <div key={l} className="rounded-xl border border-slate-200 px-3 py-2">
              <div className="text-[11.5px] text-slate-400">{l}</div>
              <div data-ecp-sum={l} className={`text-xl font-extrabold tabular-nums ${c}`}>{v}</div>
            </div>))}
          {futureN > 0 && <div className="text-[11px] text-amber-700">미래 입고일 {futureN}줄 — 명세서 날짜 그대로 넣음</div>}
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11.5px] text-slate-600 leading-6">
            <b>고정값</b><br />담당자 <span className="font-mono">{staff}</span> (내려받는 사람)<br />입고창고 <span className="font-mono">{ECOUNT_WH}</span><br />
            프로젝트 AXCELIS <span className="font-mono">00012</span> · 그 외 <span className="font-mono">00005</span><br />품목코드 = 기준코드<br />거래유형 = 비움 (이카운트 기본값)<br />메모 = 입고 비고 · 적요 = 발주번호
          </div>
          <div className="flex gap-1.5 mt-1">
            <button onClick={onClose} className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">취소</button>
            <button data-ecp-download onClick={download} disabled={busy || !built.slips.length}
              className="flex-1 px-3 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">⬇ 엑셀 내려받기</button>
          </div>
          <p className="text-[11px] text-slate-400">이카운트 → 구매입력 → 엑셀 업로드에 그대로 올립니다. 내려받으면 그 줄에 「이카운트 ✓」 표시가 남습니다.</p>
        </aside>
      </div>
    </div>
  )
}
