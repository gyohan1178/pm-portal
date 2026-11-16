// v4.200.1 — 미확인 카드 · 할 일 「수주 미확인」(?kpi=unconfirmed) → PO별로 바로
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 400)) } }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const p = await b.newPage({ viewport: { width: 1366, height: 800 } }); p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
  await p.clock.setFixedTime(new Date('2026-11-16T01:00:00Z'))
  await p.goto('http://localhost:8765/app.html?unconf=1&r=' + encodeURIComponent('/orders?kpi=unconfirmed')); await p.waitForTimeout(3000)
  ok(await p.locator('[data-kpi="미확인"][data-kpi-on="1"]').count() === 1, '주소 ?kpi=unconfirmed → 미확인 거르기 켜짐')
  const t = await p.locator('main').innerText()
  ok(/UC-ED-NEAR/.test(t) && !/UC-ED-FAR/.test(t) && await p.locator('[data-check^="UC-ED-NEAR|"]').count() === 0, 'PO별 목록 (품목 줄 체크칸 없음)')
  await p.locator('[data-kpi="미확인"]').click(); await p.waitForTimeout(300)
  ok(await p.locator('[data-kpi="미확인"][data-kpi-on="1"]').count() === 0, '다시 누르면 거르기 풂')
  console.log(`pass=${pass} fail=${fail}`, 'errs', errs)
  await b.close()
})()
