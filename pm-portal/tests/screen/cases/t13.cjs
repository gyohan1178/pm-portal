const { chromium } = require('playwright')
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (c ? '' : ' → ' + x)) }
const KEY = 'pm.flowSeen.u1.구매자재'
const BASE = { 'b:미확인': 0, 'st:수주 확인': 0, 'b:새 PO 회신 대기': 5, 'st:회신': 5, 'b:입고 지연': 0, 'b:곧 입고': 1, 'st:입고': 1, 'b:요청': 51, 'b:처리 중': 36, 'b:승인 대기': 41,
  'i:새로 올라온 PO 확인 (등록 1영업일 넘음)': 1, 'i:자재 요청': 51, 'o:조건부 · 불가 회신 — 영업이 고객사와 협의 중': 3 }
;(async () => {
  const b = await chromium.launch(); const errs = []
  const open = async (r, w, base, fc) => {
    const p = await b.newPage({ viewport: { width: w, height: 900 } }); p.on('pageerror', e => errs.push(r + ': ' + e.message.slice(0, 120)))
    await p.addInitScript(([k, v]) => { localStorage.setItem('pm.flowTab', 'detail'); if (v) localStorage.setItem(k, v); else localStorage.removeItem(k) }, [KEY, base ? JSON.stringify(base) : ''])
    await p.goto('http://localhost:8765/app.html?r=' + encodeURIComponent(r) + (fc ? '&fc=' + encodeURIComponent(JSON.stringify(fc)) : '')); await p.waitForTimeout(1500); return p }
  // 0) 처음 쓰는 브라우저 — 알림 없음, 기준만 저장
  let p = await open('/flow', 1440, null)
  let t = await p.evaluate(() => ({ fresh: document.querySelectorAll('[data-flow-fresh]').length, menu: document.querySelector('[data-menu-badge="/flow"]')?.textContent || '', title: document.title }))
  ok(t.fresh === 0 && !t.menu && !/^\(/.test(t.title), '처음 쓰는 브라우저 — 「새로」 알림 없음', JSON.stringify(t))
  await p.waitForTimeout(3300)
  ok(!!(await p.evaluate((k) => localStorage.getItem(k), KEY)), '3초 보면 지금 숫자를 「봤음」으로 저장')
  await p.close()
  // 1) 기준보다 늘어남 · 처리됨 · 모두 처리 (PC)
  p = await open('/flow', 1440, BASE, { ord_waiting: 0 })
  t = await p.evaluate(() => {
    const step = (n) => document.querySelector(`[data-flow-step="${n}"]`)?.closest('div.relative')
    const freshOf = (el) => el?.querySelector('[data-flow-fresh]')?.getAttribute('data-flow-fresh') || ''
    return {
      s1: freshOf(step('수주 확인')),
      zero: !!step('회신')?.querySelector('[data-flow-zero]'),
      ring: !!step('수주 확인')?.querySelector('.pm-ring'),
      sub: document.querySelector('[data-flow-sub="자재 요청"] [data-flow-fresh]')?.getAttribute('data-flow-fresh') || '',
      inRow: [...document.querySelectorAll('[data-flow-hand]')].filter(e => e.classList.contains('pm-row-in')).map(e => e.dataset.flowHand).join('|'),
      done: document.querySelector('[data-flow-done]')?.textContent || '',
      menu: document.querySelector('[data-menu-badge="/flow"]')?.textContent || '',
      title: document.title,
    } })
  ok(t.s1 === '1', '늘어난 단계에 「+1 새로」 (수주 확인 미확인 0 → 1)', JSON.stringify(t))
  ok(t.sub === '2', '보조 업무에도 「+2」 (자재 요청 51 → 53)', t.sub)
  ok(t.inRow === '자재 요청', '넘어온 일 — 늘어난 줄만 보라로 내려옴', t.inRow)
  ok(/−1 처리됨/.test(t.done), '내가 넘긴 일 줄어듦 → 「−1 처리됨」', t.done)
  ok(t.zero, '단계가 0 이 됨 → 「모두 처리」 (회신 5 → 0)', t.zero)
  ok(t.ring, '막힌 단계에 빨간 링', t.ring)
  ok(t.menu === '3' && /^\(3\)/.test(t.title), '사이드바 「업무 흐름」 3 · 탭 제목 「(3) …」 (1 + 2)', t.menu + ' / ' + t.title)
  await p.waitForTimeout(3600)
  t = await p.evaluate((k) => ({ seen: JSON.parse(localStorage.getItem(k) || '{}')['b:요청'], fresh: document.querySelectorAll('[data-flow-fresh]').length, menu: document.querySelector('[data-menu-badge="/flow"]')?.textContent || '', title: document.title, done: !!document.querySelector('[data-flow-done]') }), KEY)
  ok(t.seen === 53 && t.fresh > 0, '3초 뒤 「봤음」 저장 — 이번 화면의 「+n 새로」는 그대로', JSON.stringify(t))
  ok(!t.menu && !/^\(/.test(t.title), '봤음 → 사이드바 숫자 · 탭 제목 숫자 사라짐', t.menu + ' / ' + t.title)
  ok(!t.done, '「처리됨」은 3초 뒤 사라짐')
  await p.close()
  // 2) 다른 화면에서도 사이드바 · 탭 숫자
  p = await open('/inventory', 1440, BASE)
  t = await p.evaluate(() => ({ menu: document.querySelector('[data-menu-badge="/flow"]')?.textContent || '', title: document.title }))
  ok(t.menu === '3' && /^\(3\)/.test(t.title), '재고현황 화면에서도 사이드바 · 탭 제목에 3', JSON.stringify(t))
  // 단계 누르면 봤음
  await p.close()
  p = await open('/flow', 1440, BASE)
  await p.click('[data-flow-step="수주 확인"]'); await p.waitForTimeout(500)
  t = await p.evaluate((k) => ({ seen: JSON.parse(localStorage.getItem(k) || '{}')['b:미확인'], menu: document.querySelector('[data-menu-badge="/flow"]')?.textContent || '' }), KEY)
  ok(t.seen === 1 && !t.menu, '단계를 누르면 바로 「봤음」 → 사이드바 숫자 사라짐', JSON.stringify(t))
  await p.close()
  // 3) 휴대폰
  p = await open('/flow', 412, BASE)
  t = await p.evaluate(() => ({
    m: document.querySelector('[data-flow-mrow="수주 확인"] [data-flow-fresh]')?.getAttribute('data-flow-fresh') || '',
    ring: !!document.querySelector('[data-flow-mrow="수주 확인"] .pm-ring'),
    flashBlk: document.querySelector('[data-flow-sum="막힘"]')?.className.includes('pm-hero-flash'),
    popTot: !!document.querySelector('[data-flow-total] .pm-pop'),
    sw: document.querySelector('main').scrollWidth - document.querySelector('main').clientWidth,
  }))
  ok(t.m === '1' && t.ring, '휴대폰 단계 줄 「+1」 · 막힌 줄 링', JSON.stringify(t))
  ok(t.flashBlk && t.popTot, '휴대폰 보라 카드 — 막힘 늘어 반짝 · 합계 숫자 튐', JSON.stringify(t))
  ok(t.sw <= 1, '휴대폰 가로 넘침 없음', t.sw)
  await p.close()
  // 4) 입고 처리 — 처리한 줄 번쩍 + 체크
  p = await open('/inbound', 1440, null)
  await p.click('[data-inb-process] tbody input[type=checkbox]'); await p.waitForTimeout(200)
  const btn = p.locator('button:has-text("입고 처리")').last()
  await btn.click(); await p.waitForTimeout(250)
  t = await p.evaluate(() => ({ done: document.querySelectorAll('tr[data-inb-done]').length, stamp: !!document.querySelector('tr[data-inb-done] .pm-stamp'), checked: document.querySelectorAll('[data-inb-process] tbody input[type=checkbox]:checked').length }))
  ok(t.done === 1 && t.stamp && t.checked === 0, '입고 처리 → 그 줄 초록 번쩍 + 체크 표시 · 체크는 바로 풀림', JSON.stringify(t))
  await p.waitForTimeout(1200)
  ok((await p.locator('tr[data-inb-done]').count()) === 0, '0.9초 뒤 목록 새로 받음 (번쩍 표시 끝)')
  await p.close()
  // 5) 공정 스캔 — 실패 · 성공 화면
  p = await open('/scan', 412, null)
  const startBtn = p.locator('button:has-text("QR")').first()
  if (await p.locator('input[placeholder="이름"]').count()) { await p.fill('input[placeholder="이름"]', '천석훈'); await p.click('button:has-text("시작하기")'); await p.waitForTimeout(300) }
  const scanBtn = p.locator('button:has-text("QR 찍기")').first()
  if (await scanBtn.count()) { await scanBtn.click(); await p.waitForTimeout(400) }
  const manual = p.locator('input[placeholder^="직접 입력"]')
  if (await manual.count()) {
    await manual.fill('PD|nope|E'); await manual.press('Enter'); await p.waitForTimeout(250)
    ok(await p.locator('[data-scan-flash="ng"]').count() === 1, '공정 스캔 — 모르는 QR → 빨간 화면 「진행 중인 호기가 아닙니다」')
    await p.waitForTimeout(2200)
    ok(await p.locator('[data-scan-flash]').count() === 0, '2초 뒤 저절로 닫힘')
  } else ok(false, '공정 스캔 직접 입력 칸 찾기', await p.content().then(h => h.slice(0, 200)))
  await p.close()
  // 6) 전광판 · 애니메이션 끄기
  p = await open('/board', 1920, null)
  ok(await p.locator('[data-pb-tv]').count() === 1, '전광판(공정 현황판 TV) 정상 표시')
  await p.close()
  const ctx = await b.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } }); p = await ctx.newPage(); p.on('pageerror', e => errs.push('rm: ' + e.message))
  await p.addInitScript(([k, v]) => { localStorage.setItem('pm.flowTab', 'detail'); localStorage.setItem(k, v) }, [KEY, JSON.stringify(BASE)])
  await p.goto('http://localhost:8765/app.html?r=/flow'); await p.waitForTimeout(1500)
  t = await p.evaluate(() => { const r = document.querySelector('.pm-ring'); const c = document.querySelector('[data-flow-fresh]'); return { ring: r ? getComputedStyle(r).display : 'none', chip: c ? getComputedStyle(c).animationName : '' } })
  ok(t.ring === 'none' && t.chip === 'none', '「애니메이션 끄기」 설정이면 움직임 없음 (숫자 · 표시는 그대로)', JSON.stringify(t))
  await ctx.close()
  ok(errs.length === 0, '화면 오류 없음', errs.join(' / '))
  await b.close(); console.log(fail ? `  ${fail}개 실패` : `  ${pass}/${pass} 통과`)
})()
