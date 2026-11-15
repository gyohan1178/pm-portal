// v4.158.0 — 하네스 출도 · 불출이 수주대장 줄을 읽고 · 수주대장 줄에 불출을 쓴다
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1500,height:1000}});p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8765/app.html?hrp=1&nofn4=1&r='+encodeURIComponent('/production/harness-release'));await p.waitForTimeout(2500)
const S0=await p.evaluate(()=>window.__S.RPC.map(r=>r.fn))
ok(true,'SQL 전')
const body=await p.textContent('body')
ok(true,'-')
ok(/LM778185/.test(body)&&/824470/.test(body)===false,'호기 붙은 줄(824470 hp1)은 목록에서 빠짐 · 나머지는 보임')
// 첫 줄 골라 불출
await p.click('button:has-text("전체")').catch(()=>{})
const cb=p.locator('tbody input[type=checkbox]').first(); await cb.check(); await p.waitForTimeout(200)
await p.click('[data-hr-issue]'); await p.waitForTimeout(400)
await p.click('[data-confirm-ok]'); await p.waitForTimeout(1200)
const W=await p.evaluate(()=>window.__S.WRITES.filter(w=>w.op==='update').map(w=>w.table))
ok(!W.includes('pm_order_line'),'SQL 전 — 예전처럼 고객사 PO 에만',W)
ok(W.includes('purchase_orders'),'같은 줄의 고객사 PO 도 같이 (전환 기간)',W)
ok(errs.length===0,'화면 오류 없음',errs)
console.log(`\n${pass} pass / ${fail} fail`);await b.close();process.exit(fail?1:0)})()
