// v4.190.0 — 수주대장: 미납 사유 (줄 · 일괄 · 사유별 거르기) · PO 확인 처리 (일괄 · 되돌리기)
const { chromium } = require('playwright')
const base = 'http://localhost:8765/app.html'
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 400)) } }
const W = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const b = await chromium.launch()
  const mk = async (me, pre) => {
    const p = await b.newPage({ viewport: { width: 1600, height: 1000 } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)))
    await p.addInitScript(() => { try { localStorage.setItem('pm_coach_seen_orders-sales', '1') } catch {} })
    await p.goto(`${base}?fastx=1&me=${encodeURIComponent(JSON.stringify(me))}&r=${encodeURIComponent('/orders')}`); await p.waitForTimeout(2000)
    // 진행 중 줄 3개의 납기를 지난 날로 · PO 확인을 지움
    const info = await p.evaluate(async (pre) => {
      const S = window.__S; if (pre === 'missing') S.MISSING = [...(S.MISSING || []), 'pm_order_late']
      S.DATA.pm_order_late = S.DATA.pm_order_late || []
      const heads = new Map(S.DATA.pm_order.map((o) => [o.id, o]))
      const live = S.DATA.pm_order_line.filter((l) => !l.cancelled && !((+l.delivered_qty || 0) >= (+l.qty || 0)) && heads.get(l.order_id) && !heads.get(l.order_id).cancelled && !heads.get(l.order_id).planned).slice(0, 3)
      while (live.length < 3) { const n = { ...live[live.length - 1], id: 'lx' + live.length, line_no: String(90 + live.length), del_line: '1', delivered_qty: 0 }; S.DATA.pm_order_line.push(n); live.push(n) }
      live.forEach((l) => { l.due_date = '2026-10-01'; l.reply = null; const o = heads.get(l.order_id); o.confirmed_at = null; o.confirmed_name = null })
      await window.__qc.invalidateQueries()
      return live.map((l) => ({ id: l.id, key: `${heads.get(l.order_id).po_no}|${l.line_no}/${l.del_line}`, oid: l.order_id }))
    }, pre)
    await W(1800)
    return { p, errs, info }
  }
  // ① 구매자재 화면
  {
    const { p, errs, info } = await mk({})
    ok(info.length === 3, '지난 납기 줄 3개 심음', info)
    ok(await p.locator('[data-late-sum]').count() === 1, '사유별 줄이 보임')
    ok(/사유 없음 \d+/.test(await p.textContent('[data-late-sum]')), '처음엔 전부 「사유 없음」', await p.textContent('[data-late-sum]'))
    const row0 = `[data-row="${info[0].key}"]`
    ok(await p.locator(`${row0} select[data-late-reason]`).count() === 1, '납기 지난 줄 상태 칸에 사유 고르기')
    await p.selectOption(`${row0} select[data-late-reason]`, '자재 부족'); await W(600)
    let D = await p.evaluate(() => window.__S.DATA.pm_order_late)
    ok(D.length === 1 && D[0].line_id === info[0].id && D[0].reason === '자재 부족', '줄 하나 저장', D)
    ok(await p.locator('[data-late-chip="자재 부족"]').count() === 1 && /자재 부족 1/.test(await p.textContent('[data-late-chip="자재 부족"]')), '사유별 숫자에 바로 반영')
    const lg = await p.evaluate(() => (window.__S.DATA.pm_order_change || []).filter((c) => c.field === 'late_reason'))
    ok(lg.length === 1 && lg[0].after_val === '자재 부족' && lg[0].before_val == null, '변경 이력 남음', lg)
    // 일괄
    await p.check(`[data-check="${info[1].key}"]`); await p.check(`[data-check="${info[2].key}"]`); await W(300)
    ok(await p.locator('[data-bulk-late]').count() === 1 && /2줄에 넣기/.test(await p.textContent('[data-bulk-late]')), '체크하면 「미납 사유 2줄에 넣기」')
    await p.selectOption('[data-bulk-late]', '납품만 남음'); await W(700)
    D = await p.evaluate(() => window.__S.DATA.pm_order_late)
    ok(D.length === 3 && D.filter((r) => r.reason === '납품만 남음').length === 2, '일괄 저장 2줄', D.map((r) => r.reason))
    // 사유별 거르기
    await p.click('[data-late-chip="납품만 남음"]'); await W(500)
    const rows = await p.$$eval('[data-row]', (a) => a.map((x) => x.getAttribute('data-row')))
    ok(rows.length === 2 && rows.includes(info[1].key) && rows.includes(info[2].key), '칩을 누르면 그 사유 줄만', rows)
    await p.click('[data-late-chip="납품만 남음"]'); await W(300)
    ok((await p.$$eval('[data-row]', (a) => a.length)) >= 3, '다시 누르면 사유 거르기 풀림')
    // 사유 지우기
    await p.check(`[data-check="${info[1].key}"]`); await W(200)
    await p.selectOption('[data-bulk-late]', '-'); await W(600)
    D = await p.evaluate(() => window.__S.DATA.pm_order_late)
    ok(D.length === 2 && !D.find((r) => r.line_id === info[1].id), '「사유 지우기」로 줄 삭제', D.length)
    // PO 확인 처리
    await p.evaluate(() => document.querySelectorAll('[data-check]').forEach((c) => { if (c.checked) c.click() })); await W(200)
    const before = await p.evaluate((ids) => window.__S.DATA.pm_order.filter((o) => ids.includes(o.id) && o.confirmed_at).length, info.map((x) => x.oid))
    await p.check(`[data-check="${info[0].key}"]`); await p.check(`[data-check="${info[2].key}"]`); await W(300)
    ok(await p.locator('[data-bulk-confirm]').count() === 1 && !(await p.isDisabled('[data-bulk-confirm]')), '「✓ 확인 처리」 버튼')
    await p.click('[data-bulk-confirm]'); await W(700)
    const oids = [...new Set([info[0].oid, info[2].oid])]
    let C = await p.evaluate((ids) => window.__S.DATA.pm_order.filter((o) => ids.includes(o.id)).map((o) => [o.confirmed_at ? 1 : 0, o.confirmed_name]), oids)
    ok(before === 0 && C.every((c) => c[0] === 1), '고른 줄의 PO 가 확인됨', C)
    ok(/확인 대기/.test(await p.textContent(`${row0} [data-status]`)) === false, '상태가 「확인 대기」에서 바뀜', await p.textContent(`${row0} [data-status]`))
    ok((await p.evaluate(() => (window.__S.DATA.pm_order_line || []).filter((l) => l.reply).length)) >= 0 && (await p.evaluate((id) => window.__S.DATA.pm_order_line.find((l) => l.id === id).reply, info[0].id)) === '가능', 'v4.199.0 한 단계: 「✓ 가능 회신」 — 고른 줄이 「가능」으로 회신됨')
    // 되돌리기
    const undo = p.locator('[data-undo], button:has-text("되돌리기")').first()
    ok(await undo.count() === 1, '6초 되돌리기')
    await undo.click(); await W(700)
    C = await p.evaluate((ids) => window.__S.DATA.pm_order.filter((o) => ids.includes(o.id)).map((o) => (o.confirmed_at ? 1 : 0)), oids)
    ok(C.every((c) => c === 0), '되돌리면 다시 미확인', C)
    ok((await p.evaluate((id) => window.__S.DATA.pm_order_line.find((l) => l.id === id).reply, info[0].id)) == null, '되돌리면 회신도 빈 칸으로')
    ok(errs.length === 0, '화면 오류 없음', errs)
    await p.screenshot({ path: '/tmp/jsportal-test/out/late1.png' })
    await p.close()
  }
  // ② 영업 화면 — 사유 넣기는 되고 확인 처리는 없음
  {
    const { p, errs, info } = await mk({ name: '이정민', dept: '영업', role: 'editor' })
    ok(await p.locator(`[data-row="${info[0].key}"] select[data-late-reason]`).count() === 1, '영업(편집)도 줄에서 사유 고르기')
    await p.check(`[data-check="${info[0].key}"]`); await W(300)
    ok(await p.locator('[data-bulk-late]').count() === 1, '영업 일괄 줄에도 미납 사유')
    ok(await p.locator('[data-bulk-confirm]').count() === 0, '영업 화면엔 「확인 처리」 없음')
    ok(errs.length === 0, '화면 오류 없음', errs); await p.close()
  }
  // ③ 표가 없으면(SQL 전) 사유 칸만 안 보임
  {
    const { p, errs, info } = await mk({}, 'missing')
    ok(await p.locator('[data-late-sum]').count() === 0 && await p.locator('select[data-late-reason]').count() === 0, 'SQL 전: 사유 줄 · 칸 없음')
    ok(await p.locator(`[data-row="${info[0].key}"]`).count() === 1, 'SQL 전: 목록은 그대로')
    await p.check(`[data-check="${info[0].key}"]`); await W(300)
    ok(await p.locator('[data-bulk-confirm]').count() === 1 && await p.locator('[data-bulk-late]').count() === 0, 'SQL 전: 확인 처리는 되고 사유 일괄은 없음')
    ok(errs.length === 0, '화면 오류 없음', errs); await p.close()
  }
  console.log(`t124 ${pass}/${pass + fail} 통과`); await b.close(); process.exit(fail ? 1 : 0)
})()
