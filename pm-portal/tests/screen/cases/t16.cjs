// v4.98.1 — 관제탑 · 업무 흐름 역할 나눔
const {chromium}=require('playwright');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
const STAFF=JSON.stringify({role:'editor',is_lead:false,dept:'구매자재',menu_scope:['buy','mat','sales','report','master','quality','floor','todo']});
(async()=>{const b=await chromium.launch();
const page=async(r,me,w=1440,shot)=>{const p=await b.newPage({viewport:{width:w,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(()=>{try{localStorage.setItem('pm.flowTab','map')}catch{}});
  await p.goto(`${base}?r=${encodeURIComponent(r)}${me?'&me='+encodeURIComponent(me):''}`);await p.waitForTimeout(1800);return {p,errs}};
// 1. 관제탑 — 흐름 박스 없음 · 버튼
{const {p,errs}=await page('/control-tower',null);
 ok(await p.locator('h1:has-text("관제탑")').count()>=1,'관제탑 화면 (v4.122.0 부터 /control-tower)');
 ok(await p.locator('[data-flowmap], [data-wf]').count()===0 && !(await p.textContent('main')).includes('넘어온 일'),'관제탑 위 업무 흐름 박스 없음');
 ok(await p.locator('[data-ct-flow]').count()===1,'「🧭 업무 흐름」 버튼 있음');
 await p.screenshot({path:'/tmp/jsportal-test/out/ct_after.png',fullPage:false});
 await p.click('[data-ct-flow]'); await p.waitForTimeout(1200);
 ok(await p.locator('[data-flowmap]').count()===1,'버튼 → 업무 흐름(지도)');
 // 흐름 지도 → 구매발주 칸 → 관제탑 바로가기
 await p.click('[data-flowmap-node="p3"]'); await p.waitForTimeout(300);
 const go=await p.$$eval('[data-flowmap-go]',a=>a.map(x=>x.getAttribute('data-flowmap-go')));
 ok(go.includes('관제탑'),'관리자: 구매발주 칸에 「관제탑」 바로가기',go);
 await p.screenshot({path:'/tmp/jsportal-test/out/map_admin.png',fullPage:false});
 await p.click('[data-flowmap-go="관제탑"]'); await p.waitForTimeout(1200);
 ok(await p.locator('h1:has-text("관제탑")').count()>=1,'바로가기 → 관제탑');
 ok(errs.length===0,'오류 없음',errs);
 // 고객사별 관제탑에도 버튼
 await p.goto(`${base}?r=${encodeURIComponent('/control-tower/ed')}`); await p.waitForTimeout(1500);
 ok(await p.locator('[data-ct-flow]').count()===1 && await p.locator('[data-flowmap]').count()===0,'고객사별 관제탑도 같은 모양');
}
// 2. 팀원 — 관제탑 못 봄 → 바로가기 안 보임 (권한 없음 버튼도 X)
{const {p,errs}=await page('/flow',STAFF);
 await p.click('[data-flowmap-node="p3"]'); await p.waitForTimeout(300);
 const go=await p.$$eval('[data-flowmap-go]',a=>a.map(x=>x.getAttribute('data-flowmap-go')));
 ok(!go.some(x=>/관제탑/.test(x)) && go.length>=1,'팀원: 관제탑 바로가기 안 보임 · 구매발주는 그대로',go);
 await p.click('[data-flowmap-node="p4"]'); await p.waitForTimeout(300);
 const go2=await p.$$eval('[data-flowmap-go]',a=>a.map(x=>x.getAttribute('data-flowmap-go')));
 ok(!go2.some(x=>/관제탑/.test(x)) && go2.includes('입고'),'팀원: 입고 칸도 관제탑 없음',go2);
 await p.goto(`${base}?r=/&me=${encodeURIComponent(STAFF)}`); await p.waitForTimeout(1500);
 ok(await p.locator('h1:has-text("관제탑")').count()===0,'팀원 첫 화면은 관제탑 아님 (그대로)');
 ok(errs.length===0,'오류 없음',errs);
}
// 3. 흐름 지도 3초 → 「봤음」 저장
{const p=await b.newPage({viewport:{width:1440,height:1000}});
 await p.addInitScript(()=>{try{if(!sessionStorage.getItem('x')){localStorage.clear();sessionStorage.setItem('x','1')};localStorage.setItem('pm.flowTab','map')}catch{}});
 await p.goto(`${base}?r=/flow`); await p.waitForTimeout(1200);
 const k0=await p.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('pm.flowSeen')));
 await p.waitForTimeout(3500);
 const k1=await p.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('pm.flowSeen')));
 ok(k1.length>=1,'지도 3초 보면 봤음 기록',{k0,k1});
}
console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
