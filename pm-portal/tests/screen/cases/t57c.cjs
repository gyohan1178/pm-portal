const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1500,height:1100}});p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8765/app.html?q99=1&nq1=closed&r=/sales-quote');await p.waitForTimeout(2200);
// 닫힌 건이 보이게 — 상태 필터가 있으면 전체로
for (const t of ['전체','끝난 건','종료']) { const x=p.locator(`button:has-text("${t}")`).first(); if(await x.count()){ await x.click().catch(()=>{}); await p.waitForTimeout(400) } }
let btn=p.locator('[data-rfq-act="nq-reopen"]');
console.log('reopen btns',await btn.count());
if(!(await btn.count())){ const t=(await p.textContent('main')).replace(/\s+/g,' '); console.log(t.slice(0,800)) }
ok(await btn.count()===1,'견적 불가 건에 「↩ 다시 진행」');
if(await btn.count()){ await btn.click(); await p.waitForTimeout(400); await p.click('button:has-text("다시 진행") >> nth=-1'); await p.waitForTimeout(1200);
 const st=await p.evaluate(()=>window.__S.DATA.pm_rfq.find(r=>r.id==='r3').status); ok(st==='진행','다시 진행 → 상태 진행',st) }
ok(!errs.length,'페이지 오류 없음',errs);
console.log(`\n${pass} 통과 / ${fail} 실패`);await b.close();process.exit(fail?1:0)})();
