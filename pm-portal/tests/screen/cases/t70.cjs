// v4.143.0 — Edwards 생산관리 납기 = 수주대장 PO 납기 (우선 · 따라가기)
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const T=async(p,s)=>(await p.textContent(s).catch(()=>'')||'').replace(/\s+/g,' ').trim();
(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1600,height:1000}});p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8765/app.html?pt=1&edsync=1&eddue=1&r='+encodeURIComponent('/production/ED'));await p.waitForTimeout(2500); console.log('btns',await p.$$eval('button',a=>a.map(x=>x.innerText.trim()).filter(t=>/펼침|묶기/.test(t)))); await p.click('button:has-text("파트별 펼침")').catch(()=>{}); await p.waitForTimeout(500); console.log('dues',await p.$$eval('[data-ed-due]',a=>a.length))
const row=(id)=>p.evaluate((id)=>JSON.parse(JSON.stringify(window.__S.DATA.production.find(r=>r.id===id))),id)
const cell=async(txt)=>p.evaluate((txt)=>{const tr=[...document.querySelectorAll('tbody tr')].find(t=>t.innerText.includes(txt));const c=tr&&tr.querySelector('[data-ed-due]');return c?[c.dataset.edDue,c.innerText.replace(/\s+/g,' ').trim()]:null},txt)
let c=await cell('Dummy TW'); ok(c&&c[0]==='po'&&/^10-20/.test(c[1]),'H2D — 가공물 입고(10-08)−7 이 아니라 PO 납기(저장값 10-20)',c)
c=await cell('ASML WTR'); ok(c&&c[0]==='fc'&&/^12-15/.test(c[1]),'발주서 미접수 · 수주대장 표시 없는 줄은 포캐스트 그대로',c)
console.log('② 불러오기 → 납기 맞춤')
await p.click('[data-ed-import]'); await p.waitForTimeout(800)
const dlg=await T(p,'[data-confirm-dialog]'); console.log('   ',dlg.slice(0,400))
ok(/납기 1|납기 2/.test(dlg)&&/Dummy TW #3 · H2D — 납기 10-20 → 11-16/.test(dlg)&&/ASML WTR #3,4 · EUV — 납기 10-29 → 11-01 · 발주서 접수/.test(dlg),'확인 창에 납기 맞춤 줄',dlg)
await p.click('[data-confirm-ok]'); await p.waitForTimeout(1500)
let r=await row('pd3'); ok(r.req_date==='2026-11-16'&&r.changes.at(-1).type==='납기변경'&&r.changes.at(-1).src==='수주대장'&&r.changes.at(-1).msg==='2026-10-20 → 2026-11-16','TW #3 → 11-16 · 이력',r.changes.at(-1))
r=await row('pd4'); ok(r.req_date==='2026-11-01'&&r.po_received===true,'ASML WTR → 11-01 · 발주서 접수')
await p.waitForTimeout(800)
c=await cell('Dummy TW'); ok(c&&c[0]==='po'&&/^11-16/.test(c[1]),'화면 11-16',c)
c=await cell('ASML WTR'); ok(c&&c[0]==='po'&&/^11-01/.test(c[1]),'ASML 화면도 PO 납기 11-01 (포캐스트 12-15 보다 앞)',c)
r=await row('pe4'); ok(r.req_date==='2026-11-05','수주대장 묶음 없는 줄은 그대로')
await p.click('[data-ed-import]'); await p.waitForTimeout(800)
ok(!await p.$('[data-confirm-dialog]'),'다시 누르면 맞출 것 없음 (확인 창 없이 알림)')
ok(errs.length===0,'오류 없음',errs);
console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close();})();
