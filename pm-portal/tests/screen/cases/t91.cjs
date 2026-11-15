// v4.162.0 — 판매 실적가 (하위 부품 · 단품) : 불러와 쓰기 · 경고 · 지금 계산가로 · 세부견적 고정 · 저장 때 기록
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const T=(p,s)=>p.$eval(s,e=>e.innerText.replace(/\s+/g,' ')).catch(()=>'');
const N=(t)=>Number(String(t).replace(/[^0-9.]/g,''));
const fl=(v)=>Math.floor(v/100)*100;
(async()=>{const b=await chromium.launch();const errs=[];
const open=async(q)=>{const p=await b.newPage({viewport:{width:1500,height:1100}});p.on('pageerror',e=>errs.push(e.message));
 await p.addInitScript(()=>{ window.print=()=>{}; try{localStorage.removeItem('quote_detail_pref')}catch{} });
 await p.goto('http://localhost:8765/app.html?qsup=buy'+q+'&r='+encodeURIComponent('/sales-quote'));await p.waitForTimeout(2000);
 await p.click('button:has-text("✍ 견적 작성")');await p.waitForTimeout(1200);
 const pn=p.locator('input[placeholder="품번 입력 (ASSY·단품 자동 판별)"]'); await pn.fill('990000001'); await pn.press('Enter'); await p.waitForTimeout(1800); return p};
const tr='.qs-edit tbody tr.align-top'
const price=(p,i=0)=>p.$$eval(`${tr} td:nth-child(7) input`,(a,i)=>Number(a[i].value),i)
console.log('① 실적가 있음 — HOSE 부품 90,000 고정')
let p=await open('&salep=1')
await p.fill(`${tr} td:nth-child(12) input`,'100,000'); await p.waitForTimeout(600)
const BODY=1250000/0.8, HOSEc=68400/0.65, LAB=100000/0.75
let up=await price(p); console.log('    단가',up)
ok(up===fl(BODY+90000+LAB),'ASSY 단가 = BODY 계산가 + HOSE 실적가 90,000 + 작업비',[up,fl(BODY+90000+LAB)])
const tag=await T(p,'[data-sale-assy]'); ok(/판매 실적가 부품 1\/1/.test(tag)&&/마진 낮음 1/.test(tag),'줄 표시 「판매 실적가 부품 1/1 · ⚠ 마진 낮음 1」 (BODY 세부 미제출 값은 안 씀)',tag)
ok(!await p.$('[data-sale-missing]'),'표 없음 안내 없음')
await p.click('[data-sale-assy]'); await p.waitForTimeout(300)
const cell='[data-sale-part="AX-GHOSE01"]'
ok(await p.$eval(cell+' [data-sale-prev]',e=>e.dataset.salePrev)==='on','부품표 「판매 실적가」 칸 — HOSE 켜짐')
ok(await p.$eval(cell+' [data-sale-warn]',e=>e.dataset.saleWarn)==='low','지금 매입가 68,400 기준 마진 24% → ⚠ 마진 낮음')
ok(/90,000/.test(await T(p,cell))&&/2026-10-01/.test(await T(p,cell))&&/990000777/.test(await T(p,cell)),'값 · 날짜 · 다른 ASSY 세부였음 표시',await T(p,cell))
await p.screenshot({path:'t91_parts.png'})
console.log('② 지금 계산가로 → 다시 실적가로')
await p.click(cell+' [data-sale-toggle]'); await p.waitForTimeout(300)
up=await price(p); ok(up===fl(BODY+HOSEc+LAB)&&await p.$eval(cell+' [data-sale-prev]',e=>e.dataset.salePrev)==='off','지금 계산가로 — 구간 마진 계산',[up,fl(BODY+HOSEc+LAB)])
await p.click(cell+' [data-sale-toggle]'); await p.waitForTimeout(300)
up=await price(p); ok(up===fl(BODY+90000+LAB),'실적가로 되돌림',up)
console.log('③ 세부견적 — 실적가 부품은 고정 · 네고는 나머지가 맞춤')
await p.check('[data-quote-detail]'); await p.waitForTimeout(300)
let rows=await p.$$eval('[data-qd-row]',a=>a.map(e=>[...e.children].map(c=>c.innerText.trim())))
const hose=()=>rows.find(r=>r[1]==='AX-GHOSE01')
ok(hose()&&N(hose()[5])===90000,'세부 HOSE 90,000',rows)
ok(N(await T(p,'[data-qd-total]'))===up,'합계 = 견적 단가')
await p.fill(`${tr} td:nth-child(7) input`,'2000000'); await p.waitForTimeout(300)
rows=await p.$$eval('[data-qd-row]',a=>a.map(e=>[...e.children].map(c=>c.innerText.trim())))
ok(N(hose()[5])===90000&&N(await T(p,'[data-qd-total]'))===2000000,'네고 2,000,000 — HOSE 90,000 그대로 · 합계 맞음',rows)
console.log('④ 단품 — 매입가 없어도 실적가 5,000')
const pn=p.locator('input[placeholder="품번 입력 (ASSY·단품 자동 판별)"]'); await pn.fill('GK0001'); await pn.press('Enter'); await p.waitForTimeout(1500)
const up2=await price(p,1); ok(up2===5000,'단품 단가 5,000',up2)
ok(/5,000/.test(await p.$$eval(`${tr}`,(a)=>a[1].innerText))&&!!await p.$(`${tr}:nth-of-type(2) [data-sale-prev="on"], [data-sale-prev="on"]`),'단품 줄 실적가 표시')
ok(await price(p,0)===2000000,'새 줄 넣어도 손으로 고친 ASSY 단가 그대로',await price(p,0))
console.log('⑤ 저장 → 실적가 기록')
await p.fill('input[placeholder="고객사 이름"]','AXCELIS').catch(()=>{})
await p.click('button:has-text("💾 저장")'); await p.waitForTimeout(2000)
const H=await p.evaluate(()=>window.__S.DATA.pm_sale_price_hist.filter(h=>h.quote_no==='S261109-001').map(h=>({k:h.code_key,kind:h.kind,pr:h.unit_price,ds:h.detail_sent,par:h.parent_code,ck:h.cust_key,cur:h.currency})))
console.log('    ',JSON.stringify(H))
ok(H.length===4,'4줄 (ASSY · 단품 · 부품 2)',H.length)
ok(H.some(h=>h.k==='AX-990000001'&&h.kind==='assy'&&h.pr===2000000),'ASSY 줄 2,000,000')
ok(H.some(h=>h.k==='AX-GK0001'&&h.kind==='item'&&h.pr===5000&&h.ds),'단품 5,000')
ok(H.some(h=>h.k==='AX-GHOSE01'&&h.kind==='part'&&h.pr===90000&&h.ds===true&&h.par==='AX-990000001'),'HOSE 부품 90,000 · 세부견적 제출 · 상위 ASSY')
ok(H.every(h=>h.ck==='cid-ax'&&h.cur==='KRW'),'고객사 · 통화')
await p.close()
console.log('⑥ SQL 전 — 안내만, 계산은 예전 그대로')
p=await open('')
await p.fill(`${tr} td:nth-child(12) input`,'100,000'); await p.waitForTimeout(600)
up=await price(p); ok(up===fl(BODY+HOSEc+LAB),'예전 계산',[up,fl(BODY+HOSEc+LAB)])
ok(!!await p.$('[data-sale-missing]'),'「판매 실적가 표가 아직 없습니다」 안내')
ok(errs.length===0,'화면 오류 없음',errs)
console.log(`\nt91 ${pass}/${pass+fail}`);await b.close();process.exit(fail?1:0)})();
