// 구매발주 목록 — 상위품목 · LT 칸 뺌 (머리 칸 수 = 줄 칸 수)
const {chromium}=require('playwright');
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
(async()=>{const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1560,height:900}}); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
 await p.goto(`http://localhost:8765/app.html?d13=1&r=${encodeURIComponent(process.argv[2]||'/customer/ax/purchase')}`); await p.waitForTimeout(2500);
 const th=await p.$$eval('table thead th',a=>a.map(x=>x.textContent.trim()));
 ok(th.length>5,'발주 표 열림',th);
 ok(!th.some(t=>/상위품목|^LT$/.test(t)),'머리에 상위품목 · LT 없음',th);
 const n=await p.$$eval('table tbody tr',rs=>rs.map(r=>r.querySelectorAll(':scope > td').length).filter(n=>n>1));
 ok(n.length>0 && n.every(x=>x===th.length),`줄마다 칸 수 = 머리 칸 수 (${th.length})`,n);
 const row=(await p.textContent('table tbody tr')).replace(/\s+/g,' ');
 ok(/JS-2610\d\d-\d\d/.test(row)&&/2026-10-21/.test(row),'첫 줄 내용 그대로 (v4.108.0 기본 차례 = 받을 날 순 → 지연 줄이 맨 위)',row.slice(0,160));
 await p.screenshot({path:'/tmp/jsportal-test/out/purchase_cols.png'});
 ok(errs.length===0,'오류 없음',errs);
 console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
