// v4.115.0 — 회원 관리 알림
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const T=async(p,s)=>((await p.textContent(s).catch(()=>''))||'').replace(/\s+/g,' ').trim();
(async()=>{const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1400,height:1000}});
await ctx.addInitScript(()=>{ window.__seed=(S)=>{} });
const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
const seed=async()=>p.evaluate(()=>{ const P=window.__S.DATA.pm_profiles; if(!P.find(x=>x.id==='n1')) P.push(
  {id:'n1',name:'강성식',email:'k@jinsuntech.co.kr',dept:'품질',role:'viewer',status:'pending',created_at:new Date().toISOString()},
  {id:'n2',name:'이원준',email:'l@jinsuntech.co.kr',dept:'품질',role:'viewer',status:'pending',created_at:new Date().toISOString()},
  {id:'o1',name:'예전사람',email:'o@jinsuntech.co.kr',dept:'제조',role:'editor',status:'approved',created_at:'2026-08-01T00:00:00Z'}); window.__qc.invalidateQueries({queryKey:['pendingSignups']}) });
await p.goto('http://localhost:8765/app.html?r='+encodeURIComponent('/'));await p.waitForTimeout(1800);
await seed(); await p.waitForTimeout(1200);
console.log('① 메뉴 숫자 · 알림');
ok(await T(p,'[data-menu-badge="/users"]')==='2','회원 관리 옆 2',await T(p,'[data-menu-badge="/users"]'));
ok(/새 가입 신청 2명 — 강성식\(품질\), 이원준\(품질\)/.test(await T(p,'body')),'새 가입 신청 알림');
await p.reload(); await p.waitForTimeout(1800); await seed(); await p.waitForTimeout(1200);
ok(!/새 가입 신청 2명/.test(await T(p,'body')),'같은 신청은 다시 알리지 않음');
ok(await T(p,'[data-menu-badge="/users"]')==='2','숫자는 그대로 2');
console.log('② 승인 → 숫자 줄어듦');
await p.click('a[href="/users"]'); await p.waitForTimeout(1200);
ok((await p.$$('[data-user-new]')).length===2,'승인 대기 2명에 「새 가입」');
await p.locator('tr:has-text("강성식") button:has-text("승인")').click(); await p.waitForTimeout(1200);
ok(await T(p,'[data-menu-badge="/users"]')==='1','승인하면 바로 1');
const pr=await p.evaluate(()=>window.__S.DATA.pm_profiles.find(x=>x.id==='n1'));
ok(pr.status==='approved'&&pr.approved_by==='u1','승인 · 승인한 사람 기록',{s:pr.status,by:pr.approved_by});
await p.click('button:has-text("활성")'); await p.waitForTimeout(500);
ok(/강성식/.test(await T(p,'tbody'))&&(await p.$$('[data-user-new]')).length>=1&&!/예전사람.*새 가입/.test(await T(p,'tbody')),'활성 목록: 새로 들어온 사람만 「새 가입」');
console.log('③ 관리자 아니면 없음');
await p.goto('http://localhost:8765/app.html?me='+encodeURIComponent(JSON.stringify({role:'editor'}))+'&r=%2F'); await p.waitForTimeout(1800); await seed(); await p.waitForTimeout(800);
ok(!await p.$('[data-menu-badge="/users"]'),'편집 계정엔 숫자 · 메뉴 없음');
ok(errs.length===0,'오류 없음',errs);
console.log(`\nt44 ${pass}/${pass+fail}`);await b.close();process.exit(fail?1:0)})();
