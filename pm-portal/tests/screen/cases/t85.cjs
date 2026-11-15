// v4.157.0 — 수주대장 줄에 붙은 호기(PO 연동 v4)의 PO 번호
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();
const p=await b.newPage({viewport:{width:1500,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message))
await p.goto(`http://localhost:8765/app.html?pt=1&pol=1&poline=1&r=${encodeURIComponent('/production/AX')}`);await p.waitForTimeout(2500)
const row=(h)=>p.locator('tbody tr',{hasText:h}).filter({hasText:'110173680'}).first()
const t5=await row('#5').textContent()
ok(/47894KF/.test(t5),'#5 — 수주대장 줄의 PO 번호',t5.slice(0,160))
ok(await row('#5').locator('[data-po-src-order]').count()===1,'#5 — 「수주대장」 표시')
ok(/PE081612KK/.test(await row('#3').textContent()),'#3 — 예전 잡아 둔 호기 그대로')
ok(/47001KF/.test(await row('#4').textContent()),'#4 — 고객사 PO 붙은 호기 그대로')
ok(errs.length===0,'화면 오류 없음',errs)
console.log(`\n${pass} pass / ${fail} fail`);await b.close();process.exit(fail?1:0)})()
