// v4.196.0 — 조용히 넘어가던 보조 자료 실패가 기록으로 남는다 (화면은 그대로)
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 400)) } }
;(async () => {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 1366, height: 768 } }); const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 120)))
  await p.goto('http://localhost:8765/app.html?r=' + encodeURIComponent('/todo')); await p.waitForTimeout(1800)
  await p.evaluate(() => { window.__S.RPCFN.pm_error_add = () => null })
  const mod = await p.evaluate(() => Object.keys(window).filter(k => /swallow|__err/i.test(k)))
  // 공정 현황판 — 주요품목 지정 읽기가 실패해도 화면은 뜨고, 기록이 남는다
  await p.evaluate(() => { window.__S.FAILFROM = window.__S.FAILFROM || {} })
  await p.click('aside a:has-text("공정 현황판")'); await p.waitForTimeout(2000)
  ok(await p.locator('[data-error-boundary]').count() === 0 && /공정/.test(await p.locator('main').innerText()), '공정 현황판 정상')
  const L = await p.evaluate(() => window.__S.RPC.filter((r) => r.fn === 'pm_error_add').map((r) => r.args.p_row))
  console.log('  기록', JSON.stringify(L.map(x => [x.kind, x.where_at, x.message.slice(0, 60)])))
  for (const r of ['/inbound', '/customer/ax/bom', '/orders', '/weekly', '/outbound']) {
    await p.goto('http://localhost:8765/app.html?r=' + encodeURIComponent(r)); await p.waitForTimeout(2000)
    ok(await p.locator('[data-error-boundary]').count() === 0 && (await p.locator('main').innerText()).length > 50, r + ' 정상')
  }
  // BOM — 등록일 읽기가 실패 → 목록은 그대로 뜨고 기록 1건
  await p.goto('http://localhost:8765/app.html?r=' + encodeURIComponent('/todo')); await p.waitForTimeout(1500)
  await p.evaluate(() => { window.__S.RPCFN.pm_error_add = () => null; window.__S.READFAIL = { projects: 99 }; window.__S.READFAILMSG = 'permission denied for table projects' })
  await p.locator('aside button:has-text("기초자료")').first().click(); await p.waitForTimeout(400)
  await p.locator('aside a[href*="/bom"]').first().click(); await p.waitForTimeout(6000)
  ok(await p.locator('[data-error-boundary]').count() === 0 && /BOM/.test(await p.locator('main').innerText()), 'BOM 화면은 그대로 뜬다')
  const Q = await p.evaluate(() => window.__S.RPC.filter((r) => r.fn === 'pm_error_add').map((r) => r.args.p_row))
  ok(Q.some(x => x.kind === 'quiet' && /BOM · 등록일/.test(x.where_at)), '조용히 넘어간 실패가 기록된다', Q.map(x => [x.kind, x.where_at, x.message.slice(0, 50)]))
  console.log(`pass=${pass} fail=${fail}`, 'errs', errs)
  await b.close()
})()
