// v4.201.1 — 재고현황 보관위치 칸이 현재고 옆에 보이고 · 눌러서 입력 · 저장
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 400)) } }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
  await p.goto('http://localhost:8765/app.html?r=' + encodeURIComponent('/inventory')); await p.waitForTimeout(2500)
  const heads = await p.$$eval('thead th', (a) => a.map((x) => x.textContent.trim()))
  const qi = heads.findIndex((h) => /현재고/.test(h)), li = heads.findIndex((h) => /보관위치/.test(h))
  ok(li === qi + 1, '보관위치가 현재고 바로 옆', heads)
  const cell = p.locator('[data-inv-loc]').first()
  const box = await cell.boundingBox()
  ok(box && box.x + box.width <= 1440, '위치 칸이 화면 안에 보임', box)
  const code = await cell.getAttribute('data-inv-loc')
  await cell.click(); await p.waitForTimeout(200)
  await p.fill('[data-inv-loc-input]', 'Z-09-01'); await p.press('[data-inv-loc-input]', 'Enter'); await p.waitForTimeout(800)
  const saved = await p.evaluate((c) => { const S = window.__S; const it = S.DATA.items.find((i) => i.std_code === c); return (S.DATA.inventory || []).find((r) => r.item_id === it?.id)?.location }, code)
  ok(saved === 'Z-09-01', '저장 → inventory.location', [code, saved])
  ok(/Z-09-01/.test(await p.locator(`[data-inv-loc="${code}"]`).innerText()), '화면에도 바로')
  console.log(`pass=${pass} fail=${fail}`, 'errs', errs)
  await b.close()
})()
