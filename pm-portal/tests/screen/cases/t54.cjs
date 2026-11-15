const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const ITEMS=[['VM-309-1701-007','Generator Rack Side Cover with Window',107692],['VM-309-1701-008','Generator Rack Side Cover with Window',107692],['VM-309-1702-021','Generator Rack Front Cover3',23077],['VM-309-1702-023','Generator Rack Front Cover1',46154],['VM-313-0023-076','Generator PCW Module Fix Bracket 3',76923],['VM-313-0023-077','Generator PCW Module Fix Bracket 4',76923],['VM-318-1701-001','Generator Rack Side Window Cover',23077],['VM-501-0148-193','SS-PB8TA8PM8-52CM-RD',189333],['VM-501-0148-194','SS-PB8TA8PM8-45CM-RD',216000],['VM-501-0148-195','SS-PB8TA8PM8-70CM-RD',240000],['VM-501-0148-196','SS-PB8TA8PM8-21CM-BL',200000],['VM-501-0148-197','SS-PB8TA8PM8-25CM-BL',200000],['VM-501-0148-198','SS-PB8TA8PM8-50CM-BL',224000]];
const N=+(process.env.N||13), OUT=process.env.OUT||'q13', MODE=process.env.MODE||'auto';
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1500,height:1100}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(()=>{ window.__pr=0; window.print=()=>{ window.__pr++ } });
await p.goto('http://localhost:8765/app.html?r='+encodeURIComponent('/sales-quote'));await p.waitForTimeout(2000);await p.click('button:has-text("✍ 견적 작성")');await p.waitForTimeout(1200);
await p.fill('input[placeholder="고객사 이름"]','VM'); await p.fill('input[placeholder="담당자명"]','최우석TL님');
await p.fill('input[placeholder="RFQ_110228078"]','Leo NK I-C (EP3A18-EP3A22)');
for(let i=0;i<N;i++){ const it=ITEMS[i%ITEMS.length]; await p.click('button:has-text("+ 빈 줄")'); }
await p.waitForTimeout(300);
const rows=await p.$$('.qs-edit tbody > tr.align-top'); ok(rows.length===N,'줄 수',rows.length);
for(let i=0;i<N;i++){ const it=ITEMS[i%ITEMS.length]; const td=await rows[i].$$(':scope > td');
  await (await td[1].$('input')).fill(it[0]); await (await td[2].$('input')).fill(process.env.LONG?(it[1]+' / ').repeat(4):it[1]); await (await td[6].$('input')).fill(String(it[2])); }
await p.fill('input[placeholder="특이사항"]','스웨즈락(Swagelok)의 다목적 푸쉬온(Push-On) PB 시리즈 장납기');
if(process.env.EN){ await p.click(process.env.EN); await p.waitForTimeout(300) }
if(MODE!=='auto') await p.selectOption('[data-quote-print-mode]',MODE);
const label=await p.textContent('[data-quote-print]'); console.log('btn',label.trim());
ok(await p.isHidden('[data-quote-split]'),'화면에서는 갑을지 안 보임');
await p.click('[data-quote-print]'); await p.waitForTimeout(200);
const cls=await p.evaluate(()=>document.body.className); console.log('body',cls);
await p.pdf({path:OUT+'.pdf',landscape:true,format:'A4',printBackground:true,preferCSSPageSize:true});
const info=await p.evaluate(()=>({summary:document.querySelector('[data-qs-summary]')?.innerText.replace(/\s+/g,' '), coverTotal:document.querySelector('[data-qs-cover-total]')?.innerText, rows:document.querySelectorAll('[data-qs-row]').length, sheets:document.querySelectorAll('[data-qs-sheet]').length, total:document.querySelector('[data-qs-total]')?.innerText}));
console.log(JSON.stringify(info));
if(cls.includes('qs-split')){ ok(info.rows===N,'을지 줄 수 = 품목 수',info.rows); ok(info.total===info.coverTotal,'갑지 합계 = 을지 합계',[info.total,info.coverTotal]);
  if(N>1) ok(info.summary.includes(`외 ${N-1}건`)&&info.summary.includes(`총 ${N}품목`),'갑지 요약줄',info.summary) }
await p.evaluate(()=>window.dispatchEvent(new Event('afterprint'))); await p.waitForTimeout(100);
ok(!/qs-split|printing-quote/.test(await p.evaluate(()=>document.body.className)),'인쇄 후 클래스 정리');
ok(errs.length===0,'오류 없음',errs);
console.log(`\nt54 ${pass}/${pass+fail}`);await b.close();process.exit(fail?1:0)})();
