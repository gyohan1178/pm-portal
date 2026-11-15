// v4.153.0 — 출고 BOM 보기(출고 대상 · 소요 0 · 구분) · 찾기 · 번호 = 불출표 번호
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const T=async(p,s)=>(await p.textContent(s).catch(()=>'')||'').replace(/\s+/g,' ').trim();
(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1500,height:950}});p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8765/app.html?obv=1&r='+encodeURIComponent('/outbound'));await p.waitForTimeout(2500)
const sels=await p.$$('main select'); await sels[0].selectOption({index:1}); await p.waitForTimeout(800)
const s2=await p.$$('main select'); const opts=await s2[1].$$eval('option',a=>a.map(o=>[o.value,o.textContent])); const pj=opts.find(o=>/110153030/.test(o[1])); await s2[1].selectOption(pj[0]); await p.waitForTimeout(1800)
const codes=()=>p.$$eval('table tbody tr',a=>a.map(r=>(r.querySelector('td:nth-child(7)')||{}).textContent).filter(Boolean))
const v=await T(p,'[data-out-view]'); console.log('   ',v)
ok(/출고 대상 3/.test(v)&&/소요 0 2/.test(v)&&/불출 미대상 1/.test(v)&&/하네스 1/.test(v)&&/전체 6/.test(v),'보기 칸 숫자',v)
let c=await codes(); ok(c.length===3&&!c.some(x=>/86000/.test(x))&&!c.includes('AX-5000999'),'기본 = 출고 대상 (소요 0 · 미대상 숨김)',c)
await p.click('[data-out-view-btn="zero"]'); await p.waitForTimeout(300); c=await codes(); ok(c.length===2&&c.every(x=>/86000/.test(x)),'소요 0 만',c)
await p.click('[data-out-view-btn="harness"]'); await p.waitForTimeout(300); c=await codes(); ok(JSON.stringify(c)==='["AX-160011112"]','하네스만',c)
await p.click('[data-out-view-btn="all"]'); await p.waitForTimeout(300); ok((await codes()).length===6,'전체')
await p.fill('[data-out-bomq]','bkn 3p'); await p.waitForTimeout(500); c=await codes(); ok(JSON.stringify(c)==='["AX-6200111"]','제조사품번 찾기 (띄어쓰기 무시)',c)
await p.fill('[data-out-bomq]',''); await p.click('[data-out-view-btn="target"]'); await p.waitForTimeout(400)
const nos=await p.$$eval('table tbody tr',a=>a.map(r=>[(r.querySelector('td:nth-child(7)')||{}).textContent,(r.querySelector('td:nth-child(2)')||{}).textContent]))
console.log('    번호',JSON.stringify(nos))
const all=await (async()=>{await p.click('[data-out-view-btn="all"]');await p.waitForTimeout(300);return p.$$eval('table tbody tr',a=>a.map(r=>[(r.querySelector('td:nth-child(7)')||{}).textContent,(r.querySelector('td:nth-child(2)')||{}).textContent]))})()
const m=Object.fromEntries(all); ok(nos.every(([k,n])=>m[k]===n),'출고 대상 보기에서도 번호 = 전체(불출표) 번호')
ok(m['AX-5000999']==='—','불출 미대상은 번호 없음',m['AX-5000999'])
ok(errs.length===0,'오류 없음',errs); console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close();})();
