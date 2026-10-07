// CSK 생산관리 표 — 머리글을 CSK 생산 일정표 엑셀에 맞춘다 (2026-10-07)
//   일정표 값은 production.csk 에 들어 있다 (lib/cskSchedule.js). 상태만 포털에서 바꾼다.
//   일정표 없이 손으로 넣은 예전 CSK 줄도 같은 표에 보인다 (관리번호 = 호기 · 규격 = 품번).
import { useState } from 'react'
import { cskOrdered, optionLines } from '../../lib/cskSchedule'

const dayMs = 86400000
const dOf = (d) => { if (!d) return null; const x = new Date(String(d).slice(0, 10) + 'T00:00:00'); if (isNaN(x)) return null; return Math.round((x - new Date(new Date().toDateString())) / dayMs) }
const md = (d) => (d ? String(d).slice(5).replace('-', '/') : '')

// 일정표 칸 중 ITEM NO. · 품번 · 품명 · 입고 요청일 · 납품 완료일 · 회계는 화면에서 뺐다 (2026-10-07 사용자 정리)
//   값은 그대로 저장되어 있어 검색 · 다시 올리기에는 쓰인다. 다시 보이게 하려면 여기 칸만 되살리면 된다.
export const CSK_COLSPAN = 17

// 검색에 쓰는 글자 — 화면에 보이는 열은 모두 찾을 수 있게
export const cskHay = (r) => {
  const c = r.csk || {}
  return [r.hogi, r.pn, r.name, r.part, r.memo, r.manager, c.gubun, c.po_no, c.spec, c.plnd, c.prod, c.pre_assy, c.pn, c.name, c.memo, c.memo1, c.chg, c.no]
    .filter(Boolean).join(' ').toLowerCase()
}
// 같은 납품 예정일 안에서는 일정표 NO/ 순
export const cskNo = (r) => { const n = parseInt(String(r?.csk?.no || '').replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : 9e9 }

function OptionModal({ row, onClose }) {
  const c = row.csk || {}
  const lines = optionLines(c.option)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-slate-800">Option — {row.hogi}</p>
            <p className="text-xs text-slate-400 font-mono">{c.spec || row.pn}{c.memo1 ? ` · ${c.memo1}` : ''}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>
        <div className="p-5 overflow-y-auto">
          {lines.length === 0 ? <p className="text-sm text-slate-400">적힌 Option 이 없습니다</p> : (
            <ol className="space-y-1.5 text-xs text-slate-700">
              {lines.map((l, i) => <li key={i} className="px-2.5 py-1.5 rounded-lg bg-slate-50 whitespace-pre-wrap">{l}</li>)}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}

export function CskTable({ list, sel, setSel, rowSel, onField, onEdit, statusOpts, statusColor }) {
  const [opt, setOpt] = useState(null)
  const ids = list.filter(r => !r._month).map(r => r.id)
  const th = 'px-2 py-2 font-bold'
  return (
    <>
      <table className="w-full text-xs whitespace-nowrap" data-csk-table>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-slate-400 text-center">
            <th className="px-1 py-2 w-7">
              <input type="checkbox" checked={ids.length > 0 && ids.every(id => sel.has(id))}
                onChange={e => setSel(e.target.checked ? new Set(ids) : new Set())} />
            </th>
            <th className={th}>NO/</th>
            <th className={`${th} text-left`}>구분</th>
            <th className={`${th} text-left`}>관리번호</th>
            <th className={th} title="포털에서 관리하는 진행 상태 — 일정표에는 없는 칸">상태</th>
            <th className={`${th} text-left`}>발주 번호</th>
            <th className={`${th} text-left`}>규격</th>
            <th className={th}>Plnd<br />order number</th>
            <th className={th}>Prod<br />order number</th>
            <th className={th}>Q'TY</th>
            <th className={`${th} text-left`}>PRE ASSY 품번</th>
            <th className={th}>발주일자</th>
            <th className={th}>납품 예정일</th>
            <th className={`${th} text-left`}>비고</th>
            <th className={th}>자재 반출일</th>
            <th className={`${th} text-left`}>Option</th>
            <th className={`${th} text-left`}>비고1</th>
            <th className={`${th} text-left`} title="지난주 일정 → 변경 후 일정 · 변경 현황">변경 현황</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 ? (
            <tr><td colSpan={CSK_COLSPAN + 1} className="text-center py-10 text-slate-400">등록된 호기가 없습니다 — 「📅 일정표 올리기」로 CSK 생산 일정표 엑셀을 올려 주세요</td></tr>
          ) : list.map((r) => r._month ? (
            <tr key={'m' + r._month} className="bg-indigo-50/60 border-b border-indigo-100">
              <td colSpan={CSK_COLSPAN + 1} className="px-3 py-1.5 text-[11px] font-bold text-indigo-600">
                {r._month === '미정' ? '납품 예정일 미정' : `${r._month.slice(0, 4)}년 ${+r._month.slice(5, 7)}월`}
              </td>
            </tr>
          ) : (() => {
            const c = r.csk || {}
            const due = c.due || r.req_date
            const d = r.status === '완료' ? null : dOf(due)
            const lines = optionLines(c.option)
            const ordered = r.csk ? cskOrdered(c) : !!r.po_received
            return (
              <tr key={r.id}
                onMouseDown={e => rowSel.start(r.id, e, sel.has(r.id))}
                onMouseEnter={e => rowSel.over(r.id, e)}
                className={`border-b border-slate-100 hover:bg-slate-50 text-center select-none ${sel.has(r.id) ? 'bg-indigo-50/50' : ''} ${r.status === '완료' ? 'text-slate-400' : ''}`}>
                <td className="px-1 py-2"><input type="checkbox" checked={sel.has(r.id)} readOnly className="pointer-events-none" /></td>
                <td className="px-2 py-2 font-mono text-slate-400">{c.no || '—'}</td>
                <td className="px-2 py-2 text-left font-mono text-slate-600">{c.gubun || r.part || '—'}</td>
                <td data-no-select className="px-2 py-2 text-left font-mono font-bold text-indigo-600 cursor-pointer hover:underline" onClick={() => onEdit(r)}>
                  {r.hogi || '—'}
                  {c.gone && <span data-csk-gone className="ml-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold font-sans" title={`${c.gone_at || ''} 올린 일정표부터 빠진 줄입니다 — 납품이 끝났으면 상태를 완료로 바꿔 주세요`}>일정표에서 빠짐</span>}
                </td>
                <td data-no-select className="px-2 py-2">
                  <select value={r.status || 'PO접수'} onChange={e => onField(r.id, 'status', e.target.value)}
                    className={`px-1.5 py-0.5 rounded-full text-[11px] font-bold border-0 cursor-pointer ${statusColor[r.status] || statusColor['PO접수'] || ''}`}>
                    {statusOpts.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </td>
                <td className="px-2 py-2 text-left font-mono">
                  {!r.csk ? '—' : ordered ? <span className="text-slate-700">{c.po_no}</span>
                    : <span className="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-bold font-sans">{c.po_no || '발주 예정'}</span>}
                </td>
                <td className="px-2 py-2 text-left font-mono text-slate-700" title={[c.name || (r.csk ? '' : r.name), c.pn && `품번 ${c.pn}`, c.in_req && `입고 요청일 ${c.in_req}`, c.done && `납품 완료일 ${c.done}`].filter(Boolean).join(' · ') || undefined}>{c.spec || r.pn || '—'}</td>
                <td className="px-2 py-2 font-mono text-slate-600">{c.plnd || '—'}</td>
                <td className={`px-2 py-2 font-mono ${/^tba$/i.test(c.prod || '') ? 'text-slate-300' : 'text-slate-600'}`}>{c.prod || '—'}</td>
                <td className="px-2 py-2 font-mono font-bold text-slate-700">{c.qty || '—'}</td>
                <td className="px-2 py-2 text-left font-mono text-slate-600">{c.pre_assy || '—'}</td>
                <td className="px-2 py-2 font-mono text-slate-500">{md(c.order_date) || '—'}</td>
                <td className="px-2 py-2 font-mono font-bold text-slate-800">
                  {md(due) || '—'}
                  {d !== null && <span className={`ml-1 px-1 rounded text-[10px] ${d < 0 ? 'bg-red-50 text-red-600' : d <= 7 ? 'bg-orange-50 text-orange-600' : 'text-slate-400'}`}>{d < 0 ? `${-d}일 지남` : d === 0 ? '오늘' : `D-${d}`}</span>}
                </td>
                <td className="px-2 py-2 text-left text-slate-600 max-w-[200px] truncate" title={c.memo}>{c.memo || '—'}</td>
                <td className="px-2 py-2 font-mono text-slate-500">{md(c.mat_out) || '—'}</td>
                <td data-no-select className="px-2 py-2 text-left">
                  {lines.length === 0 ? <span className="text-slate-300">—</span> : (
                    <button data-csk-option onClick={() => setOpt(r)} title={lines.slice(0, 6).join('\n') + (lines.length > 6 ? '\n…' : '')}
                      className="px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[11px] font-bold text-slate-600 hover:border-indigo-300 hover:text-indigo-600">
                      {lines.length}항목 ▸
                    </button>
                  )}
                </td>
                <td className="px-2 py-2 text-left text-slate-600">{c.memo1 || '—'}</td>
                <td className="px-2 py-2 text-left">
                  {c.chg ? (
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${/신규/.test(c.chg) ? 'bg-sky-50 text-sky-700' : /단축/.test(c.chg) ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{c.chg}</span>
                  ) : <span className="text-slate-300">—</span>}
                  {(c.prev || c.next) && <span className="ml-1 font-mono text-[10px] text-slate-400">{md(c.prev) || '?'} → {md(c.next) || '?'}</span>}
                </td>
              </tr>
            )
          })())}
        </tbody>
      </table>
      {opt && <OptionModal row={opt} onClose={() => setOpt(null)} />}
    </>
  )
}
