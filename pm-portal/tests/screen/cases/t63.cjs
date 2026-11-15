// v4.135.0 — 생산관리 자동 불러오기 결과 표시
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1500,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
const go=async(q,cs)=>{await p.goto(`http://localhost:8765/app.html?pt=1&${q}&r=${encodeURIComponent('/production/'+cs)}`);await p.waitForTimeout(2000)};
await go('asl=1','AX'); let t=await p.textContent('[data-autosync]').catch(()=>null);
ok(/🤖 자동 불러오기 .* — 새 줄 2 · 고침 2 · 완료 1/.test(t||''),'AX — 가장 최근 기록 (새 줄 2 · 고침 2 · 완료 1)',t);
await go('asl=1','ED'); t=await p.textContent('[data-autosync="fail"]').catch(()=>null);
ok(/자동 불러오기 실패/.test(t||''),'ED — 실패 빨강',t);
await go('asl=1','CSK'); t=await p.textContent('[data-autosync="none"]').catch(()=>null);
ok(/아직 돈 기록이 없습니다/.test(t||''),'CSK — 기록 없음',t);
await go('asl=1','VM'); ok(!await p.$('[data-autosync]'),'VM — 표시 없음');
await go('x=1','AX'); ok(!await p.$('[data-autosync]'),'표가 없으면(SQL 전) 표시 없음');
ok(errs.length===0,'오류 없음',errs);
console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close();})();
