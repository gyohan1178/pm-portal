const {chromium,devices}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const T=async(p,s)=>(await p.textContent(s).catch(()=>'')||'').replace(/\s+/g,' ').trim();
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({...devices['Pixel 7']});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message))
await p.goto('http://localhost:8765/app.html?pdone=1&r='+encodeURIComponent('/customer/ax/purchase'));await p.waitForTimeout(2500)
ok(/부분 입고 4\/10/.test(await T(p,'[data-po-card="pd-part"]'))&&/입고 11-04/.test(await T(p,'[data-po-card="pd-part"]')),'부분 입고 · 마지막 입고일',await T(p,'[data-po-card="pd-part"]'))
ok(!await p.$('[data-po-card="pd-done"]'),'미입고 탭엔 완료 없음')
await p.click('[data-po-mstat-btn="done"]'); await p.waitForTimeout(1500)
ok(/✔ 입고 완료/.test(await T(p,'[data-po-card="pd-done"]'))&&/입고 11-02/.test(await T(p,'[data-po-card="pd-done"]')),'입고 완료 · 입고일',await T(p,'[data-po-card="pd-done"]'))
ok(/입고 완료 ?1/.test(await T(p,"[data-po-mstat]")),'칩 숫자',await T(p,'[data-po-mstat]'))
await p.fill('[data-po-msearch]','261028'); await p.waitForTimeout(500); ok((await p.$$('[data-po-card]')).length===1,'발주번호로 찾기')
await p.click('[data-po-mstat-btn="all"]'); await p.fill('[data-po-msearch]','sphs'); await p.waitForTimeout(500); ok((await p.$$('[data-po-card]')).length===2,'전체 — 진행 + 완료',(await p.$$('[data-po-card]')).length)
await p.fill('[data-po-msearch]',''); await p.waitForTimeout(500); await p.screenshot({path:'/tmp/jsportal-test/out/t79b.png',fullPage:true})
ok(errs.length===0,'오류 없음',errs); console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close()})()
