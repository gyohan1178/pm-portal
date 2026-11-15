// v4.194.0 — 휴대폰(390) : 실사 맨 위 · 접기(없애지 않음) · 메뉴 한 줄 / PC(1366) 는 그대로
const { chromium } = require('playwright')
const base = 'http://localhost:8765/app.html'
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 400)) } }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const open = async (route, w, h, extra = '') => { const ctx = await b.newContext({ viewport: { width: w, height: h } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(route + ': ' + e.message.slice(0, 160)))
    await p.clock.setFixedTime(new Date('2026-11-16T01:00:00Z'))
    await p.goto(`${base}?${extra}r=${encodeURIComponent(route)}`); await p.waitForTimeout(2600); return p }
  const top = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top) : null }, sel)
  const noX = async (p) => { const [a, c] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); return a <= c }
  // ① 할 일 — 휴대폰
  {
    const p = await open('/todo', 390, 844, 'cyc=1&')
    ok(await p.locator('[data-cycle-lead] [data-cycle-todo]').count() === 1, '내 오늘 실사가 맨 위 묶음에')
    const tl = await top(p, '[data-cycle-lead]'), tf = await top(p, '[data-today-fold]'), tw = await top(p, '[data-todo-who]')
    ok(tl < tf && tf < tw, '차례: 실사 → 오늘 챙길 일(접힘) → 사람 칩', [tl, tf, tw])
    ok(await p.locator('[data-todo-group] [data-cycle-todo]').count() === 0, '아래 묶음에 같은 줄이 또 나오지 않음')
    const go = p.locator('[data-cycle-go]'); const loc = await go.getAttribute('data-cycle-go')
    const bb = await go.boundingBox(); ok(bb.height >= 44 && bb.y + bb.height < 844, '「이어서 세기」 큰 버튼이 첫 화면에', bb)
    ok(await p.locator('[data-cycle-lead] [data-cycle-cell]').count() >= 5, '오늘 칸이 펼쳐져 있음')
    ok(await p.locator('[data-cycle-week]').count() === 1 && await p.locator('[data-cycle-todo-more]').count() === 1, '이번 주 · ＋5칸 더는 그대로 있음')
    ok(await p.locator('[data-today-auto]').count() === 0 && /6칸 펼치기/.test(await p.textContent('[data-today-fold]')), '오늘 챙길 일은 한 줄 · 「6칸 펼치기」')
    await p.click('[data-today-fold]'); await p.waitForTimeout(300)
    ok(await p.locator('[data-today]').count() === 6, '펼치면 6칸 다 나옴')
    await p.click('[data-today-unfold]'); await p.waitForTimeout(200)
    ok(await p.locator('[data-today-fold]').count() === 1, '다시 접힘')
    ok(await noX(p), '가로 스크롤 없음')
    await go.click(); await p.waitForTimeout(1500)
    ok(new RegExp('재고 실사[\\s\\S]*' + loc).test(await p.textContent('body')), '누르면 다음 칸 실사로', (await p.textContent('main').catch(() => '')).slice(0, 160))
    await p.close()
  }
  // ② 메뉴 — 휴대폰
  {
    const p = await open('/todo', 390, 844, 'cyc=1&')
    await p.click('[data-menu-open]').catch(async () => { await p.locator('header button').first().click() }); await p.waitForTimeout(500)
    ok(await p.locator('[data-menu-cycle]').count() === 1 && /오늘 실사 이어서/.test(await p.textContent('[data-menu-cycle]')), '메뉴 맨 위 「오늘 실사 이어서」', await p.locator('[data-menu-cycle]').count())
    ok(/다음 N2-/.test(await p.textContent('[data-menu-cycle]')), '진행 · 다음 칸이 보임', await p.textContent('[data-menu-cycle]').catch(() => ''))
    const h = await p.evaluate(() => { const a = [...document.querySelectorAll('aside a[href]')].find((x) => /할 일/.test(x.textContent)); return a ? a.getBoundingClientRect().height : 0 })
    ok(h >= 40, '메뉴 줄 높이 40 이상', h)
    const names = await p.$$eval('aside a[href]', (a) => a.map((x) => x.textContent.trim()).filter(Boolean))
    await p.click('[data-menu-cycle]'); await p.waitForTimeout(1200)
    ok(/재고 실사[\s\S]*N2-/.test(await p.textContent('body')) && await p.locator('[data-todo-who]').count() === 0, '누르면 다음 칸으로')
    await p.close()
    const q = await open('/todo', 1366, 768, 'cyc=1&')
    const pcNames = await q.$$eval('aside a[href]', (a) => a.map((x) => x.textContent.trim()).filter(Boolean))
    ok(JSON.stringify(names.filter((x) => !/오늘 실사 이어서/.test(x))) === JSON.stringify(pcNames), '메뉴 구성은 PC 와 같음 (한 줄만 더)', [names.length, pcNames.length])
    // ③ PC 는 그대로
    ok(await q.locator('[data-cycle-lead]').count() === 0 && await q.locator('[data-menu-cycle]').count() === 0, 'PC: 맨 위 실사 묶음 · 메뉴 한 줄 없음')
    ok(await q.locator('[data-today-auto] [data-today]').count() === 6 && await q.locator('[data-today-fold]').count() === 0, 'PC: 오늘 챙길 일 6칸 그대로')
    ok(await q.locator('[data-todo-group] [data-cycle-todo]').count() === 1 && await q.locator('[data-cycle-go]').count() === 0 && await q.locator('[data-cycle-cell]').count() === 0, 'PC: 실사 줄은 묶음 안 · 접힌 채')
    const h2 = await q.evaluate(() => { const a = [...document.querySelectorAll('aside a[href]')].find((x) => /할 일/.test(x.textContent)); return a.getBoundingClientRect().height })
    ok(h2 < 34, 'PC: 메뉴 줄 높이 그대로', h2)
    await q.close()
  }
  // ④ 자재 요청
  {
    const p = await open('/material-request', 390, 844, 'mr=1&')
    ok(await p.locator('[data-req-kpi-fold]').count() === 1 && await p.locator('[data-req-kpi]').count() === 0, '지표는 한 줄로 접힘')
    ok(/지표 4개 펼치기/.test(await p.textContent('[data-req-kpi-fold]')) && /필요일 지남 \d/.test(await p.textContent('[data-req-kpi-fold]')), '접힌 줄에 숫자 4개 · 무엇이 접혔는지')
    ok(await p.locator('[data-req-actbar] button:visible').count() === 0 && /체크하면/.test(await p.textContent('[data-req-actbar]')), '처리 버튼 줄은 안내 한 줄')
    await p.click('[data-req-kpi-fold]'); await p.waitForTimeout(300)
    ok(await p.locator('[data-req-kpi]').count() === 1, '펼치면 지표 카드 4개')
    await p.click('[data-req-kpi-unfold]'); await p.waitForTimeout(200)
    const cb = p.locator('input[type=checkbox]:visible').first()
    if (await cb.count()) { await cb.click({ force: true }); await p.waitForTimeout(200); if (!/선택/.test(await p.textContent('[data-req-selcount]'))) { await cb.locator('xpath=..').click(); await p.waitForTimeout(300) }
      ok(await p.locator('[data-req-actbar] button:visible').count() >= 3 && /선택/.test(await p.textContent('[data-req-selcount]')), '체크하면 처리 버튼이 나옴', await p.locator('[data-req-actbar] button:visible').count())
    } else ok(false, '체크할 요청이 있음')
    ok(await noX(p), '가로 스크롤 없음')
    await p.close()
    const q = await open('/material-request', 1366, 768, 'mr=1&')
    ok(await q.locator('[data-req-kpi]').count() === 1 && await q.locator('[data-req-kpi-fold]').count() === 0, 'PC: 지표 카드 그대로')
    ok(await q.locator('[data-req-actbar] button:visible').count() >= 5 && /요청을 체크$/.test((await q.textContent('[data-req-selcount]')).trim()), 'PC: 처리 버튼 줄 늘 그 자리', await q.textContent('[data-req-selcount]'))
    await q.close()
  }
  // ⑤ BOM
  {
    const p = await open('/customer/ax/bom', 390, 844)
    ok(await p.locator('[data-bom-up-fold]').count() === 1 && !/BOM CSV 업로드/.test(await p.textContent('body')), '올리기 · 양식 3개는 접힘')
    const ts = await p.evaluate(() => Math.round(document.querySelector('input[placeholder^="상위품번"]').getBoundingClientRect().top))
    ok(ts < 400, '검색칸이 첫 화면 위쪽에', ts)
    await p.click('[data-bom-up-fold]'); await p.waitForTimeout(200)
    ok(/BOM CSV 업로드/.test(await p.textContent('body')) && /양식 다운로드/.test(await p.textContent('body')), '펼치면 3개 다 나옴')
    await p.close()
    const q = await open('/customer/ax/bom', 1366, 768)
    ok(await q.locator('[data-bom-up-fold]').count() === 0 && /BOM CSV 업로드/.test(await q.textContent('body')), 'PC: 그대로')
    await q.close()
  }
  ok(errs.length === 0, '화면 오류 없음', errs)
  console.log(`\npass=${pass} fail=${fail}`); await b.close(); process.exit(fail ? 1 : 0)
})()
