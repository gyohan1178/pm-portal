import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { missingOf } from '../../lib/prodFlow'
import { CUST_NAME } from '../../lib/prodSteps'
import { ddTone, ddText } from '../../lib/prodBoard'
import { todayISO } from '../../lib/utils'

// ⚠ 미불출 목록 (v4.165.0) — 생산관리 호기마다 적어 둔 미불출 파트를 한 표로
//   건건이 호기 편집 창을 열지 않고 한 번에 본다. 고치는 곳은 그대로 생산관리 (호기 편집 창 「파트 미불출 현황」)
//   · 호기별 = 한 줄이 「호기 × 미불출 파트」 · 부품별 = 같은 품번을 묶어 수량 합계 · 걸린 호기 · 가장 빠른 납기
//   rows: 공정 현황판이 만든 호기 목록 (완료 전 · _due · _dd · _po 붙은 것)

const normPn = (v) => String(v || '').trim().toUpperCase().replace(/^AX-/, '')
const qtyN = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0 }

export default function MissingList({ rows, cust, q }) {
  const [mode, setMode] = useState('hogi')   // hogi · part
  const lines = useMemo(() => rows.flatMap((r) => missingOf(r).map((m, i) => ({ key: `${r.id}-${i}`, r, m }))), [rows])
  const shown = useMemo(() => {
    const k = String(q || '').trim().toUpperCase()
    return lines.filter(({ r, m }) => (cust === 'ALL' || r.customer_code === cust)
      && (!k || [r.pn, r.name, r.hogi, r._po, m.pn, m.name, m.maker, m.makerPn].some((x) => String(x || '').toUpperCase().includes(k))))
      .sort((a, b) => (a.r._due || '9999').localeCompare(b.r._due || '9999') || normPn(a.m.pn).localeCompare(normPn(b.m.pn)))
  }, [lines, cust, q])
  const parts = useMemo(() => {
    const g = new Map()
    for (const x of shown) {
      const k = normPn(x.m.pn) || `이름:${String(x.m.name || '').trim()}`
      const o = g.get(k) || { k, pn: x.m.pn, name: x.m.name, maker: x.m.maker, makerPn: x.m.makerPn, qty: 0, list: [], due: null, date: null }
      o.qty += qtyN(x.m.qty)
      o.list.push(x)
      if (!o.name && x.m.name) o.name = x.m.name
      if (!o.maker && x.m.maker) o.maker = x.m.maker
      if (!o.makerPn && x.m.makerPn) o.makerPn = x.m.makerPn
      if (x.r._due && (!o.due || x.r._due < o.due)) { o.due = x.r._due; o.dd = x.r._dd }
      if (x.m.date && (!o.date || x.m.date < o.date)) o.date = x.m.date
      g.set(k, o)
    }
    return [...g.values()].sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || String(a.k).localeCompare(String(b.k)))
  }, [shown])
  const hogiN = new Set(shown.map((x) => x.r.id)).size

  const exportXlsx = () => {
    const ws1 = XLSX.utils.json_to_sheet(shown.map(({ r, m }) => ({
      고객사: CUST_NAME[r.customer_code] || r.customer_code, 제품품번: String(r.pn || '').replace(/^AX-/, ''), 제품명: r.name || '', 호기: r.hogi || '', PO: r._po || '',
      납기: r._due || '', 상태: r.status || '', 미불출품번: m.pn || '', 품명: m.name || '', 제조사: m.maker || '', 제조사품번: m.makerPn || '', 수량: m.qty !== '' && m.qty != null ? qtyN(m.qty) : '', 입고예정: m.date || '',
    })))
    const ws2 = XLSX.utils.json_to_sheet(parts.map((p) => ({
      미불출품번: p.pn || '', 품명: p.name || '', 제조사: p.maker || '', 제조사품번: p.makerPn || '', 수량합계: p.qty, 호기수: p.list.length,
      호기: p.list.map(({ r }) => `${String(r.pn || '').replace(/^AX-/, '')} ${r.hogi || ''}`).join(', '), 가장빠른납기: p.due || '', 입고예정: p.date || '',
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws1, '호기별')
    XLSX.utils.book_append_sheet(wb, ws2, '부품별')
    XLSX.writeFile(wb, `미불출목록_${todayISO()}.xlsx`)
  }

  const th = 'px-2 py-2 text-left font-bold'
  return (
    <div className="space-y-3" data-miss-list>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {[['hogi', '호기별'], ['part', '부품별 합계']].map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)} data-miss-mode={k}
              className={`px-2.5 py-1 text-xs font-bold rounded-md ${mode === k ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>{l}</button>
          ))}
        </div>
        <span className="text-xs text-slate-500" data-miss-count>호기 {hogiN.toLocaleString()}대 · 파트 {shown.length.toLocaleString()}줄 · 품번 {parts.length.toLocaleString()}종</span>
        <span className="text-[11px] text-slate-400">고치려면 생산관리에서 호기 품번을 눌러 「파트 미불출 현황」</span>
        <button onClick={exportXlsx} disabled={!shown.length} data-miss-xlsx
          className="ml-auto h-[34px] px-3 rounded-[9px] border border-slate-200 bg-white text-[13px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40">📥 엑셀</button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
        {mode === 'hogi' ? (
          <table className="w-full text-[13px]">
            <thead className="bg-[#f7f8fb] text-slate-500 border-b-2 border-slate-200">
              <tr>
                <th className={th}>고객사</th><th className={th}>제품 · 호기</th><th className={`${th} text-center`}>납기</th><th className={th}>상태</th>
                <th className={th}>미불출 품번</th><th className={th}>품명</th><th className={th}>제조사 · 제조사품번</th>
                <th className={`${th} text-right`}>수량</th><th className={`${th} text-center`}>입고 예정</th>
              </tr>
            </thead>
            <tbody>
              {!shown.length && <tr><td colSpan={9} className="py-10 text-center text-slate-400">미불출로 적힌 파트가 없습니다</td></tr>}
              {shown.map(({ key, r, m }) => (
                <tr key={key} className="border-b border-slate-100 h-[46px] hover:bg-slate-50/70" data-miss-row={key}>
                  <td className="px-2 text-[11.5px] font-bold text-slate-500">{CUST_NAME[r.customer_code] || r.customer_code}</td>
                  <td className="px-2">
                    <div className="font-mono font-bold text-[#5b6ee8]">{String(r.pn || '').replace(/^AX-/, '')} <span className="font-sans text-indigo-700">{r.hogi}</span>{r.part ? <span className="ml-1 font-sans text-[11px] text-slate-500">{r.part}</span> : null}</div>
                    <div className="text-[11.5px] text-slate-400 truncate max-w-[260px]">{r.name}{r._po ? ` · ${r._po}` : ''}</div>
                  </td>
                  <td className="px-2 text-center whitespace-nowrap"><div className={`font-bold tabular-nums ${ddTone(r._dd)}`}>{r._due ? r._due.slice(5).replace('-', '/') : '미정'}</div><div className={`text-[10.5px] font-bold ${ddTone(r._dd)}`}>{ddText(r._dd)}</div></td>
                  <td className="px-2"><span className="px-2 py-[1px] rounded-full bg-slate-100 text-slate-600 text-[11px] font-bold whitespace-nowrap">{r.status || 'PO접수'}</span></td>
                  <td className="px-2 font-mono font-bold text-red-600 whitespace-nowrap">{m.pn || '—'}</td>
                  <td className="px-2 text-slate-700">{m.name || '—'}</td>
                  <td className="px-2 text-[12px] text-slate-500">{[m.maker, m.makerPn].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-2 text-right font-mono font-bold">{m.qty !== '' && m.qty != null ? qtyN(m.qty).toLocaleString() : '—'}</td>
                  <td className="px-2 text-center tabular-nums text-slate-600">{m.date ? String(m.date).slice(5, 10).replace('-', '/') : <span className="text-slate-300">미정</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-[#f7f8fb] text-slate-500 border-b-2 border-slate-200">
              <tr>
                <th className={th}>미불출 품번</th><th className={th}>품명</th><th className={th}>제조사 · 제조사품번</th>
                <th className={`${th} text-right`}>수량 합계</th><th className={th}>걸린 호기</th><th className={`${th} text-center`}>가장 빠른 납기</th><th className={`${th} text-center`}>입고 예정</th>
              </tr>
            </thead>
            <tbody>
              {!parts.length && <tr><td colSpan={7} className="py-10 text-center text-slate-400">미불출로 적힌 파트가 없습니다</td></tr>}
              {parts.map((p) => (
                <tr key={p.k} className="border-b border-slate-100 h-[46px] hover:bg-slate-50/70 align-middle" data-miss-part={normPn(p.pn) || p.k}>
                  <td className="px-2 font-mono font-bold text-red-600 whitespace-nowrap">{p.pn || '—'}</td>
                  <td className="px-2 text-slate-700">{p.name || '—'}</td>
                  <td className="px-2 text-[12px] text-slate-500">{[p.maker, p.makerPn].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-2 text-right font-mono font-bold">{p.qty.toLocaleString()}</td>
                  <td className="px-2 text-[12px] text-slate-600">
                    <span className="font-bold">{p.list.length}대</span>{' '}
                    <span className="text-slate-500">{p.list.slice(0, 4).map(({ r, m }) => `${String(r.pn || '').replace(/^AX-/, '')} ${r.hogi || ''}${m.qty ? `(${m.qty})` : ''}`).join(', ')}{p.list.length > 4 ? ` 외 ${p.list.length - 4}` : ''}</span>
                  </td>
                  <td className="px-2 text-center whitespace-nowrap"><span className={`font-bold tabular-nums ${ddTone(p.dd)}`}>{p.due ? p.due.slice(5).replace('-', '/') : '미정'}</span> <span className={`text-[10.5px] font-bold ${ddTone(p.dd)}`}>{ddText(p.dd)}</span></td>
                  <td className="px-2 text-center tabular-nums text-slate-600">{p.date ? String(p.date).slice(5, 10).replace('-', '/') : <span className="text-slate-300">미정</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
