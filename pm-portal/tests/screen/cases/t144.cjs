// v4.204.0 — 고객사 불만 접수: 처리 상태(접수 · 조치 중 · 완료) · 미처리 KPI · 표 안 스크롤(가로 막대가 화면 안에)
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const W=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1500,height:900}});p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8765/app.html?r=/');await W(1000);
await p.evaluate(()=>{const D=window.__S.DATA; const rs=[]; for(let i=1;i<=30;i++) rs.push({id:'h'+i,customer_code:'AX',rma_no:'RMA#JS25'+String(i).padStart(4,'0'),rma_date:'2025-0'+(1+i%9)+'-10',qty:'1',part_number:'5002033',description:'MNT .75 CONDUIT',status:null,action:null,done_date:null,created_at:'2025-01-01'})
 rs.push({id:'c1',customer_code:'AX',rma_no:'RMA#JS260009',rma_date:'2026-11-04',qty:'1',part_number:'160021022',description:'CBL ASSY ANALYZER MAGNET',status:null,action:null,done_date:null,created_at:'2026-11-04'})
 rs.push({id:'c2',customer_code:'AX',rma_no:'RMA#JS260008',rma_date:'2026-09-16',qty:'20',part_number:'650200191',status:'조치중',action:'대체품 승인 요청 중',done_date:null,created_at:'2026-09-16'})
 rs.push({id:'c3',customer_code:'AX',rma_no:'RMA#JS260007',rma_date:'2026-09-09',qty:'2',part_number:'110228078',status:'완료',action:'재출하',done_date:'2026-09-20',created_at:'2026-09-09'})
 D.pm_customer_complaint=rs});
await p.click('a[href="/quality/complaints"]');await W(1500);
const kv=await p.$eval('[data-complaint-kpi-open]',e=>e.textContent);
ok(/미처리\s*2/.test(kv.replace(/\s+/g,' ')),'미처리 = 조치 중 1 + 올해 미입력 1 (예전 미입력은 안 셈)',kv);
ok(await p.$eval('[data-complaint-row="RMA#JS260008"] [data-complaint-status]',e=>/조치 중/.test(e.textContent)&&/일째/.test(e.textContent)),'조치 중 + 며칠째');
ok(await p.$eval('[data-complaint-row="RMA#JS260007"] [data-complaint-status]',e=>/완료/.test(e.textContent)&&/09\/20/.test(e.textContent)),'완료 + 완료일');
ok(await p.$eval('[data-complaint-row="RMA#JS260009"] [data-complaint-status]',e=>/미입력/.test(e.textContent)),'올해 건 미입력 표시');
// 가로 스크롤 막대가 화면 안
const sc=await p.$eval('[data-complaint-scroll]',e=>{const r=e.getBoundingClientRect();return {bottom:r.bottom,vh:innerHeight,sw:e.scrollWidth,cw:e.clientWidth,sh:e.scrollHeight,ch:e.clientHeight}});
await p.evaluate(()=>document.querySelector('[data-complaint-scroll]').scrollIntoView({block:'end'}));await W(200);
const sc2=await p.$eval('[data-complaint-scroll]',e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,vh:innerHeight}});
ok(sc.sw>sc.cw&&sc.sh>sc.ch&&sc2.bottom<=sc2.vh+1&&sc2.top>=0,'표가 화면 높이 안 — 가로 막대가 바로 보임 (표 안 세로 스크롤)',{sc,sc2});
await p.$eval('[data-complaint-scroll]',e=>e.scrollTop=400);await W(200);
const th=await p.$eval('[data-complaint-scroll] thead',e=>{const r=e.getBoundingClientRect(),s=e.closest('[data-complaint-scroll]').getBoundingClientRect();return Math.abs(r.top-s.top)});
ok(th<3,'아래로 내려도 머리줄 고정',th);
await p.screenshot({path:'/tmp/jsportal-test/out/shots/complaint_scroll.png'});
await p.$eval('[data-complaint-scroll]',e=>e.scrollTop=0);
// 미처리 KPI 누르면 그 건만
await p.click('[data-complaint-kpi-open]');await W(300);
ok(await p.locator('[data-complaint-row]').count()===2,'미처리 KPI → 2건만');
// 처리: 미입력 건 → 완료
await p.click('[data-complaint-row="RMA#JS260009"]');await W(300);
await p.click('[data-f-status="완료"]');await W(100);
ok(await p.inputValue('[data-f="done_date"]')!=='','완료 고르면 완료일 자동');
await p.fill('[data-f="action"]','대체품 승인 회신 받음');
await p.screenshot({path:'/tmp/jsportal-test/out/shots/complaint_form.png'});
await p.click('[data-complaint-save]');await W(1000);
const c1=await p.evaluate(()=>window.__S.DATA.pm_customer_complaint.find(x=>x.id==='c1'));
ok(c1.status==='완료'&&c1.done_date&&c1.action==='대체품 승인 회신 받음','저장 — 상태 · 완료일 · 조치 내용',c1);
ok(/미처리\s*1/.test((await p.$eval('[data-complaint-kpi-open]',e=>e.textContent)).replace(/\s+/g,' ')),'미처리 1 로 줄어듦');
// 상태 안 건드린 수정은 상태 칸을 보내지 않음
await p.click('[data-complaint-st="all"]');await W(200);
await p.click('[data-complaint-row="RMA#JS250001"]');await W(300);await p.fill('[data-f="note"]','x');await p.click('[data-complaint-save]');await W(800);
const h1=await p.evaluate(()=>window.__S.DATA.pm_customer_complaint.find(x=>x.id==='h1'));
ok(h1.note==='x'&&h1.status==null,'다른 칸만 고치면 상태는 그대로',h1);
// 새 접수 = 접수 상태
await p.click('[data-complaint-new]');await W(300);await p.fill('[data-f="part_number"]','120005809');await p.fill('[data-f="description"]','MOD IO');await p.click('[data-complaint-save]');await W(900);
const nw=await p.evaluate(()=>window.__S.DATA.pm_customer_complaint.find(x=>x.rma_no==='RMA#JS260010'));
ok(nw&&nw.status==='접수','새 접수는 「접수」 상태로',nw);
ok(!errs.length,'오류 없음',errs); console.log(`t144 ${pass}/${pass+fail}`); await b.close()})()
