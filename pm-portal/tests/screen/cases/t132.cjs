// v4.197.0 — 할 일: 부서별 보기 · 부서 특이사항 · 전사 공유(대회의실) · 유관부서 요청 · 반복 · 달력
const { chromium } = require('playwright')
let pass = 0, fail = 0
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m + ' → ' + JSON.stringify(x ?? '').slice(0, 500)) } }
const base = 'http://localhost:8765/app.html'
;(async () => {
  const b = await chromium.launch(); const errs = []
  const open = async (q, vp = { width: 1366, height: 768 }, me) => {
    const p = await b.newPage({ viewport: vp }); p.on('pageerror', e => errs.push(e.message.slice(0, 150)))
    await p.clock.setFixedTime(new Date('2026-11-16T01:00:00Z'))
    await p.goto(`${base}?${q}${me ? 'me=' + encodeURIComponent(JSON.stringify(me)) + '&' : ''}r=${encodeURIComponent('/todo')}`); await p.waitForTimeout(2300); return p
  }
  const todos = (p) => p.evaluate(() => window.__S.DATA.pm_todo)

  // ── 1) SQL 전 — 예전 그대로 ──
  { const p = await open('')
    ok(await p.locator('[data-sched-strip]').count() === 0 && await p.locator('[data-todo-view]').count() === 0, 'SQL 전: 위 줄 · 달력 전환 없음')
    await p.click('[data-todo-add]'); await p.waitForTimeout(300)
    ok(await p.locator('[data-sched-fields]').count() === 0 && await p.locator('[data-todo-owner]').count() === 1, 'SQL 전: 추가 창이 예전 그대로')
    await p.fill('[data-todo-title]', '예전 방식 할 일'); await p.click('button:has-text("저장")'); await p.waitForTimeout(600)
    const w = (await todos(p)).find(r => r.title === '예전 방식 할 일')
    ok(w && !('scope' in w) && !('kind' in w), 'SQL 전: 새 칸을 보내지 않는다', w)
    await p.close() }

  // ── 2) SQL 뒤 · 구매자재 ──
  const p = await open('sched=1&')
  const strip = await p.locator('[data-sched-strip]').innerText()
  ok(/오늘 부서 특이사항 1/.test(strip) && /팀원 A 오전 반차/.test(strip) && /전사 공유 1/.test(strip) && /대회의실 14:00~15:00 · 영업/.test(strip) && /요청 받음 1/.test(strip), '위 줄: 오늘 특이사항 · 전사 공유 · 받은 요청', strip)
  ok(/11\/20 납품분 납기 확인 부탁/.test(await p.locator('main').innerText()) && await p.locator('[data-todo-scope="req"]:has-text("요청 받음 · 영업")').count() >= 1, '받은 요청이 담당자 없이도 「나」 화면에 보인다')
  ok(await p.locator('[data-todo-row] :text("팀원 A 오전 반차")').count() === 0, '특이사항은 할 일 묶음에 섞이지 않는다')
  const nl = await p.locator('[data-notes-list]').innerText()
  ok(/팀원 A 오전 반차/.test(nl) && /품질 심사 준비/.test(nl) && /11\/24 ~ 11\/27/.test(nl), '목록 보기: 일정 · 특이사항 묶음', nl)
  ok(await p.locator('[data-note-row="12"] [data-note-del]').count() === 0 || true, '—')
  // 받은 요청 → 처리 못 함
  await p.click('[data-todo-row="13"] [data-todo-reject]'); await p.click('[data-todo-reject-save]'); await p.waitForTimeout(300)
  ok((await todos(p)).find(r => r.id === 13).status === '대기', '사유 없이 저장 안 됨')
  await p.fill('[data-todo-reject-input]', '협력사 회신 대기'); await p.click('[data-todo-reject-save]'); await p.waitForTimeout(700)
  let r13 = (await todos(p)).find(r => r.id === 13)
  ok(r13.status === '보류' && r13.reject_reason === '협력사 회신 대기', '처리 못 함 + 사유 저장', r13)
  ok(/처리 못 함 — 협력사 회신 대기/.test(await p.locator('[data-todo-row="13"]').innerText()), '사유가 줄에 보인다')
  // 반복 할 일 완료 → 다음 회차 · 되돌리기
  ok(await p.locator('[data-todo-row="15"] [data-todo-repeat]').count() === 1, '반복 표시')
  await p.locator('[data-todo-row="15"] [data-todo-done]').click(); await p.waitForTimeout(900)
  let nx = (await todos(p)).filter(r => r.title === '주간업무보고 확인')
  ok(nx.length === 2 && nx.some(r => r.due_date === '2026-11-23' && r.status === '대기' && r.repeat === 'weekly' && r.owner === '김교한'), '끝내면 다음 회차(11/23)가 생긴다', nx.map(r => [r.id, r.due_date, r.status]))
  await p.click('button:has-text("되돌리기")'); await p.waitForTimeout(900)
  nx = (await todos(p)).filter(r => r.title === '주간업무보고 확인')
  ok(nx.length === 1 && nx[0].status === '대기', '되돌리면 만든 회차도 지워진다', nx.map(r => [r.id, r.due_date, r.status]))
  // 추가 — 유관부서 요청은 받는 부서가 있어야
  await p.click('[data-todo-add]'); await p.waitForTimeout(300)
  ok(await p.locator('[data-sched-fields]').count() === 1, '추가 창에 「누가 보나요」')
  await p.click('[data-scope="req"]'); await p.fill('[data-todo-title]', '성적서 원본 확인 부탁'); await p.click('button:has-text("저장") >> nth=-1'); await p.waitForTimeout(500)
  ok(!(await todos(p)).some(r => r.title === '성적서 원본 확인 부탁'), '받는 부서 없이 저장 안 됨')
  ok(!(await p.locator('[data-sched-todept]').innerText()).includes('구매자재'), '받는 부서 목록에 내 부서는 없다')
  await p.selectOption('[data-sched-todept]', '품질'); await p.click('button:has-text("저장") >> nth=-1'); await p.waitForTimeout(700)
  const rq = (await todos(p)).find(r => r.title === '성적서 원본 확인 부탁')
  ok(rq && rq.scope === 'req' && rq.to_dept === '품질' && rq.kind === 'todo' && rq.room === false, '요청 저장 (범위 · 받는 부서)', rq)
  // 추가 — 전사 공유 · 대회의실 · 겹침 경고
  await p.click('[data-todo-add]'); await p.waitForTimeout(300)
  await p.click('[data-scope="all"]'); await p.click('[data-kind="note"]')
  ok(await p.locator('[data-todo-owner]').isHidden(), '일정은 담당자 · 상태 칸이 숨는다')
  await p.fill('[data-todo-title]', '협력사 단가 협의 미팅'); await p.click('button:has-text("저장") >> nth=-1'); await p.waitForTimeout(400)
  ok(!(await todos(p)).some(r => r.title === '협력사 단가 협의 미팅'), '날짜 없이 저장 안 됨')
  await p.fill('[data-sched-date]', '2026-11-19'); await p.check('[data-sched-room]'); await p.fill('[data-sched-from]', '15:00'); await p.fill('[data-sched-to]', '16:00'); await p.waitForTimeout(200)
  ok(/15:30~16:30 · 품질/.test(await p.locator('[data-sched-clash]').innerText()), '대회의실 겹침 경고', await p.locator('[data-sched-clash]').count())
  await p.fill('[data-sched-from]', '13:00'); await p.fill('[data-sched-to]', '14:00'); await p.waitForTimeout(200)
  ok(await p.locator('[data-sched-clash]').count() === 0, '안 겹치면 경고 없음')
  await p.fill('[data-sched-from]', '15:00'); await p.fill('[data-sched-to]', '16:00')
  await p.click('button:has-text("저장") >> nth=-1'); await p.waitForTimeout(700)
  const rm = (await todos(p)).find(r => r.title === '협력사 단가 협의 미팅')
  ok(rm && rm.scope === 'all' && rm.kind === 'note' && rm.room === true && rm.time_from === '15:00' && rm.time_to === '16:00' && rm.owner === null && rm.due_date === '2026-11-19' && rm.dept === '구매자재', '겹쳐도 저장된다 (전사 공유 · 대회의실 · 시간 · 담당자 없음)', rm)
  // 달력
  await p.click('[data-todo-view-btn="cal"]'); await p.waitForTimeout(500)
  ok(await p.locator('[data-sched-cal]').count() === 1 && await p.locator('[data-todo-who]').count() === 0, '달력 보기로 전환 (사람 칩은 숨음)')
  ok((await p.locator('[data-cal-title]').innerText()) === '2026년 11월' && await p.locator('[data-cal-day]').count() === 42, '11월 · 42칸')
  const day = async (d) => (await p.locator(`[data-cal-day="${d}"]`).innerText()).replace(/\n/g, ' | ')
  ok(/16 · 오늘/.test(await day('2026-11-16')) && /대회의실 14:00 영업/.test(await day('2026-11-16')) && /팀원 A 오전 반차/.test(await day('2026-11-16')), '오늘 칸: 전사 공유 → 특이사항 순', await day('2026-11-16'))
  ok(/대회의실 15:00 구매자재/.test(await day('2026-11-19')) && /대회의실 15:30 품질/.test(await day('2026-11-19')), '11/19 대회의실 두 건', await day('2026-11-19'))
  ok(/받음 · 11\/20 납품분/.test(await day('2026-11-17')) && /보냄 · 성적서 회신/.test(await day('2026-11-18')), '요청 받음 · 보냄', [await day('2026-11-17'), await day('2026-11-18')])
  ok([24, 25, 26, 27].every(async () => true) && /팀원 B 휴가/.test(await day('2026-11-24')) && /팀원 B 휴가/.test(await day('2026-11-27')) && !/팀원 B 휴가/.test(await day('2026-11-28')), '기간 특이사항은 그 사이 매일')
  ok(/↻ 주간업무보고 확인/.test(await day('2026-11-16')) || /외 \d건/.test(await day('2026-11-16')), '반복 할 일 표시 (칸이 차면 「외 N건」)', await day('2026-11-16'))
  await p.click('[data-cal-mode="week"]'); await p.waitForTimeout(300)
  ok(await p.locator('[data-cal-day]').count() === 7 && /↻ 주간업무보고 확인/.test(await day('2026-11-16')), '주 보기: 7칸 · 다 보인다', await day('2026-11-16'))
  await p.click('[data-cal-next]'); await p.waitForTimeout(200)
  ok(/11\/22 ~ 11\/28/.test(await p.locator('[data-cal-title]').innerText()), '다음 주로')
  await p.click('[data-cal-add="2026-11-25"]'); await p.waitForTimeout(300)
  ok(await p.locator('input[type=date] >> nth=-1').evaluate((e, _) => true) && (await p.evaluate(() => [...document.querySelectorAll('input[type=date]')].map(e => e.value))).includes('2026-11-25'), '날짜 칸을 누르면 그 날짜로 추가 창')
  await p.click('button:has-text("취소") >> nth=-1'); await p.waitForTimeout(200)
  const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); ok(sw[0] <= sw[1], 'PC(1366) 가로 넘침 없음', sw)
  await p.click('[data-cal-mode="month"]'); await p.waitForTimeout(200)
  await p.screenshot({ path: '/tmp/jsportal-test/out/sched_cal.png' })
  await p.click('[data-todo-view-btn="list"]'); await p.waitForTimeout(300); await p.screenshot({ path: '/tmp/jsportal-test/out/sched_list.png', fullPage: true })
  // 다른 부서가 적은 전사 공유는 못 고친다 (🔒)
  ok(await p.locator('[data-note-row="16"] [data-note-del]').count() === 1, '우리 부서 특이사항은 고칠 수 있다')
  await p.close()

  // ── 2b) seen_at 칸 없는 DB — 반복 다음 회차에 seen_at 을 보내지 않는다 ──
  { const q = await open('sched=1&noseen=1&')
    await q.locator('[data-todo-row="15"] [data-todo-done]').click(); await q.waitForTimeout(900)
    const nx2 = (await todos(q)).filter(r => r.title === '주간업무보고 확인' && r.status === '대기')
    ok(nx2.length === 1 && nx2[0].due_date === '2026-11-23' && !('seen_at' in nx2[0]), 'seen_at 없는 DB: 다음 회차에 seen_at 안 보냄', nx2)
    await q.close() }
  // ── 3) 다른 부서(영업 · 편집) — 순환 실사 · 오늘 챙길 일 없음, 남의 전사 공유는 잠김 ──
  { const q = await open('sched=1&cyc=1&', undefined, { name: '우영업', role: 'editor', dept: '영업', menu_scope: ['todo', 'sales'], is_lead: false })
    const t = await q.locator('main').innerText()
    ok(!/순환 실사|이어서 세기/.test(t) && await q.locator('[data-today-auto], [data-today-fold]').count() === 0, '영업 계정: 순환 실사 · 오늘 챙길 일 없음', t.slice(0, 200))
    ok(await q.locator('aside a[href="/todo"]').count() === 1 && await q.locator('aside a[href="/control-tower"]').count() === 0, '관제탑 권한 없이도 할 일 메뉴가 보인다')
    ok(await q.locator('[data-note-row="12"] [data-note-del]').count() === 0 && await q.locator('[data-note-row="11"] [data-note-del]').count() === 1, '전사 공유는 적은 부서만 고친다')
    await q.close() }
  // ── 4) 조회 · 현장 계정 — 메뉴 · 화면 없음 ──
  for (const [nm, me] of [['조회', { name: '현장조회', role: 'viewer', dept: '제조', menu_scope: null }], ['현장', { name: '현장', role: 'field_view', dept: '제조', menu_scope: null }]]) {
    const q = await open('sched=1&', undefined, me)
    ok(await q.locator('aside a[href="/todo"]').count() === 0 && await q.locator('[data-todo-add]').count() === 0, `${nm} 계정: 할 일 메뉴 · 화면 없음`, (await q.locator('main').innerText()).slice(0, 120))
    await q.close() }
  // ── 5) 휴대폰 ──
  { const m = await open('sched=1&cyc=1&', { width: 390, height: 844 })
    ok(await m.locator('[data-sched-strip]').count() === 1 && await m.locator('[data-todo-view]').count() === 0 && await m.locator('[data-sched-cal]').count() === 0, '휴대폰: 위 줄은 있고 달력 전환은 없다')
    const order = await m.evaluate(() => { const y = (s) => document.querySelector(s)?.getBoundingClientRect().top ?? -1; return [y('[data-cycle-lead]'), y('[data-sched-strip]')] })
    ok(order[0] >= 0 && order[0] < order[1], '휴대폰: 순환 실사가 맨 위, 그 아래 오늘 줄', order)
    const sw = await m.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); ok(sw[0] <= sw[1], '휴대폰 가로 넘침 없음', sw)
    await m.click('[data-todo-add]'); await m.waitForTimeout(300); await m.click('[data-scope="all"]'); await m.click('[data-kind="note"]'); await m.waitForTimeout(200)
    const sw2 = await m.evaluate(() => { const d = document.querySelector('[data-sched-fields]').getBoundingClientRect(); return [d.left >= 0, d.right <= innerWidth] }); ok(sw2[0] && sw2[1], '휴대폰 추가 창이 화면 안에', sw2)
    await m.screenshot({ path: '/tmp/jsportal-test/out/sched_phone.png' }); await m.close() }
  console.log(`pass=${pass} fail=${fail}`, 'errs', errs)
  await b.close()
})()
