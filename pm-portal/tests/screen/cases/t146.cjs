// v4.207.0 — 할 일 대분류 (외근 · 미팅 …) + 담당자 이름 · 달력 칸 「이름 · [대분류] 제목」
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 400)) } }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } }); p.on('pageerror', e => errs.push(e.message))
  await p.clock.setFixedTime(new Date('2026-11-16T01:00:00Z'))
  await p.goto(`http://localhost:8765/app.html?sched=1&r=${encodeURIComponent('/todo')}`); await p.waitForTimeout(2300)
  await p.click('[data-todo-add]'); await p.waitForTimeout(400)
  const btns = await p.$$eval('[data-todo-cat-btn]', (els) => els.map((e) => e.dataset.todoCatBtn))
  ok(['외근', '내방', '미팅', '연차'].every((c) => btns.includes(c)), '대분류 버튼', btns)
  await p.click('[data-todo-cat-btn="외근"]')
  await p.fill('[data-todo-title]', '보명이티씨 / 11시')
  await p.fill('input[type="date"] >> nth=0', '2026-11-17')
  await p.screenshot({ path: '/tmp/jsportal-test/out/shots/todo_cat.png' })
  await p.click('button:has-text("저장")'); await p.waitForTimeout(800)
  const r = await p.evaluate(() => window.__S.DATA.pm_todo.find((x) => x.title === '보명이티씨 / 11시'))
  ok(r && r.tag === '외근', '대분류 저장 (태그 칸)', r)
  // 직접 적은 대분류는 다음부터 버튼으로
  await p.click('[data-todo-add]'); await p.waitForTimeout(300)
  await p.fill('[data-todo-cat] input', '설치'); await p.fill('[data-todo-title]', '판넬 설치 입회'); await p.click('button:has-text("저장")'); await p.waitForTimeout(800)
  await p.click('[data-todo-add]'); await p.waitForTimeout(300)
  ok(await p.locator('[data-todo-cat-btn="설치"]').count() === 1, '직접 적은 대분류가 버튼으로 나옴')
  await p.keyboard.press('Escape'); await p.click('button:has-text("취소")').catch(() => {}); await p.waitForTimeout(300)
  // 달력
  await p.click('[data-todo-view-btn="cal"]').catch(() => {}); await p.waitForTimeout(800)
  const cal = await p.$$eval('[data-cal-item]', (els) => els.map((e) => e.textContent))
  ok(cal.some((t) => /\[외근\] 보명이티씨/.test(t)), '달력 칸에 [대분류] 제목', cal.slice(0, 12))
  await p.screenshot({ path: '/tmp/jsportal-test/out/shots/todo_cat_cal.png' })
  ok(!errs.length, '오류 없음', errs); console.log(`t146 ${pass}/${pass + fail}`); await b.close()
})()
