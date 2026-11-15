// v4.178.0 — 공정 현황판: VM 현장작업 = 납품 완료로 보고 빠짐
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1500,height:1000}});p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8765/app.html?r=/');await p.waitForTimeout(1200);
await p.evaluate(()=>{const D=window.__S.DATA.production;
  D.push({id:9101,customer_code:'VM',pn:'Nardo',name:'3by2',hogi:'VMSITE-1',status:'현장작업',req_date:'2026-11-01',missing_parts:[]},
         {id:9102,customer_code:'VM',pn:'Nardo',name:'3by2',hogi:'VMMAKE-2',status:'제작중',req_date:'2026-11-20',missing_parts:[]},
         {id:9103,customer_code:'VM',pn:'Nardo',name:'3by2',hogi:'VMDONE-3',status:'완료',req_date:'2026-10-20',missing_parts:[]}); });
await p.click('a[href="/production"]');await p.waitForTimeout(2500);
const t=await p.textContent('main');
ok(/VMMAKE-2/.test(t),'VM 제작중 호기는 보임');
ok(!/VMSITE-1/.test(t),'VM 현장작업 호기는 빠짐 (납품 완료)');
ok(!/VMDONE-3/.test(t),'완료 호기는 그대로 빠짐');
ok(/현장작업」으로 넘어가면 납품 완료/.test(t),'설명문에 안내');
await p.goto('http://localhost:8765/app.html?r=/board%3Fc%3DVM');await p.waitForTimeout(800);
await p.evaluate(()=>{window.__S.DATA.production.push({id:9101,customer_code:'VM',pn:'Nardo',name:'3by2',hogi:'VMSITE-1',status:'현장작업',req_date:'2026-11-01',missing_parts:[]});window.__qc.invalidateQueries({queryKey:['processBoard']})});await p.waitForTimeout(1500);
ok(!/VMSITE-1/.test(await p.textContent('body')),'현장 TV 에서도 빠짐');
ok(!errs.length,'페이지 오류 없음',errs);
console.log(`\n${pass} 통과 / ${fail} 실패`);await b.close();process.exit(fail?1:0)})();
