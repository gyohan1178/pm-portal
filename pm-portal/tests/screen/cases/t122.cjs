// v4.189.0 — 주간업무보고: 지난주 대비 증감 · 순환실사 카드 · 순환실사 운영 현황
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 400)) } }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } }); p.on('pageerror', e => errs.push(e.message.slice(0, 140)))
  await p.goto('http://localhost:8765/app.html?' + (process.argv[2] || 'cyc=1') + '&r=' + encodeURIComponent('/weekly')); await p.waitForTimeout(1800)
  // 이번 주 월~금에 센 기록 · 차이 품목을 심는다
  const info = await p.evaluate(async () => {
    const S = window.__S, kd = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10)
    const now = new Date(), dow = (now.getUTCDay() + (now.getUTCHours() >= 15 ? 1 : 0)) % 7
    const today = kd(now), mon = new Date(now.getTime() - ((new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7) * 864e5), monS = kd(mon)
    S.DATA.pm_rack = S.DATA.pm_rack || []
    if (!S.DATA.pm_rack.find((r) => r.code === 'N2')) S.DATA.pm_rack.push({ code: 'N2', rows_cnt: 5, levels_cnt: 2, sort_no: 99 })
    S.DATA.pm_rack_owner = [{ rack_code: 'N2', owner_name: '김교한', late: false }]
    S.DATA.pm_cell_check = [
      { id: 1, location: 'N2-01-1', check_date: '2026-10-20', checked_by: 'u1' },
      { id: 2, location: 'N2-01-1', check_date: monS, checked_by: 'u1' }, { id: 3, location: 'N2-01-2', check_date: monS, checked_by: 'u1' },
      { id: 4, location: 'N2-02-1', check_date: monS, checked_by: 'u1' }, { id: 5, location: 'N2-02-1', check_date: monS, checked_by: 'u1' },   // 같은 날 같은 칸 = 한 번
      { id: 6, location: 'Z9-01-1', check_date: monS, checked_by: 'u1' },                                                                       // 담당 렉 밖
    ]
    S.DATA.pm_stock_audit = [
      { id: 'a1', item_id: 'p1', location: 'N2-01-1', audit_date: monS, book_qty: 100, counted_qty: 90, diff: -10, applied: true },
      { id: 'a2', item_id: 'p2', location: 'N2-01-2', audit_date: monS, book_qty: 5, counted_qty: 55, diff: 50, applied: false },
      { id: 'a3', item_id: 'p1', location: 'N2-02-1', audit_date: monS, book_qty: 7, counted_qty: 7, diff: 0, applied: false },
      { id: 'a4', item_id: 'p1', location: 'N2-01-1', audit_date: '2026-10-20', book_qty: 1, counted_qty: 2, diff: 1, applied: false },             // 다른 주
    ]
    await window.__qc.invalidateQueries(); return { today, monS }
  })
  await p.waitForTimeout(1500)
  const card = await p.$eval('[data-kpi="cycle"]', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => null)
  ok(card && /순환실사 3칸/.test(card) && /차이 2품목 · 반영 1 · 미반영 1/.test(card), '① 요약 카드 — 순환실사 3칸 · 차이 2 · 반영 1 · 미반영 1', card)
  const row = await p.$eval('[data-cycle-row="김교한"]', (e) => [...e.children].map((td) => td.innerText.replace(/\s+/g, ' ').trim())).catch(() => null)
  ok(row && row[1] === 'N2' && /^3 \/ \d+$/.test(row[2]) && row[4] === '2품목' && row[5] === '1 / 2', '② 담당자 줄 — 담당 렉 · 센 칸/목표 · 차이 · 반영', row)
  ok(row && /1바퀴째 33% \(3\/9칸\)/.test(row[3]), '② 한 바퀴 진행률 (담당 9칸 중 3칸)', row && row[3])
  const diffs = await p.$$eval('[data-cycle-diffs] p', (a) => a.map((x) => x.innerText))
  ok(diffs.length === 3 && /N2-01-2/.test(diffs[1]) && /\+50/.test(diffs[1]) && /미반영/.test(diffs[1]) && /−?-10/.test(diffs[2]) && /반영/.test(diffs[2]), '② 차이 품목 — 큰 순 · 다른 주 · 차이 0 은 빠짐', diffs)
  const deltas = await p.$$eval('[data-delta]', (a) => a.map((x) => x.textContent))
  ok(deltas.length >= 2 && deltas.every((t) => /지난주 \d/.test(t)), '① 요약 카드 지난주 대비 증감', deltas)
  // 순환 실사 설정이 없으면 구간 · 카드 없음, 보고서는 그대로
  await p.evaluate(async () => { window.__S.MISSING = [...(window.__S.MISSING || []), 'pm_rack_owner']; await window.__qc.invalidateQueries() }); await p.waitForTimeout(1500)
  ok(await p.locator('[data-kpi="cycle"]').count() === 0 && await p.locator('[data-cycle-sec]').count() === 0 && await p.locator('[data-kpi="inbound"]').count() === 1, '순환 실사 설정 전: 카드 · 구간 없이 보고서 그대로')
  ok(errs.length === 0, '화면 오류 없음', errs)
  console.log(`t122 ${pass}/${pass + fail} 통과`); await b.close()
})()
