// v4.163.0 — 매출견적 「🏷 판매 실적가」 탭
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const T=(p,s)=>p.$eval(s,e=>e.innerText.replace(/\s+/g,' ')).catch(()=>'');
(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1500,height:1000}});p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8765/app.html?qsup=1&salep=1&r='+encodeURIComponent('/sales-quote'));await p.waitForTimeout(2000)
await p.click('[data-sq-tab="price"]'); await p.waitForTimeout(1500)
ok(!!await p.$('[data-sale-board]'),'탭 열림')
const kpi=await T(p,'[data-sale-kpi]'); console.log('   ',kpi)
ok(/실적가 품목 2/.test(kpi),'실적가 품목 2 (HOSE · GK0001 — BODY 미제출 부품은 기록만)',kpi)
ok(/마진 낮음 · 적자 1/.test(kpi),'경고 1 (HOSE 90,000 vs 매입 68,400)',kpi)
const hose=await T(p,'[data-sale-row="AX-GHOSE01"]'); ok(/90,000/.test(hose)&&/S261001-003/.test(hose)&&/990000777 세부/.test(hose),'HOSE = 최근 견적 90,000 (25년 단가표 80,000 아님)',hose)
ok(await p.$eval('[data-sale-row="AX-GHOSE01"] [data-sale-margin]',e=>e.dataset.saleMargin)==='low','지금 마진 ⚠')
const body=await T(p,'[data-sale-row="AX-GBODY01"]'); ok(/기록만/.test(body),'BODY — 기록만 (안 씀)',body)
ok(await p.$$eval('[data-sale-row]',a=>a.length)===3,'원화 3줄 (USD 줄 · ASSY 줄 빠짐)')
await p.click('[data-sale-hist="AX-GHOSE01"]'); await p.waitForTimeout(200)
ok(await p.$$eval('[data-sale-histrow]',a=>a.length)===2,'이력 2건')
await p.click('[data-sale-warnonly]'); await p.waitForTimeout(300)
ok(await p.$$eval('[data-sale-row]',a=>a.length)===1,'⚠만 → 1줄'); await p.click('[data-sale-warnonly]')
await p.click('[data-sale-cur="USD"]'); await p.waitForTimeout(300)
ok(/12\.50/.test(await T(p,'[data-sale-row="AX-GK0002"]')),'USD 12.50')
await p.click('[data-sale-cur="KRW"]'); await p.click('[data-sale-kind="assy"]'); await p.waitForTimeout(300)
ok(/1,500,000/.test(await T(p,'[data-sale-row="AX-990000777"]')),'ASSY 견적가 (참고)')
await p.click('[data-sale-kind="use"]'); await p.waitForTimeout(300)
console.log('② 고치기')
await p.click('[data-sale-hist="AX-GHOSE01"]').catch(()=>{}); await p.waitForTimeout(200)
if(!await p.$('[data-sale-histrow]')) { await p.click('[data-sale-hist="AX-GHOSE01"]'); await p.waitForTimeout(200) }
await p.click('[data-sale-edit="sp1"]'); await p.waitForTimeout(200)
await p.fill('[role="dialog"] input, .fixed input[type=number]','95000'); await p.click('[data-confirm-ok]'); await p.waitForTimeout(1000)
ok(await p.evaluate(()=>window.__S.DATA.pm_sale_price_hist.find(r=>r.id==='sp1').unit_price)===95000,'DB 95,000')
ok(/95,000/.test(await T(p,'[data-sale-row="AX-GHOSE01"]')),'화면 갱신')
console.log('③ 지우기 → 전 값으로')
await p.click('[data-sale-del="sp1"]'); await p.waitForTimeout(200); await p.click('[data-confirm-ok]'); await p.waitForTimeout(1000)
ok(/80,000/.test(await T(p,'[data-sale-row="AX-GHOSE01"]'))&&/단가표/.test(await T(p,'[data-sale-row="AX-GHOSE01"]')),'지우면 25년 단가표 80,000 이 실적가',await T(p,'[data-sale-row="AX-GHOSE01"]'))
await p.screenshot({path:'t92.png',fullPage:false})
ok(errs.length===0,'오류 없음',errs)
console.log(`\nt92 ${pass}/${pass+fail}`);await b.close();process.exit(fail?1:0)})();
