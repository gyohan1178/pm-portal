// v4.140.0 — 견적 작성 버튼 자리 고정
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();const errs=[];
for (const W of [1500,1280]) {
const p=await b.newPage({viewport:{width:W,height:1000}});p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(()=>{ window.print=()=>{} })
await p.goto('http://localhost:8765/app.html?qsup=buy&r='+encodeURIComponent('/sales-quote'));await p.waitForTimeout(2000);
await p.click('button:has-text("✍ 견적 작성")');await p.waitForTimeout(1200);
const pos=()=>p.evaluate(()=>{const q=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y)]};
  return {save:q('[data-quote-toolbar-row="out"] button:nth-of-type(3)'),print:q('[data-quote-print]'),detail:q('[data-quote-detail-ctl]'),excel:q('[data-quote-toolbar-row="out"] button.border-emerald-300'),sim:q('[data-sim-all]'),add:q('input[placeholder="품번 입력 (ASSY·단품 자동 판별)"]')}})
const p0=await pos()
const pn=p.locator('input[placeholder="품번 입력 (ASSY·단품 자동 판별)"]'); await pn.fill('990000001'); await pn.press('Enter'); await p.waitForTimeout(1800)
for(let i=0;i<6;i++) await p.click('button:has-text("+ 빈 줄")')   // 6줄 → 인쇄 (갑지·을지)
await p.waitForTimeout(300)
const p1=await pos()
await p.check('[data-quote-detail]'); await p.check('[data-quote-detail-maker]'); await p.waitForTimeout(300)
const p2=await pos()
await p.click('button:has-text("📝 임시저장")'); await p.waitForTimeout(800)
const p3=await pos()
console.log(W,JSON.stringify({p0,p1,p2,p3}))
ok(/갑지·을지/.test(await p.textContent('[data-quote-print]')),W+' 인쇄 글자 길어짐')
ok(/보관 갱신/.test(await p.textContent('[data-quote-toolbar-row="out"]')),W+' 임시저장 → 보관 갱신')
ok(JSON.stringify(p0)===JSON.stringify(p1)&&JSON.stringify(p1)===JSON.stringify(p2)&&JSON.stringify(p2)===JSON.stringify(p3),W+' 버튼 자리 그대로 (줄 추가 · 세부견적 켬 · 임시저장 후)')
if(W===1500){ await p.screenshot({path:'/tmp/jsportal-test/out/t67.png',clip:{x:240,y:340,width:1260,height:130}}) }
await p.close() }
ok(errs.length===0,'오류 없음',errs);
console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close();})();
