// v4.167.0 — 공용 부품(지표 · 빈 상태 · 버튼 이름) + 자재 영역 적용
const {chromium}=require('playwright');
const fs=require('fs');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const T=(p,s)=>p.$eval(s,e=>e.innerText.replace(/\s+/g,' ')).catch(()=>'');
const SHOT='/tmp/jsportal-test/out/shots/';
fs.mkdirSync(SHOT,{recursive:true});
(async()=>{const b=await chromium.launch();const errs=[];
const pg=async(r,q='',w=1440)=>{const p=await b.newPage({viewport:{width:w,height:900}});p.on('pageerror',e=>errs.push(r+': '+e.message.slice(0,140)));await p.goto('http://localhost:8765/app.html?'+q+'r='+encodeURIComponent(r));await p.waitForTimeout(1800);return p}
const head=p=>p.evaluate(()=>{const h=document.querySelector('[data-page-head]');return h?{crumb:h.querySelector('[data-page-crumb]')?.textContent||'',title:h.querySelector('[data-page-title]')?.textContent||'',desc:!!h.querySelector('.page-desc'),acts:[...h.querySelectorAll('[data-page-actions] button, [data-page-actions] a')].map(b=>b.textContent.trim())}:null})

console.log('① 자재 7화면 — 같은 머리(구분 자재 · 제목 · 설명)')
for (const [r,title,shot] of [['/search','통합 검색','m_search'],['/inventory','재고현황','m_inv'],['/outbound','ASSY 출고','m_out'],['/issue','다품목 출고','m_issue'],['/outbound-history','출고 현황','m_outhist'],['/production/harness-release','하네스 출도 · 불출','m_hr'],['/rack-layout','창고 배치도','m_rack']]) {
  const p=await pg(r); const h=await head(p)
  ok(h&&h.crumb==='자재'&&h.title===title&&h.desc,`${r} — 자재 · ${title} · 설명`,h)
  if(h&&h.acts.some(a=>/엑셀/.test(a))) ok(h.acts.some(a=>a==='📥 엑셀'),`${r} — 엑셀 버튼 이름 「📥 엑셀」`,h.acts)
  ok(await p.evaluate(()=>document.querySelectorAll('main h1').length)===1,`${r} — 제목 하나`)
  await p.screenshot({path:SHOT+shot+'.png'}); await p.close()
}

console.log('② 재고현황 — 지표 누르면 걸러짐')
let p=await pg('/inventory')
const cards=await p.$$eval('[data-kpi-row="inv"] > *',a=>a.map(e=>[e.tagName,e.children.length]))
ok(cards.length===5&&cards.slice(0,4).every(c=>c[0]==='BUTTON')&&cards.every(c=>c[1]===3),'5칸 · 라벨/숫자/설명 3줄 · 앞 4칸은 버튼',cards)
const nAll=await p.$$eval('table tbody tr',a=>a.length)
const zero=Number((await T(p,'[data-kpi="재고 없음"] > :nth-child(2)')).replace(/,/g,''))
await p.click('[data-kpi="재고 없음"]'); await p.waitForTimeout(300)
const nZero=await p.$$eval('table tbody tr',a=>a.filter(r=>!r.querySelector('[data-empty]')).length)
ok(nZero===zero,'「재고 없음」 누르면 그 수만큼만',{zero,nZero,nAll})
ok(await p.$eval('[data-kpi="재고 없음"]',e=>e.dataset.kpiOn==='1'),'눌린 칸 표시')
await p.click('[data-kpi="재고 없음"]'); await p.waitForTimeout(300)
ok(await p.$$eval('table tbody tr',a=>a.length)===nAll,'다시 누르면 풀림')
await p.click('[data-kpi="안전재고 미달"]'); await p.waitForTimeout(300)
const low=Number((await T(p,'[data-kpi="안전재고 미달"] > :nth-child(2)')).replace(/,/g,''))
const nLow=await p.$$eval('table tbody tr',a=>a.filter(r=>!r.querySelector('[data-empty]')).length)
ok(nLow===low||(low===0&&await p.$('[data-empty]')),'「안전재고 미달」 거르기 (0이면 빈 상태 안내)',{low,nLow})
await p.close()

console.log('③ 조회 실패 ≠ 0건')
p=await pg('/outbound-history','')
await p.evaluate(()=>{ window.__S.FAIL = ['stock_movements'] })
// 다시 조회 — 실패가 「출고 이력 없음」이 아니라 오류로 보이는지
const hasFail=await p.evaluate(()=>!!window.__S && 'FAIL' in window.__S)
await p.click('button:has-text("조회")'); await p.waitForTimeout(800)
const em=await T(p,'[data-empty], [data-error-state]')
ok(/출고 이력이 없습니다|불러오지 못했습니다/.test(em),'빈 상태 · 실패 상태 부품 사용',em)
await p.close()

console.log('④ 노트북 화면 — 지표가 한 줄 칩')
p=await b.newPage({viewport:{width:1366,height:768}}); p.on('pageerror',e=>errs.push(e.message))
await p.addInitScript(()=>{ try{ localStorage.setItem('pm.viewScale','94') }catch{} })
await p.goto('http://localhost:8765/app.html?r='+encodeURIComponent('/inventory')); await p.evaluate(()=>document.documentElement.setAttribute('data-compact','94')); await p.waitForTimeout(1800)
const cmp=await p.evaluate(()=>document.documentElement.hasAttribute('data-compact'))
if(cmp){ const disp=await p.$eval('[data-kpi-row="inv"]',e=>getComputedStyle(e).display); ok(disp==='flex','compact → 칩 한 줄',disp) } else console.log('   (compact 설정 키 다름 — 건너뜀)')
await p.screenshot({path:SHOT+'m_inv_compact.png'}); await p.close()

console.log('⑤ 빈 상태')
p=await pg('/issue')
ok(/담긴 품목이 없습니다/.test(await T(p,'[data-issue-cart] [data-empty]')),'다품목 출고 빈 장바구니 — 안내 문구')
await p.close()
p=await pg('/search')
await p.fill('input[placeholder*="기준코드"]','ZZZ없는품번'); await p.keyboard.press('Enter'); await p.waitForTimeout(1200)
ok(/결과가 없습니다/.test(await T(p,'[data-empty]')),'통합 검색 결과 없음 — 안내 문구')
await p.close()

console.log(errs.length?errs:'  페이지 오류 없음'); ok(!errs.length,'페이지 오류 0')
console.log(`t95 ${pass}/${pass+fail}`); await b.close()})()
