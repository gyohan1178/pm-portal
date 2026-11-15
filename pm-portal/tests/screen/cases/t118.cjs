// v4.186.2 — 호기 연결을 한 번의 요청으로 (함수 있으면 보기를 따로 안 읽음 · 없으면 예전 방식)
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 300)) } }
;(async () => {
  const b = await chromium.launch()
  for (const [q, name] of [['&prodall=1', '함수 있음'], ['', '함수 없음(SQL 전)']]) {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 120)))
    await p.goto('http://localhost:8765/app.html?pt=1&iss=1' + q + '&r=' + encodeURIComponent('/orders')); await p.waitForTimeout(2800)
    const t = await p.getAttribute('[data-row="47894KF|2/1"] [data-prod-link]', 'data-prod-link').catch(() => null)
    const s = await p.evaluate(() => ({ rpc: window.__S.RPC.filter((r) => r.fn === 'pm_line_prod_all').length, v1: (window.__S.READLOG || []).filter((x) => x === 'pm_line_prod_v').length, v2: (window.__S.READLOG || []).filter((x) => x === 'pm_line_issue_v').length, iss: document.querySelectorAll('[data-iss]').length || document.body.innerText.includes('불출') }))
    ok(t === '#12,#13', `${name}: 수주대장 줄에 🏭 #12 #13`, t)
    if (q) ok(s.rpc === 1 && s.v1 === 0 && s.v2 === 0, `${name}: 요청 한 번 · 보기는 따로 안 읽음`, s)
    else ok(s.rpc === 1 && s.v1 >= 1 && s.v2 >= 1, `${name}: 예전 방식으로 보기를 읽음`, s)
    ok(!!s.iss, `${name}: 불출 표시 나옴`); ok(errs.length === 0, `${name}: 화면 오류 없음`, errs); await p.close()
  }
  console.log(`t118 ${pass}/${pass + fail} 통과`); await b.close()
})()
