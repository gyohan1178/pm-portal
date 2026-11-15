// v4.193.0 — Ctrl+D 품목 찾기 · 여러 품번 붙여넣기 · 결과 바로가기 · 방향키 · 강조 (노트북 1366×768)
const { chromium } = require('playwright')
const base = 'http://localhost:8765/app.html'
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 400)) } }
const W = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const b = await chromium.launch(); const errs = []
  const open = async (route, me) => { const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(route + ': ' + e.message.slice(0, 160)))
    await p.goto(`${base}?${me ? 'me=' + encodeURIComponent(JSON.stringify(me)) + '&' : ''}r=${encodeURIComponent(route)}`); await p.waitForTimeout(2300); return p }
  const paste = (p, sel, text) => p.evaluate(({ sel, text }) => { const el = document.querySelector(sel); el.focus(); const dt = new DataTransfer(); dt.setData('text', text); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) }, { sel, text })
  // ① Ctrl+D — 품목
  {
    const p = await open('/todo')
    await p.keyboard.press('Control+d'); await W(300)
    await p.keyboard.type('6200111'); await W(1200)
    ok(await p.locator('[data-palette-item="AX-6200111"]').count() === 1, 'Ctrl+D 에서 품번으로 품목이 나옴', await p.locator('[data-palette-item]').count())
    ok((await p.$$eval('[data-palette-item] mark', (a) => a.map((x) => x.textContent))).includes('6200111'), '맞은 글자 강조')
    await p.keyboard.press('Enter'); await W(1500)
    ok(/\/search/.test(await p.evaluate(() => location.hash + location.pathname + location.search)) || await p.locator('[data-search-main]').count() === 1, '고르면 통합 검색으로')
    ok(await p.inputValue('[data-search-main]') === 'AX-6200111' && /AX-6200111/.test(await p.textContent('tbody')), '그 품번으로 검색됨', await p.inputValue('[data-search-main]'))
    await p.keyboard.press('Control+d'); await W(300); await p.keyboard.type('입고'); await W(500)
    ok(/입고/.test(await p.textContent('.fixed.inset-0')), '메뉴 찾기는 그대로'); await p.keyboard.press('Escape'); await p.close()
  }
  // ② 통합 검색 — 커서 · 여러 품번 · 바로가기
  {
    const p = await open('/search')
    ok(await p.evaluate(() => document.activeElement?.hasAttribute('data-search-main')), '들어가면 커서가 검색칸에')
    await paste(p, '[data-search-main]', '품번\t수량\n6200111\t3\nBKN-3P-20A\nNOPE-999\n110153030'); await W(1500)
    ok(await p.locator('[data-many]').count() === 1 && /붙여넣은 품번 4개/.test(await p.textContent('[data-many]')), '머리글 빼고 4개로 읽음', await p.textContent('[data-many]').catch(() => ''))
    ok(/못 찾음 1/.test(await p.textContent('[data-many]')) && /NOPE-999/.test(await p.textContent('[data-many-missing]')), '못 찾은 품번을 알려 줌')
    const codes = await p.$$eval('tbody tr td:first-child .font-mono', (a) => a.map((x) => x.textContent))
    ok(codes[0] === 'AX-6200111' && codes.includes('AX-110153030'), '붙여넣은 차례대로 (접두 없이 쳐도 찾음)', codes)
    ok(codes.filter((c) => c === 'AX-6200111').length === 1, '같은 품목은 한 번만 (품번 · 제조사품번 둘 다 맞아도)', codes)
    ok(await p.locator('[data-recent]').count() === 0, '여러 품번은 최근 검색에 안 남음')
    ok(await p.locator('[data-act="po"]').count() >= 1 && await p.locator('[data-act="inb"]').count() >= 1, '구매자재: 발주 · 입고 이력 바로가기')
    await p.locator('[data-act="where"]').first().click(); await W(900)
    ok(await p.inputValue('input[placeholder^="기준코드 / 제조사품번"]') === 'AX-6200111', '「사용처」 → 역전개 탭에 그 품번')
    await p.goBack().catch(() => {}); await p.close()
    const q = await open('/search')
    await q.fill('[data-search-main]', '6200111'); await q.press('[data-search-main]', 'Enter'); await W(1300)
    await q.locator('[data-act="po"]').first().click(); await W(1800)
    ok(await q.inputValue('input[placeholder*="품번"]').catch(() => '') !== null && /AX-6200111/.test(await q.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.value).join('|'))), '「발주」 → 구매발주에 그 품번이 검색어로', await q.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.value).filter(Boolean)))
    await q.close()
    const r = await open('/search')
    await r.fill('[data-search-main]', '6200111'); await r.press('[data-search-main]', 'Enter'); await W(1300)
    await r.locator('[data-act="inb"]').first().click(); await W(1800)
    ok(/AX-6200111/.test(await r.evaluate(() => [...document.querySelectorAll('input')].map((i) => i.value).join('|'))) && await r.locator('[data-period-chips]').count() === 1, '「입고 이력」 → 입고 현황 탭 + 그 품번')
    await r.close()
    // 현장 계정 — 발주 · 입고 이력 버튼 없음
    const f = await open('/search', { name: '현장', dept: '제조', role: 'viewer' })
    await f.fill('[data-search-main]', '6200111'); await f.press('[data-search-main]', 'Enter'); await W(1300)
    ok(await f.locator('[data-act="where"]').count() >= 1 && await f.locator('[data-act="po"]').count() === 0 && await f.locator('[data-act="inb"]').count() === 0, '구매자재가 아니면 발주 · 입고 이력 버튼 없음'); await f.close()
  }
  // ③ 구매발주 품목 담기 — 방향키
  {
    const p = await open('/customer/ax/purchase')
    const add = p.locator('button', { hasText: /발주 등록|\+ 발주|신규 발주|발주 추가/ }).first()
    if (await add.count()) { await add.click(); await W(500) }
    const inp = p.locator('[data-item-search]')
    ok(await inp.count() === 1, '품목 담기 칸', await p.locator('button').allTextContents().then((a) => a.slice(0, 12)))
    if (await inp.count()) {
      await inp.fill('62'); await W(1200)
      ok(await p.locator('[data-item-hit]').count() >= 1, '품목 후보 나옴', await p.locator('[data-item-hit]').count())
      await inp.press('ArrowDown'); await W(150)
      ok(/bg-indigo-50/.test(await p.getAttribute('[data-item-hit="0"]', 'class')), '↓ 로 첫 줄 고름')
      ok((await p.$$eval('[data-item-hit] mark', (a) => a.length)) >= 1, '후보에 강조')
      await inp.press('Enter'); await W(400)
      ok(await p.locator('[data-item-hit]').count() === 0 && (await inp.inputValue()).length > 2, 'Enter 로 담김', await inp.inputValue())
    }
    await p.close()
  }
  // ④ 현장 검색 자동완성 — 방향키
  {
    const p = await open('/field-search')
    const inp = p.locator('input[placeholder^="품명·기준코드·제조사"]').first()
    await inp.fill('6200'); await W(1300)
    ok(await p.locator('[data-sug]').count() >= 1, '자동완성 나옴', await p.locator('[data-sug]').count())
    await inp.press('ArrowDown'); await W(150)
    ok(/bg-indigo-50/.test(await p.getAttribute('[data-sug="0"]', 'class')), '↓ 로 고름')
    await inp.press('Enter'); await W(1200)
    ok(await inp.inputValue() === 'AX-6200111', 'Enter 로 그 품번 검색', await inp.inputValue())
    ok((await p.$$eval('mark[data-hl]', (a) => a.length)) >= 1, '현장 검색 결과에도 강조')
    await p.close()
  }
  ok(errs.length === 0, '화면 오류 없음', errs)
  console.log(`t128 ${pass}/${pass + fail} 통과`); await b.close(); process.exit(fail ? 1 : 0)
})()
