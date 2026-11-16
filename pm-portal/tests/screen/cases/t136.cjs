// v4.200.0 — 수주대장 지표 카드 순서(영업 · 구매자재) · 특이사항 카드 · 납기 지남 사유 없음 · 줄 왼쪽 띠
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 400)) } }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const open = async (me) => {
    const p = await b.newPage({ viewport: { width: 1600, height: 1000 } }); p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
    await p.addInitScript(() => { try { localStorage.setItem('pm_coach_seen_orders-sales', '1'); localStorage.setItem('pm_coach_seen_orders-buy', '1') } catch {} })
    await p.clock.setFixedTime(new Date('2026-11-16T01:00:00Z'))
    await p.goto('http://localhost:8765/app.html?odd=1&fastx=1' + (me ? '&me=' + encodeURIComponent(JSON.stringify(me)) : '') + '&r=' + encodeURIComponent('/orders')); await p.waitForTimeout(2000)
    await p.evaluate(async () => { const S = window.__S; S.DATA.pm_order_late = []; const l = S.DATA.pm_order_line.find((x) => x.id === 'l2') || S.DATA.pm_order_line.find((x) => x.id !== 'l1' && !x.cancelled && !(+x.delivered_qty >= +x.qty)); l.due_date = '2026-10-01'; window.__lateId = l.id; await window.__qc.invalidateQueries() })
    await p.waitForTimeout(1500)
    return p
  }
  const labels = (p) => p.locator('[data-kpi-order] [data-kpi]').evaluateAll((els) => els.map((e) => e.getAttribute('data-kpi')))
  // 영업
  let p = await open({ name: '이정민', dept: '영업', role: 'editor' })
  const ls = await labels(p)
  ok(ls[0] === '⚠ 특이사항' && ls[1] === '납기 지남' && ls[2] === '조건부 · 불가' && ls[3] === '미확인', '영업: 특이사항 · 납기 지남 · 조건부 먼저', ls)
  const oddTxt = await p.locator('[data-kpi="⚠ 특이사항"]').innerText()
  ok(/영업 확인/.test(oddTxt) && /Rev 1/.test(oddTxt), '특이사항 카드: 영업 확인 · Rev 1', oddTxt)
  const lateTxt = await p.locator('[data-kpi="납기 지남"]').innerText()
  ok(/사유 없음 \d+줄/.test(lateTxt), '납기 지남 카드에 사유 없음 줄 수', lateTxt)
  ok(/영업이 사유를 넣어 주세요/.test(await p.locator('[data-late-sum]').innerText()), '사유별 줄 빨갛게 + 안내')
  ok(await p.locator('[data-row-flag="late"]').count() >= 1 && await p.locator('[data-row-flag="odd"]').count() >= 1, '목록 줄 왼쪽 띠 (납기 지남 · 특이사항)')
  await p.click('[data-kpi="⚠ 특이사항"]'); await p.waitForTimeout(500)
  ok(await p.locator('[data-row-flag="odd"]').count() >= 1 && await p.locator('tr[data-row]').count() === await p.locator('[data-row-flag="odd"], [data-row-flag="late"]').count(), '특이사항 카드 누르면 특이사항 줄만')
  await p.screenshot({ path: '/tmp/jsportal-test/out/kpi_sales.png' })
  await p.close()
  // 구매자재
  p = await open(null)
  const lb = await labels(p)
  ok(lb[0] === '미확인' && lb[3] === '⚠ 특이사항' && lb.length === 5, '구매자재: 미확인 먼저 · 특이사항 4번째 · 5장', lb)
  await p.close()
  console.log(`pass=${pass} fail=${fail}`, 'errs', errs)
  await b.close()
})()
