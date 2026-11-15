// v4.188.1 — 지표 카드 · 도움말 머리글 맞추기
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 300)) } }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const open = async (r) => { const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', e => errs.push(r + ': ' + e.message.slice(0, 120))); await p.goto('http://localhost:8765/app.html?r=' + encodeURIComponent(r)); await p.waitForTimeout(2000); return p }
  let p = await open('/help')
  ok(await p.$eval('[data-page-title]', (e) => e.textContent) === '도움말 · 업무 안내' && await p.locator('[data-page-head] .page-desc').count() === 1, '도움말 — 공용 머리글(제목 + 설명)')
  await p.close()
  p = await open('/quality/drawing-dist')
  await p.locator('nav button', { hasText: '사내' }).first().click().catch(() => {}); await p.waitForTimeout(1200)
  const k = await p.$$eval('[data-kpi]', (a) => a.map((x) => x.getAttribute('data-kpi')))
  ok(k.includes('배포 대기 (영업 공유)') && k.includes('이번 달 사내 배포'), '사내 도면 배포 — 공용 지표 카드', k)
  await p.close()
  p = await open('/orders'); await p.click('[data-oi-tab="ecount"]').catch(() => {}); await p.waitForTimeout(1500)
  const body = await p.evaluate(() => document.body.innerText.slice(0, 3000))
  ok(/이카운트/.test(body), '이카운트 대조 탭 열림 (오류 없이)')
  await p.close()
  ok(errs.length === 0, '화면 오류 없음', errs)
  console.log(`t121 ${pass}/${pass + fail} 통과`); await b.close()
})()
