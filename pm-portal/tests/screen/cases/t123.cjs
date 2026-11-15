// v4.189.1 — 업데이트 이력: 최근 20개만 바로 · 나머지는 「이전 기록 더 보기」
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 300)) } }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } }); p.on('pageerror', e => errs.push(e.message.slice(0, 140)))
  await p.goto('http://localhost:8765/app.html?r=' + encodeURIComponent('/weekly')); await p.waitForTimeout(1500)
  await p.locator('button', { hasText: '· 이력' }).first().click(); await p.waitForTimeout(500)
  const cnt = () => p.evaluate(() => (document.body.innerText.match(/v4\.\d+\.\d+/g) || []).filter((v, i, a) => a.indexOf(v) === i).length)
  const n1 = await cnt(); ok(n1 >= 20 && n1 <= 22, '처음엔 최근 20개', n1)
  const txt = await p.evaluate(() => document.body.innerText)
  ok(txt.includes('v4.180.0') && !txt.includes('v4.179.2'), 'v4.180.0 까지 보이고 v4.179.2 는 아직 없음')
  await p.getByRole('button', { name: '이전 기록 더 보기' }).click(); await p.waitForTimeout(1500)
  const n2 = await cnt(); ok(n2 > 300, '더 보기 → 나머지 전부', n2)
  ok((await p.evaluate(() => document.body.innerText)).includes('v4.179.2'), '옮긴 기록(v4.179.2)이 이어서 나옴')
  ok(errs.length === 0, '화면 오류 없음', errs)
  console.log(`t123 ${pass}/${pass + fail} 통과`); await b.close(); process.exit(fail ? 1 : 0)
})()
