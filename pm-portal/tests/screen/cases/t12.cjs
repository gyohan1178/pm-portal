const { chromium } = require('playwright')
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (c ? '' : ' → ' + x)) }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const pg = async (r, w = 1440) => { const p = await b.newPage({ viewport: { width: w, height: 900 } }); p.on('pageerror', e => errs.push(r + ': ' + e.message.slice(0, 120))); await p.addInitScript(() => { try { localStorage.setItem('pm.flowTab', 'detail') } catch {} }); await p.goto('http://localhost:8765/app.html?r=' + encodeURIComponent(r)); await p.waitForTimeout(1600); return p }
  // 1 구매발주
  let p = await pg('/customer/ax/purchase')
  let t = await p.evaluate(() => ({
    title: document.querySelector('[data-page-head] [data-page-title]')?.textContent,
    acts: [...document.querySelectorAll('[data-page-actions] button')].map(b => b.textContent.trim()).join('|'),
    kpi: [...document.querySelectorAll('[data-po-kpi] > div')].map(d => d.children.length).join(','),
    hint: document.querySelector('[data-po-selbar]')?.innerText.replace(/\s+/g, ' '),
    tableTop: Math.round(document.querySelector('[data-po-selbar]').getBoundingClientRect().bottom),
  }))
  ok(t.title === '구매발주', '구매발주 — 화면 머리 제목', t.title)
  ok(/현황 엑셀/.test(t.acts) && /구매발주 추가/.test(t.acts), '머리 오른쪽: 현황 엑셀 · 구매발주 추가', t.acts)
  ok(t.kpi === '3,3,3,3', '지표 4칸 모두 설명 줄', t.kpi)
  ok(/전체선택/.test(t.hint) && /발주를 체크/.test(t.hint) && /이카운트 발주서/.test(t.hint), '선택 줄은 늘 같은 자리 (선택 전 — 버튼 흐리게)', t.hint)
  await p.click('tbody input[type=checkbox]')
  await p.waitForTimeout(300)
  const t2 = await p.evaluate(() => ({ bar: document.querySelector('[data-po-selbar]').innerText.replace(/\s+/g, ' '), bottom: Math.round(document.querySelector('[data-po-selbar]').getBoundingClientRect().top) }))
  ok(/1건/.test(t2.bar) && /납기 이월/.test(t2.bar) && /발주번호 부여/.test(t2.bar) && /이카운트 발주서/.test(t2.bar) && /삭제/.test(t2.bar) && /입고 처리/.test(t2.bar), '체크하면 같은 자리에 일괄 작업 (입고 처리 · 납기 이월 · 발주번호 · 이카운트 발주서 · 삭제)', t2.bar)
  await p.click('[data-po-selbar] button:has-text("삭제")'); await p.waitForTimeout(200)
  ok(await p.locator('text=되돌릴 수 없습니다').count() > 0, '삭제 누르면 확인 창 (삭제 입력 절차 그대로)')
  await p.click('div.fixed button:has-text("취소")'); await p.waitForTimeout(200)
  ok(await p.locator('text=되돌릴 수 없습니다').count() === 0, '확인 창 취소 → 닫힘')
  await p.click('[data-po-add]'); await p.waitForTimeout(300)
  ok(await p.locator('#po-form').count() === 1, '구매발주 추가 → 등록 칸 열림')
  await p.click('[data-due-filter="over"]'); await p.waitForTimeout(200)
  ok(await p.locator('text=구매 발주가 없습니다').count() === 1, '납기 「지남」 거르기 동작 (예시 데이터엔 지난 건 없음)')
  await p.click('button:has-text("📊 구매현황")'); await p.waitForTimeout(400)
  ok(await p.locator('text=총 입고 수량').count() === 1, '구매현황 탭 전환')
  await p.close()
  // 2 재고현황
  p = await pg('/inventory')
  t = await p.evaluate(() => ({ acts: [...document.querySelectorAll('[data-page-actions] button')].map(b => b.textContent.trim()).join('|'), kpi: [...document.querySelectorAll('[data-kpi-row="inv"] > *')].filter(d => d.children.length >= 3).length, tool: document.querySelector('[data-inv-toolbar]')?.innerText.replace(/\s+/g, ' ') }))
  ok(/📥 엑셀/.test(t.acts) && /QR 스캔/.test(t.acts), '재고현황 머리: 📥 엑셀(버튼 이름 기준 v4.167.0) · QR 스캔', t.acts)
  ok(t.kpi === 5, '재고 지표 5칸 모두 설명 줄', t.kpi)
  ok(/실사 붙여넣기/.test(t.tool) && /칸 실사 반영/.test(t.tool) && /실사양식/.test(t.tool) && /실사 업로드/.test(t.tool) && /관리대상만/.test(t.tool), '조회 조건 + 실사 버튼 한 카드', t.tool)
  await p.click('[data-inv-toolbar] button:has-text("실사 붙여넣기")'); await p.waitForTimeout(300)
  ok(await p.locator('textarea').count() > 0, '실사 붙여넣기 창 열림')
  await p.close()
  // 3 고객사 PO
  p = await pg('/customer/ax/cpo')
  t = await p.evaluate(() => ({ title: document.querySelector('[data-page-title]')?.textContent, notes: [...document.querySelectorAll('.kpi-grid > *')].map(b => b.children.length).join(','), tool: !!document.querySelector('[data-cpo-toolbar]'), acts: [...document.querySelectorAll('[data-page-actions] button')].map(b => b.textContent.trim()).join('|') }))
  ok(t.title === '고객사 PO' && /PO 업로드/.test(t.acts) && /PO 추가/.test(t.acts), '고객사 PO 머리 + PO 업로드 · PO 추가', JSON.stringify(t))
  ok(t.notes === '3,3,3,3,3' && t.tool, '카드 5칸 설명 줄 · 조회 조건 카드', t.notes)
  await p.close()
  // 4 수주대장
  p = await pg('/orders')
  t = await p.evaluate(() => ({ title: document.querySelector('[data-page-title]')?.textContent, badge: document.querySelector('[data-page-actions] [data-view-badge]')?.textContent, sales: !!document.querySelector('[data-page-actions] [data-as-sales]') }))
  ok(t.title === '수주대장' && t.badge === '구매자재 화면' && t.sales, '수주대장 머리 + 화면 구분 · 영업 화면으로 보기', JSON.stringify(t))
  await p.click('[data-as-sales]'); await p.waitForTimeout(300)
  ok((await p.textContent('[data-view-badge]')) === '영업 · 타부서 화면', '영업 화면으로 보기 전환 동작')
  await p.close()
  // 5 입고
  p = await pg('/inbound')
  ok((await p.textContent('[data-page-title]')) === '입고', '입고 머리')
  await p.click('[data-page-actions] button:has-text("입고 현황")'); await p.waitForTimeout(400)
  ok(await p.locator('[data-inb-process]').count() === 0, '입고 현황 탭 전환')
  await p.close()
  // 6 자재 요청
  p = await pg('/material-request')
  await p.click('[data-page-actions] button:has-text("새 요청")'); await p.waitForTimeout(400)
  ok(await p.locator('text=요청하기').count() > 0 || await p.locator('textarea, input').count() > 3, '자재 요청 — 새 요청 탭 열림')
  await p.close()
  // 7 휴대폰 — 머리 제목은 위 보라 줄에만, 설명 · 버튼은 보임
  p = await pg('/customer/ax/purchase', 412)
  t = await p.evaluate(() => ({ title: getComputedStyle(document.querySelector('[data-page-title]')).display, desc: getComputedStyle(document.querySelector('[data-page-head] .page-desc')).display, add: !!document.querySelector('[data-po-add]')?.offsetParent, sw: document.querySelector('main').scrollWidth - document.querySelector('main').clientWidth }))
  ok(t.title === 'none' && t.desc !== 'none' && !t.add && t.sw <= 1, '휴대폰: 제목 숨김(보라 줄에 있음) · 설명 보임 · 추가 버튼은 PC 만 (v4.152.1) · 가로 넘침 없음', JSON.stringify(t))
  await p.close()
  // 8 톤 — 흰 카드 · 테두리 없음 · 점선 올리기 칸은 테두리 유지 · 강조선 유지
  p = await pg('/flow')
  t = await p.evaluate(() => { const hot = document.querySelector('[data-flow-step="수주 확인"]')?.parentElement; return { hot: getComputedStyle(hot).boxShadow } })
  ok(/inset/.test(t.hot), '막힌 단계의 빨간 강조선 그대로', t.hot)
  await p.close()
  p = await pg('/upload')
  t = await p.evaluate(() => { const d = document.querySelector('main [class*="border-dashed"]'); return d ? getComputedStyle(d).borderTopStyle + ' ' + getComputedStyle(d).borderTopColor : 'none' })
  ok(/dashed/.test(t) && !/rgba\(0, 0, 0, 0\)/.test(t), '올리기 칸 점선 테두리 그대로', t)
  await p.close()
  ok(errs.length === 0, '조작 중 화면 오류 없음', errs.join(' / '))
  await b.close(); console.log(fail ? `  ${fail}개 실패` : `  ${pass}/${pass} 통과`)
})()
