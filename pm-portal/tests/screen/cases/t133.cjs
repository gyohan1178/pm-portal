// v4.198.0 — 수주대장 「미확인」 PO 수 · Edwards 7주 / 기타 4주 기준 · 확인 예정 · PO 한 번에 고르기
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 500)) } }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const p = await b.newPage({ viewport: { width: 1366, height: 768 } }); p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
  await p.clock.setFixedTime(new Date('2026-11-16T01:00:00Z'))
  await p.goto('http://localhost:8765/app.html?unconf=1&r=' + encodeURIComponent('/orders')); await p.waitForTimeout(3500)
  const kpiTxt = async () => (await p.locator('[data-kpi="미확인"]').innerText()).replace(/\n/g, ' ')
  const k = await kpiTxt()
  ok(/미확인/.test(k) && /\b4\b/.test(k) && /품목 20줄/.test(k) && /확인 예정 PO 2건/.test(k), '지표: 급한 PO 4건(기본 자료 1 + ED 근접 · 기타 근접 · AX) · 20줄 · 확인 예정 2건 (줄 22개는 빠짐)', k)
  const later = await p.locator('[data-unconf-later]').innerText()
  ok(/확인 예정 PO 2건/.test(later) && /품목 22줄/.test(later), '확인 예정 줄', later)
  // 지표 누르기 → 급한 것만
  await p.locator('[data-kpi="미확인"]').click(); await p.waitForTimeout(600)
  const t1 = await p.locator('main').innerText()
  ok(/UC-ED-NEAR/.test(t1) && /UC-ETC-NEAR/.test(t1) && /UC-AX-1/.test(t1) && !/UC-ED-FAR/.test(t1) && !/UC-ETC-FAR/.test(t1), '미확인 보기: 급한 PO 만')
  // PO 한 번에 고르기
  const pick = p.locator('[data-pick-po="UC-ED-NEAR"]').first()
  ok(/PO 15줄 고르기/.test(await pick.innerText()), 'PO 15줄 고르기 버튼', await pick.innerText())
  await pick.click(); await p.waitForTimeout(200)
  const nChk = await p.locator('[data-check^="UC-ED-NEAR|"]:checked').count()
  ok(nChk === 15, 'PO 15줄이 한 번에 골라짐', nChk)
  await pick.click(); await p.waitForTimeout(200)
  ok(await p.locator('[data-check^="UC-ED-NEAR|"]:checked').count() === 0, '다시 누르면 풂')
  ok(await p.locator('[data-pick-po="UC-AX-1"]').count() === 0, '한 줄짜리 PO 는 버튼 없음')
  // 확인 처리 → 미확인에서 빠짐
  await p.locator('[data-pick-po="UC-ED-NEAR"]').first().click(); await p.waitForTimeout(200)
  await p.locator('[data-bulk-confirm], button:has-text("확인 처리")').first().click(); await p.waitForTimeout(1200)
  const o2 = await p.evaluate(() => window.__S.DATA.pm_order.find((o) => o.id === 'uo2'))
  ok(!!o2.confirmed_at, 'PO 확인 처리 저장', o2)
  // 확인 예정 보기
  await p.click('[data-unconf-later-btn]'); await p.waitForTimeout(600)
  const t2 = await p.locator('main').innerText()
  ok(/UC-ED-FAR/.test(t2) && /UC-ETC-FAR/.test(t2) && !/UC-ETC-NEAR/.test(t2), '확인 예정 보기: 먼 PO 만')
  ok(await p.locator('[data-status]:has-text("확인 예정")').count() >= 1, '상태 칸 「확인 예정」(회색)')
  ok(!/영업일 미확인/.test(await p.locator('[data-row^="UC-ED-FAR|"]').first().innerText()), '먼 PO 줄엔 「N영업일 미확인」 빨간 글씨 없음')
  const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); ok(sw[0] <= sw[1], 'PC 가로 넘침 없음', sw)
  await p.screenshot({ path: '/tmp/jsportal-test/out/unconf.png' })
  console.log(`pass=${pass} fail=${fail}`, 'errs', errs)
  await b.close()
})()
