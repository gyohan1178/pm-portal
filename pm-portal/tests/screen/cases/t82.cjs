// v4.155.0 — 수주대장으로 미리 만든 호기의 PO 번호
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();
for (const mode of ['1','notbl']) {
const p=await b.newPage({viewport:{width:1500,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto(`http://localhost:8765/app.html?pt=1&pol=${mode}&r=${encodeURIComponent('/production/AX')}`);await p.waitForTimeout(2500)
const row=(h)=>p.locator('tbody tr',{hasText:h}).filter({hasText:'110173680'}).first()
const t3=await row('#3').textContent(), t4=await row('#4').textContent()
if (mode==='1') {
  ok(/PE081612KK/.test(t3),'#3 — PO 없는 호기에 수주대장 PO 번호',t3.slice(0,160))
  ok(await row('#3').locator('[data-po-src-order]').count()===1,'#3 — 「수주대장」 표시')
  ok(/47001KF/.test(t4)&&!/OLDPO/.test(t4),'#4 — 붙은 호기는 고객사 PO 번호 그대로',t4.slice(0,160))
  ok(await row('#4').locator('[data-po-src-order]').count()===0,'#4 — 「수주대장」 표시 없음')
} else {
  ok(!/PE081612KK/.test(t3)&&await row('#3').count()===1,'표 없음(SQL 전) — 화면 그대로 · PO 칸 비움',t3.slice(0,120))
  ok(/47001KF/.test(t4),'표 없음 — 붙은 호기 PO 번호는 그대로')
}
ok(errs.length===0,`[${mode}] 화면 오류 없음`,errs)
await p.close() }
console.log(`\n${pass} pass / ${fail} fail`);await b.close();process.exit(fail?1:0)})()
