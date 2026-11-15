// v4.181.0 — 고객사 불만 접수 · 견적서 로고
const {chromium}=require('playwright'); const ExcelJS=require('/tmp/jsportal-test/repo/node_modules/exceljs');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1500,height:1000}});p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8765/app.html?r=/');await p.waitForTimeout(1000);
await p.evaluate(()=>{const D=window.__S.DATA; D.pm_customer_complaint=[
 {id:'c1',customer_code:'AX',rma_no:'RMA#JS260009',rma_date:'2026-11-04',qty:'1',part_number:'160021022',description:'CBL ASSY ANALYZER MAGNET',case_id:'CAS-140696-G7D6Z6',disposition:'RETURN',ccn:'K',created_at:'2026-11-04'},
 {id:'c2',customer_code:'AX',rma_no:'RMA#JS250009',rma_date:'2025-12-10',qty:'58',part_number:'5002033',description:'MNT .75 CONDUIT',disposition:'Return',ccn:'B',reason:'제품 불량',created_at:'2025-12-10'}];
 D.items.push({id:'ax9',std_code:'AX-120005809',name:'MOD IO CONTROLLER',unit:'EA'});});
await p.click('a[href="/quality/complaints"]');await p.waitForTimeout(1500);
ok(/고객사 불만 접수/.test(await p.textContent('main')),'품질 › 고객사 불만 접수 화면');
ok(await p.locator('[data-complaint-row]').count()===2,'기존 2건');
ok(/RETURN/.test(await p.textContent('[data-complaint-row="RMA#JS260009"]')),'대문자 RETURN 도 그대로 보임');
await p.click('[data-complaint-new]');await p.waitForTimeout(300);
ok(await p.$eval('[data-f="rma_no"]',e=>e.value)==='RMA#JS260010','RMA 번호 자동 (올해 다음 번호)');
ok(await p.$eval('[data-f="vendor_id"]',e=>e.value)==='6105020'&&await p.$eval('[data-f="resp_site"]',e=>e.value)==='JINSUNTECH CO LTD','Vendor ID · 사이트 기본값');
await p.fill('[data-f="part_number"]','120005809');await p.click('[data-f="case_id"]');await p.waitForTimeout(600);
ok(await p.$eval('[data-f="description"]',e=>e.value)==='MOD IO CONTROLLER','품번 → 품명 자동');
await p.fill('[data-f="case_id"]','CAS-139295-Y6R8C6');await p.fill('[data-f="qty"]','1');await p.selectOption('[data-f="disposition"]','Return');await p.selectOption('[data-f="ccn"]','K');
await p.screenshot({path:'cmp_form.png'});
await p.click('[data-complaint-save]');await p.waitForTimeout(1200);
const D=await p.evaluate(()=>window.__S.DATA.pm_customer_complaint);
const n=D.find(x=>x.rma_no==='RMA#JS260010');
ok(n&&n.customer_code==='AX'&&n.part_number==='120005809'&&n.description==='MOD IO CONTROLLER'&&n.case_type==='INTR','저장 — 양식 그대로',n);
ok(await p.locator('[data-complaint-row]').count()===3,'목록에 추가');
await p.selectOption('[data-complaint-year]','25');await p.waitForTimeout(300);
ok(await p.locator('[data-complaint-row]').count()===1,'연도 거르기');
await p.selectOption('[data-complaint-year]','all');
const [dl]=await Promise.all([p.waitForEvent('download'),p.click('[data-complaint-excel]')]);const f='/tmp/jsportal-test/out/t112.xlsx';await dl.saveAs(f);
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(f);const ws=wb.worksheets[0];
const hdr=ws.getRow(2).values.slice(1);ok(hdr.join('|')==='YY|DATE|RMA NO|Vendor ID|CASE_RESP_SITE_NAME|CASE_ID|CASE_PART_QTY|PART_NUMBER|DESCRIPTION|CASE_TYPE_LVL2|Disposition|CCN|사유|비고','엑셀 머리글 = 양식',hdr);
ok(ws.getRow(3).getCell(3).value==='RMA#JS250009'&&ws.getRow(5).getCell(3).value==='RMA#JS260010','엑셀 날짜순');
// 수정
await p.click('[data-complaint-row="RMA#JS250009"]');await p.fill('[data-f="note"]','본사 리워크');await p.click('[data-complaint-save]');await p.waitForTimeout(800);
ok((await p.evaluate(()=>window.__S.DATA.pm_customer_complaint.find(x=>x.id==='c2').note))==='본사 리워크','수정 저장');
await p.screenshot({path:'cmp_list.png'});
// 견적서 로고
await p.click('a[href="/sales-quote"]');await p.waitForTimeout(1500);await p.click('button:has-text("✍ 견적 작성")');await p.waitForTimeout(1200);
ok(await p.locator('[data-quote-logo]').count()>=1,'매출 견적서에 로고');
await p.waitForTimeout(500);
ok(await p.locator('[data-quote-seal]').count()>=1,'직인 파일 있으면 보임');await p.locator('[data-quote-title]').scrollIntoViewIfNeeded();await p.screenshot({path:'brand.png'});
ok(!errs.length,'페이지 오류 없음',errs);
console.log(`\n${pass} 통과 / ${fail} 실패`);await b.close();process.exit(fail?1:0)})();
