// v4.185.0 — 수주대장 예상 매출 기본 접힘 · 곁가지 요청은 목록 뒤
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 300)) } }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', e => errs.push(e.message.slice(0, 140)))
  await p.goto('http://localhost:8765/app.html?r=' + encodeURIComponent('/orders') + '&moneyoff=1'); await p.waitForTimeout(2500)
  const st = () => p.evaluate(() => ({ rpc: window.__S.RPC.map((r) => r.fn), log: window.__S.READLOG || [], rows: document.querySelectorAll('tbody tr').length, show: !!document.querySelector('[data-money-show]'), total: document.querySelector('[data-money-total]')?.textContent || null }))
  let s = await st()
  ok(s.rows > 0, '① 목록 뜸', s.rows)
  ok(s.show && s.total === null, '① 예상 매출 기본 접힘 (「보기」 버튼만)', s)
  ok(!s.rpc.includes('pm_order_money'), '① 접힌 동안 매출 합계 요청 안 함', s.rpc)
  // 순서: 진행 줄 → 그 뒤에 호기 연결 · 자재요청
  const iLive = s.log.indexOf('pm_order_line_live_v'), iProd = s.log.indexOf('pm_line_prod_v'), iMr = s.log.lastIndexOf('pm_material_request')  // (사이드바 알림도 같은 표를 먼저 읽음)
  const lastList = Math.max(s.log.lastIndexOf('pm_order_line_live_v'), s.log.lastIndexOf('pm_order_line_hist_v'))
  ok(iProd > lastList && s.log.indexOf('pm_line_prod_v') > lastList && iMr > lastList, '② 호기 연결 · 자재요청은 목록을 다 받은 뒤', { iLive, lastList, iProd, iMr })
  // 펼치면 그때 받음 · 기억
  await p.click('[data-money-show]'); await p.waitForTimeout(1200); s = await st()
  ok(s.rpc.includes('pm_order_money') && /\d/.test(s.total || ''), '③ 「보기」 누르면 그때 합계 받아 숫자', s)
  ok(await p.evaluate(() => localStorage.getItem('pm.oi.money')) === '1', '③ 펼친 상태 기억')
  await p.click('[data-money-hide]'); await p.waitForTimeout(300)
  ok(!!(await p.$('[data-money-show]')) && await p.evaluate(() => localStorage.getItem('pm.oi.money')) === '0', '④ 접기 → 다시 접힘 · 기억')
  ok(errs.length === 0, '화면 오류 없음', errs)
  console.log(`t116 ${pass}/${pass + fail} 통과`); await b.close()
})()
