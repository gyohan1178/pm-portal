// v4.146.0 — 하네스 출도 대상 품번 (16번대 밖)
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const T=async(p,s)=>(await p.textContent(s).catch(()=>'')||'').replace(/\s+/g,' ').trim();
(async()=>{const b=await chromium.launch();const errs=[];
const open=async(q)=>{const p=await b.newPage({viewport:{width:1500,height:1000}});p.on('pageerror',e=>errs.push(e.message));await p.goto('http://localhost:8765/app.html?hrp=1&hrx='+q+'&r='+encodeURIComponent('/production/harness-release'));await p.waitForTimeout(2500);return p}
const ids=(p)=>p.$$eval('[data-hr-row]',a=>a.map(e=>e.dataset.hrRow))
console.log('① 기본(설정 없음) — 120220971~4')
let p=await open('1')
let r=await ids(p); ok(r.includes('hx1')&&r.includes('hx2')&&!r.includes('hx3')&&!r.includes('hx4'),'120220971 · 974 진행 중 줄 보임 · 다른 12번대 · 완료 줄은 안 보임',r)
ok(/구매품 · 출도 대상/.test(await T(p,'[data-hr-row="hx1"]')),'「구매품 · 출도 대상」 표시')
ok(/출도 대상 품번 4/.test(await T(p,'[data-hr-extra]')),'버튼 「출도 대상 품번 4」')
console.log('② 품번 바꾸기')
await p.click('[data-hr-extra]'); await p.waitForTimeout(300)
ok(await p.inputValue('[data-hr-extra-text]')==='120220971~4','기본값이 범위로 보임')
await p.fill('[data-hr-extra-text]','120220971~4\n120299999'); await p.waitForTimeout(100)
ok(/품번 5개/.test(await T(p,'[data-hr-extra-count]')),'5개')
await p.click('[data-hr-extra-save]'); await p.waitForTimeout(1800)
const st=await p.evaluate(()=>window.__S.DATA.pm_settings.find(x=>x.key==='harness_release_extra'))
ok(JSON.stringify(st.value.codes)===JSON.stringify(['120220971','120220972','120220973','120220974','120299999']),'저장',st.value)
r=await ids(p); ok(r.includes('hx3'),'새로 넣은 품번 줄도 보임',r)
console.log('③ 불출 표시도 똑같이')
await p.click('[data-hr-row="hx1"]'); await p.click('[data-hr-issue]'); await p.waitForTimeout(300); await p.click('[data-confirm-ok]'); await p.waitForTimeout(1200)
ok(await p.evaluate(()=>window.__S.DATA.purchase_orders.find(x=>x.id==='hx1').material_issued)===true,'12번대 줄 불출 표시')
await p.close()
p=await open('set'); r=await ids(p); ok(r.includes('hx1')&&!r.includes('hx2'),'저장된 설정(120220971만)을 따름',r)
ok(errs.length===0,'오류 없음',errs);
console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close();})();
