// v4.104.0 2 · 3차 — 60화면: 느린 연결에서 「불러오는 중」 글자 대신 모양 · 다 받으면 모양이 사라짐 · 오류 없음 · 브라우저 기본 창 없음
const {chromium}=require('playwright');
const routes=require('fs').readFileSync('/tmp/jsportal-test/out/routes.txt','utf8').trim().split(',');
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
const W=(ms)=>new Promise(r=>setTimeout(r,ms));
// 일부러 남겨 둔 「불러오는 중」 (작은 보조 표시 · 다른 사람이 만든 탭)
const ALLOW=/지난 견적 불러오는 중|BOM 불러오는 중|납품 끝난 · 취소된 줄까지 불러오는 중|지난 이력까지 불러오는 중/;
(async()=>{const b=await chromium.launch(); let dialogs=0; const stuck=[], textLeft=[];
for (const r of routes) {
  const ctx=await b.newContext({viewport:{width:1440,height:900}}); const p=await ctx.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push(e.message.slice(0,120))); p.on('dialog',d=>{dialogs++;d.dismiss()});
  await p.goto(`http://localhost:8765/app.html?slow=400&r=${encodeURIComponent(r)}`);
  await W(1100);
  const t1=await p.evaluate(()=>(document.querySelector('main')?.innerText||''));
  const m=(t1.match(/[^\n]*불러오는\s?중[^\n]*/g)||[]).filter(x=>!/지난 견적 불러오는 중|BOM 불러오는 중|납품 끝난|지난 이력까지/.test(x));
  if(m.length) textLeft.push(`${r}: ${m[0].slice(0,50)}`);
  await W(7000);
  const sk=await p.$$eval('main [data-skeleton]',e=>e.length).catch(()=>0);
  if(sk) stuck.push(`${r}: ${sk}`);
  ok(errs.length===0,`${r} 오류 없음`,errs);
  await ctx.close();
}
ok(stuck.length===0,'다 받은 뒤에도 모양(스켈레톤)이 남은 화면 없음',stuck);
ok(textLeft.length===0,'「불러오는 중」 글자 대신 모양',textLeft);
ok(dialogs===0,'브라우저 기본 창 0',dialogs);
console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
