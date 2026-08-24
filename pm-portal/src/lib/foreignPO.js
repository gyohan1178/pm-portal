import { LOGO_B64, SEAL_B64 } from './poAssets'

// 미터를 피트로.
//   현장에서는 1 M = 10/3 FT 로 쓴다. 실제(3.2808)와 1.6% 차이지만
//   발주 단위(75·150·300·600·900·1200 M)가 250 FT 배수로 떨어지도록 맞춘 값이다.
const M_TO_FT = 10 / 3
const isLen = (u) => ['M', 'm', '미터'].includes(u)

const esc = (v) => String(v ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const money = (v, d = 2) => Number(v || 0).toLocaleString('en-US', {
  minimumFractionDigits: d, maximumFractionDigits: d,
})

// 해외 발주서 — 인쇄·PDF.
//
//   거래처에 보내는 문서라 격식이 중요하다. 회사 레터헤드와 직인을 넣고,
//   금액·수량은 오른쪽 정렬해 숫자를 대조하기 쉽게 했다.
//
//   재고는 미터로 관리하지만 발주는 피트로 낸다.
//   수량과 단가를 함께 바꿔 총액은 그대로 유지한다.
export function printForeignPO(rows, vendor) {
  if (!rows.length) return { ok: false, msg: '발주 건이 없습니다' }

  const cur = rows[0].fx_currency || vendor?.currency || 'USD'
  const sym = cur === 'USD' ? '$' : ''
  const poNo = rows[0].po_number || ''
  const date = rows[0].order_date || ''
  const eta = rows[0].promise_date || ''

  let amtSum = 0
  const qtyByUnit = {}          // 단위가 다르면 따로 센다. FT 와 EA 를 더할 수는 없다.
  const odd = []

  const lines = rows.map((x, i) => {
    const mQty = Number(x.qty_ordered) || 0
    const len = isLen(x.items?.unit)
    const qty = len ? Math.round(mQty * M_TO_FT * 10) / 10 : mQty
    const unit = len ? 'FT' : (x.items?.unit || 'EA')
    const priceM = Number(x.unit_price_fx) || 0
    const price = len ? Math.round(priceM / M_TO_FT * 10000) / 10000 : priceM
    const amt = Math.round(qty * price * 100) / 100
    if (len && mQty % 75 !== 0) odd.push(`${x.items?.std_code} ${mQty}M`)
    qtyByUnit[unit] = (qtyByUnit[unit] || 0) + qty
    amtSum += amt

    return `<tr>
      <td class="c">${i + 1}</td>
      <td class="mono">${esc((x.items?.std_code || '').replace(/^AX-/, ''))}</td>
      <td>${esc(x.items?.manufacturer_code || x.items?.name || '')}</td>
      <td class="r">${money(qty, qty % 1 ? 1 : 0)}</td>
      <td class="c u">${unit}</td>
      <td class="r">${sym}${money(price, 4)}</td>
      <td class="r b">${sym}${money(amt)}</td>
    </tr>`
  }).join('')

  // 관세는 업체마다 다르다. 등록돼 있으면 별도 줄로 붙인다.
  const rate = Number(vendor?.tariff_rate) || 0
  const tariff = rate > 0 ? Math.round(amtSum * rate / 100 * 100) / 100 : 0
  const total = Math.round((amtSum + tariff) * 100) / 100

  const addr = (vendor?.address || '').split('\n').filter(Boolean)
    .map(l => `<div>${esc(l)}</div>`).join('')

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(poNo)}</title>
<style>
  @page { size: A4; margin: 14mm 15mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #1a1a1a; background: #fff;
    font: 10.5pt/1.45 "Malgun Gothic", "맑은 고딕", Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet { max-width: 180mm; margin: 0 auto; }

  /* 로고 이미지 아래에 이미 선이 있어 테두리를 겹치지 않는다 */
  /* 회사 정보는 글자로 적는다. 이미지로 넣으면 흐릿하고 고칠 수 없다. */
  .letterhead {
    display: flex; align-items: flex-end; gap: 6mm;
    padding-bottom: 3mm; border-bottom: 2.5px solid #1a3a6b;
  }
  .letterhead img { height: 13mm; display: block; }
  .co { flex: 1; padding-bottom: .5mm; }
  .co .nm {
    font-size: 15pt; font-weight: 700; letter-spacing: .02em;
    color: #1a3a6b; line-height: 1.1;
  }
  .co .ad { font-size: 8.5pt; color: #4b5563; line-height: 1.5; margin-top: 1mm; }

  h1 {
    margin: 7mm 0 6mm; text-align: center;
    font-size: 21pt; font-weight: 700; letter-spacing: .28em;
    color: #1a3a6b; text-indent: .28em;
  }

  .meta { display: flex; justify-content: space-between; gap: 10mm; margin-bottom: 6mm; }
  .to { flex: 1; }
  .to .lb {
    font-size: 8pt; font-weight: 700; letter-spacing: .12em;
    color: #6b7280; margin-bottom: 1.5mm;
  }
  .to .nm { font-size: 12pt; font-weight: 700; margin-bottom: 1mm; }
  .to div { font-size: 9.5pt; color: #374151; line-height: 1.5; }

  .ref { width: 62mm; }
  .ref table { width: 100%; border-collapse: collapse; }
  .ref td {
    border: 1px solid #c9d2de; padding: 1.8mm 2.5mm; font-size: 9.5pt;
  }
  .ref td:first-child {
    background: #eef2f7; font-weight: 700; width: 22mm;
    font-size: 8.5pt; letter-spacing: .06em; color: #1a3a6b;
  }
  .ref td:last-child { font-weight: 700; }

  table.items { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
  table.items th {
    background: #1a3a6b; color: #fff; font-size: 8.5pt; font-weight: 700;
    letter-spacing: .06em; padding: 2.2mm 2mm; border: 1px solid #1a3a6b;
  }
  table.items td {
    border: 1px solid #d5dce6; padding: 1.9mm 2mm; font-size: 9.5pt;
  }
  table.items tbody tr:nth-child(even) td { background: #fafbfc; }
  .c { text-align: center; }
  .r { text-align: right; }
  .b { font-weight: 700; }
  .u { font-size: 8.5pt; color: #6b7280; }
  .mono { font-family: Consolas, "Courier New", monospace; font-size: 9pt; }

  tr.sub td { background: #fff !important; border-top: 1px solid #d5dce6; }
  tr.total td {
    background: #eef2f7 !important; font-weight: 700; font-size: 11pt;
    border-top: 2px solid #1a3a6b; border-bottom: 2px solid #1a3a6b;
  }

  .terms { display: flex; justify-content: space-between; gap: 12mm; margin-top: 8mm; }
  .terms ol { margin: 0; padding-left: 5mm; font-size: 9.5pt; line-height: 1.9; }
  .terms li::marker { color: #9ca3af; }
  .terms b {
    display: inline-block; min-width: 25mm; color: #1a3a6b;
    font-size: 9pt; letter-spacing: .02em;
  }
  .terms .sub { display: block; padding-left: 25mm; color: #4b5563; }

  /* 서명은 문서 오른쪽 끝에 붙인다. 도장 자리를 넉넉히 둔다. */
  .sign { width: 58mm; flex-shrink: 0; text-align: right; }
  .sign .who {
    font-size: 8.5pt; color: #4b5563; line-height: 1.55; margin-bottom: 1mm;
  }
  .sign .who .nm {
    font-size: 10.5pt; font-weight: 700; color: #1a3a6b;
    letter-spacing: .01em;
  }
  .sign img { width: 42mm; display: block; margin-left: auto; margin-top: 4mm; }

  .note {
    margin-top: 6mm; padding: 2.5mm 3mm; font-size: 8.5pt;
    background: #fffbea; border-left: 3px solid #d4a72c; color: #6b5518;
  }

  @media print { .noprint { display: none !important; } }
  .noprint {
    position: fixed; top: 12px; right: 12px; display: flex; gap: 8px;
  }
  .noprint button {
    padding: 9px 18px; font-size: 13px; font-weight: 700; cursor: pointer;
    border-radius: 8px; border: 1px solid #1a3a6b; background: #1a3a6b; color: #fff;
  }
  .noprint button.gh { background: #fff; color: #1a3a6b; }
</style></head><body>
<div class="noprint">
  <button onclick="window.print()">인쇄 · PDF 저장</button>
  <button class="gh" onclick="window.close()">닫기</button>
</div>

<div class="sheet">
  <div class="letterhead">
    <img src="${LOGO_B64}" alt="">
    <div class="co">
      <div class="nm">JINSUNTECH CO., LTD</div>
      <div class="ad">
        98, Chadol-ro, Dongnam-gu, Cheonan-si, Chungcheongnam-do, KOREA<br>
        TEL : 041) 579-5845 &nbsp;&nbsp; FAX : 041) 579-5846 &nbsp;&nbsp; E-mail : biz@jinsuntech.co.kr
      </div>
    </div>
  </div>

  <h1>PURCHASE ORDER</h1>

  <div class="meta">
    <div class="to">
      <div class="lb">TO</div>
      <div class="nm">${esc(vendor?.name || '')}</div>
      ${addr}
      ${vendor?.phone ? `<div>Tel : ${esc(vendor.phone)}</div>` : ''}
      ${vendor?.email ? `<div>E-mail : ${esc(vendor.email)}</div>` : ''}
    </div>
    <div class="ref"><table>
      <tr><td>P/O #</td><td>${esc(poNo)}</td></tr>
      <tr><td>DATE</td><td>${esc(date)}</td></tr>
      <tr><td>CURRENCY</td><td>${esc(cur)}</td></tr>
    </table></div>
  </div>

  <table class="items">
    <thead><tr>
      <th style="width:9mm">NO</th>
      <th style="width:26mm">ITEM CODE</th>
      <th>DESCRIPTION &amp; MODEL</th>
      <th style="width:20mm">Q'TY</th>
      <th style="width:12mm">UNIT</th>
      <th style="width:24mm">UNIT PRICE</th>
      <th style="width:28mm">AMOUNT</th>
    </tr></thead>
    <tbody>
      ${lines}
      ${tariff > 0 ? `<tr class="sub">
        <td colspan="6" class="r b">TARIFF (${rate}%)</td>
        <td class="r b">${sym}${money(tariff)}</td>
      </tr>` : ''}
      <tr class="total">
        <td colspan="3" class="c">TOTAL</td>
        <td colspan="3" class="r" style="font-size:9.5pt;font-weight:600">${
          Object.entries(qtyByUnit).map(([u, q]) =>
            `${money(q, q % 1 ? 1 : 0)} ${u}`).join(' · ')}</td>
        <td class="r">${sym}${money(total)}</td>
      </tr>
    </tbody>
  </table>

  <div class="terms">
    <ol>
      <li><b>Payment Term</b>${esc(vendor?.payment_terms || 'T/T')}</li>
      <li><b>Delivery</b>ETA ${esc(eta)}</li>
      <li><b>Delivery to</b>JINSUNTECH CO., LTD
        <span class="sub">98, Chadol-ro, Dongnam-gu, Cheonan-si</span>
        <span class="sub">Chungcheongnam-do, KOREA</span></li>
    </ol>
    <div class="sign">
      <div class="who"><div class="nm">JINSUNTECH CO., LTD</div></div>
      <img src="${SEAL_B64}" alt="">
    </div>
  </div>

  ${odd.length ? `<div class="note">
    발주 단위(75M 배수)가 아닌 건이 있어 피트 환산이 딱 떨어지지 않습니다 —
    ${esc(odd.slice(0, 4).join(', '))}${odd.length > 4 ? ` 외 ${odd.length - 4}건` : ''}
  </div>` : ''}
</div>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) return { ok: false, msg: '팝업이 막혀 있습니다. 브라우저 설정을 확인하세요' }
  w.document.write(html)
  w.document.close()

  return { ok: true, cnt: rows.length, total, cur, odd }
}
