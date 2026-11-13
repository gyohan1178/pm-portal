// 협력사 납기 회신 요청 창 (v4.184.0 · v4.184.1 특이사항)
//   업체마다 「📋 메일용 복사」(표째로 붙음) · 전체 「엑셀 받기」(업체별 시트)
//   특이사항은 줄마다 자동 문구(지남 · 임박 · 약속일) — 펼쳐서 고쳐 쓸 수 있고, 고친 문구가 복사 · 엑셀에 들어간다
import { useMemo, useState } from 'react'
import { buildDueRequest, copyDue, downloadDueExcel, DUE_COLS } from '../lib/dueRequest'
import { toastSuccess, toastError } from '../lib/toast'

export default function DueRequestDialog({ pos, vendors, custName, onClose }) {
  const base = useMemo(() => buildDueRequest(pos, vendors), [pos, vendors])
  const [notes, setNotes] = useState({})      // 줄 key → 고친 특이사항
  const groups = useMemo(() => base.map((g) => ({ ...g, rows: g.rows.map((r) => (r.key in notes ? { ...r, note: notes[r.key] } : r)) })), [base, notes])
  const [copied, setCopied] = useState({})
  const [open, setOpen] = useState(() => (base.length === 1 ? { [base[0].vendor]: true } : {}))

  async function copy(g) {
    const ok = await copyDue(g)
    if (ok) { setCopied((c) => ({ ...c, [g.vendor]: true })); toastSuccess(`${g.vendor} ${g.rows.length}건 — 메일 본문에 붙여 넣으세요 (Ctrl+V)`) }
    else toastError('복사하지 못했습니다 — 엑셀로 받아 붙여 주세요')
  }
  async function excel(list) {
    try { await downloadDueExcel(list, { custName }) } catch (e) { toastError('엑셀 오류: ' + e.message) }
  }
  const total = groups.reduce((a, g) => a + g.rows.length, 0)
  const COLS = DUE_COLS

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose} data-due-req>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-3 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[17px] font-extrabold text-slate-800">📨 납기 회신 요청</h3>
            <p className="text-[12.5px] text-slate-500 mt-0.5">체크한 {total}건을 업체 {groups.length}곳으로 나눴습니다. 업체마다 「메일용 복사」 → 메일 본문에 붙여 넣으면 표째로 들어갑니다.
              <br />「특이사항」에는 「기재된 일정에 변경 없는지 확인 부탁드립니다」를 넣었습니다 — 펼쳐서 줄마다 고쳐 쓰면 고친 문구로 복사 · 엑셀에 들어갑니다. 발주번호는 넣지 않습니다.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none px-1" aria-label="닫기">✕</button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto px-6 py-3 space-y-2">
          {groups.map((g) => {
            const op = !!open[g.vendor]
            const nLate = g.rows.filter((r) => r.late && !r.promised).length
            return (
              <div key={g.vendor} className="rounded-xl border border-slate-200" data-due-vendor={g.vendor}>
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <button onClick={() => setOpen((o) => ({ ...o, [g.vendor]: !o[g.vendor] }))} className="flex-1 min-w-0 text-left flex items-center gap-2" data-due-toggle>
                    <span className="text-slate-300">{op ? '▾' : '▸'}</span>
                    <b className="text-[14px] text-slate-800 truncate">{g.vendor}</b>
                    <span className="text-[12px] text-slate-500">{g.rows.length}건{nLate ? <span className="text-red-500 font-semibold"> · 지연 {nLate}</span> : null}</span>
                  </button>
                  <button onClick={() => excel([g])} className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50">📥 엑셀</button>
                  <button onClick={() => copy(g)} data-due-copy
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${copied[g.vendor] ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100'}`}>
                    {copied[g.vendor] ? '✓ 복사됨' : '📋 메일용 복사'}
                  </button>
                </div>
                {op && (
                  <div className="px-4 pb-3 overflow-x-auto">
                    <table className="w-full text-[11.5px] border-collapse">
                      <thead><tr>{COLS.map(([k, h]) => <th key={k} className={`border border-slate-200 px-2 py-1 text-left whitespace-nowrap ${k === 'note' ? 'bg-yellow-50 text-amber-700 min-w-[320px]' : 'bg-slate-50 text-slate-500'}`}>{h}</th>)}</tr></thead>
                      <tbody>{g.rows.map((r) => (
                        <tr key={r.key}>{COLS.map(([k]) => k === 'note' ? (
                          <td key={k} className="border border-slate-200 p-0 bg-yellow-50/40">
                            <input value={r.note} onChange={(e) => { const v = e.target.value; setNotes((m) => ({ ...m, [r.key]: v })); setCopied((c) => ({ ...c, [g.vendor]: false })) }}
                              data-due-note className="w-full min-w-[320px] px-2 py-1 bg-transparent text-[11.5px] text-slate-700 focus:outline-none focus:bg-white focus:ring-2 focus:ring-violet-300" />
                          </td>
                        ) : (
                          <td key={k} className={`border border-slate-200 px-2 py-1 whitespace-nowrap ${k === 'qty' || k === 'remain' || k === 'no' ? 'text-right tabular-nums' : ''} ${k === 'req' && r.late && !r.promised ? 'text-red-600 font-bold' : 'text-slate-700'}`}>
                            {k === 'qty' || k === 'remain' ? Number(r[k] || 0).toLocaleString('ko-KR') : (r[k] || (k === 'promised' ? '—' : ''))}
                          </td>))}</tr>))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between gap-3">
          <span className="text-[11.5px] text-slate-400">빨간 요청 납기 = 받을 날이 지났는데 변경 약속도 없는 건</span>
          <div className="flex gap-2">
            <button onClick={() => excel(groups)} disabled={!groups.length} data-due-excel-all
              className="px-3 py-2 text-xs font-bold rounded-lg border border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50">📥 전체 엑셀 (업체별 시트)</button>
            <button onClick={onClose} className="px-4 py-2 text-xs font-bold rounded-lg bg-slate-800 text-white hover:bg-slate-700">닫기</button>
          </div>
        </div>
      </div>
    </div>
  )
}
