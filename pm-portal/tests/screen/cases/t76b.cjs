const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const PASTE=['제조사\t제조사품번\t품명\t수량','NEWCO\tX-999\tNEW PART\t4'].join('\n')
;(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1500,height:1100}});p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8765/app.html?pq=1&r='+encodeURIComponent('/sales-quote'));await p.waitForTimeout(2000)
await p.click('button:has-text("✍ 견적 작성")');await p.waitForTimeout(1200)
await p.click('[data-quote-parts-paste]'); await p.waitForTimeout(300)
await p.fill('[data-qp-name]','X ASSY'); await p.fill('[data-qp-text]',PASTE); await p.click('[data-qp-check]'); await p.waitForTimeout(600); await p.click('[data-qp-add]'); await p.waitForTimeout(500)
const n0=await p.evaluate(()=>window.__S.DATA.pm_rfq.length)
await p.evaluate(()=>{ window.__S.FAIL['pm_rfq_line:insert']="Could not find the 'paste_parts' column of 'pm_rfq_line' in the schema cache" })
await p.click('[data-paste-req]'); await p.waitForTimeout(300); await p.click('[data-confirm-ok]'); await p.waitForTimeout(1200)
const body=(await p.textContent('body')).replace(/\s+/g,' ')
ok(/견적접수_부품표_반영_261104\.sql/.test(body),'SQL 전 — 실행할 SQL 안내')
ok(await p.evaluate(()=>window.__S.DATA.pm_rfq.length)===n0,'접수 머리 안 남음')
ok(!!await p.$('[data-paste-req]'),'버튼 그대로 (다시 누를 수 있음)')
ok(errs.length===0,'오류 없음',errs); console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close();})();
