// v4.183.0 — 다품목 출고 상위품목 기록 · 출고 현황 「상위품목 기준」
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 300)) } }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', e => errs.push(e.message.slice(0, 140)))
  await p.goto('http://localhost:8765/app.html?r=' + encodeURIComponent('/outbound-history')); await p.waitForTimeout(1500)
  const today = await p.evaluate(() => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10))
  // ① 담기 → 출고 → 붙이기
  const r1 = await p.evaluate(async (today) => {
    const S = window.__S, ia = window.__ia
    S.DATA.pm_issue_assy = []
    await ia.addPendingAssys('cid-ax', [{ std_code: 'AX-110153030', name: 'ASSY MAIN PD', qty: 4 }, { std_code: 'AX-110158840', name: 'ASSY PWR DIST EFEM', qty: 2 }, { std_code: '', qty: 3 }, { std_code: 'X', qty: 0 }], '김교한')
    const pending = S.DATA.pm_issue_assy.filter((r) => r.batch_at == null).length
    const T1 = new Date(Date.now() - 60e3).toISOString()
    S.DATA.stock_movements = (S.DATA.stock_movements || []).concat([
      { id: 'iam1', item_id: 'p1', movement_type: '출고', qty: 16, memo: '출고작업', movement_date: today, processed_at: T1, customer_id: 'cid-ax' },
      { id: 'iam2', item_id: 'p2', movement_type: '출고', qty: 4, memo: '출고작업', movement_date: today, processed_at: T1, customer_id: 'cid-ax' }])
    const at = await ia.stampPendingAssys('cid-ax')
    return { pending, at, T1, stamped: S.DATA.pm_issue_assy.filter((r) => r.batch_at === T1).length }
  }, today)
  ok(r1.pending === 2, '① 상위품목만 대기로 적음 (빈 품번 · 0대 제외)', r1)
  ok(r1.at === r1.T1 && r1.stamped === 2, '① 출고 처리 시각을 대기 줄에 붙임', r1)
  // ② 출고 현황 — 묶음 줄에 🧩
  await p.evaluate(() => window.__qc.invalidateQueries()); await p.waitForTimeout(1200)
  const chip = await p.$eval('[data-row-assys]', (e) => e.textContent).catch(() => '')
  ok(/AX-110153030 ×4대 외 1종/.test(chip), '② 묶음 줄 프로젝트 칸에 「🧩 AX-110153030 ×4대 외 1종」', chip)
  // ③ 상위품목 기준
  await p.click('[data-mode="assy"]'); await p.waitForTimeout(400)
  const v = await p.evaluate(() => [...document.querySelectorAll('[data-assy-row]')].map((tr) => tr.getAttribute('data-assy-row') + '=' + tr.querySelector('[data-assy-qty]').textContent))
  ok(v.join(',') === 'AX-110153030=4대,AX-110158840=2대', '③ 상위품목 기준: 품목마다 대수', v)
  // ④ 두 번째 출고 — 같은 상위품목 3대 더 → 합 7대 · 2번
  await p.evaluate(async (today) => {
    const S = window.__S, ia = window.__ia
    await ia.addPendingAssys('cid-ax', [{ std_code: 'AX-110153030', name: 'ASSY MAIN PD', qty: 3 }], '남기문')
    // 흉내 DB 는 정렬을 안 하므로 앞 출고 줄의 처리 시각을 지우고 새 출고만 남긴다
    const T2 = new Date().toISOString()
    S.DATA.stock_movements.filter((r) => r.id === 'iam1' || r.id === 'iam2').forEach((r) => { r._t = r.processed_at; r.processed_at = null })
    S.DATA.stock_movements.push({ id: 'iam3', item_id: 'p1', movement_type: '출고', qty: 12, memo: '출고작업', movement_date: today, processed_at: T2, customer_id: 'cid-ax' })
    await ia.stampPendingAssys('cid-ax')
    S.DATA.stock_movements.filter((r) => r._t).forEach((r) => { r.processed_at = r._t; delete r._t })
    window.__T2 = T2
  }, today)
  await p.evaluate(() => window.__qc.invalidateQueries()); await p.waitForTimeout(1200)
  const v2 = await p.evaluate(() => [...document.querySelectorAll('[data-assy-row]')].map((tr) => tr.getAttribute('data-assy-row') + '=' + tr.querySelector('[data-assy-qty]').textContent + '/' + tr.children[4].textContent))
  ok(v2[0] === 'AX-110153030=7대/2번', '④ 두 번 출고 → 7대 · 2번', v2)
  await p.click('[data-assy-row="AX-110153030"]'); await p.waitForTimeout(300)
  const sub = await p.$$eval('[data-assy-view] tbody tr', (rs) => rs.map((r) => r.innerText.replace(/\s+/g, ' ')))
  ok(sub.some((t) => /4대/.test(t) && /같이: AX-110158840 ×2/.test(t)) && sub.some((t) => /3대/.test(t) && /남기문|김교한|—/.test(t)), '④ 펼치면 출고한 날마다 대수 · 같이 뺀 상위품목', sub)
  // ⑤ 되돌리기 → 다시 대기 · 비우기 → 대기 줄 삭제
  const r5 = await p.evaluate(async () => {
    const S = window.__S, ia = window.__ia
    await ia.unstampAssys('cid-ax', window.__T2)
    const back = S.DATA.pm_issue_assy.filter((r) => r.batch_at == null).length
    await ia.clearPendingAssys('cid-ax')
    return { back, left: S.DATA.pm_issue_assy.length, keptStamped: S.DATA.pm_issue_assy.filter((r) => r.batch_at).length }
  })
  ok(r5.back === 1 && r5.left === 2 && r5.keptStamped === 2, '⑤ 되돌리면 다시 대기 · 비우면 대기 줄만 지움 (지난 출고 기록은 그대로)', r5)
  // ⑥ 표가 없을 때 — 조용히 넘어감 · 화면 정상
  const r6 = await p.evaluate(async () => {
    const S = window.__S, ia = window.__ia
    S.MISSING = [...(S.MISSING || []), 'pm_issue_assy']
    try { await ia.addPendingAssys('cid-ax', [{ std_code: 'AX-1', qty: 1 }]); const at = await ia.stampPendingAssys('cid-ax'); const m = await ia.fetchIssueAssys({ from: '2026-11-01', to: '2026-11-30' }); return { ok: true, at, size: m.size } } catch (e) { return { ok: false, e: e.message } }
  })
  ok(r6.ok && r6.at === null && r6.size === 0, '⑥ SQL 전(표 없음): 오류 없이 넘어감', r6)
  await p.click('[data-mode="line"]'); await p.evaluate(() => window.__qc.invalidateQueries()); await p.waitForTimeout(1000)
  ok(await p.$$eval('tbody tr', (r) => r.length) > 0, '⑥ 표 없어도 출고 줄 목록은 그대로')
  await p.click('[data-mode="assy"]'); await p.waitForTimeout(300)
  ok(/상위품목 기록이 없습니다/.test(await p.$eval('[data-assy-view]', (e) => e.innerText)), '⑥ 상위품목 기준은 「기록이 없습니다」 안내')
  ok(errs.length === 0, '화면 오류 없음', errs)
  console.log(`t114 ${pass}/${pass + fail} 통과`); await b.close()
})()
