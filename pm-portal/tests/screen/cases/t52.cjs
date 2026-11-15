// v4.122.0 첫 화면 = 업무 흐름 · 관제탑은 /control-tower
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✔', m) } else { fail++; console.log('  ✘', m) } }
;(async () => {
  const br = await chromium.launch()
  const pg = await br.newPage({ viewport: { width: 1440, height: 900 } })
  const errs = []; pg.on('pageerror', e => errs.push(e.message))
  const go = async (q) => { await pg.goto('http://localhost:8765/app.html?' + q); await pg.waitForTimeout(2500) }
  const active = async () => pg.$$eval('aside a[aria-current="page"], nav a[aria-current="page"]', as => as.map(a => a.textContent.trim()))

  console.log('1) 관리자 — 주소 / 로 들어오면')
  await go('r=/')
  let act = await active()
  ok(act.some(t => t.includes('업무 흐름')), '사이드바 활성 = 업무 흐름: ' + JSON.stringify(act))
  ok(!act.some(t => t.includes('관제탑')), '관제탑은 활성 아님')
  const ctHref = await pg.$$eval('a', as => as.filter(a => a.textContent.trim() === '🎯관제탑' || /^\s*🎯\s*관제탑\s*$/.test(a.textContent)).map(a => a.getAttribute('href')))
  ok(ctHref.includes('/control-tower'), '사이드바 관제탑 링크 = /control-tower: ' + JSON.stringify(ctHref))
  const body1 = await pg.textContent('body')
  ok(!body1.includes('관제탑 (홈)'), '「관제탑 (홈)」 글자 없음')

  console.log('2) 사이드바 관제탑 누르면')
  await pg.click('a[href="/control-tower"]')
  await pg.waitForTimeout(2000)
  act = await active()
  ok(act.some(t => t.includes('관제탑')) && !act.some(t => t.includes('업무 흐름')), '활성 = 관제탑: ' + JSON.stringify(act))
  ok((await pg.$$eval('h1', a => a.map(x => x.textContent))).some(t => t.includes('관제탑')), '관제탑 화면 열림')

  console.log('3) 관제탑에서 업무 흐름으로 돌아가기')
  await pg.click('a[href="/flow"]')
  await pg.waitForTimeout(1500)
  act = await active()
  ok(act.some(t => t.includes('업무 흐름')), '업무 흐름 활성')

  console.log('4) 예전 즐겨찾기에 관제탑(/) 이 있던 계정')
  await go('r=/&fav=1')
  const favLinks = await pg.$$eval('a', as => as.map(a => [a.textContent.trim(), a.getAttribute('href')]).filter(([, h]) => h === '/' || h === '/control-tower'))
  const favSec = await pg.evaluate(() => { const p = [...document.querySelectorAll('p')].find(x => x.textContent.includes('즐겨찾기')); if (!p) return []; return [...p.parentElement.querySelectorAll('a')].map(a => a.getAttribute('href')) })
  ok(favSec.includes('/control-tower') && !favSec.includes('/'), '즐겨찾기 관제탑 → /control-tower: ' + JSON.stringify(favSec))
  ok(favSec.filter(h => h === '/control-tower').length === 1, '한 번만')

  console.log('5) 업무 흐름을 막은 관제탑 계정')
  await go('r=/&ctonly=1')
  act = await active()
  ok(act.some(t => t.includes('관제탑')), '첫 화면 = 관제탑: ' + JSON.stringify(act))

  console.log('6) 분석 탭의 관제탑')
  await go('r=/sales')
  const tabs = await pg.$$eval('a', as => as.filter(a => a.textContent.includes('🎯 관제탑')).map(a => a.getAttribute('href')))
  ok(tabs.length && tabs.every(h => h === '/control-tower'), '분석 탭 관제탑 → /control-tower: ' + JSON.stringify(tabs))

  console.log('7) Ctrl+K 빠른 이동')
  await go('r=/flow')
  await pg.keyboard.press('Control+k'); await pg.waitForTimeout(500)
  await pg.keyboard.type('관제탑'); await pg.waitForTimeout(500)
  const pal = await pg.textContent('body')
  ok(/관제탑/.test(pal), '팔레트에 관제탑')
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(1500)
  act = await active()
  ok(act.some(t => t.includes('관제탑')), 'Enter → 관제탑: ' + JSON.stringify(act))

  ok(errs.length === 0, '화면 오류 없음 ' + errs.slice(0, 2).join(' | '))
  console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`)
  await br.close(); process.exit(fail ? 1 : 0)
})()
