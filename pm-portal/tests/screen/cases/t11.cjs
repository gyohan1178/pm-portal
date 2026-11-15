const { chromium } = require('playwright')
let pass = 0, fail = 0; const ok = (c, m, x='') => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (c ? '' : ' → ' + x)) }
;(async () => {
  const b = await chromium.launch()
  const pg = async (r, w) => { const p = await b.newPage({ viewport: { width: w, height: 900 } }); await p.addInitScript(() => { try { localStorage.setItem('pm.flowTab', 'detail') } catch {} }); await p.goto('http://localhost:8765/app.html?r=' + encodeURIComponent(r)); await p.waitForTimeout(1800); return p }
  let p = await pg('/flow', 412)
  const t = await p.evaluate(() => ({
    total: document.querySelector('[data-flow-total]')?.textContent,
    sums: [...document.querySelectorAll('[data-flow-sum]')].map(e => e.dataset.flowSum + '=' + e.lastChild.textContent).join(),
    msub: [...document.querySelectorAll('[data-flow-msub]')].map(e => e.dataset.flowMsub).join(),
    hdr: getComputedStyle(document.querySelector('[data-app-header]')).backgroundColor,
    heroTop: Math.round(document.querySelector('[data-flow-hero]').getBoundingClientRect().top),
    hdrBottom: Math.round(document.querySelector('[data-app-header]').getBoundingClientRect().bottom),
    hot: document.querySelector('[data-flow-mrow="수주 확인"]').className,
    big: document.querySelector('[data-flow-mstep="회신"]').innerText.replace(/\s+/g, ' '),
    deskHidden: getComputedStyle(document.querySelector('[data-flow-main]')).display,
    theme: document.querySelector('meta[name="theme-color"]')?.content,
    sw: document.querySelector('main').scrollWidth - document.querySelector('main').clientWidth,
  }))
  ok(t.total === '100', '휴대폰 요약 — 오늘 처리할 일 = 막힘 + 처리 대기', t.total)
  ok(t.sums === '막힘=1,처리 대기=99,넘어온 일=54', '요약 3칸 (막힘 · 처리 대기 · 넘어온 일)', t.sums)
  ok(t.msub === '자재 요청,견적 단가 요청,부족자재,하네스 출도·불출,도면 배포 (협력사),자료 요청 (영업에)', '보조 업무 2칸 타일 (v4.98 자료 요청)', t.msub)
  ok(t.hdr === 'rgb(95, 82, 233)' && t.theme === '#5f52e9', '휴대폰 머리 줄 보라 + 상태줄 색', t.hdr + ' ' + t.theme)
  ok(t.heroTop === t.hdrBottom, '업무 흐름 화면 — 보라 요약이 머리 줄에 바로 붙음', t.heroTop + '/' + t.hdrBottom)
  ok(/fdeef0/.test(t.hot), '막힌 단계(빨강)는 색 바탕', t.hot)
  ok(/회신 새 PO 회신 대기 5/.test(t.big), '단계 줄에 이름 · 사유 · 큰 숫자', t.big)
  ok(t.deskHidden === 'none' && t.sw <= 1, 'PC용 단계 칸은 숨김 · 가로 넘침 없음', t.deskHidden + ' ' + t.sw)
  await p.close()
  p = await pg('/flow', 1280)
  const d = await p.evaluate(() => ({ hdr: getComputedStyle(document.querySelector('[data-app-header]')).backgroundColor, hero: getComputedStyle(document.querySelector('[data-flow-hero]')).display, mob: getComputedStyle(document.querySelector('[data-flow-mobile]')).display, main: getComputedStyle(document.querySelector('[data-flow-main]')).display, bg: getComputedStyle(document.querySelector('main')).backgroundColor }))
  ok(d.hdr === 'rgb(255, 255, 255)' && d.hero === 'none' && d.mob === 'none' && d.main === 'grid' && d.bg === 'rgb(244, 245, 250)', 'PC — 흰 머리 줄 · 단계 칸 · 회색 바탕(v4.96.0)', JSON.stringify(d))
  await p.close()
  for (const [r, title] of [['/quote-history', '견적 이력'], ['/ecount', '확정매입 (ecount)'], ['/sales/upload', '매출 실적 올리기']]) {
    p = await pg(r, 412); const h = await p.evaluate(() => document.querySelector('[data-app-header] h1').textContent); ok(h === title, `머리 줄 제목: ${r} → ${title}`, h); await p.close()
  }
  const sq = []
  for (const r of ['/issue', '/outbound-history', '/sales', '/purchase-dashboard', '/cost-saving', '/weekly/upload', '/quality/cn', '/quality/drawing-dist', '/master/items']) {
    p = await pg(r, 412)
    const z = await p.evaluate(() => { const m = document.querySelector('main'); const bad = []; for (const el of document.querySelectorAll('main button, main a, main th, main td span')) { const rc = el.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(el).lineHeight) || 16; if (rc.width && rc.width < 70 && rc.height > lh * 2.6 && (el.innerText||'').trim().length > 2 && el.rowSpan !== 2) bad.push(el.innerText.trim().slice(0, 8)) } return { bad, sw: m.scrollWidth - m.clientWidth } })
    if (z.bad.length || z.sw > 1) sq.push(r + ':' + z.bad.join('/') + ' sw' + z.sw)
    await p.close()
  }
  ok(!sq.length, '좁은 칸에서 세로로 꺾이던 버튼 · 표 머리글 없음 · 가로 넘침 없음 (9화면)', sq.join(' | '))
  await b.close(); console.log(fail ? `  ${fail}개 실패` : `  ${pass}/${pass} 통과`)
})()
