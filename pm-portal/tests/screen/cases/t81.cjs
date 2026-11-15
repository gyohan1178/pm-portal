// v4.154.0 — 출고 위치: 실사 칸 보여 주기 · 인터넷 끊김 때 저장 안 됨 표시 · 다시 저장 · 위 경고 줄
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const T=async(p,s)=>(await p.textContent(s).catch(()=>'')||'').replace(/\s+/g,' ').trim();
(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1500,height:950}});p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8765/app.html?obv=1&r='+encodeURIComponent('/outbound'));await p.waitForTimeout(2500)
const sels=await p.$$('main select'); await sels[0].selectOption({index:1}); await p.waitForTimeout(800)
const s2=await p.$$('main select'); const opts=await s2[1].$$eval('option',a=>a.map(o=>[o.value,o.textContent])); await s2[1].selectOption(opts.find(o=>/110153030/.test(o[1]))[0]); await p.waitForTimeout(2000)
console.log('① 실사 칸')
const hv=await p.$eval('[data-out-loc="hh1"]',e=>e.value); ok(hv==='B3-2-1','품목 위치가 없으면 최근 실사 칸 (09-01 아니고 10-20)',hv)
ok(await p.$eval('[data-out-loc="p2"]',e=>e.value)==='B-02-01','품목 위치가 있으면 그대로')
await p.click('[data-out-loc-adopt]'); await p.waitForTimeout(1000)
const inv=await p.evaluate(()=>window.__S.DATA.inventory.find(x=>x.item_id==='hh1')); ok(inv&&inv.location==='B3-2-1','실사 칸 ✓ 저장 → 품목 위치',inv)
ok(!await p.$('[data-out-loc-adopt]'),'저장 뒤 실사 표시 사라짐')
console.log('② 인터넷 끊김')
await p.evaluate(()=>{ window.__S.FAIL['inventory:update']='TypeError: Failed to fetch' })
await p.fill('[data-out-loc="p1"]','Z-9-9'); await p.click('[data-out-bomq]'); await p.waitForTimeout(6000)
ok(await p.$eval('[data-out-loc="p1"]',e=>e.value)==='Z-9-9','실패해도 입력값 그대로')
ok(!!await p.$('[data-out-loc-retry]'),'「저장 안 됨 ↻」 표시')
ok(!!await p.$('[data-net-banner]'),'위에 인터넷 불안정 줄',await T(p,'body').then(t=>t.slice(0,0)))
const before=await p.evaluate(()=>window.__S.DATA.inventory.find(x=>x.item_id==='p1').location); ok(before==='A-01-02','DB 는 그대로',before)
await p.evaluate(()=>{ delete window.__S.FAIL['inventory:update'] })
await p.click('[data-out-loc-retry]'); await p.waitForTimeout(1200)
const after=await p.evaluate(()=>window.__S.DATA.inventory.find(x=>x.item_id==='p1').location); ok(after==='Z-9-9','다시 저장 → 들어감',after)
ok(!await p.$('[data-out-loc-retry]'),'저장 안 됨 표시 사라짐')
ok(await p.$eval('[data-out-loc="p1"]',e=>e.value)==='Z-9-9','칸에 저장값')
ok(!await p.$('[data-net-banner]'),'성공하면 경고 줄 사라짐')
ok(errs.length===0,'오류 없음',errs); console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close();})();
