// v4.214.0 — 미불출 일괄 창에 제조사 · 제조사품번
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1500,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto(`http://localhost:8765/app.html?pt=1&mbulk=1&r=${encodeURIComponent('/production/AX')}`);await p.waitForTimeout(2200)
for (const h of ['#71','#72','#73','#74']) { const row=p.locator('tbody tr',{hasText:h}).filter({hasText:'110158840'}).first(); await row.locator('td').first().click() }
await p.click('[data-bulk-missing-open]'); await p.waitForTimeout(300)
await p.fill('[data-bulk-missing-paste]','5102060\t2'); await p.waitForTimeout(900)
ok(/S9P/.test(await p.textContent('[data-bulk-missing-makerpn="5102060"]')),'넣기 — 제조사품번 S9P')
await p.click('[data-bulk-missing-tab="clear"]'); await p.waitForTimeout(900)
const r=await p.textContent('[data-bulk-clear-row="4021187"]')
ok(/OMRON/.test(r)&&/G2R/.test(r),'해제 — RELAY 제조사 OMRON · 제조사품번 G2R (마스터에서 채움)',r)
const k=await p.textContent('[data-bulk-clear-row="9999"]')
ok(/—/.test(k),'마스터에 없는 품번은 —',k)
ok(errs.length===0,'오류 없음',errs)
console.log(`t149 ${pass}/${pass+fail}`); await b.close(); process.exit(fail?1:0)})();
