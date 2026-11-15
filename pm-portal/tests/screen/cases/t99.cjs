// v4.170.0 — 수주대장: 자재 요청한 줄에 「🙋 자재요청됨 / 일부 불출 / 요청 불출완료」 표시
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const W=(ms)=>new Promise(r=>setTimeout(r,ms));
const SHOT='/tmp/jsportal-test/out/shots/';
const A='47894KF|2/1', B='PO2610000242|1/1', TA='수주 PO 47894KF · 2/1', TB='수주 PO PO2610000242 · 1/1'
;(async()=>{const b=await chromium.launch();const errs=[];
const run=async(pre)=>{const p=await b.newPage({viewport:{width:1500,height:1000}});p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(()=>{try{localStorage.setItem('pm_coach_seen_orders-sales','1')}catch{}});
  await p.goto(`http://localhost:8765/app.html?fastx=1&me=${encodeURIComponent(JSON.stringify({name:'이정민',dept:'영업',role:'user'}))}&r=${encodeURIComponent('/orders')}`);await W(2200)
  await p.evaluate((pre)=>{const S=window.__S; S.DATA.pm_material_request=pre;
    S.RPCFN.pm_request_create=({p_rows})=>{p_rows.forEach((r)=>S.DATA.pm_material_request.push({id:'mrx'+S.DATA.pm_material_request.length,req_no:'MR-T'+(S.DATA.pm_material_request.length+1),status:'요청',issued_qty:0,created_at:new Date().toISOString(),...r}));return {data:p_rows.length}}},pre)
  return p}
const tag=(p,k)=>p.$eval(`[data-row="${k}"] [data-mr-tag]`,e=>[e.dataset.mrTag,e.textContent.trim(),e.title]).catch(()=>null)
const submit=async(p,k)=>{ await p.check(`[data-check="${k}"]`); await W(200); await p.click('[data-bulk-mr]'); await W(800); await p.click('[data-mr-submit]'); await W(1500) }
// ① 요청 · 일부 불출
let p=await run([{id:'m2',req_no:'MR-10',status:'요청',reason:TB,qty:11,issued_qty:4,created_at:'2026-11-09'}])
ok(await tag(p,A)===null,'요청 전 — 표시 없음')
await submit(p,A)
let t=await tag(p,A); ok(t&&t[0]==='req'&&/자재요청됨/.test(t[1]),'요청하면 바로 「🙋 자재요청됨」',t)
t=await tag(p,B); ok(t&&t[0]==='partial'&&/일부 불출/.test(t[1])&&/MR-10/.test(t[2]),'일부 불출 — 「🙋 요청 일부 불출」 · 마우스 올리면 요청 번호',t)
await p.screenshot({path:SHOT+'order_mr_tag.png',clip:{x:240,y:640,width:1260,height:260}}); await p.close()
// ② 불출완료 · 반려는 빼기
p=await run([{id:'m1',req_no:'MR-9',status:'완료',reason:TB,qty:3,issued_qty:3,created_at:'2026-11-09'},{id:'m3',req_no:'MR-11',status:'반려',reason:TA,qty:1,issued_qty:0,created_at:'2026-11-09'}])
await submit(p,A)
t=await tag(p,B); ok(t&&t[0]==='done'&&/불출완료/.test(t[1]),'완료된 요청 — 「🙋 요청 불출완료」',t)
t=await tag(p,A); ok(t&&t[0]==='req'&&!/ 2$/.test(t[1]),'반려된 예전 요청은 세지 않음 (새 요청 1건만)',t)
ok(!errs.length,'오류 없음',errs); console.log(`t99 ${pass}/${pass+fail}`); await b.close()})()
