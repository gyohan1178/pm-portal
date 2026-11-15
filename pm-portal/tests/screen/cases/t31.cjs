// v4.103.1 — 수주대장 등록한 사람 표시
const {chromium}=require('playwright');
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
const T=async(p,s)=>(await p.textContent(s).catch(()=>'')||'').replace(/\s+/g,' ').trim();
(async()=>{const b=await chromium.launch();
 const go=async(w)=>{const p=await b.newPage({viewport:{width:w,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto(`http://localhost:8765/app.html?fastx=1&r=${encodeURIComponent('/orders')}`);
  await p.evaluate(()=>{});await p.waitForTimeout(2200);return {p,errs}};
 const {p,errs}=await go(1500);
 const a=await T(p,'[data-row="47894KF|2/1"]');
 ok(/접수 \d+\/\d+ 김교한/.test(a),'품번별 목록: 「접수 날짜 김교한」',a.slice(0,140));
 const v=await T(p,'[data-row="PO2610000242|1/1"]');
 ok(!/김교한/.test(v),'등록자 이름 없는 PO 는 이름 안 붙음',v.slice(0,140));
 await p.screenshot({path:'/tmp/jsportal-test/out/reg_by.png',clip:{x:240,y:600,width:1260,height:260}});
 ok(errs.length===0,'오류 없음',errs);
 const m=await go(400);
 ok(/김교한/.test(await T(m.p,'[data-mcard="47894KF|2/1"]')),'휴대폰 카드에도 이름');
 ok(m.errs.length===0,'오류 없음',m.errs);
 console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
