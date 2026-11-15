// v4.98.0 ⑬ — 협력사 변경 납기 · 독촉 · 주간업무 B안 · 입고 단가 경고 · 성적표
//   v4.108.0 — 받을 날(변경 납기 > 요청 납기) 기준으로 바뀜: 변경 납기를 받으면 그날까지 지연이 아님
const {chromium}=require('playwright');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();
const page=async(r,w=1440)=>{const p=await b.newPage({viewport:{width:w,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.goto(`${base}?d13=1&r=${encodeURIComponent(r)}`);await p.waitForTimeout(1600);return {p,errs}};
{const {p,errs}=await page('/customer/ax/purchase');
 const kpiNum=async()=>(await p.textContent('[data-po-kpi] > div:nth-child(2)')).replace(/\s+/g,'')
 let kpi=await kpiNum(); ok(/납기지연i?1받을날지남·그중변경납기도지남0/.test(kpi),'KPI 납기 지연 1 (변경 납기 받은 건은 빠짐)',kpi);
 ok(await p.locator('[data-due-filter="chase"]').count()===0,'「독촉」 단추 없음 (지남과 같아짐)');
 const over=await p.textContent('[data-due-filter="over"]'), vchg=await p.textContent('[data-due-filter="vchg"]'); ok(/1/.test(over)&&/1/.test(vchg),'납기 필터 지남 1 · 변경 약속 1',[over,vchg]);
 await p.click('[data-due-filter="over"]'); await p.waitForTimeout(200);
 let pns=await p.$$eval('tbody tr',trs=>trs.map(t=>t.textContent).filter(t=>/JS-26/.test(t)).map(t=>t.match(/JS-\d{6}-\d{2}/)[0])); ok(pns.join()==='JS-261008-03','지남 = 변경 납기 없는 지연 1건',pns);
 await p.click('[data-due-filter="vchg"]'); await p.waitForTimeout(200);
 pns=await p.$$eval('tbody tr',trs=>trs.map(t=>t.textContent).filter(t=>/JS-26/.test(t)).map(t=>t.match(/JS-\d{6}-\d{2}/)[0])); ok(pns.join()==='JS-261009-01','변경 약속 = 변경 납기가 아직 안 온 1건',pns);
 const r3=await p.textContent('tr:has-text("JS-261009-01")'); ok(/진행중 · 변경 납기/.test(r3)&&/요청 10-20/.test(r3)&&/2099-11-04/.test(r3),'변경 납기 받은 줄: 위 날짜 = 변경 납기 · 아래 요청 10-20 · 상태 「진행중 · 변경 납기」',r3.replace(/\s+/g,' ').slice(0,200));
 await p.click('[data-due-filter=""]'); await p.waitForTimeout(200);
 ok(/지연 · 독촉/.test(await p.textContent('tr:has-text("JS-261008-03")')),'변경 납기 없는 지난 줄 = 「지연 · 독촉」');
 // 정렬: 받을 날 순 — 10-21(지연) · 11-03 · 2099
 let ord=await p.$$eval('tbody tr',trs=>trs.map(t=>t.textContent).filter(t=>/JS-26/.test(t)).map(t=>t.match(/JS-\d{6}-\d{2}/)[0])); ok(ord.join()==='JS-261008-03,JS-261020-01,JS-261009-01','기본 차례 = 받을 날 순',ord);
 // 한 줄 변경 납기
 await p.click('tr:has-text("JS-261008-03") [data-vendor-date]'); await p.waitForTimeout(300);
 ok(await p.locator('[data-due-dialog]').count()===1,'「＋ 변경 납기」로 창 열림');
 await p.fill('[data-due-date]','2099-11-10'); await p.click('[data-due-save]'); await p.waitForTimeout(400);
 ok(await p.locator('[data-due-dialog]').count()===1,'사유 없으면 저장 안 됨 (창 그대로)');
 await p.click('button:has-text("운송 · 통관 지연")'); await p.click('[data-due-save]'); await p.waitForTimeout(800);
 const po2=await p.evaluate(()=>window.__S.DATA.purchase_orders.find(x=>x.id==='po2')); ok(po2.vendor_date==='2099-11-10'&&po2.promise_date==='2026-10-21','변경 납기 저장 · 요청 납기 그대로',po2);
 await p.waitForTimeout(300); kpi=await kpiNum(); ok(/납기지연i?0/.test(kpi),'변경 납기 넣자마자 지연 0',kpi);
 const log=await p.evaluate(()=>window.__S.DATA.pm_po_date_log); ok(log.length===1&&log[0].kind==='협력사 변경'&&log[0].reason==='운송 · 통관 지연','이력 남음',log);
 // 일괄: 우리 필요일 변경
 await p.click('tr:has-text("JS-261020-01") input[type=checkbox]'); await p.waitForTimeout(200);
 await p.click('[data-po-due-btn]'); await p.waitForTimeout(300);
 await p.click('[data-due-kind="need"]'); await p.fill('[data-due-date]','2026-11-20'); await p.fill('[data-due-why]','고객사 일정 연기'); await p.click('[data-due-save]'); await p.waitForTimeout(800);
 const po1=await p.evaluate(()=>window.__S.DATA.purchase_orders.find(x=>x.id==='po1')); ok(po1.promise_date==='2026-11-20'&&!po1.vendor_date,'우리 필요일 변경 = 요청 납기 바뀜',po1);
 // 성적표
 await p.click('[data-po-score-btn]'); await p.waitForTimeout(500);
 ok(await p.locator('[data-score-row="로이코"]').count()===1 && /83%/.test(await p.textContent('[data-score-row="로이코"]')),'협력사 성적표 — 로이코 준수율 83%');
 ok(!errs.length,'오류 없음',errs); await p.screenshot({path:'v98_purchase.png'}); await p.close();}
// 편집 폼 — 요청 납기 바꾸면 사유 필수
{const {p,errs}=await page('/customer/ax/purchase');
 await p.click('tr:has-text("JS-261008-03") button:has-text("수정")').catch(()=>{});
 await p.waitForTimeout(400);
 const has=await p.locator('[data-po-promise]').count();
 if (has) { await p.fill('[data-po-promise]','2026-12-01'); await p.waitForTimeout(200); ok(await p.locator('[data-po-need-reason]').count()===1,'편집에서 요청 납기 바꾸면 사유 칸 나옴') }
 else ok(false,'편집 폼 열기');
 await p.close();}
// 입고 — 변경 납기 · 단가 경고
{const {p,errs}=await page('/inbound');
 const vd=await p.locator('[data-inb-vendor-date]').count(); ok(vd>=1,'입고 화면에 변경 납기 표시',vd);
 await p.click('tr:has-text("JS-261008-03") input[type=checkbox]').catch(()=>{}); await p.waitForTimeout(300);
 const gap=await p.$$eval('[data-inb-price-gap]',els=>els.map(e=>e.dataset.inbPriceGap)); ok(gap.includes('30'),'단가 65 vs 직전 50 → ▲30% 경고',gap);
 ok(!errs.length,'오류 없음',errs); await p.close();}
// 주간업무 B안
{const {p,errs}=await page('/weekly');
 const g=await p.$$eval('[data-wk-delay-group]',els=>els.map(e=>e.dataset.wkDelayGroup+':'+(e.textContent.match(/(\d+)건/)||[])[1]));
 ok(g.join()==='1:1,2:1','지연 2건 = ① 독촉 필요 1 (변경 없음) · ② 변경 납기도 지남 1 — 변경 납기가 아직 안 온 건은 빠짐',g);
 ok(/독촉 1 · 변경 납기도 지남 1/.test(await p.textContent('body')),'KPI 카드에 독촉 · 변경 납기도 지남');
 ok(!errs.length,'오류 없음',errs); await p.screenshot({path:'v98_weekly.png',fullPage:true}); await p.close();}
console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
