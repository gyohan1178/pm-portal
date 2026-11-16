// v4.203.0 — 수주대장 영업 「FA · PPAP 대상 지정」 → 초도품 진행관리 (새 접수 · PPAP 탭)
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 400)) } }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const p = await b.newPage({ viewport: { width: 1600, height: 1000 } }); p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
  await p.addInitScript(() => { try { localStorage.setItem('pm_coach_seen_orders-sales', '1') } catch {} })
  await p.clock.setFixedTime(new Date('2026-11-16T01:00:00Z'))
  await p.goto('http://localhost:8765/app.html?unconf=1&fa3=1&me=' + encodeURIComponent(JSON.stringify({ name: '이정민', dept: '영업', role: 'editor' })) + '&r=' + encodeURIComponent('/orders')); await p.waitForTimeout(3000)
  // AX 줄 — 같은 FA PO · 품번 건(24)이 있으니 줄만 연결
  await p.check('[data-check="47894KF|2/1"]'); await p.waitForTimeout(300)
  ok(/FA 대상/.test(await p.locator('[data-bulk-fa]').innerText()), 'AX 줄 → 「FA 대상 지정」')
  await p.click('[data-bulk-fa]'); await p.waitForTimeout(1500)
  ok(await p.evaluate(() => window.__S.DATA.pm_fa.find((x) => x.id === 24).order_line_id) === 'l1', '같은 FA PO · 품번 건에 줄 연결')
  ok(await p.locator('[data-row="47894KF|2/1"] [data-fa-badge="FA"]').count() === 1, '줄에 FA 배지')
  // Edwards 줄 — PPAP 새 건
  await p.check('[data-check="UC-ED-NEAR|1/1"]'); await p.check('[data-check="UC-ED-NEAR|2/1"]'); await p.waitForTimeout(300)
  ok(/PPAP 대상/.test(await p.locator('[data-bulk-fa]').innerText()), 'Edwards 줄 → 「PPAP 대상 지정」')
  await p.click('[data-bulk-fa]'); await p.waitForTimeout(1500)
  const pp = await p.evaluate(() => window.__S.DATA.pm_fa.filter((x) => x.kind === 'PPAP'))
  ok(pp.length === 2 && pp.every((x) => x.po_number === 'UC-ED-NEAR' && x.created_name === '이정민' && x.steps.g_po?.d && x.order_line_id), 'PPAP 2건 등록 (PO 접수 완료 · 지정자 · 줄 연결)', pp)
  ok(await p.evaluate(() => (window.__S.DATA.pm_fa_log || []).filter((l) => /PPAP 대상 지정/.test(l.body)).length) === 2, '진행 기록에 「PPAP 대상 지정」')
  // 다시 고르면 이미 지정 → 버튼 흐림
  await p.check('[data-check="UC-ED-NEAR|1/1"]'); await p.waitForTimeout(300)
  ok(await p.locator('[data-bulk-fa]').isDisabled(), '이미 지정된 줄만 고르면 버튼 꺼짐')
  // 진행관리 PPAP 탭
  await p.goto('http://localhost:8765/app.html?unconf=1&fa3=1&r=' + encodeURIComponent('/quality/fa-progress?k=PPAP')); await p.waitForTimeout(2500)
  // (새 페이지라 S 가 다시 만들어짐 → 저장된 건이 없으므로 화면에서 직접 확인은 아래 주입으로)
  await p.evaluate(async () => { const S = window.__S; S.DATA.pm_fa.push({ id: 31, kind: 'PPAP', item_code: 'ED-NKB901030', item_desc: 'CABINET', po_number: '6001388184', fa_type: 'ASSY', order_line_id: 'ue2_1', created_at: '2026-11-15T01:00:00Z', created_name: '이정민', hold: false, steps: { g_po: { d: '2026-11-15' } } }); await window.__qc.invalidateQueries() })
  await p.waitForTimeout(1200)
  ok(await p.locator('[data-fa-kind-btn="PPAP"].bg-indigo-600').count() === 1, 'PPAP 탭 켜짐')
  const heads = await p.locator('[data-fa-grid] thead').innerText()
  ok(/PSW 작성/.test(heads) && /치수 성적서/.test(heads) && !/실물 검수/.test(heads), 'PPAP 단계 칸', heads.replace(/\s+/g, ' ').slice(0, 200))
  ok(/NEW/.test(await p.locator('[data-fa-row="ED-NKB901030"]').innerText()), '새 접수 NEW 표시')
  ok(/새 접수\s*1/.test(await p.locator('[data-fa-kpi="new"]').innerText()), '새 접수 지표 1')
  ok(!(await p.locator('[data-fa-row="100139060"]').count()), 'PPAP 탭엔 FA 건 안 보임')
  await p.click('[data-fa-kind-btn="FA"]'); await p.waitForTimeout(500)
  ok(await p.locator('[data-fa-row="100139060"]').count() === 1 && !(await p.locator('[data-fa-row="ED-NKB901030"]').count()), 'FA 탭엔 FA 건만')
  console.log(`pass=${pass} fail=${fail}`, 'errs', errs)
  await b.close()
})()
