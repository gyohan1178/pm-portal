// BOM 목록 — 어셈블리 1,000개 넘어도 전부 · 등록일 · 품명 그대로 · 서버 왕복 줄임
const {chromium}=require('playwright');
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
(async()=>{const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1500,height:900}}); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 await p.goto(`http://localhost:8765/app.html?bomx=1&r=${encodeURIComponent('/customer/ax/bom')}`); await p.waitForTimeout(3000);
 const body=(await p.textContent('body')).replace(/\s+/g,' ');
 ok(/1,?200 \/ 1,?200개|1200 \/ 1200개/.test(body),'어셈블리 1,200개 전부 (예전엔 1,000개에서 잘림)',(body.match(/\d[\d,]* \/ \d[\d,]*개/)||[])[0]);
 await p.fill('input[placeholder="상위품번·어셈블리명 검색"]','AX-110001199'); await p.waitForTimeout(500);
 const row=(await p.textContent('table tbody')).replace(/\s+/g,' ');
 ok(/AX-110001199/.test(row)&&/ASSY 1199/.test(row),'1,000번째 넘는 어셈블리도 품번 · 품명(items) 보임',row.slice(0,200));
 ok(/2026-10-0/.test(row),'등록일(마지막 업로드) 보임',row.slice(0,200));
 const rpc=await p.evaluate(()=>window.__S.RPC.filter(x=>x.fn==='get_bom_assemblies').length);
 ok(rpc===2,'목록은 1,000개씩 두 번',rpc);
 ok(errs.length===0,'오류 없음',errs);
 console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
