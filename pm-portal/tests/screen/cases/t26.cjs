// 매출 대시보드 — 1000행 넘어도 숫자가 그대로 (예전엔 매번 다른 1000행)
const {chromium}=require('playwright');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
(async()=>{const b=await chromium.launch(); const vals=[];
for (let k=0;k<2;k++){ const p=await b.newPage({viewport:{width:1440,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto(`${base}?cap=1&r=${encodeURIComponent('/sales')}`); await p.waitForTimeout(2500);
 const t=(await p.evaluate(()=>{const c=document.querySelector('.kpi-grid').cloneNode(true);c.querySelectorAll('[data-info-tip]').forEach(x=>x.remove());return c.textContent})).replace(/\s/g,'');   // ⓘ 글자 빼고 (v4.104.0) vals.push(t);
 ok(/기매출\(납품완료\)25\.00억/.test(t),`${k+1}번째 열기: 기매출 25.00억 (2,500행 전부)`,t.slice(0,120)); ok(errs.length===0,'오류 없음',errs); await p.close() }
ok(vals[0]===vals[1],'다시 열어도 같은 숫자');
console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
