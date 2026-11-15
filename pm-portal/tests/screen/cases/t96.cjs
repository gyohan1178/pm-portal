// v4.167.1 — 기준코드 DB 구매처 일괄변경
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const SHOT='/tmp/jsportal-test/out/shots/';
(async()=>{const b=await chromium.launch();const errs=[];
const p=await b.newPage({viewport:{width:1440,height:900}});p.on('pageerror',e=>errs.push(e.message))
await p.goto('http://localhost:8765/app.html?r='+encodeURIComponent('/master/items'));await p.waitForTimeout(1800)
await p.evaluate(()=>{ const I=window.__S.DATA.items; I.find(i=>i.id==='p1').vendor_id='v1'; I.find(i=>i.id==='p2').vendor_id='v1' })
await p.click('button:has-text("일괄수정")'); await p.waitForTimeout(300)
ok(!!await p.$('[data-bulk-vendor] select'),'일괄수정에 구매처 칸')
const opts=await p.$$eval('[data-bulk-vendor] option',a=>a.map(o=>o.textContent))
ok(opts.includes('로이코')&&opts.includes('구매처 비우기'),'협력사 목록 · 비우기',opts)
const cbs=p.locator('tbody input[type=checkbox]'); const n=await cbs.count()
for(let i=0;i<n;i++){ const t=await cbs.nth(i).evaluate(e=>e.closest('tr').innerText); if(/AX-5100052|AX-6200111/.test(t)) await cbs.nth(i).check() }
await p.selectOption('[data-bulk-vendor] select','v2'); await p.waitForTimeout(100)
await p.click('button:has-text("일괄수정"):has-text("선택")'); await p.waitForTimeout(400)
const dlg=await p.$eval('[role="dialog"]',e=>e.innerText.replace(/\s+/g,' ')).catch(()=>'')
ok(/구매처를 「로이코」/.test(dlg)&&/지금 .+ · 2건/.test(dlg),'확인 창 — 바뀔 구매처 · 지금 구매처별 건수',dlg)
await p.screenshot({path:SHOT+'items_bulk_vendor.png'})
await p.click('[data-confirm-ok]'); await p.waitForTimeout(900)
const v=await p.evaluate(()=>window.__S.DATA.items.filter(i=>['p1','p2'].includes(i.id)).map(i=>i.vendor_id))
ok(v.join()==='v2,v2','DB — 두 품목 구매처 로이코',v)
ok(await p.evaluate(()=>window.__S.DATA.items.find(i=>i.id==='a1').vendor_id!=='v2'),'고르지 않은 품목은 그대로')
console.log(errs.length?errs:'  페이지 오류 없음'); ok(!errs.length,'페이지 오류 0')
console.log(`t96 ${pass}/${pass+fail}`); await b.close()})()
