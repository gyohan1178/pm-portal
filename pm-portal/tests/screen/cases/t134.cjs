// v4.198.1 — 오늘 챙길 일 「수주 미확인 · 회신 대기」: SQL 뒤엔 PO 기준(pm_order_confirm_summary) · 전엔 예전 숫자
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 400)) } }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const run = async (withFn, q = 'oc=1&') => {
    const p = await b.newPage({ viewport: { width: 1366, height: 768 } }); p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
    await p.clock.setFixedTime(new Date('2026-11-16T01:00:00Z'))
    await p.goto('http://localhost:8765/app.html?flowc=1&' + (withFn ? q : '') + 'r=' + encodeURIComponent('/todo')); await p.waitForTimeout(2500)
    const t = await p.locator('a[href^="/orders"]:has-text("수주 미확인")').first().innerText().catch(() => '')
    await p.close(); return t.replace(/\n/g, ' ')
  }
  const a = await run(true)
  ok(/\(PO\)/.test(a) && /\b4\b/.test(a) && /미확인 3 · 대기 1 · 예정 2/.test(a), 'SQL 뒤: PO 기준 4 (미확인 3 · 대기 1 · 예정 2)', a)
  const d = await run(true, 'oc=2&')
  ok(/회신 전/.test(d) && /\b3\b/.test(d) && !/대기/.test(d) && /예정 2/.test(d), 'v4.199.0 한 단계: 미확인 3 (회신 대기 없음)', d)
  const c = await run(false)
  ok(!/\(PO\)/.test(c) && /1,358/.test(c) && /미확인 679 · 대기 679/.test(c), 'SQL 전: 예전 숫자 그대로', c)
  console.log(`pass=${pass} fail=${fail}`, 'errs', errs)
  await b.close()
})()
