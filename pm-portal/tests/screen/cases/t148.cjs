// v4.213.0 — 기준코드 DB MOQ 칸
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();const errs=[];
const p=await b.newPage({viewport:{width:1440,height:900}});p.on('pageerror',e=>errs.push(e.message.slice(0,160)))
await p.goto('http://localhost:8765/app.html?r='+encodeURIComponent('/master/items')); await p.waitForTimeout(1800)
await p.fill('input[placeholder*="검색"]','SCREW').catch(()=>{}); await p.keyboard.press('Enter'); await p.waitForTimeout(1200)
await p.dblclick('tr:has-text("SCREW PAN HD M4X8")'); await p.waitForTimeout(800)
ok(!!await p.$('[data-item-moq]'),'수정 폼에 MOQ 칸')
await p.fill('[data-item-moq]','30')
const id=await p.evaluate(()=>window.__S.DATA.items.find(i=>/SCREW PAN HD M4X8/.test(i.name||''))?.id)
await p.click('button:has-text("수정 완료")'); await p.waitForTimeout(1000)
const it=await p.evaluate((id)=>window.__S.DATA.items.find(i=>i.id===id),id)
ok(it&&Number(it.moq)===30,'저장하면 items.moq = 30',it&&it.moq)
await p.fill('input[placeholder*="검색"]','SCREW').catch(()=>{}); await p.keyboard.press('Enter'); await p.waitForTimeout(1200)
ok(/MOQ 30/.test(await p.$eval('tr:has-text("SCREW PAN HD M4X8") [data-item-moq-cell]',e=>e.textContent).catch(()=>'')),'목록 LT 아래 MOQ 30')
ok(errs.length===0,'오류 없음',errs)
console.log(`t148 ${pass}/${pass+fail}`); await b.close(); process.exit(fail?1:0)})();
