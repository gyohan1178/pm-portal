// 견적서 갑지 · 을지 인쇄 (v4.124.0)
//   품목이 많아 한 장을 넘기면 표가 다음 장으로 잘려 넘어가고, 합계 · 납기 · 유효기간이 맨 뒤로 밀린다.
//   → 갑지(1장): 원래 견적서 모양 그대로 — 다만 품목표 자리는 「첫 품번 외 N건 · 세부 내역은 을지 참조」 한 줄(1식)
//     + 합계 · 납기 · 유효기간 · 비고
//     을지(2장~): 세부 품목표. 장마다 머리글 · 표 제목을 다시 찍고 마지막 장에만 합계
//   화면에는 안 보이고, 인쇄할 때만 QuoteSheet 의 편집 화면 대신 찍힌다 (body.qs-split).

// 을지 한 장에 넣는 분량 (한 줄짜리 품목 기준 18개).
//   품명 · 비고가 길어 두세 줄로 접히는 품목은 그만큼 무겁게 쳐서 덜 넣는다 → 장이 넘쳐 밀리지 않게.
export const SPLIT_ROWS_PER_PAGE = 18
// 「자동」일 때 이 줄 수부터 갑지 · 을지로 나눈다. 5줄까지는 한 장에 합계 · 납기 · 비고까지 들어간다 (6줄이면 비고가 다음 장으로 밀림 — 시험 확인).
export const SPLIT_AUTO_FROM = 6

export function wantSplit(mode, lineCount) {
  if (mode === 'split') return true
  if (mode === 'single') return false
  return lineCount >= SPLIT_AUTO_FROM
}

// 글자 폭 대충 셈 — 한글 · 한자 2, 나머지 1
const width = (t) => [...String(t ?? '')].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)
// 품목 한 줄이 인쇄에서 몇 줄 높이로 찍히는지 → 무게 (한 줄 = 1, 한 줄 더 접힐 때마다 +0.6)
export function rowWeight(l) {
  const lines = Math.max(1, Math.ceil(width(l.description) / 64), Math.ceil(width(l.remarks) / 14))
  return 1 + (lines - 1) * 0.6
}
export function paginate(arr, cap = SPLIT_ROWS_PER_PAGE) {
  const out = []
  let cur = [], w = 0
  for (const l of arr) {
    const rw = rowWeight(l)
    if (cur.length && w + rw > cap) { out.push(cur); cur = []; w = 0 }
    cur.push(l); w += rw
  }
  if (cur.length) out.push(cur)
  return out.length ? out : [[]]
}

