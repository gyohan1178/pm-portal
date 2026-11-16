// v4.203.1 — 수주대장 → 자재 요청: 구매자재 회신 코멘트가 요청 사유에 같이 남음 · 다시 요청 확인 · 📦 표시 유지
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const W=(ms)=>new Promise(r=>setTimeout(r,ms));
const SHOT='/tmp/jsportal-test/out/shots/';
const A='47894KF|2/1', TA='수주 PO 47894KF · 2/1'
;(async()=>{const b=await chromium.launch();const errs=[];
const p=await b.newPage({viewport:{width:1500,height:1000}});p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(()=>{try{localStorage.setItem('pm_coach_seen_orders-sales','1')}catch{}});
await p.goto(`http://localhost:8765/app.html?fastx=1&me=${encodeURIComponent(JSON.stringify({name:'이정민',dept:'영업',role:'user'}))}&r=${encodeURIComponent('/orders')}`);await W(2200)
await p.evaluate(()=>{const S=window.__S; S.DATA.pm_material_request=[];
  S.RPCFN.pm_request_create=({p_rows})=>{p_rows.forEach((r)=>S.DATA.pm_material_request.push({id:'mrx'+S.DATA.pm_material_request.length,req_no:'MR-T'+(S.DATA.pm_material_request.length+1),status:'요청',issued_qty:0,created_at:new Date().toISOString(),...r}));return {data:p_rows.length}}})
await p.check(`[data-check="${A}"]`); await W(200); await p.click('[data-bulk-mr]'); await W(900)
const cmt=await p.$eval('[data-mr-cmt]',e=>e.value).catch(()=>null)
ok(cmt&&/구매자재 회신 조건부/.test(cmt)&&/EFEM 판금 11\/27 입고/.test(cmt),'요청 창에 구매자재 회신 코멘트가 자동으로 들어옴',cmt)
await p.screenshot({path:SHOT+'order_mr_cmt.png'})
await p.click('[data-mr-submit]'); await W(1500)
const rs=await p.evaluate(()=>window.__S.DATA.pm_material_request.map(r=>r.reason))
ok(rs.length===1&&rs[0].startsWith(TA+' ‖ 구매자재 회신 조건부')&&/EFEM 판금/.test(rs[0]),'요청 사유 = 수주 PO 태그 ‖ 회신 코멘트',rs)
const t=await p.$eval(`[data-row="${A}"] [data-mr-tag]`,e=>[e.dataset.mrTag,e.textContent.trim()]).catch(()=>null)
ok(t&&t[0]==='req','코멘트가 붙어도 수주대장 「자재요청됨」 표시 유지',t)
await p.check(`[data-check="${A}"]`).catch(()=>{}); await W(200); await p.click('[data-bulk-mr]'); await W(1200)
const prev=await p.$eval('[data-mr-prev]',e=>e.textContent).catch(()=>null)
ok(prev&&/MR-T1/.test(prev),'같은 줄 다시 요청 — 「이미 요청」 경고 유지',prev)
ok(!errs.length,'오류 없음',errs); console.log(`t143 ${pass}/${pass+fail}`); await b.close()})()
