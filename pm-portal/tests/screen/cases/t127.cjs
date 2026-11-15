// v4.192.0 — 조건 풀기 · 기간 빠른 선택 · 검색어 강조 · 최근 검색 (노트북 1366×768)
const { chromium } = require('playwright')
const base = 'http://localhost:8765/app.html'
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 400)) } }
const W = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const b = await chromium.launch(); const errs = []
  const open = async (route, ls) => { const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(route + ': ' + e.message.slice(0, 160)))
    if (ls) await p.addInitScript((ls) => { for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v) }, ls)
    await p.goto(`${base}?r=${encodeURIComponent(route)}`); await p.waitForTimeout(2300); return p }
  const noH = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  // ① 입고 — 기억된 고객사(Edwards) 때문에 0건 → 조건 풀기
  {
    const p = await open('/inbound', { 'pm.keep.inbound.cs': '"cid-ed"' })
    ok(await p.locator('[data-inb-empty]').count() === 1 && /이 조건에 맞는/.test(await p.textContent('[data-inb-empty]')) && /고객사/.test(await p.textContent('[data-inb-empty]')), '입고: 조건 때문에 0건임을 알려 줌', await p.textContent('[data-inb-empty]').catch(() => ''))
    await p.click('[data-inb-empty] [data-clear-filters]'); await W(900)
    ok(await p.locator('tbody tr').count() >= 1 && await p.locator('[data-inb-empty]').count() === 0, '입고: 「조건 풀기」 → 목록 다시 나옴')
    ok(await p.evaluate(() => localStorage.getItem('pm.keep.inbound.cs')) === '""', '입고: 기억된 고객사도 풀림')
    // 입고 현황 — 기간 칩
    await p.locator('button', { hasText: '입고 현황' }).first().click(); await W(900)
    ok(await p.locator('[data-period-chips]').count() === 1, '입고 현황: 기간 칩')
    await p.click('[data-period="m1"]'); await W(700)
    const d = await p.$$eval('input[type=date]', (a) => a.map((x) => x.value))
    ok(d.includes('2026-10-01') && d.includes('2026-10-31'), '입고 현황: 「지난달」 → 10-01 ~ 10-31', d)
    ok(/eeebfd/.test(await p.getAttribute('[data-period="m1"]', 'class')), '고른 칩 강조')
    ok(await noH(p), '입고: 가로 스크롤 없음'); await p.close()
  }
  // ② 재고현황 · 구매발주 · 자재 요청
  {
    const p = await open('/inventory', { 'pm.keep.inv.brand': '"없는브랜드"' })
    ok(/이 조건의 품목이 없습니다/.test(await p.textContent('tbody')) && await p.locator('[data-clear-filters]').count() === 1, '재고: 조건 0건 + 버튼', (await p.textContent('tbody')).slice(0, 120))
    await p.click('[data-clear-filters]'); await W(700)
    ok(await p.locator('[data-clear-filters]').count() === 0 && await p.locator('tbody tr').count() >= 1, '재고: 풀면 목록 나옴'); await p.close()
    const q = await open('/customer/ax/purchase', { 'pm.keep.po.type': '"없는구분"' })
    ok(await q.locator('[data-clear-filters]').count() === 1 && /조건에 가려져/.test(await q.textContent('tbody')), '구매발주: 조건 0건 + 몇 건이 가려졌는지', (await q.textContent('tbody')).slice(0, 140))
    await q.click('[data-clear-filters]'); await W(700)
    ok(await q.locator('[data-clear-filters]').count() === 0, '구매발주: 풀면 목록 나옴'); ok(await noH(q), '구매발주: 가로 스크롤 없음'); await q.close()
    const m = await open('/material-request', { 'pm.keep.mr.dept': '"없는부서"' })
    ok(await m.locator('[data-clear-filters]').count() === 1, '자재 요청: 조건 0건 + 버튼', (await m.textContent('body')).slice(0, 0))
    await m.click('[data-clear-filters]'); await W(900)
    ok(await m.locator('[data-clear-filters]').count() === 0, '자재 요청: 풀림'); await m.close()
  }
  // ③ 출고 현황 — 기간 칩
  {
    const p = await open('/outbound-history')
    ok(await p.locator('[data-period-chips] button').count() === 4, '출고 현황: 칩 4개')
    await p.click('[data-period="today"]'); await W(600)
    const d = await p.$$eval('input[type=date]', (a) => a.map((x) => x.value))
    ok(d[0] === d[1] && /^2026-/.test(d[0]), '출고 현황: 「오늘」', d); ok(await noH(p), '출고 현황: 가로 스크롤 없음'); await p.close()
  }
  // ④ 통합 검색 — 강조 · 최근 검색
  {
    const p = await open('/search')
    const inp = p.locator('input[placeholder^="기준코드·품명"]')
    await inp.fill('zzz-none'); await inp.press('Enter'); await W(1200)
    ok(await p.locator('[data-recent]').count() === 0, '결과 없는 검색은 최근 검색에 안 남음')
    await inp.fill('6200111'); await inp.press('Enter'); await W(1500)
    const marks = await p.$$eval('mark[data-hl]', (a) => a.map((x) => x.textContent))
    ok(marks.length >= 1, '맞은 글자 강조', marks)
    ok(await p.locator('[data-recent-q="6200111"]').count() === 1, '최근 검색에 들어감')
    await inp.fill('circuit'); await inp.press('Enter'); await W(1200)
    const rec = await p.$$eval('[data-recent-q]', (a) => a.map((x) => x.textContent))
    ok(rec[0] === 'circuit' && rec[1] === '6200111', '최근 것이 앞에', rec)
    await p.click('[data-recent-q="6200111"]'); await W(1000)
    ok(await inp.inputValue() === '6200111' && (await p.$$eval('mark[data-hl]', (a) => a.length)) >= 1, '칩을 누르면 다시 검색')
    await p.screenshot({ path: '/tmp/jsportal-test/out/v192_search.png' })
    await p.click('[data-recent-clear]'); await W(200)
    ok(await p.locator('[data-recent]').count() === 0, '「지우기」'); await p.close()
  }
  ok(errs.length === 0, '화면 오류 없음', errs)
  console.log(`t127 ${pass}/${pass + fail} 통과`); await b.close(); process.exit(fail ? 1 : 0)
})()
