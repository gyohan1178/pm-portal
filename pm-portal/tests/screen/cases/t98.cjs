// v4.169.0 — 미불출 일부 불출: 4대 × 대당 2 = 8개 필요 · 5개 있음 → 뒤 호기에 3개 미불출 · 일부 해제
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const SHOT='/tmp/jsportal-test/out/shots/';
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1500,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto(`http://localhost:8765/app.html?pt=1&mbulk=1&r=${encodeURIComponent('/production/AX')}`);await p.waitForTimeout(2200)
const mp=async(id)=>p.evaluate((id)=>window.__S.DATA.production.find(x=>x.id===id).missing_parts,id)
const shell=async(id)=>((await mp(id)).find(x=>x.pn==='5102060')||{}).qty||0
const pick=async(hs)=>{ for (const h of hs) { const row=p.locator('tbody tr',{hasText:h}).filter({hasText:'110158840'}).first(); await row.locator('td').first().click() } await p.waitForTimeout(200) }
await pick(['#74','#72','#71','#73'])
await p.click('[data-bulk-missing-open]'); await p.waitForTimeout(300)
await p.fill('[data-bulk-missing-paste]','5102060\t2'); await p.waitForTimeout(900)
ok(/8/.test(await p.textContent('[data-bulk-missing-row="5102060"]')),'대당 2 × 4대 = 8')
ok((await p.textContent('[data-bulk-missing-short="5102060"]')).trim().startsWith('8'),'있는 수량 비우면 8개 전부 미불출 (예전과 같음)')
await p.fill('[data-bulk-missing-have="5102060"]','5'); await p.waitForTimeout(200)
const st=await p.textContent('[data-bulk-missing-short="5102060"]')
ok(/^3/.test(st.trim())&&/#73 1/.test(st)&&/#74 2/.test(st),'5개 있음 → 미불출 3 (#73 1 · #74 2 — 납기 빠른 호기부터 채움)',st)
await p.screenshot({path:SHOT+'mbulk_partial.png'})
await p.click('[data-bulk-missing-save]'); await p.waitForTimeout(1200)
const q=[await shell('mh1'),await shell('mh2'),await shell('mh3'),await shell('mh4')]
ok(q.join()==='0,0,1,2','저장 — #71 0 · #72 0 · #73 1 · #74 2',q)
// 다 있는 경우 (8개) — 「수량 바꾸기」면 이미 적힌 것도 지운다
// 일부 해제 — 2개 들어와 불출
await pick(['#71','#72','#73','#74'])
await p.click('[data-bulk-missing-open]'); await p.waitForTimeout(300)
await p.click('[data-bulk-missing-tab="clear"]'); await p.waitForTimeout(200)
await p.fill('[data-bulk-clear-qty="5102060"]','2'); await p.waitForTimeout(200)
ok(/남는 미불출 1/.test(await p.textContent('[data-bulk-clear-row="5102060"]')),'일부 해제 미리보기 — 남는 1')
await p.screenshot({path:SHOT+'mbulk_partial_clear.png'})
await p.click('[data-bulk-clear-save]'); await p.waitForTimeout(1200)
const q2=[await shell('mh3'),await shell('mh4')]
ok(q2.join()==='0,1','2개 불출 → #73 1→0(지움) · #74 2→1',q2)
const keep=(await mp('mh3')).find(x=>x.std_code==='AX-4021187'); ok(keep&&keep.qty>0,'다른 품목(RELAY) 그대로',await mp('mh3'))
const ch=await p.evaluate(()=>window.__S.DATA.production.find(x=>x.id==='mh4').changes.slice(-1)[0]); ok(ch&&ch.type==='미불출해제'&&/일부 불출 5102060 2→1/.test(ch.msg),'변경 이력 — 일부 불출 2→1',ch)
// 다 들어옴 — 「수량 바꾸기」 + 있는 수량 8 → 남은 미불출 지움
await pick(['#71','#72','#73','#74'])
await p.click('[data-bulk-missing-open]'); await p.waitForTimeout(300)
await p.fill('[data-bulk-missing-paste]','5102060\t2'); await p.waitForTimeout(900)
await p.fill('[data-bulk-missing-have="5102060"]','8'); await p.waitForTimeout(200)
ok(/모두 불출/.test(await p.textContent('[data-bulk-missing-short="5102060"]')),'8개 다 있음 → 모두 불출')
await p.click('[data-bulk-missing-save]'); await p.waitForTimeout(1200)
ok((await shell('mh4'))===0,'수량 바꾸기 + 다 있음 → #74 남은 미불출 지움',await mp('mh4'))
ok(!errs.length,'오류 없음',errs); console.log(`t98 ${pass}/${pass+fail}`);await b.close()})()
