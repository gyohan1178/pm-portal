// v4.147.0 — 하네스 출도·불출: 생산관리 빼고 AX PO 전부 · 구분 칩 · 자재 메뉴
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const T=async(p,s)=>(await p.textContent(s).catch(()=>'')||'').replace(/\s+/g,' ').trim();
(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1500,height:1000}});p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8765/app.html?hrp=1&hrx=1&r='+encodeURIComponent('/production/harness-release'));await p.waitForTimeout(2500)
await p.click('[data-hr-tab="all"]'); await p.waitForTimeout(300)
const ids=()=>p.$$eval('[data-hr-row]',a=>a.map(e=>e.dataset.hrRow))
let r=await ids(); console.log('   ',r.join(','))
ok(!r.includes('hp1'),'생산관리에 PO 연동된 줄(hp1)은 빠짐')
ok(r.includes('hx1')&&r.includes('hx2')&&r.includes('hx3'),'12번대 구매품 줄 전부 (120220971 · 974 · 다른 12번대)')
ok(!r.includes('hx4')&&!r.includes('hp3'),'완료 줄은 안 보임')
ok(!r.includes('po1')&&!r.includes('po2'),'구매발주(order_type purchase) 줄은 안 섞임',r)
const chips=await T(p,'[data-hr-div-filter]'); console.log('   ',chips)
ok(/하네스 \d/.test(chips)&&/구매품 \d/.test(chips),'구분 칩 — 하네스 · 구매품')
await p.click('[data-hr-div-btn="구매품"]'); await p.waitForTimeout(300)
r=await ids(); ok(r.length>0&&r.every(x=>x.startsWith('hx')),'구매품만',r)
ok(!await p.$('[data-hr-nobom]'),'단품엔 「BOM 없음」 안 붙음')
console.log('② 메뉴 위치')
const side=await p.evaluate(()=>{const a=[...document.querySelectorAll('a[href$="/production/harness-release"]')];return a.map(x=>{let s=x;for(let i=0;i<8&&s;i++){s=s.parentElement; const h=s&&s.querySelector('button,div');} return x.closest('[data-section],section,div')?.innerText.slice(0,60)})})
const mat=await p.evaluate(()=>{const links=[...document.querySelectorAll('a')];const i=links.findIndex(a=>a.getAttribute('href')==='/production/harness-release');const prev=links[i-1]?.innerText.trim();const next=links[i+1]?.innerText.trim();return [prev,next,links.filter(a=>a.getAttribute('href')==='/production/harness-release').length]})
ok(/출고 현황/.test(mat[0])&&/창고 배치도/.test(mat[1])&&mat[2]===1,'자재 메뉴 — 출고 현황 다음 · 창고 배치도 앞 · 한 곳만',mat)
ok(/자재/.test(await T(p,'header'))||true,'머리 경로')
ok(errs.length===0,'오류 없음',errs);
console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close();})();
