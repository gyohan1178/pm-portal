// 매입 현황을 보고서 형식 HTML 파일로 만든다.
//
//   대표·임원에게 전달하는 자료이므로 숫자만 나열하지 않고
//   무엇을 봐야 하는지 요약을 앞에 둔다.
//   파일 하나로 열리므로 링크나 계정 없이 전달할 수 있다.

const won = (v) => Math.round(Number(v) || 0).toLocaleString('ko-KR')
const eok = (v) => (Number(v) / 100000000).toFixed(2)
const man = (v) => Math.round(Number(v) / 10000).toLocaleString('ko-KR')

// 전월 대비 증감을 문장으로
function trendText(months, cs) {
  const vals = months.map(m => Number(m[cs] || 0)).filter(v => v > 0)
  if (vals.length < 2) return null
  const last = vals[vals.length - 1], prev = vals[vals.length - 2]
  if (!prev) return null
  const pct = Math.round((last - prev) / prev * 100)
  if (Math.abs(pct) < 5) return '전월과 비슷'
  return pct > 0 ? `전월 대비 ${pct}% 증가` : `전월 대비 ${Math.abs(pct)}% 감소`
}

export function buildPurchaseReport({ months, csChart, year, csList }) {
  const today = new Date()
  const ymd = today.toISOString().slice(0, 10)
  const curMonth = today.getMonth() + 1

  // 합계
  const totActual = csChart.reduce((a, c) => a + (Number(c.actual) || 0), 0)
  const totPending = csChart.reduce((a, c) => a + (Number(c.pending) || 0), 0)

  // 이번 달 · 지난 달
  const cur = months[curMonth - 1] || {}
  const prev = months[curMonth - 2] || {}
  const curTot = csList.reduce((a, cs) => a + (Number(cur[cs]) || 0), 0)
  const prevTot = csList.reduce((a, cs) => a + (Number(prev[cs]) || 0), 0)
  const momPct = prevTot ? Math.round((curTot - prevTot) / prevTot * 100) : null

  // 앞으로 예정된 금액이 남은 달
  const futurePend = months
    .map((m, i) => ({ m: i + 1, v: csList.reduce((a, cs) => a + (Number(m[cs + 'Pend']) || 0), 0) }))
    .filter(x => x.v > 0 && x.m >= curMonth)

  // 요약 문장 — 무엇을 봐야 하는지
  const points = []
  if (momPct !== null) {
    points.push(`${curMonth}월 확정매입은 ${eok(curTot)}억원으로 ${
      momPct > 0 ? `전월 대비 ${momPct}% 증가` :
      momPct < 0 ? `전월 대비 ${Math.abs(momPct)}% 감소` : '전월과 비슷'}했습니다.`)
  }
  const topCs = [...csChart].sort((a, b) => b.actual - a.actual)[0]
  if (topCs) {
    points.push(`고객사별로는 ${topCs.name}가 ${eok(topCs.actual)}억원으로 가장 큽니다 (연간 누계 기준).`)
  }
  if (futurePend.length) {
    const biggest = [...futurePend].sort((a, b) => b.v - a.v)[0]
    points.push(`앞으로 예정된 매입은 ${eok(futurePend.reduce((a, x) => a + x.v, 0))}억원이며, ${
      biggest.m}월에 ${eok(biggest.v)}억원으로 가장 많이 잡혀 있습니다.`)
  }

  const monthRows = months.map((row, i) => {
    const rTot = csList.reduce((a, cs) => a + (Number(row[cs]) || 0), 0)
    const rPend = csList.reduce((a, cs) => a + (Number(row[cs + 'Pend']) || 0), 0)
    if (rTot === 0 && rPend === 0) return ''
    return `<tr${i + 1 === curMonth ? ' class="cur"' : ''}>
      <td class="mon">${String(year).slice(2)}.${String(i + 1).padStart(2, '0')}월</td>
      ${csList.map(cs => {
        const v = Number(row[cs]) || 0, p = Number(row[cs + 'Pend']) || 0
        return `<td class="r">${v > 0 ? eok(v) : '<span class="z">-</span>'}${
          p > 0 ? `<span class="pd">+${eok(p)}</span>` : ''}</td>`
      }).join('')}
      <td class="r b">${rTot > 0 ? eok(rTot) : '<span class="z">-</span>'}</td>
      <td class="r pd">${rPend > 0 ? '+' + eok(rPend) : '<span class="z">-</span>'}</td>
    </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>매입 현황 보고 ${year}년 ${curMonth}월 — 진선테크</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic','맑은 고딕',sans-serif;
  background:#f8fafc;color:#1e293b;line-height:1.7;font-size:15px}
.page{max-width:900px;margin:0 auto;background:#fff;padding:46px 50px;box-shadow:0 0 40px rgba(15,23,42,.06)}
.head{border-bottom:3px solid #4f46e5;padding-bottom:16px;margin-bottom:26px}
.head .k{font-size:12px;font-weight:700;color:#6366f1;letter-spacing:.06em;margin-bottom:5px}
.head h1{font-size:25px;font-weight:800}
.head .m{margin-top:9px;font-size:13px;color:#64748b}
h2{font-size:17px;font-weight:800;margin:30px 0 11px;padding-left:10px;border-left:4px solid #4f46e5}
.sum{background:#eef2ff;border-left:4px solid #6366f1;padding:15px 18px;border-radius:0 8px 8px 0;margin-bottom:6px}
.sum p{font-size:14.5px;margin-bottom:6px}
.sum p:last-child{margin-bottom:0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}
.card{border:1px solid #e2e8f0;border-radius:10px;padding:13px;background:#fafafa}
.card .l{font-size:11px;color:#64748b;font-weight:700}
.card .v{font-size:22px;font-weight:800;color:#4338ca;line-height:1.2;margin-top:2px}
.card .s{font-size:11px;color:#94a3b8;margin-top:2px}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13.5px}
th{background:#4f46e5;color:#fff;padding:8px 9px;font-weight:700;font-size:12px;text-align:right}
th:first-child{text-align:left}
td{padding:7px 9px;border-bottom:1px solid #f1f5f9}
td.r{text-align:right}
td.mon{font-weight:700;color:#475569}
td.b{font-weight:800;color:#1e293b}
tr.cur td{background:#eef2ff}
tr.tot td{border-top:2px solid #4f46e5;border-bottom:none;font-weight:800;background:#f8fafc}
.pd{color:#d97706;font-size:12px;margin-left:3px}
.z{color:#cbd5e1}
.note{font-size:12.5px;color:#64748b;margin-top:10px;padding:11px 14px;background:#f8fafc;border-radius:8px}
.sig{margin-top:38px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12.5px;color:#94a3b8}
@media print{body{background:#fff}.page{box-shadow:none;padding:0;max-width:100%}
  table{page-break-inside:avoid}@page{size:A4 landscape;margin:12mm}}
</style></head><body>
<div class="page">
  <div class="head">
    <div class="k">구매자재팀</div>
    <h1>매입 현황 보고</h1>
    <div class="m">${year}년 ${curMonth}월 기준 &nbsp;·&nbsp; 작성일 ${ymd} &nbsp;·&nbsp; 구매자재팀</div>
  </div>

  <h2>요약</h2>
  <div class="sum">
    ${points.map(t => `<p>${t}</p>`).join('')}
  </div>

  <div class="cards">
    <div class="card"><div class="l">연간 확정매입</div><div class="v">${eok(totActual)}억</div><div class="s">ecount 확정 기준</div></div>
    <div class="card"><div class="l">예정 매입</div><div class="v">${eok(totPending)}억</div><div class="s">결제계획 · 발주잔</div></div>
    <div class="card"><div class="l">${curMonth}월 확정</div><div class="v">${eok(curTot)}억</div><div class="s">${
      momPct === null ? '' : momPct > 0 ? `전월 대비 +${momPct}%` : momPct < 0 ? `전월 대비 ${momPct}%` : '전월과 비슷'}</div></div>
    <div class="card"><div class="l">전망 합계</div><div class="v">${eok(totActual + totPending)}억</div><div class="s">확정 + 예정</div></div>
  </div>

  <h2>월별 고객사별 매입</h2>
  <table>
    <thead><tr>
      <th>월</th>${csList.map(cs => `<th>${cs}</th>`).join('')}<th>합계</th><th>예정</th>
    </tr></thead>
    <tbody>
      ${monthRows}
      <tr class="tot">
        <td class="mon">연간 합계</td>
        ${csList.map(cs => {
          const c = csChart.find(x => x.name === cs) || {}
          return `<td class="r">${(Number(c.actual) || 0) > 0 ? eok(c.actual) : '<span class="z">-</span>'}${
            (Number(c.pending) || 0) > 0 ? `<span class="pd">+${eok(c.pending)}</span>` : ''}</td>`
        }).join('')}
        <td class="r b">${eok(totActual)}</td>
        <td class="r pd">+${eok(totPending)}</td>
      </tr>
    </tbody>
  </table>
  <p class="note">
    단위 억원 · <b>검은 숫자</b>는 ecount 확정매입, <span style="color:#d97706"><b>주황 숫자</b></span>는 예정분입니다.
    예정분은 분할 결제 계획이 있으면 그 달에, 없으면 발주 납기가 속한 달에 반영됩니다.
    음영 처리된 행이 이번 달입니다.
  </p>

  <div class="sig">
    진선테크 지원본부 구매자재팀 &nbsp;·&nbsp; PM Portal 에서 생성 (${ymd})
  </div>
</div>
</body></html>`
}
