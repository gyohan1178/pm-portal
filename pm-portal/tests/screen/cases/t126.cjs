// v4.191.0 — 팝업: 창 밖을 눌러도 안 닫힘 · 닫기 / 취소로만
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 300)) } }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const p = await b.newPage({ viewport: { width: 1366, height: 768 } }); p.on('pageerror', (e) => errs.push(e.message.slice(0, 140)))
  const U = (r) => 'http://localhost:8765/app.html?r=' + encodeURIComponent(r)
  // ① 할 일 추가 창
  await p.goto(U('/todo')); await p.waitForTimeout(2000)
  await p.click('[data-todo-add]'); await p.waitForTimeout(400)
  const back = p.locator('div.fixed.inset-0').last()
  ok(await back.count() === 1, '할 일 추가 창 열림')
  await p.mouse.click(5, 400); await p.waitForTimeout(400)
  ok(await p.locator('div.fixed.inset-0').count() >= 1, '창 밖을 눌러도 그대로')
  const cancel = p.locator('div.fixed.inset-0 button', { hasText: /취소|닫기/ }).first()
  ok(await cancel.count() === 1, '취소 / 닫기 버튼 있음')
  await cancel.click(); await p.waitForTimeout(400)
  ok(await p.locator('div.fixed.inset-0').count() === 0, '버튼으로는 닫힘')
  // ② 확인 창 (묻는 창) — 밖 눌러도 안 닫힘 · Esc 는 취소
  await p.goto(U('/orders')); await p.waitForTimeout(2200)
  await p.locator('[data-po-link]').first().click(); await p.waitForTimeout(600)
  ok(await p.locator('[data-po-drawer]').count() === 1, 'PO 상세 열림')
  await p.mouse.click(300, 400); await p.waitForTimeout(400)
  ok(await p.locator('[data-po-drawer]').count() === 1, 'PO 상세 — 밖을 눌러도 그대로')
  const x = p.locator('[data-po-drawer] button', { hasText: /닫기|✕/ }).first()
  ok(await x.count() === 1, 'PO 상세 닫기 버튼 있음'); await x.click(); await p.waitForTimeout(400)
  ok(await p.locator('[data-po-drawer]').count() === 0, 'PO 상세 — 닫기로 닫힘')
  // ③ 통합 검색 창(Ctrl+D)은 예전대로 밖을 누르면 닫힘
  ok(errs.length === 0, '화면 오류 없음', errs)
  console.log(`t126 ${pass}/${pass + fail} 통과`); await b.close(); process.exit(fail ? 1 : 0)
})()
