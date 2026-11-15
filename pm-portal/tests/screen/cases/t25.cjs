// 자료 요청 「직접 입력」 칸이 창 밖으로 안 나가는지 (PC · 노트북 · 휴대폰)
const {chromium}=require('playwright');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();
for (const w of [1500,1366,390]) {
 const p=await b.newPage({viewport:{width:w,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto(`${base}?me=${encodeURIComponent(JSON.stringify({role:'editor',dept:'품질',is_lead:false}))}&r=${encodeURIComponent('/doc-request')}`); await p.waitForTimeout(1800);
 await p.click('[data-doc-req-open]'); await p.waitForTimeout(300);
 await p.click('[data-doc-kind="기타"]'); await p.fill('[data-doc-label]','CN내역'); await p.waitForTimeout(300);
 const box=await p.$eval('[data-doc-req-box]',e=>{const r=e.getBoundingClientRect();return {l:r.left,r:r.right,sw:e.scrollWidth,cw:e.clientWidth}});
 const inp=await p.$eval('[data-doc-label]',e=>{const r=e.getBoundingClientRect();return {l:r.left,r:r.right}});
 ok(inp.l>=box.l-1&&inp.r<=box.r+1&&box.sw<=box.cw+1,`${w}px: 입력칸이 창 안에 · 가로 넘침 없음`,{box,inp});
 ok(box.l>=0&&box.r<=w,`${w}px: 창이 화면 안에`,box);
 if(w===1366) await p.screenshot({path:'/tmp/jsportal-test/out/doc_modal.png'});
 ok(errs.length===0,`${w}px: 오류 없음`,errs);
 await p.close();
}
console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
