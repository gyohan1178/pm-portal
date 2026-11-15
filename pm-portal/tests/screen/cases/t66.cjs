// v4.139.0 — 견적 이력 고객사 거르기
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1500,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8765/app.html?qh=1&r='+encodeURIComponent('/sales-quote'));await p.waitForTimeout(1800)
await p.click('[data-sq-tab="history"]'); await p.waitForTimeout(1500)
const codes=()=>p.$$eval('table tbody tr',a=>a.map(e=>e.innerText).join('|'))
const cnt=()=>p.textContent('[data-qh-count]')
let c=await codes(); ok(/AX-1003-0027-0006/.test(c)&&!/VM-309/.test(c),'처음 — AXCELIS 만',c.slice(0,200))
ok(await p.textContent('[data-qh-cust]')==='AXCELIS'&&await cnt()==='1','표시 AXCELIS · 1건')
const vmVal=await p.$eval('[data-qh-cust-sel]',s=>[...s.options].find(o=>o.text==='VM').value)
await p.selectOption('[data-qh-cust-sel]',vmVal); await p.waitForTimeout(1200)
c=await codes(); ok(/VM-309-1701-007/.test(c)&&/VM-501-0148-193/.test(c)&&!/AX-1003/.test(c)&&!/ED-NK1/.test(c),'VM — VM 견적 + 예전(고객사 빈) VM 견적',c.slice(0,200))
ok(await cnt()==='2','VM 2건')
await p.selectOption('[data-qh-cust-sel]','__all'); await p.waitForTimeout(1000)
ok(await cnt()==='4'&&await p.textContent('[data-qh-cust]')==='전체 고객사','전체 고객사 4건')
await p.click('button:has-text("📥 매입견적")'); await p.waitForTimeout(1000)
ok(await cnt()==='1','매입견적은 거르지 않음')
await p.click('button:has-text("📤 매출견적")'); await p.selectOption('[data-qh-cust-sel]',vmVal); await p.waitForTimeout(800)
await p.click('button:has-text("견적별")'); await p.waitForTimeout(500)
c=await codes(); ok(/Sq2/.test(c)&&/Sq3/.test(c)&&!/Sq1/.test(c),'견적별도 VM 만',c.slice(0,200))
await p.click('[data-sq-tab="write"]'); await p.waitForTimeout(800)
ok(!await p.$('[data-qh-cust-sel]'),'작성 탭은 원래 고객사 선택')
ok(errs.length===0,'오류 없음',errs);
console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close();})();
