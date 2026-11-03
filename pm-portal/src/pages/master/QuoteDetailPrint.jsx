// 세부견적서 인쇄 (v4.138.0) — 견적서 뒤에 어셈블리마다 부품별 판매가 장을 붙인다
//   화면에는 안 보이고, 「세부견적 같이」를 켜고 인쇄할 때만 찍힌다 (body.qs-detail).
//   한 장에 부품 16줄 — 넘으면 같은 어셈블리를 다음 장에 이어 찍고, 마지막 장에만 자재 소계 · 조립비 · 소계 · 단수 절삭 · 합계
//   매입가 · 마진율은 찍지 않는다. 계산은 lib/quoteDetail.js
import { paginate } from './QuotePrintSplit'
import { adjustLabel } from '../../lib/quoteDetail'

export const DETAIL_ROWS_PER_PAGE = 16   // 머리글 · 소계 · 조립비 · 합계 자리를 남긴다 (20줄은 넘쳐서 다음 장으로 밀렸음 — 시험 확인)

export default function QuoteDetailPrint({ ko, savedNo, quoteDate, party, projectName, currency, sym, money, details, showMaker }) {
  if (!details?.length) return null
  const no = savedNo || (ko ? '(저장 전)' : '(not saved)')
  // 장 나누기 — 품명이 길면 무겁게 (paginate 는 description · remarks 로 무게를 잰다)
  const sheets = []
  details.forEach((d, di) => {
    const pages = paginate(d.detail.rows.map((r) => ({ ...r, description: r.name, remarks: '' })), DETAIL_ROWS_PER_PAGE)
    pages.forEach((rows, pi) => sheets.push({ d, di, rows, pi, last: pi === pages.length - 1, pages: pages.length }))
  })
  const cols = showMaker ? 9 : 7
  const m = (v) => money(v, currency)
  return (
    <div className="qd-print" data-quote-detail-print>
      {sheets.map((s, si) => {
        const l = s.d.line, dt = s.d.detail
        return (
          <section key={si} className="qs-sheet qd-sheet" data-qd-sheet={l.std_code}>
            <div className="text-center mb-3">
              <h2 className="text-2xl font-bold tracking-widest text-slate-900">{ko ? '세 부 견 적 서' : 'DETAILED QUOTATION'}</h2>
              <p className="text-xs text-slate-500 mt-1">{ko ? '견적번호' : 'NO'} : {no} · {quoteDate}{s.pages > 1 ? ` · ${s.pi + 1} / ${s.pages}` : ''}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mb-3">
              <div className="flex gap-2"><span className="w-20 shrink-0 text-slate-400">{ko ? '수신' : 'To'}</span><b>{party || '—'}</b></div>
              <div className="flex gap-2"><span className="w-20 shrink-0 text-slate-400">{ko ? '건명' : 'Project'}</span><span>{projectName || '—'}</span></div>
              <div className="flex gap-2"><span className="w-20 shrink-0 text-slate-400">{ko ? '품번' : 'Item no.'}</span>
                <span><b className="font-mono">{l.std_code}</b>{l.rev ? ` Rev.${l.rev}` : ''} · {l.description}</span></div>
              <div className="flex gap-2"><span className="w-20 shrink-0 text-slate-400">{ko ? '견적 단가' : 'Unit Price'}</span>
                <span><b>{sym}{m(l.unitPrice)}</b> / {l.unit || 'EA'} <span className="text-slate-400">({ko ? '수량' : "Q'ty"} {Number(l.qty) || 0} · {ko ? '견적서' : 'Quote line'} {s.d.idx + 1})</span></span></div>
            </div>
            <table className="w-full text-xs qs-tbl border-t-2 border-slate-800">
              <thead>
                <tr>
                  <th className="w-8 text-left">No</th>
                  <th className="text-left">{ko ? '품번' : 'Part no.'}</th>
                  <th className="text-left">{ko ? '품명' : 'Description'}</th>
                  {showMaker && <th className="text-left">{ko ? '제조사' : 'Maker'}</th>}
                  {showMaker && <th className="text-left">{ko ? '제조사 품번' : 'Maker P/N'}</th>}
                  <th className="w-16 text-right">{ko ? '대당 수량' : "Q'ty/Unit"}</th>
                  <th className="w-12 text-center">{ko ? '단위' : 'Unit'}</th>
                  <th className="w-24 text-right">{ko ? '단가' : 'Unit Price'}</th>
                  <th className="w-28 text-right">{ko ? '금액' : 'Amount'}</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.no} data-qd-row={r.std_code}>
                    <td className="text-slate-400">{r.no}</td>
                    <td className="font-mono whitespace-nowrap">{r.std_code}</td>
                    <td>{r.name}</td>
                    {showMaker && <td className="whitespace-nowrap">{r.maker || '—'}</td>}
                    {showMaker && <td className="font-mono whitespace-nowrap">{r.makerPn || '—'}</td>}
                    <td className="text-right">{r.qty}</td>
                    <td className="text-center">{r.unit}</td>
                    <td className="text-right">{m(r.price)}</td>
                    <td className="text-right">{m(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
              {s.last && (
                <tfoot>
                  <tr className="qd-sub"><td colSpan={cols - 1} className="text-right pr-3">{ko ? '자재 소계' : 'Material Subtotal'}</td><td className="text-right" data-qd-parts>{m(dt.partsSum)}</td></tr>
                  {dt.labor > 0 && (
                    <tr className="qd-labor" data-qd-labor>
                      <td className="text-slate-400">{dt.rows.length + 1}</td>
                      <td colSpan={showMaker ? 4 : 2}>{ko ? '조립 · 배선 · 검사비' : 'Assembly, Wiring & Test'}</td>
                      <td className="text-right">1</td><td className="text-center">{ko ? '식' : 'Lot'}</td>
                      <td className="text-right">{m(dt.labor)}</td><td className="text-right">{m(dt.labor)}</td>
                    </tr>
                  )}
                  {dt.adjust !== 0 && (
                    <>
                      <tr className="qd-sub"><td colSpan={cols - 1} className="text-right pr-3">{ko ? '소계' : 'Subtotal'}</td><td className="text-right" data-qd-subtotal>{m(dt.subtotal)}</td></tr>
                      <tr data-qd-adjust={dt.adjust}><td colSpan={cols - 1} className="text-right pr-3 text-slate-500">{adjustLabel(dt.adjust, ko)}</td>
                        <td className="text-right text-slate-500">{dt.adjust < 0 ? '−' : '+'}{m(Math.abs(dt.adjust))}</td></tr>
                    </>
                  )}
                  <tr className="qs-total"><td colSpan={cols - 1} className="text-right pr-3">{ko ? `${l.std_code} 1${l.unit || 'EA'} 합계 (= 견적 단가)` : `Total per ${l.unit || 'EA'} (= quoted unit price)`}</td>
                    <td className="text-right" data-qd-total>{sym}{m(dt.total)}</td></tr>
                </tfoot>
              )}
            </table>
            {!s.last && <p className="text-[10px] text-slate-400 mt-2 text-right">{ko ? '다음 장에 이어짐' : 'Continued on next page'}</p>}
            <div className="qs-foot">
              <span>{ko ? '견적번호' : 'NO'} {no} · {ko ? '세부견적' : 'Detail'} {l.std_code}</span>
              <span>{si + 1} / {sheets.length}</span>
            </div>
          </section>
        )
      })}
    </div>
  )
}

// QuoteSheet <style> 에 붙는 규칙 — 화면에서는 숨기고, body.qs-detail 로 인쇄할 때 견적서 뒤에 붙인다
export const DETAIL_CSS = `
  .qd-print{display:none}
  @media print {
    body.printing-quote.qs-detail .qd-print{display:block}
    .qd-sheet{break-before:page;page-break-before:always;break-after:auto !important;page-break-after:auto !important}
    /* 한 장 모드 — 인쇄 영역이 이미 여백을 갖고 있고, 장 높이를 채우면 크롬이 표 끝(소계 · 합계)을 다음 장으로 밀어 낸다 */
    body.printing-quote:not(.qs-split) .qd-sheet{padding-left:0;padding-right:0;padding-bottom:0;min-height:0}
    body.printing-quote:not(.qs-split) .qd-sheet .qs-foot{position:static;margin-top:16px}
  }
  .qd-sub td{padding:6px 4px;font-weight:700;border-top:1px solid #94a3b8}
  .qd-labor td{padding:5px 4px;background:#f8fafc}
`
