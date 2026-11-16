// v4.200.2 — 업무 흐름: 회신 한 단계(SQL 뒤 one_step) → 「회신 대기」 대신 「확인 예정」 · SQL 전엔 예전 그대로
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 400)) } }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const run = async (q) => {
    const p = await b.newPage({ viewport: { width: 412, height: 900 } }); p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
    await p.addInitScript(() => { try { localStorage.setItem('pm.flowTab', 'detail') } catch {} })
    await p.goto('http://localhost:8765/app.html?' + q + 'r=' + encodeURIComponent('/flow')); await p.waitForTimeout(2200)
    const t = await p.evaluate(() => document.querySelector('[data-flow-mstep="회신"]')?.innerText.replace(/\s+/g, ' ') || '')
    await p.close(); return t
  }
  const a = await run('oc=2&')
  ok(/확인 예정 2/.test(a) && !/회신 대기/.test(a), 'SQL 뒤: 회신 단계에 「확인 예정 2」 · 회신 대기 없음', a)
  const c = await run('')
  ok(/새 PO 회신 대기 5/.test(c), 'SQL 전: 예전 그대로', c)
  console.log(`pass=${pass} fail=${fail}`, 'errs', errs)
  await b.close()
})()
