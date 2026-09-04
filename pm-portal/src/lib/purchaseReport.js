// 매입 대시보드를 화면 그대로 HTML 로 뽑는다.
//
//   ⚠ 예전 판은 요약 문장을 지어내고 화면과 다른 표를 만들었다.
//     받는 쪽이 화면과 대조할 수 없었고, 어느 업체 금액인지 알 수 없어
//     매번 되물어야 했다.
//
//   이번에는 화면에 있는 것만, 있는 순서대로 담는다.
//     총합계 → 고객사별 카드 → 월별 표 → 월·고객사별 세부 내역
//
//   세부 내역이 핵심이다. 화면에서는 숫자를 눌러야 보이지만
//   파일에서는 눌러 볼 수 없으므로 모두 펼쳐 넣는다.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const won = (v) => Math.round(Number(v) || 0).toLocaleString('ko-KR')
const eok = (v) => (Number(v) / 10000).toFixed(2)     // 만원 → 억원

// 화면(PurchaseDashboard)의 색과 같아야 한다.
//   화면과 색이 다르면 대조할 때 헷갈린다.
const CS_COLOR = {
  '에드워드': '#f43f5e', 'VM': '#10b981', 'CSK': '#f59e0b',
  '엑셀리스': '#6366f1', '하네스': '#0ea5e9', '기타': '#94a3b8',
}
const csHex = (cs) => CS_COLOR[cs] || '#64748b'

// 월별 고객사별 누적 막대. recharts 는 파일에 담을 수 없어 SVG 로 직접 그린다.
//   화면 차트와 같은 값·같은 색을 쓴다.
function barChart(months, csList) {
  const W = 820, H = 210, PADL = 46, PADR = 8, PADT = 10, PADB = 26
  const iw = W - PADL - PADR, ih = H - PADT - PADB
  const totals = months.map(m =>
    csList.reduce((a, cs) => a + (Number(m[cs]) || 0) + (Number(m[cs + 'Pend']) || 0), 0))
  const max = Math.max(1, ...totals)
  // 눈금은 1억(10000만) 단위로 올려 잡는다
  const step = Math.max(10000, Math.ceil(max / 4 / 10000) * 10000)
  const top = Math.ceil(max / step) * step
  const y = v => PADT + ih - (v / top) * ih
  const bw = iw / months.length
  const bar = bw * 0.56

  const grid = []
  for (let g = 0; g <= top; g += step) {
    grid.push(`<line x1="${PADL}" y1="${y(g)}" x2="${W - PADR}" y2="${y(g)}" stroke="#eef0f4"/>`
      + `<text x="${PADL - 6}" y="${y(g) + 3}" text-anchor="end" font-size="9" fill="#a8afba">`
      + `${(g / 10000).toFixed(0)}억</text>`)
  }

  const bars = months.map((m, i) => {
    const x = PADL + bw * i + (bw - bar) / 2
    let acc = 0
    const segs = []
    // 확정 먼저 쌓고, 예정은 흐리게 위에 올린다
    csList.forEach(cs => {
      const v = Number(m[cs]) || 0
      if (v > 0) { segs.push(`<rect x="${x}" y="${y(acc + v)}" width="${bar}" `
        + `height="${Math.max(0, y(acc) - y(acc + v))}" fill="${csHex(cs)}" opacity="0.88"/>`); acc += v }
    })
    csList.forEach(cs => {
      const v = Number(m[cs + 'Pend']) || 0
      if (v > 0) { segs.push(`<rect x="${x}" y="${y(acc + v)}" width="${bar}" `
        + `height="${Math.max(0, y(acc) - y(acc + v))}" fill="${csHex(cs)}" opacity="0.30"/>`); acc += v }
    })
    return segs.join('')
      + `<text x="${PADL + bw * i + bw / 2}" y="${H - 8}" text-anchor="middle" `
      + `font-size="9" fill="#8b93a3">${esc(m.label)}</text>`
  }).join('')

  const legend = csList.map(cs =>
    `<span class="lg"><i style="background:${csHex(cs)}"></i>${esc(cs)}</span>`).join('')

  return `<div class="box">
    <div class="ch-h"><h2>월별 고객사별 매입 추이</h2><div class="lgs">${legend}
      <span class="lg"><i class="pale"></i>연한 색 = 예정</span></div></div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img">
      ${grid.join('')}${bars}
    </svg>
  </div>`
}

