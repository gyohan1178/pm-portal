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

const SRC_COLOR = {
  '확정(ecount)': '#12a05f',
  '결제계획':      '#7c5cd6',
  '발주잔':        '#d99400',
}

/**
 * months  : 화면과 같은 월별 배열
 * csChart : [{ name, actual, pending }]
 * csList  : 고객사 순서
 * detail  : [{ month, cs, rows:[{source,label,amount,cnt,note}] }]  없으면 세부 없이
 */
export function buildPurchaseReport({ months, csChart, csList, year, detail = [] }) {
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

  const detailHtml = detail.length ? detail.map(blk => {
    const bySrc = {}
    ;(blk.rows || []).forEach(r => { (bySrc[r.source] = bySrc[r.source] || []).push(r) })
    const total = (blk.rows || []).reduce((a, r) => a + (Number(r.amount) || 0), 0)
    if (!total) return ''
    const groups = Object.entries(bySrc).map(([src, list]) => {
      const sum = list.reduce((a, r) => a + (Number(r.amount) || 0), 0)
      const items = list.slice()
        .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))
        .map(r => `<div class="di">
            <span class="dl">${esc(r.label || '(미지정)')}${r.cnt > 1 ? `<i> · ${r.cnt}건</i>` : ''}</span>
            <span class="da">${won(r.amount)}</span>
          </div>`).join('')
      const notes = [...new Set(list.map(r => r.note).filter(Boolean))]
      return `<div class="src" style="border-color:${SRC_COLOR[src] || '#cbd5e1'}55">
          <div class="src-h">
            <b style="color:${SRC_COLOR[src] || '#475569'}">${esc(src)}</b>
            <b>${won(sum)}원</b>
          </div>
          ${items}
          ${notes.length ? `<p class="note">${esc(notes.join(' · '))}</p>` : ''}
        </div>`
    }).join('')
    return `<div class="dblk">
        <div class="dblk-h">
          <span><b>${blk.month}월</b> · <span style="color:${csHex(blk.cs)}">${esc(blk.cs)}</span></span>
          <b>${won(total)}원</b>
        </div>
        ${groups}
      </div>`
  }).filter(Boolean).join('') : ''

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
  .foot{margin-top:22px;padding-top:14px;border-top:1px solid #e8eaf0;font-size:11px;color:#98a0b0}
  @page{size:A4 portrait;margin:12mm}
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

  ${detailHtml ? `
  <div class="box">
    <h2>월·고객사별 세부 내역</h2>
    <p class="h2sub">위 표의 숫자가 어느 업체·어느 근거에서 나온 것인지 펼쳐 놓았습니다.</p>
  </div>
  ${detailHtml}` : ''}

  <div class="foot">
    진선테크 지원본부 구매자재팀 · gyohan@jinsuntech.co.kr<br>
    화면(매입 대시보드)과 같은 값입니다. 숫자에 대한 문의는 구매자재팀으로 주십시오.
  </div>

</div></body></html>`
}
