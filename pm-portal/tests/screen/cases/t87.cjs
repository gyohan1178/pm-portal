// v4.159.0 — 수주대장 PO 창에서 Rev 고치기
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1500,height:1000}});p.on('pageerror',e=>errs.push(e.message))
await p.goto('http://localhost:8765/app.html?r='+encodeURIComponent('/orders'));await p.waitForTimeout(2500)
await p.locator('text=47894KF').first().click(); await p.waitForTimeout(800)
ok(await p.locator('[data-rev-edit]').count()>0,'「✎ Rev」 버튼 보임')
await p.locator('[data-rev-edit]').first().click(); await p.waitForTimeout(200)
ok(await p.locator('[data-rev-input]').count()===1 && await p.locator('[data-brev-input]').count()===1,'AXCELIS — SREV · BREV 두 칸')
await p.fill('[data-rev-input]','e'); await p.fill('[data-brev-input]','d'); await p.click('[data-rev-save]'); await p.waitForTimeout(1000)
const D=await p.evaluate(()=>JSON.parse(JSON.stringify(window.__S.DATA)))
const l1=D.pm_order_line.find(x=>x.id==='l1')
ok(l1.rev==='E'&&l1.brev==='D','저장 — 대문자로',{rev:l1.rev,brev:l1.brev})
const ch=(D.pm_order_change||[]).filter(c=>c.field==='rev'||c.field==='brev')
ok(ch.length===2 && ch.some(c=>c.field==='rev'&&c.before_val==='P'&&c.after_val==='E'),'변경 이력 2줄 (SREV P→E · BREV)',ch)
ok(/S E/.test(await p.textContent('[data-dline="2/1"]')),'화면에 바로 반영')
ok(errs.length===0,'화면 오류 없음',errs)
console.log(`\n${pass} pass / ${fail} fail`);await b.close();process.exit(fail?1:0)})()
