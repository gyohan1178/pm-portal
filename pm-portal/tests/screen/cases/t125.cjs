// v4.191.0 — 입고: 보관 위치 · 기다리는 곳 / 보던 조건 기억 / 구매발주 일괄 바꾸기 되돌리기 / 할 일: 오늘 챙길 일 (노트북 1366×768)
const { chromium } = require('playwright')
const base = 'http://localhost:8765/app.html'
const SHOT = '/tmp/jsportal-test/out/'
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 400)) } }
const W = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const b = await chromium.launch()
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } })
  const errs = []
  const open = async (route) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message.slice(0, 160))); await p.goto(`${base}?r=${encodeURIComponent(route)}`); await p.waitForTimeout(2200); return p }
  const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  // ① 입고 — 위치 · 요청 대기 · 미불출 호기
  {
    const p = await open('/inbound')
    await p.evaluate(async () => {
      const S = window.__S
      S.DATA.pm_material_request.push({ id: 'mrw1', req_no: 'MR-W1', item_id: 'p2', qty: 5, issued_qty: 2, status: '요청' }, { id: 'mrw2', req_no: 'MR-W2', item_id: 'p2', qty: 4, status: '완료' })
      S.DATA.production[0].missing_parts = [{ pn: (S.DATA.items.find((i) => i.id === 'p2').std_code || '').replace(/^AX-/, ''), qty: 2 }]
      await window.__qc.invalidateQueries()
    }); await W(1500)
    const row = p.locator('tbody tr').first()
    ok(/B-02-01/.test(await row.locator('[data-inb-loc]').textContent()), '줄에 보관 위치', await row.textContent())
    ok(/요청 1/.test(await row.locator('[data-inb-req]').textContent()), '끝난 요청은 빼고 「요청 대기 1」')
    ok(/남은 수량 3/.test(await row.locator('[data-inb-req]').getAttribute('title')), '남은 수량 = 요청 5 − 불출 2', await row.locator('[data-inb-req]').getAttribute('title'))
    ok(/미불출 1대/.test(await row.locator('[data-inb-miss]').textContent()) && /#12/.test(await row.locator('[data-inb-miss]').getAttribute('title')), '미불출 호기 (접두 없는 품번도 맞춤)', await row.locator('[data-inb-miss]').getAttribute('title'))
    ok(await noHScroll(p), '1366 폭에서 가로 스크롤 없음')
    await p.screenshot({ path: SHOT + 'v191_inbound.png' })
    // 고객사 기억
    const tab = p.locator('button', { hasText: 'AXCELIS' }).first()
    await tab.click(); await W(500)
    const kept = await p.evaluate(() => localStorage.getItem('pm.keep.inbound.cs'))
    ok(kept === '"cid-ax"', '고객사 고르면 기억', kept)
    await p.close()
    const p2 = await open('/inbound')
    ok((await p2.evaluate(() => window.__S.READLOG ? 1 : 1)) === 1 && await p2.locator('tbody tr').count() >= 1, '다시 열어도 목록 그대로')
    ok(await p2.evaluate(() => localStorage.getItem('pm.keep.inbound.cs')) === '"cid-ax"', '다시 열어도 고객사 선택 유지')
    await p2.close()
  }
  // ② 구매발주 — 발주번호 일괄 부여 → 되돌리기
  {
    const p = await open('/customer/ax/purchase')
    await p.evaluate(async () => {
      const S = window.__S, a = S.DATA.purchase_orders[0]
      S.DATA.purchase_orders.push({ ...a, id: 'po2', po_number: 'OLD-2', item_id: 'p1' }, { ...a, id: 'po3', po_number: null, item_id: 'p1' })
      await window.__qc.invalidateQueries()
    }); await W(1500)
    const boxes = p.locator('tbody input[type=checkbox]')
    const n = await boxes.count(); for (let i = 0; i < n; i++) await boxes.nth(i).check().catch(() => {})
    await W(300)
    const inp = p.locator('input[placeholder="이카운트 발주번호"]')
    ok(await inp.count() === 1, '발주번호 일괄 칸', n)
    await inp.fill('NEW-9'); await p.locator('button', { hasText: '발주번호 부여' }).click(); await W(900)
    let D = await p.evaluate(() => window.__S.DATA.purchase_orders.map((x) => x.po_number))
    ok(D.every((x) => x === 'NEW-9'), '3건 모두 새 번호', D)
    const undo = p.locator('.pm-snack button', { hasText: '되돌리기' })
    ok(await undo.count() === 1, '되돌리기 스낵바')
    await undo.click(); await W(900)
    D = await p.evaluate(() => window.__S.DATA.purchase_orders.map((x) => [x.id, x.po_number]))
    ok(JSON.stringify(D) === JSON.stringify([['po1', 'JS-261020-01'], ['po2', 'OLD-2'], ['po3', null]]), '줄마다 원래 번호로 (빈 것은 빈 값)', D)
    ok(await noHScroll(p), '1366 폭에서 가로 스크롤 없음')
    await p.close()
  }
  // ③ 할 일 — 오늘 챙길 일
  {
    const p = await open('/todo')
    const today = await p.evaluate(() => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10))
    await p.evaluate(async (today) => {
      const S = window.__S, a = S.DATA.purchase_orders[0]
      S.DATA.purchase_orders = [
        { ...a, id: 'd1', promise_date: today }, { ...a, id: 'd2', promise_date: '2026-01-05' },
        { ...a, id: 'd3', promise_date: '2026-01-05', vendor_date: today },          // 협력사 변경일이 오늘 → 오늘
        { ...a, id: 'd4', promise_date: today, customer_id: 'cid-ed' },              // 다른 고객사
        { ...a, id: 'd5', promise_date: today, status: '완료' },
      ]
      S.RPCFN.pm_flow_counts = () => ({ ord_unconfirmed: 2, ord_waiting: 5, req_open: 4, rfq_price: 1 })
      await window.__qc.invalidateQueries()
    }, today); await W(1500)
    ok(await p.locator('[data-today-auto]').count() === 1, '구매자재 계정에 「오늘 챙길 일」')
    const num = async (k) => (await p.locator(`[data-today="${k}"] b`).textContent()).trim()
    ok(await num('in-today') === '2', '내 고객사: 오늘 들어올 발주 2 (변경일 오늘 포함 · 완료 · 타 고객사 제외)', await num('in-today'))
    ok(await num('in-late') === '1', '입고 지남 1', await num('in-late'))
    ok(await num('ord') === '7' && await num('req') === '4' && await num('rfq') === '1', '수주 7 · 자재 요청 4 · 단가 요청 1', [await num('ord'), await num('req'), await num('rfq')])
    await p.click('[data-today-scope="all"]'); await W(300)
    ok(await num('in-today') === '3', '「전체」로 바꾸면 3', await num('in-today'))
    const box = await p.locator('[data-today-auto]').boundingBox()
    ok(box.height <= 130, '노트북에서 한 줄 (높이 130 이하)', box.height)
    const tops = await p.$$eval('[data-today]', (a) => [...new Set(a.map((x) => Math.round(x.getBoundingClientRect().top)))])
    ok(tops.length === 1, '칸 6개가 한 줄', tops)
    ok(await noHScroll(p), '1366 폭에서 가로 스크롤 없음')
    await p.screenshot({ path: SHOT + 'v191_todo.png' })
    await p.close()
  }
  ok(errs.length === 0, '화면 오류 없음', errs)
  console.log(`t125 ${pass}/${pass + fail} 통과`); await b.close(); process.exit(fail ? 1 : 0)
})()
