// v4.201.0 — 초도품 진행관리 품번 → 자재 매칭 (BOM 바로 불러옴) · 다음 건 매칭
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 400)) } }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
  await p.goto('http://localhost:8765/app.html?fa2=1&r=' + encodeURIComponent('/quality/fa-progress?fa=11')); await p.waitForTimeout(2500)
  ok(await p.locator('[data-fa-to-fai]').count() === 1, '건 상세 품번이 버튼')
  await p.click('[data-fa-to-fai]'); await p.waitForTimeout(2500)
  const src = await p.locator('[data-fai-src]').innerText().catch(() => '')
  ok(/110153030/.test(src) && (await p.locator('[data-fai-src="bom"]').count()) === 1, '자재 매칭으로 넘어가며 그 품번 BOM 을 바로 불러옴', src)
  const box = await p.locator('[data-fa-link]').innerText().catch(() => '')
  ok(/FA-PO-1/.test(box), '진행관리 건과 연결 (FA PO)', box.slice(0, 200))
  const nx = p.locator('[data-fai-next]')
  ok(await nx.count() === 1 && (await nx.getAttribute('data-fai-next')) === '110999999', '다음 건 = 우선순위 1 · 보류 건 빠짐', await nx.getAttribute('data-fai-next').catch(() => ''))
  await nx.click(); await p.waitForTimeout(2000)
  const box2 = await p.locator('[data-fa-link]').innerText().catch(() => '')
  ok(/110999999/.test(box2) && /FA-PO-2/.test(box2) && /포털 BOM 에서 불러오기/.test(box2) && !/올린 리포트/.test(box2) && /다음 건 매칭 ▶ 110153030/.test(box2), '다음 건으로 넘어감 — BOM 없으면 앞 건 결과 비우고 올리기 안내', box2.slice(0, 250))
  console.log(`pass=${pass} fail=${fail}`, 'errs', errs)
  await b.close()
})()
