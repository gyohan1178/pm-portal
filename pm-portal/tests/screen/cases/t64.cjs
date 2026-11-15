// v4.137.0 — 미불출 일괄 입력 · 해제
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1500,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto(`http://localhost:8765/app.html?pt=1&mbulk=1&r=${encodeURIComponent('/production/AX')}`);await p.waitForTimeout(2200)
const mp=async(id)=>p.evaluate((id)=>window.__S?window.__S.DATA.production.find(x=>x.id===id).missing_parts:null,id)
ok(await p.$eval('[data-bulk-missing-open]',e=>e.matches(':disabled')),'아무것도 안 고르면 버튼 흐리게 (v4.151 자리 고정)')
for (const h of ['#71','#72','#73','#74']) { const row=p.locator('tbody tr',{hasText:h}).filter({hasText:'110158840'}).first(); await row.locator('td').first().click() }
await p.waitForTimeout(300)
ok(/4건 선택/.test(await p.textContent('body')),'4건 선택')
await p.click('[data-bulk-missing-open]'); await p.waitForTimeout(300)
const m=p.locator('[data-bulk-missing]')
let t=await m.textContent(); ok(/고른 호기 4대/.test(t)&&/#71/.test(t)&&/#74/.test(t),'창 — 4대 칩',t.slice(0,120))
ok(/해제 \(2\)/.test(t),'해제 탭 — 걸린 품목 2개(RELAY 두 모양 합침 · KEEP)',t)
await p.fill('[data-bulk-missing-paste]','품번\t수량\n5102060\t2\nax-4021187\t1\nZZZ-NONE\t5')
await p.fill('#bm-date','2026-11-12'); await p.waitForTimeout(900)
t=await m.textContent()
ok(/SHELL 9P/.test(t)&&/AMPHENOL/.test(t),'품명·제조사 자동 조회')
ok(/품목 없음/.test(t),'없는 품번 표시')
ok(/4대 새로/.test(await p.textContent('[data-bulk-missing-row="5102060"]')),'SHELL — 4대 새로')
const rr=await p.textContent('[data-bulk-missing-row="4021187"]'); ok(/3대 있음 → 바꿈 · 1대 새로/.test(rr),'RELAY — 3대 있음 바꿈 · 1대 새로',rr)
ok(/4대에 3품목 저장/.test(await p.textContent('[data-bulk-missing-save]')),'저장 버튼 문구')
// 창을 연 사이 출고 작업이 #71 에 결품을 넣었다 → 지워지면 안 됨
await p.evaluate(()=>{ window.__S.DATA.production.find(x=>x.id==='mh1').missing_parts=[{std_code:'AX-7777',name:'ISSUE SYNC',qty:2}] })
await p.click('[data-bulk-missing-save]'); await p.waitForTimeout(1200)
ok(!await p.$('[data-bulk-missing]'),'저장 후 창 닫힘')
const a1=await mp('mh1'),a2=await mp('mh2'),a3=await mp('mh3')
ok(a1.length===4&&a1[0].std_code==='AX-7777','#71 — 창 연 사이 생긴 결품 유지 + 3품목',a1)
const sh=a1.find(x=>x.pn==='5102060'); ok(sh&&sh.std_code==='AX-5102060'&&sh.item_id==='mb1'&&sh.qty===2&&sh.date==='2026-11-12'&&sh.maker==='AMPHENOL','#71 SHELL 모양 (std_code·item_id·제조사·날짜)',sh)
ok(a1.find(x=>x.pn==='ZZZ-NONE')?.qty===5&&!a1.find(x=>x.pn==='ZZZ-NONE').std_code,'없는 품번은 품번만',a1)
ok(a2.filter(x=>/4021187/.test(x.pn||x.std_code)).length===1&&a2.find(x=>x.pn==='4021187').qty===1,'#72 RELAY 3→1 (중복 없음)',a2)
const r3=a3.find(x=>x.std_code==='AX-4021187'); ok(r3&&r3.qty===1&&r3.item_id==='mb2'&&r3.pn==='4021187'&&a3.find(x=>x.std_code==='AX-9999'),'#73 출고연동 모양도 같은 품목으로 봄 · 다른 품목 유지',a3)
const ch=await p.evaluate(()=>window.__S.DATA.production.find(x=>x.id==='mh2').changes); ok(ch.length===1&&ch[0].type==='미불출입력'&&ch[0].by==='김교한','변경 이력',ch)
// 더하기
for (const h of ['#72','#73']) { const row=p.locator('tbody tr',{hasText:h}).filter({hasText:'110158840'}).first(); await row.locator('td').first().click() }
await p.click('[data-bulk-missing-open]'); await p.waitForTimeout(300)
await p.fill('[data-bulk-missing-paste]','4021187 2'); await p.locator('[data-bulk-missing] label',{hasText:'더하기'}).click(); await p.waitForTimeout(800)
ok(/2대에 1품목 저장/.test(await p.textContent('[data-bulk-missing-save]')),'2대 · 더하기')
await p.click('[data-bulk-missing-save]'); await p.waitForTimeout(1000)
ok((await mp('mh2')).find(x=>x.pn==='4021187').qty===3&&(await mp('mh3')).find(x=>x.std_code==='AX-4021187').qty===3,'더하기 1+2=3')
// 해제
for (const h of ['#71','#72','#73','#74']) { const row=p.locator('tbody tr',{hasText:h}).filter({hasText:'110158840'}).first(); await row.locator('td').first().click() }
await p.waitForTimeout(200)
ok(/4건 선택/.test(await p.textContent('body')),'다시 4건 선택',(await p.textContent('body')).match(/\d+건 선택/)?.[0])
await p.click('[data-bulk-missing-open]'); await p.waitForTimeout(300); await p.click('[data-bulk-missing-tab="clear"]')
t=await m.textContent(); ok(/5102060/.test(t)&&/4021187/.test(t)&&/7777/.test(t),'해제 목록 — 품목별로 모음')
ok(/#71 #72 #73 #74/.test(await p.textContent('[data-bulk-clear-row="4021187"]')),'RELAY 걸린 호기 4대')
ok(await p.$eval('[data-bulk-clear-save]',e=>e.matches(':disabled')),'안 고르면 해제 버튼 꺼짐')
await p.locator('[data-bulk-clear-row="5102060"] input[type=checkbox]').check(); await p.locator('[data-bulk-clear-row="4021187"] input[type=checkbox]').check()
ok(/2품목 해제/.test(await p.textContent('[data-bulk-clear-save]')),'2품목 해제')
await p.click('[data-bulk-clear-save]'); await p.waitForTimeout(1000)
const z1=await mp('mh1'),z3=await mp('mh3'),z4=await mp('mh4')
ok(z1.map(x=>x.std_code||x.pn).join()==='AX-7777,ZZZ-NONE','#71 남은 것 (결품·없는품번)',z1)
ok(z3.map(x=>x.std_code||x.pn).join()==='AX-9999,ZZZ-NONE','#73 KEEP·없는품번 남음',z3)
ok(z4.length===1&&z4[0].pn==='ZZZ-NONE','#74',z4)
await p.screenshot({path:'/tmp/jsportal-test/out/t64.png'})
ok(errs.length===0,'오류 없음',errs);
console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close();})();
