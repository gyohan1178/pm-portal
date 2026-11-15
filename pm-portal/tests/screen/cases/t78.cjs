// v4.151.0 — 생산관리 Sub Assy · 3rd party 전장 불출 · 품질 검수 체크 / 일괄 줄 자리 고정
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1440,height:900}});p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8765/app.html?subp=1&r='+encodeURIComponent('/production/ax'));await p.waitForTimeout(2500)
let cell=await p.$('[data-sub-part-issue]')
if(!cell){ await p.click('button:has-text("Sub Assy")').catch(()=>{}); await p.waitForTimeout(800); cell=await p.$('[data-sub-part-issue]') }
ok(!!cell,'Sub 줄에 전장 불출 칸이 눌림')
const id=await cell.getAttribute('data-sub-part-issue')
const tb0=await p.$eval('[data-pd-list]',e=>Math.round(e.getBoundingClientRect().y))
await cell.click(); await p.waitForTimeout(800)
let row=await p.evaluate((id)=>window.__S.DATA.production.find(x=>String(x.id)===id),id)
ok(row && (row.part_issue===true||row.part_issue==='true'),'전장 불출 저장',row&&row.part_issue)
ok(/✔ 불출/.test(await p.textContent(`[data-sub-part-issue="${id}"]`)),'✔ 불출 표시')
await p.click(`[data-sub-quality="${id}"]`); await p.waitForTimeout(800)
row=await p.evaluate((id)=>window.__S.DATA.production.find(x=>String(x.id)===id),id)
ok(row && (row.quality_recv===true||row.quality_recv==='true'),'품질 검수 저장',row&&row.quality_recv)
console.log('② 일괄 줄 — 고를 때 표가 안 밀림')
ok(!!await p.$('[data-pd-bulkbar]'),'안 골라도 일괄 줄 보임')
ok(await p.$eval('[data-bulk-missing-open]',e=>e.matches(':disabled')),'안 고르면 버튼 흐리게')
await p.locator('[data-pd-list] tbody input[type=checkbox]').first().locator('xpath=..').click(); await p.waitForTimeout(400)
const tb1=await p.$eval('[data-pd-list]',e=>Math.round(e.getBoundingClientRect().y))
ok(tb0===tb1,'표 위치 그대로',[tb0,tb1])
ok(await p.$eval('[data-bulk-missing-open]',e=>!e.matches(':disabled')),'고르면 켜짐')
ok(errs.length===0,'오류 없음',errs);
console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close();})();
