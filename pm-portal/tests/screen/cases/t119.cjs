// v4.187.0 — 메뉴 묶음 (사이드바 한 줄 + 화면 위 탭) · 결제 계획 메뉴에서 뺌
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 300)) } }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const open = async (r, q = '') => { const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); p.on('pageerror', e => errs.push(r + ': ' + e.message.slice(0, 120))); await p.goto('http://localhost:8765/app.html?' + q + 'r=' + encodeURIComponent(r)); await p.waitForTimeout(1800); return p }
  const tabs = (p) => p.$$eval('[data-menu-tab]', (a) => a.map((x) => x.textContent.trim() + (x.dataset.active === '1' ? '*' : '')))
  const side = (p) => p.evaluate(() => [...document.querySelectorAll('aside a, nav a')].map((a) => a.textContent.trim()))
  let p = await open('/quality/fa-progress')
  ok((await tabs(p)).join('|') === '🚦 초도품 진행관리*|🧾 자재 매칭', '초도품: 탭 2개 · 진행관리 켜짐', await tabs(p))
  await p.click('[data-menu-tab="1"]'); await p.waitForTimeout(1200)
  ok((await tabs(p))[1].endsWith('*') && /초도품/.test(await p.$eval('[data-page-title]', (e) => e.textContent).catch(() => '초도품')), '탭 누르면 자재 매칭 화면으로', await tabs(p))
  const s1 = await side(p)
  ok(s1.some((t) => /초도품 \(진행 · 자재 매칭\)/.test(t)) && !s1.includes('초도품 자재 매칭'), '사이드바 — 초도품 한 줄', s1.filter((t) => /초도품/.test(t)))
  ok(await p.evaluate(() => [...document.querySelectorAll('a')].some((a) => /초도품 \(진행/.test(a.textContent) && /indigo-600/.test(a.className))), '자재 매칭 화면에서도 사이드바 「초도품」 줄이 켜짐')
  await p.close()
  p = await open('/master/codemap'); ok((await tabs(p)).join('|') === '🗂️ 기준코드 DB|🔢 고객사 코드 매핑*', '기준코드: 매핑 화면에 탭', await tabs(p)); await p.close()
  p = await open('/master/price'); ok((await tabs(p)).join('|') === '💲 단가 등록|📈 단가 변동 이력*', '단가: 변동 이력 화면에 탭', await tabs(p))
  await p.click('[data-menu-tab="0"]'); await p.waitForTimeout(1200); ok((await tabs(p))[0].endsWith('*'), '단가 등록으로 넘어감', await tabs(p)); await p.close()
  p = await open('/missing'); ok((await tabs(p)).join('|') === '🚨 부족자재 (발주 필요)|🧩 결품 현황 (호기별 미불출)*', '결품 현황 화면에 탭', await tabs(p))
  const href = await p.getAttribute('[data-menu-tab="0"]', 'href'); ok(/\/customer\/ax\/short$/.test(href || ''), '부족자재 탭은 내 주 고객사로', href); await p.close()
  p = await open('/customer/ed/short'); const h2 = await tabs(p); ok(h2[0].endsWith('*'), '부족자재(Edwards) 화면에 탭', h2); await p.close()
  p = await open('/inventory'); ok((await tabs(p)).length === 0, '묶음이 아닌 화면엔 탭 없음')
  const s2 = await side(p)
  ok(!s2.some((t) => /결제 계획/.test(t)), '사이드바에 결제 계획 없음'); ok(s2.some((t) => /단가 등록 · 이력/.test(t)) && s2.some((t) => /부족자재 · 결품/.test(t)), '사이드바 — 묶음 이름들 (기초자료는 기본 접힘)', s2.filter((t) => /단가|부족|기준코드|결품/.test(t)))
  await p.close()
  p = await open('/payment-plan'); ok(!/없는 화면|404/.test(await p.evaluate(() => document.body.innerText.slice(0, 400))), '결제 계획 주소는 그대로 열림'); await p.close()
  // 즐겨찾기에 예전 주소가 있어도 이름이 나온다
  p = await open('/inventory', 'me=' + encodeURIComponent(JSON.stringify({ menu_favorites: ['/master/price', '/quality/fai'] })) + '&')
  const s3 = await side(p); ok(s3.some((t) => /단가변동이력/.test(t)) && s3.some((t) => /초도품 자재 매칭/.test(t)), '예전 즐겨찾기(단가변동이력 · 초도품 자재 매칭)는 그대로', s3.slice(0, 12)); await p.close()
  ok(errs.length === 0, '화면 오류 없음', errs)
  console.log(`t119 ${pass}/${pass + fail} 통과`); await b.close()
})()
