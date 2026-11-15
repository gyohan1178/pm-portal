const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 200)) } }
;(async () => {
  const b = await chromium.launch()
  const open = async (q) => {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errs = []
    p.on('pageerror', e => errs.push(e.message.slice(0, 120)))
    await p.goto('http://localhost:8765/app.html?r=' + encodeURIComponent('/orders') + q); return { p, errs }
  }
  const st = (p) => p.evaluate(() => ({
    rows: document.querySelectorAll('tbody tr').length, money: document.querySelector('[data-money-total]')?.textContent,
    na: !!document.querySelector('[data-money-na]'), failed: !!document.querySelector('[data-fast-failed]'),
    full: (window.__S.READLOG || []).filter((t) => t === 'pm_order_line').length,
    live: (window.__S.READLOG || []).filter((t) => t === 'pm_order_line_live_v').length,
  }))
  // A 평소
  let { p, errs } = await open(''); await p.waitForTimeout(2500); let s = await st(p)
  ok(s.rows > 0 && /원|₩|\d/.test(s.money || '') && !s.na && !s.failed, 'A 평소: 목록 · 매출 합계 숫자', s)
  ok(s.full === 0, 'A 평소: 전부 받기 안 함', s); ok(errs.length === 0, 'A 오류 없음', errs); await p.close()
  // B 진행 줄 한 번 시간 초과 → 다시 시도로 뜸 (전부 받기 안 함)
  ;({ p, errs } = await open('&livefail=2')); await p.waitForTimeout(5000); s = await st(p)
  ok(s.rows > 0 && !s.failed, 'B 한 번 실패 → 다시 시도해서 목록 뜸', s)
  ok(s.full === 0, 'B 전부 받기(1.4만 줄)로 안 넘어감', s); ok(s.live >= 7, 'B 진행 줄을 다시 요청함 (사이드바 1 + 첫 시도 3 + 다시 3)', s); await p.close()
  // C 계속 실패 → 「다시 불러오기」 → 누르면 뜸
  ;({ p, errs } = await open('&livefail=999')); await p.waitForTimeout(12000); s = await st(p)
  ok(s.failed, 'C 계속 실패 → 「다시 불러오기」 안내', s); ok(s.full === 0, 'C 전부 받기 안 함', s)
  await p.evaluate(() => { window.__S.READFAIL.pm_order_line_live_v = 0 }); await p.click('[data-fast-failed] button'); await p.waitForTimeout(2500); s = await st(p)
  ok(s.rows > 0 && !s.failed, 'C 다시 불러오기 → 목록 뜸', s); await p.close()
  // D 매출 합계만 실패 → 목록 그대로 · 합계 「—」
  ;({ p, errs } = await open('&moneyfail=999')); await p.waitForTimeout(9000); s = await st(p)
  ok(s.rows > 0 && !s.failed, 'D 매출 합계 실패해도 목록 뜸', s); ok(s.money === '—' && s.na, 'D 합계 칸만 「—」 + 다시', s); ok(s.full === 0, 'D 전부 받기 안 함', s)
  ok(errs.length === 0, 'D 오류 없음', errs); await p.close()
  // E 매출 합계 한 번 실패 → 다시 시도로 숫자
  ;({ p, errs } = await open('&moneyfail=1')); await p.waitForTimeout(5000); s = await st(p)
  ok(s.rows > 0 && /\d/.test(s.money || '') && !s.na, 'E 합계 한 번 실패 → 다시 받아 숫자', s); await p.close()
  // F 보기(SQL) 없음 → 예전처럼 전부 받기
  ;({ p, errs } = await open('&nov=1')); await p.waitForTimeout(4000); s = await st(p)
  ok(s.rows > 0 && s.full > 0 && /\d/.test(s.money || ''), 'F 보기 없음 → 전부 받기로 목록 · 합계', s); await p.close()
  console.log(`t113 ${pass}/${pass + fail} 통과`); await b.close()
})()
