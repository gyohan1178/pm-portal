// 자재 불출표.
//
//   ASSY 출고와 다품목 출고가 같은 서식을 쓴다.
//   현장에서 두 종이가 달라 보이면 헷갈리기 때문이다.
//
//   다품목 출고는 여러 프로젝트를 한 번에 빼므로,
//   상위품번을 가로로 늘어놓고 칸마다 소요량을 적는다.
//   그 경우 열이 늘어 가로 인쇄로 나간다.

const esc = (v) => String(v ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

// 제작구분 — 그룹 머리에 쓴다
const MT_LABEL = {
  normal: '전장', field_stock: '전장(현장재고)',
  harness: '하네스자재', exclude: '불출 미대상',
}

/**
 * @param opt.title      제목
 * @param opt.csName     고객사
 * @param opt.meta       부제 (프로젝트·대수 등)
 * @param opt.rows       [{ no, location, std_code, maker, makerPn, name, unit, qty, makeType, note, byAssy }]
 * @param opt.assyCols   [{ code, qty }]  가로로 늘어놓을 상위품번. 없으면 일반 서식
 * @param opt.gridHtml   랙 배치도 (선택)
 */
export function buildIssueSheet(opt) {
  const { title = '자재 불출표', csName = '', meta = '', rows = [],
          assyCols = [], gridHtml = '' } = opt
  // 열이 열 개라 세로 A4 로는 좁다. 늘 가로로 낸다.
  //   기준코드(CS-ECK000000047-01)와 제조사명이 잘리지 않아야 한다.
  const wide = true
  const hasAssy = assyCols.length > 0
  const today = new Date().toLocaleDateString('ko-KR')

  // 열 폭 — 가로 인쇄면 상위품번 자리를 나눠 준다
  const fixed = hasAssy
    ? [3, 6, 12, 9, 11, 16, 4, 5, 5, 5]      // 합 76% — 나머지는 상위품번
    : [4, 7, 14, 12, 14, 27, 5, 6, 6, 5]     // 합 100%
  const assyW = hasAssy ? (100 - fixed.reduce((a, b) => a + b, 0)) / assyCols.length : 0

  let no = 0, lastMt = null
  const body = rows.map(r => {
    const mt = r.makeType || 'normal'
    let grp = ''
    if (mt !== lastMt) {
      lastMt = mt
      // 열 수가 바뀌므로 colspan 도 함께 맞춘다
      grp = `<tr class="grp"><td colspan="${fixed.length + assyCols.length}">■ ${MT_LABEL[mt] || mt}</td></tr>`
    }
    no++
    const cells = assyCols.map(a => {
      const v = r.byAssy?.[a.code]
      return `<td class="c sub">${v ? esc(v) : ''}</td>`
    }).join('')
    const note = (r.note || '').trim()
    return grp + `<tr>
      <td class="c nw">${no}</td>
      <td class="loc">${esc(r.location) || '-'}</td>
      <td class="code">${esc(r.std_code)}</td>
      <td class="mk">${esc(r.maker) || '-'}</td>
      <td class="code">${esc(r.makerPn) || '-'}</td>
      <td class="nm">${esc(r.name)}</td>
      <td class="c">${esc(r.unit) || 'EA'}</td>
      <td class="c b">${esc(r.qty)}</td>
      <td class="chk"></td>
      ${cells}
      <td class="chk"></td>
    </tr>` + (note ? `<tr class="note"><td></td><td colspan="${fixed.length + assyCols.length - 1}">↳ <b>비고</b> ${esc(note)}</td></tr>` : '')
  }).join('')

  // 상위품번이 길어 칸을 넘치므로 머리에는 번호만 적고
  //   표 아래에 어느 번호가 무엇인지 적어 둔다.
  const assyHead = assyCols.map((a, i) => `
    <th class="c sub" style="width:${assyW.toFixed(1)}%">
      ${assyCols.length > 3
        ? `<span class="an">${i + 1}</span><br><span class="q">×${esc(a.qty)}</span>`
        : `${esc(a.code)}<br><span class="q">×${esc(a.qty)}</span>`}
    </th>`).join('')

  const assyLegend = (assyCols.length > 3)
    ? `<div class="legend">${assyCols.map((a, i) =>
        `<span><b>${i + 1}</b> ${esc(a.code)} <i>×${esc(a.qty)}</i></span>`).join('')}</div>`
    : ''

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4 ${wide ? 'landscape' : 'portrait'}; margin: 10mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0; color: #1a1a1a;
    font: ${wide ? '9pt' : '10pt'}/1.4 "Malgun Gothic", "맑은 고딕", sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .head { border-bottom: 2px solid #1a3a6b; padding-bottom: 3mm; margin-bottom: 4mm; }
  h1 { margin: 0; font-size: ${wide ? '15pt' : '17pt'}; font-weight: 700; color: #1a3a6b; }
  .meta { margin-top: 1.5mm; font-size: 8.5pt; color: #4b5563; }

  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th {
    background: #eef2f7; color: #1a3a6b; font-size: ${wide ? '7.5pt' : '8.5pt'};
    font-weight: 700; padding: 1.6mm 1mm; border: 1px solid #c9d2de;
    text-align: left; word-break: keep-all;
  }
  td {
    border: 1px solid #d5dce6; padding: 1.4mm 1mm;
    font-size: ${wide ? '8pt' : '9pt'}; vertical-align: middle;
    /* table-layout:fixed 여도 nowrap 인 칸이 표를 밀어낸다. 넘치면 자른다. */
    overflow: hidden; text-overflow: ellipsis;
  }
  .c { text-align: center; }
  .b { font-weight: 700; }
  .nw { white-space: nowrap; }
  .mk { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .code { font-family: Consolas, "Courier New", monospace; font-size: ${wide ? '7pt' : '8pt'}; white-space: nowrap; overflow: hidden; }
  .loc { font-family: Consolas, monospace; font-weight: 700; text-align: center; white-space: nowrap; overflow: hidden; }
  .nm { line-height: 1.3; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .chk { background: #fafbfc; }
  .sub { background: #f7f9fc; }
  th.sub { font-size: ${wide ? '7pt' : '8pt'}; }
  th.sub .q { font-weight: 400; color: #6b7280; font-size: 6.5pt; }
  th.sub .an {
    display: inline-block; min-width: 4mm; padding: .3mm 1mm;
    background: #1a3a6b; color: #fff; border-radius: 2px; font-size: 7.5pt;
  }
  .legend {
    margin-bottom: 3mm; padding: 2mm 2.5mm; background: #f7f9fc;
    border: 1px solid #d5dce6; border-radius: 2px;
    font-size: 8pt; display: flex; flex-wrap: wrap; gap: 2mm 5mm;
  }
  .legend b {
    display: inline-block; min-width: 4mm; text-align: center;
    background: #1a3a6b; color: #fff; border-radius: 2px; margin-right: 1mm;
  }
  .legend i { color: #6b7280; font-style: normal; }
  tr.grp td { background: #1a3a6b; color: #fff; font-weight: 700; font-size: 8.5pt; padding: 1.2mm 2mm; }
  tr.note td { background: #fffbea; font-size: 8pt; color: #6b5518; }
  tr { page-break-inside: avoid; }

  .sign { margin-top: 6mm; display: flex; gap: 14mm; font-size: 9pt; }
  .sign span { border-top: 1px solid #9ca3af; padding-top: 1.5mm; min-width: 32mm; text-align: center; }
  @media print { body { padding: 0 } }
</style></head><body>
  <div class="head">
    <h1>${esc(title)}</h1>
    <div class="meta">
      고객사: <b>${esc(csName)}</b>${meta ? ` · ${esc(meta)}` : ''}
      · 출력일: ${today} · 총 ${rows.length}품목
    </div>
  </div>

  ${assyLegend}

  <table>
    <colgroup>
      ${fixed.map(w => `<col style="width:${w}%">`).join('')}
      ${assyCols.map(() => `<col style="width:${assyW.toFixed(1)}%">`).join('')}
    </colgroup>
    <thead><tr>
      <th class="c">No</th><th>위치</th><th>기준코드</th>
      <th>제조사</th><th>제조사품번</th><th>품명</th>
      <th class="c">단위</th><th class="c">소요</th><th class="c">결품</th>
      ${assyHead}
      <th class="c">키팅<br>확인</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>

  ${gridHtml}
  <div class="sign"><span>작성</span><span>불출</span><span>확인</span></div>
</body></html>`
}

// 새 창에 띄우고 인쇄 대화를 연다
export function openPrint(html, onFail) {
  const w = window.open('', '_blank')
  if (!w) { onFail?.('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return }
  w.document.write(html)
  w.document.close()
  w.onload = () => { w.focus(); w.print() }
}