/**
 * months  : 화면과 같은 월별 배열
 * csChart : [{ name, actual, pending }]
 * csList  : 고객사 순서
 * vendors : pm_vendor_purchase_yearly 결과. 협력사별 월 표를 만든다.
 */
export function buildPurchaseReport({ months, csChart, csList, year, vendors = [] }) {
  const ymd = new Date().toISOString().slice(0, 10)
  const totActual = csChart.reduce((a, c) => a + (Number(c.actual) || 0), 0)
  const totPending = csChart.reduce((a, c) => a + (Number(c.pending) || 0), 0)
  const grand = totActual + totPending

  const cards = csChart.map(c => {
    const tot = (Number(c.actual) || 0) + (Number(c.pending) || 0)
    const pct = grand > 0 ? Math.round(tot / grand * 100) : 0
    return `
    <div class="card" style="border-color:${csHex(c.name)}33">
      <div class="card-h">
        <span class="card-n" style="color:${csHex(c.name)}">${esc(c.name)}</span>
        <span class="pill" style="color:${csHex(c.name)};border-color:${csHex(c.name)}55">${pct}%</span>
      </div>
      <p class="card-v" style="color:${csHex(c.name)}">${eok(tot)}<span class="u">억</span></p>
      <div class="card-b">
        <div><span>✅ 완료</span><b style="color:${csHex(c.name)}">${eok(c.actual)}억</b></div>
        <div><span>📋 예정</span><b class="amber">+${eok(c.pending)}억</b></div>
      </div>
    </div>`
  }).join('')

  const rows = months.map((row, i) => {
    const rTot = csList.reduce((a, cs) => a + (Number(row[cs]) || 0), 0)
    const rPend = Number(row.pending) || 0
    const tds = csList.map(cs => {
      const v = Number(row[cs]) || 0
      const p = Number(row[cs + 'Pend']) || 0
      if (!v && !p) return '<td class="r dim">-</td>'
      return `<td class="r">${v ? `<b style="color:${csHex(cs)}">${eok(v)}</b>` : '<span class="dim">-</span>'}`
        + `${p ? ` <span class="amber">+${eok(p)}</span>` : ''}</td>`
    }).join('')
    return `<tr${i % 2 ? ' class="alt"' : ''}>
      <td class="mon">${esc(row.label)}</td>${tds}
      <td class="r"><b>${rTot ? eok(rTot) : '<span class="dim">-</span>'}</b></td>
      <td class="r amber">${rPend ? `+${eok(rPend)}` : '<span class="dim">-</span>'}</td>
    </tr>`
  }).join('')

  const footTds = csList.map(cs => {
    const tot = months.reduce((a, m) => a + (Number(m[cs]) || 0), 0)
    const pend = months.reduce((a, m) => a + (Number(m[cs + 'Pend']) || 0), 0)
    return `<td class="r"><b style="color:${csHex(cs)}">${eok(tot)}</b>`
      + `${pend ? ` <span class="amber">+${eok(pend)}</span>` : ''}</td>`
  }).join('')
  const gTot = months.reduce((a, m) => a + csList.reduce((b, cs) => b + (Number(m[cs]) || 0), 0), 0)
  const gPend = months.reduce((a, m) => a + (Number(m.pending) || 0), 0)

  // ── 협력사별 매입 (확정 기준) ──
  //   "어느 업체가 어느 고객사용을 공급하고 월별 얼마인가" 를 한 표에 담는다.
  //   매입이 큰 곳부터. 172곳이라 상위 20곳만 따로 내고 나머지는 묶는다.
  const MON = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
  const vTotal = vendors.reduce((a, v) => a + (Number(v.total_amt) || 0), 0)

  const vendorRows = vendors.map((v, i) => {
    const ms = MON.map((_, j) => Number(v['m' + (j + 1)]) || 0)
    const badges = (v.customers || [])
      .map(c => `<span class="b" style="color:${csHex(c.cs)};background:${csHex(c.cs)}14;`
                + `border-color:${csHex(c.cs)}33">${esc(c.cs)} ${eok(c.amt / 10000)}</span>`)
      .join('')
    return `<tr class="${i % 2 ? 'alt ' : ''}${v.is_etc ? 'etc' : ''}">
      <td class="l vn">${esc(v.vendor)}</td>
      <td class="r ttl"><b>${eok((Number(v.total_amt) || 0) / 10000)}</b></td>
      <td class="l bs">${badges}</td>
      ${ms.map(x => `<td class="r">${x ? eok(x / 10000) : '<i>-</i>'}</td>`).join('')}
    </tr>`
  }).join('')

  const vendorFoot = MON.map((_, j) =>
    `<td class="r">${eok(vendors.reduce((a, v) => a + (Number(v['m' + (j + 1)]) || 0), 0) / 10000)}</td>`
  ).join('')

  const vendorHtml = vendors.length ? `
  <div class="box vbox">
    <h2>협력사별 매입 현황</h2>
    <p class="h2sub">
      매입이 큰 곳부터 · 단위 억원 · <b>확정(ecount) 기준</b> — 발주잔·결제계획은 포함되지 않습니다
    </p>
    <div class="scroll">
    <table class="vt">
      <thead><tr>
        <th class="l">협력사</th><th class="ttl">총액</th><th class="l">공급 고객사</th>
        ${MON.map(m => `<th>${m}</th>`).join('')}
      </tr></thead>
      <tbody>
        ${vendorRows}
        <tr class="tot"><td class="l">합계</td>
          <td class="r ttl">${eok(vTotal / 10000)}</td><td></td>${vendorFoot}</tr>
      </tbody>
    </table>
    </div>
  </div>` : ''

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>매입 현황 ${year}년 — 진선테크</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#f7f8fb;color:#1f2430;
    font-family:"Malgun Gothic","맑은 고딕",-apple-system,"Segoe UI",sans-serif;
    font-size:13px;line-height:1.6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .wrap{max-width:900px;margin:0 auto;padding:24px 20px 50px}
  .crumb{font-size:11px;color:#98a0b0;font-weight:700}
  h1{font-size:22px;font-weight:800;margin:4px 0 4px}
  .sub{font-size:12px;color:#98a0b0;margin:0 0 20px}
  .box{background:#fff;border:1px solid #e8eaf0;border-radius:14px;padding:18px 20px;margin-bottom:14px}
  .grand{border:2px solid #334155;background:#f8fafc}
  .glabel{font-size:11px;font-weight:800;color:#98a0b0;letter-spacing:.04em;margin:0 0 6px}
  .gval{font-size:34px;font-weight:800;margin:0 0 10px}
  .gval .u{font-size:15px;color:#98a0b0;margin-left:3px}
  .grow{display:flex;gap:36px}
  .grow p:first-child{font-size:11px;color:#64748b;margin:0 0 2px}
  .grow p:last-child{font-size:20px;font-weight:800;margin:0}
  .indigo{color:#4f46e5} .amber{color:#d97706}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
  .card{background:#fff;border:2px solid #e8eaf0;border-radius:12px;padding:13px}
  .card-h{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:5px}
  .card-n{font-size:13px;font-weight:800}
  .pill{font-size:10px;font-weight:800;border:1px solid;border-radius:20px;padding:1px 7px}
  .card-v{font-size:19px;font-weight:800;margin:0 0 8px}
  .card-v .u{font-size:11px;opacity:.6;margin-left:2px}
  .card-b{border-top:1px solid #eef1f5;padding-top:7px}
  .card-b div{display:flex;justify-content:space-between;font-size:11px}
  .card-b span{color:#98a0b0}
  .card-b b{font-size:12px}
  h2{font-size:14px;font-weight:800;margin:0 0 2px}
  .h2sub{font-size:11px;color:#98a0b0;margin:0 0 12px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{background:#f7f8fb;color:#64748b;font-weight:800;padding:7px 9px;
     border-bottom:1px solid #e8eaf0;text-align:right;white-space:nowrap}
  th:first-child{text-align:left}
  td{padding:6px 9px;border-bottom:1px solid #f0f2f6}
  td.r{text-align:right;white-space:nowrap}
  td.mon{font-weight:700;color:#475569;white-space:nowrap}
  tr.alt td{background:#fafbfd}
  tr.tot td{border-top:2px solid #cbd5e1;background:#f7f8fb;font-weight:800;padding:9px}
  .dim{color:#cbd5e1}
  .dblk{background:#fff;border:1px solid #e8eaf0;border-radius:12px;padding:14px 16px;margin-bottom:10px;
        break-inside:avoid}
  .dblk-h{display:flex;justify-content:space-between;align-items:baseline;
          padding-bottom:8px;margin-bottom:10px;border-bottom:1px solid #eef1f5;font-size:14px}
  .src{border:2px solid #e8eaf0;border-radius:10px;padding:9px 11px;margin-bottom:8px}
  .src-h{display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px}
  .di{display:flex;justify-content:space-between;font-size:11.5px;padding:1px 0}
  .dl{color:#475569;max-width:64%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dl i{color:#98a0b0;font-style:normal}
  .da{font-weight:700;color:#334155}
  .note{margin:6px 0 0;font-size:11px;color:#b45309}
  .ch-h{display:flex;justify-content:space-between;align-items:flex-start;
        gap:12px;flex-wrap:wrap;margin-bottom:8px}
  .lgs{display:flex;gap:10px;flex-wrap:wrap}
  .lg{font-size:10.5px;color:#6b7280;display:inline-flex;align-items:center;gap:4px}
  .lg i{width:9px;height:9px;border-radius:2px;display:inline-block}
  .lg i.pale{background:#c8ccd6}
  .scroll{overflow-x:auto}
  .vt{font-size:10.5px;min-width:1000px}
  .vt th{padding:6px 4px}
  .vt td{padding:4px 4px;text-align:right;color:#4b5563;white-space:nowrap}
  .vt td.l{text-align:left}
  .vt .vn{font-weight:700;color:#2b3038}
  .vt .bs{white-space:normal;max-width:190px}
  .vt i{color:#d4d8de;font-style:normal}
  .vt tr.etc td{color:#94a3b8;font-style:italic}
  .vt .ttl{color:#2b3038;background:#fafbfc;border-right:1px solid #e4e7ec}
  .vt tr.tot .ttl{background:#f2f4f7}
  .b{display:inline-block;font-size:9.5px;font-weight:700;border:1px solid;border-radius:20px;
     padding:0 5px;margin:0 3px 2px 0;line-height:15px}
  .foot{margin-top:22px;padding-top:14px;border-top:1px solid #e8eaf0;font-size:11px;color:#98a0b0}
  @page{size:A4 portrait;margin:12mm}
  /* 협력사 표는 12개월이라 세로로는 안 들어간다 */
  @page vendor{size:A4 landscape;margin:8mm}
  .vbox{page:vendor}
  @media print{
    body{background:#fff}
    .wrap{max-width:none;padding:0}
    .box,.card,.dblk{break-inside:avoid}
  }
  @media (max-width:640px){ .cards{grid-template-columns:repeat(2,1fr)} .grow{gap:20px} }
</style></head>
<body><div class="wrap">

  <div class="crumb">진선테크 · 지원본부 구매자재팀</div>
  <h1>💰 매입 현황</h1>
  <p class="sub">${year}년 · 출력일 ${ymd} · 확정=ecount 회계확정 · 예상=결제(명세서) 기준 · 단위 억원</p>

  <div class="box grand">
    <p class="glabel">올해 총 매입 예상금액</p>
    <p class="gval">${eok(grand)}<span class="u">억</span></p>
    <div class="grow">
      <div><p>✅ 매입 완료</p><p class="indigo">${eok(totActual)}억</p></div>
      <div><p>📋 매입 예정</p><p class="amber">+${eok(totPending)}억</p></div>
    </div>
  </div>

  <div class="cards">${cards}</div>

  ${barChart(months, csList)}

  <div class="box">
    <h2>월별 고객사별 매입 현황</h2>
    <p class="h2sub">단위 억원 · 확정=ecount · 예상=결제 기준</p>
    <table>
      <thead><tr>
        <th>월</th>
        ${csList.map(cs => `<th style="color:${csHex(cs)}">${esc(cs)}</th>`).join('')}
        <th>합계</th><th style="color:#d97706">예정</th>
      </tr></thead>
      <tbody>
        ${rows}
        <tr class="tot">
          <td>연간 합계</td>${footTds}
          <td class="r">${eok(gTot)}</td>
          <td class="r amber">${gPend ? `+${eok(gPend)}` : '-'}</td>
        </tr>
      </tbody>
    </table>
  </div>

  ${vendorHtml}

  <div class="foot">
    진선테크 지원본부 구매자재팀 · gyohan@jinsuntech.co.kr<br>
    화면(매입 대시보드)과 같은 값입니다. 숫자에 대한 문의는 구매자재팀으로 주십시오.
  </div>

</div></body></html>`
}