export default function QuotePrintSplit({
  ko, isSales, savedNo, quoteDate, party, attn, projectName, currency, sym, money, num,
  validityDays, validUntil, deliveryNote, leadTime, memo, lines, total,
  contactName, contactPhone, contactEmail, supplier, supplierKo,
}) {
  const pages = paginate(lines)
  const sheets = 1 + pages.length
  const no = savedNo || (ko ? '(저장 전)' : '(not saved)')
  const title = ko ? '견 적 서' : isSales ? 'QUOTE' : 'PURCHASE QUOTE'
  const amountTxt = `${sym}${money(total, currency)}`

  const Foot = ({ n }) => (
    <div className="qs-foot">
      <span>{ko ? '견적번호' : 'NO'} {no}</span>
      <span>{n} / {sheets}</span>
    </div>
  )

  const S = ko ? supplierKo : supplier
  return (
    <div className="qs-split-print" data-quote-split>
      {/* ── 갑지 ── */}
      <section className="qs-sheet" data-qs-sheet="cover">
        <div className="text-center mb-4">
          <h2 className="text-3xl font-bold tracking-widest text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500 mt-1">{ko ? '견적번호' : 'NO'} : {no} · {quoteDate}</p>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-4 text-xs">
          <div>
            <div className="qs-h">{ko ? '수신' : 'Issued by'}</div>
            <div className="flex justify-between font-bold text-sm"><span>{party || '—'}</span>{ko && isSales && <span>귀중</span>}</div>
            <div className="flex gap-1 mt-1.5">
              <span className="text-slate-400 w-10 shrink-0">{ko ? '참조' : 'Attn'}</span><span>{attn}</span>
            </div>
            <p className="mt-3 text-slate-600">{ko ? '아래와 같이 견적합니다.' : 'We hereby provide the following quotation:'}</p>
            <p className="text-slate-500">{ko ? `견적 유효기간 : 견적일로부터 ${validityDays}일` : `Quotation Validity: ${validityDays} days from the date of the quotation`}</p>
          </div>
          <div>
            <div className="qs-h">{ko ? '공급자' : 'Supplier'}</div>
            <div className="text-slate-600 leading-relaxed">
              {ko ? (
                <>
                  <div>상호 : <b className="text-slate-800">{S.company}</b> · 등록번호 : {S.bizNo}</div>
                  <div>대표 : {S.ceo}</div>
                  <div>주소 : {S.address}</div>
                  <div>업태 : {S.bizType}</div>
                  <div>종목 : {S.bizItem}</div>
                  <div>담당 : {contactName}{contactPhone ? ` ( ${contactPhone} )` : ''}</div>
                  <div>전화 : {S.tel}   팩스 : {S.fax}</div>
                  <div>이메일 : {contactEmail}</div>
                  <div className="text-slate-400">{S.invoiceEmail} (계산서)</div>
                </>
              ) : (
                <>
                  <div>Company : {S.company}</div>
                  <div>Business registration number : {S.bizNo}</div>
                  <div>CEO : {S.ceo}</div>
                  <div>Adress : {S.address}</div>
                  <div>Business Type : {S.bizType}</div>
                  <div>Contact : {contactName}{contactPhone ? ` ( ${contactPhone} )` : ''}</div>
                  <div>Tel : {S.tel}   Fax : {S.fax}</div>
                  <div>E-Mail : {contactEmail}</div>
                  <div className="text-slate-400">{S.invoiceEmail} (Invoice)</div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs mb-4">
          <Info label={ko ? '견적일' : 'Date'}>{quoteDate}</Info>
          <Info label={ko ? '통화' : 'Currency'}><b>{currency}</b></Info>
          <Info label={ko ? '건명' : 'Project Name'}>{projectName}</Info>
          <Info label={ko ? '유효기간' : 'Validity'}>{validityDays} <span className="ml-1 text-slate-400">{ko ? `일 (${validUntil}까지)` : `days (${validUntil})`}</span></Info>
          <Info label={ko ? '납품 일정' : 'Delivery'}>{deliveryNote}</Info>
        </div>

        {/* 품목 자리 — 한 줄로 묶고 세부는 을지로 */}
        <table className="w-full text-xs qs-tbl border-t-2 border-slate-800">
          <Head ko={ko} />
          <tbody>
            <tr data-qs-summary>
              <td className="text-slate-400">1</td>
              <td className="font-mono whitespace-nowrap">
                {lines[0]?.std_code}{lines.length > 1 && (ko ? ` 외 ${lines.length - 1}건` : ` and ${lines.length - 1} more`)}
              </td>
              <td className="font-semibold" data-qs-count>
                {ko ? `세부 내역은 을지 참조 (총 ${lines.length}품목)` : `See the attached detail (${lines.length} items)`}
              </td>
              <td></td>
              <td className="text-center">{ko ? '식' : 'Lot'}</td>
              <td className="text-right">1</td>
              <td className="text-right">{money(total, currency)}</td>
              <td className="text-right font-bold">{amountTxt}</td>
              <td></td>
              <td></td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="qs-total" data-qs-cover-total>
              <td colSpan={7} className="text-right pr-3">{ko ? '합계 (부가세 별도)' : 'TOTAL'}</td>
              <td className="text-right text-sm">{amountTxt}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>

        <div className="mt-4 text-xs text-slate-600 space-y-1">
          <div className="flex gap-2"><span className="w-24 shrink-0 text-slate-400">{ko ? '납기' : 'Lead Time'}</span><span data-qs-lead>{leadTime}</span></div>
          <div className="flex gap-2"><span className="w-24 shrink-0 text-slate-400">{ko ? '유효기간' : 'Validity'}</span>
            <span>{ko ? `견적일로부터 ${validityDays}일 (${validUntil}까지)` : `${validityDays} days from the date of quotation (${validUntil})`}</span></div>
          <div className="flex gap-2"><span className="w-24 shrink-0 text-slate-400">{ko ? '비고' : 'Remarks'}</span><span>{memo}</span></div>
        </div>
        <Foot n={1} />
      </section>

      {/* ── 을지 ── */}
      {pages.map((rows, pi) => {
        const last = pi === pages.length - 1
        const base = pages.slice(0, pi).reduce((a, r) => a + r.length, 0)
        return (
          <section key={pi} className="qs-sheet" data-qs-sheet="detail">
            <div className="flex items-end justify-between mb-3 border-b-2 border-slate-800 pb-1.5">
              <div>
                <h3 className="text-lg font-bold tracking-wider text-slate-900">
                  {ko ? '견적 세부 내역 (을지)' : 'Quotation Detail (Attachment)'}
                  {pages.length > 1 && <span className="ml-2 text-xs font-semibold text-slate-400">{pi + 1} / {pages.length}</span>}
                </h3>
                <p className="text-[11px] text-slate-500">{party || '—'}{ko && isSales ? ' 귀중' : ''}{projectName ? ` · ${projectName}` : ''}</p>
              </div>
              <p className="text-[11px] text-slate-500">{ko ? '견적번호' : 'NO'} : {no} · {quoteDate}</p>
            </div>
            <table className="w-full text-xs qs-tbl">
              <Head ko={ko} />
              <tbody>
                {rows.map((l, i) => (
                  <tr key={l.key || base + i} data-qs-row>
                    <td className="text-slate-400">{base + i + 1}</td>
                    <td className="font-mono whitespace-nowrap">{l.std_code}</td>
                    <td>{l.description}</td>
                    <td className="text-center">{l.rev}</td>
                    <td className="text-center">{l.unit}</td>
                    <td className="text-right">{num(l.qty).toLocaleString('ko-KR')}</td>
                    <td className="text-right">{money(l.unitPrice, currency)}</td>
                    <td className="text-right font-bold">{sym}{money(num(l.qty) * num(l.unitPrice), currency)}</td>
                    <td className="text-center">{l.alternative}</td>
                    <td>{l.remarks}</td>
                  </tr>
                ))}
              </tbody>
              {last ? (
                <tfoot>
                  <tr className="qs-total" data-qs-total>
                    <td colSpan={7} className="text-right pr-3">{ko ? '합계 (부가세 별도)' : 'TOTAL (VAT excluded)'}</td>
                    <td className="text-right text-sm">{amountTxt}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              ) : (
                <tfoot>
                  <tr><td colSpan={10} className="text-right text-[11px] text-slate-400 pt-1.5">{ko ? '다음 장에 계속' : 'Continued'} →</td></tr>
                </tfoot>
              )}
            </table>
            <Foot n={pi + 2} />
          </section>
        )
      })}
    </div>
  )
}

function Info({ label, children }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-slate-400">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function Head({ ko }) {
  return (
    <thead>
      <tr>
        <th className="w-8 text-left">{ko ? '번호' : 'NO'}</th>
        <th className="text-left">{ko ? '품번' : 'Item no.'}</th>
        <th className="text-left">{ko ? '품명' : 'Description'}</th>
        <th className="w-12 text-center">REV</th>
        <th className="w-12 text-center">{ko ? '단위' : 'Unit'}</th>
        <th className="w-14 text-right">{ko ? '수량' : "Q'ty"}</th>
        <th className="w-24 text-right">{ko ? '단가' : 'Unit Price'}</th>
        <th className="w-28 text-right">{ko ? '금액' : 'Amount'}</th>
        <th className="w-12 text-center">{ko ? '대체' : 'Alt.'}</th>
        <th className="w-24 text-left">{ko ? '비고' : 'Remarks'}</th>
      </tr>
    </thead>
  )
}

// QuoteSheet 의 <style> 에 붙는 규칙. 화면에서는 통째로 숨기고, body.qs-split 로 인쇄할 때만 편집 화면과 바꿔 낸다.
export const SPLIT_CSS = `
  .qs-split-print{display:none}
  @media print {
    body.printing-quote.qs-split .quote-print-area{padding:0 !important;margin:0 !important;border:0 !important;border-radius:0 !important}
    body.printing-quote.qs-split .qs-edit{display:none !important}
    body.printing-quote.qs-split .qs-split-print{display:block}
  }
  .qs-sheet{position:relative;padding:12mm 12mm 16mm;min-height:204mm;box-sizing:border-box;break-after:page;page-break-after:always;color:#1e293b}
  .qs-sheet:last-child{break-after:auto;page-break-after:auto}
  .qs-h{font-weight:700;font-size:14px;color:#1e293b;border-bottom:1px solid #cbd5e1;padding-bottom:4px;margin-bottom:8px}
  .qs-tbl{border-collapse:collapse}
  .qs-tbl thead th{padding:6px 4px;color:#64748b;font-weight:600;border-bottom:1px solid #cbd5e1}
  .qs-tbl tbody td{padding:5px 4px;border-bottom:1px solid #f1f5f9;vertical-align:top}
  .qs-tbl tbody tr{break-inside:avoid}
  .qs-total td{padding:7px 4px;font-weight:700;border-top:2px solid #1e293b}
  .qs-foot{position:absolute;left:12mm;right:12mm;bottom:7mm;display:flex;justify-content:space-between;font-size:10px;color:#94a3b8}
`
