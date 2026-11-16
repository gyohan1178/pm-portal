// v4.209.0 — 화면별 안내 「❓ 안내」 · 도움말 「화면별 안내」 (같은 글: lib/pageHelp.js)
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 300)) } }
const U = (r) => `http://localhost:8765/app.html?r=${encodeURIComponent(r)}`
;(async () => {
  const b = await chromium.launch(); const errs = []
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } }); p.on('pageerror', (e) => errs.push(e.message))
  for (const [r, k, word] of [['/todo', 'todo', '대분류'], ['/orders', 'orders', '자재 점검'], ['/inbound', 'inbound', '입고'], ['/quality/complaints', 'complaints', '미처리'], ['/material-request', 'mr', '반려']]) {
    await p.goto(U(r)); await p.waitForTimeout(1800)
    ok(await p.locator(`[data-page-help="${k}"]`).count() === 1, `${r} — 「❓ 안내」 버튼`)
    await p.click(`[data-page-help="${k}"]`); await p.waitForTimeout(300)
    const t = await p.locator('[data-page-help-panel]').innerText().catch(() => '')
    ok(t.includes(word), `${r} — 안내 창에 그 화면 내용`, t.slice(0, 120))
    if (k === 'todo') await p.screenshot({ path: '/tmp/jsportal-test/out/shots/page_help.png' })
    await p.mouse.click(20, 300); await p.keyboard.press('Escape'); await p.waitForTimeout(200)
    ok(await p.locator('[data-page-help-panel]').count() === 1, `${r} — 바깥 클릭·Esc 로는 안 닫힘`)
    await p.locator('[data-page-help-panel] button[aria-label="닫기"]').click(); await p.waitForTimeout(200)
    ok(await p.locator('[data-page-help-panel]').count() === 0, `${r} — 닫기 버튼으로 닫힘`)
  }
  await p.goto(U('/help')); await p.waitForTimeout(1500)
  ok(await p.locator('[data-help-pages]').count() === 1, '도움말에 「화면별 안내」')
  await p.click('[data-help-page="kakao"]'); await p.waitForTimeout(300)
  ok(/카카오톡 연결하기/.test(await p.locator('[data-help-page-body="kakao"]').innerText()), '도움말 — 카톡 알림 안내 펼침')
  ok(await p.locator('[data-page-help="none"]').count() === 1, '안내가 없는 화면(도움말)은 도움말로 가는 ❓')
  ok(!errs.length, '오류 없음', errs); console.log(`t147 ${pass}/${pass + fail}`); await b.close()
})()
