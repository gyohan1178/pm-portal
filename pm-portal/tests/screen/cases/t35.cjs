// v4.104.0 2·3차 — 지우기 · 되돌리기 버튼이 브라우저 창 대신 포털 확인 창을 띄우고, 취소하면 아무것도 안 바뀜
const {chromium}=require('playwright');
let pass=0, fail=0, skip=[]; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
const W=(ms)=>new Promise(r=>setTimeout(r,ms));
const cases=[['/customer/ax/cpo','[data-cpo-del]'],['/customer/ax/bom','[data-asm-del]'],['/master/vendors','td button:has-text("삭제")'],['/quote-history','button:has-text("삭제")'],['/inbound','button:has-text("삭제")'],['/master/items','button:has-text("삭제")'],['/cost-saving','button:has-text("삭제")'],['/quality/lot','button:has-text("삭제")']];
(async()=>{const b=await chromium.launch(); let dialogs=0;
for (const [r,sel] of cases){ const p=await b.newPage({viewport:{width:1440,height:900}}); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',d=>{dialogs++;d.dismiss()});
  await p.goto(`http://localhost:8765/app.html?r=${encodeURIComponent(r)}`); await W(2200);
  const el=await p.$(sel); if(!el){skip.push(r); await p.close(); continue}
  const before=await p.evaluate(()=>JSON.stringify(window.__S.DATA).length);
  await el.click().catch(()=>{}); await W(400);
  const has=!!await p.$('[data-confirm-dialog]');
  ok(has,`${r} ${sel} → 포털 확인 창`);
  if(has){ await p.click('[data-confirm-cancel]').catch(()=>p.keyboard.press('Escape')); await W(400);
    ok((await p.evaluate(()=>JSON.stringify(window.__S.DATA).length))===before,`${r} 취소 → 데이터 그대로`) }
  ok(errs.length===0,`${r} 오류 없음`,errs); await p.close() }
ok(dialogs===0,'브라우저 기본 창 0',dialogs); console.log('건너뜀(시험 데이터에 버튼 없음):',skip.join(' '));
console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
