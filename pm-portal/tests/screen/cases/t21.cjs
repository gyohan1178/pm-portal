// v4.101.0 — 수주대장 특이사항 「✓ 확인」
const {chromium}=require('playwright');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
const W=(ms)=>new Promise(r=>setTimeout(r,ms));
const oddN=async(p)=>Number(((await p.textContent('[data-odd-btn]')).match(/특이사항\s*([\d,]+)/)||[])[1]);
(async()=>{const b=await chromium.launch();
const mk=async(w=1500)=>{const p=await b.newPage({viewport:{width:w,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto(`${base}?odd=1&r=${encodeURIComponent('/orders')}`);await p.waitForTimeout(2000);return {p,errs}};
{const {p,errs}=await mk();
 ok(await oddN(p)===1,'특이사항 1줄 (Rev N→P · 단가 +25%)',await p.textContent('[data-odd-btn]'));
 await p.click('[data-odd-btn]'); await W(400);
 ok(await p.locator('[data-row="47894KF|2/1"] [data-odd-rev]').count()===1,'특이사항 목록에 Rev 배지');
 await p.screenshot({path:'/tmp/jsportal-test/out/odd_before.png'});
 await p.click('[data-row="47894KF|2/1"] [data-odd-ok]'); await W(800);
 const L=await p.evaluate(()=>window.__S.DATA.pm_order_line.find(x=>x.id==='l1'));
 ok(L.odd_ok==='R:N>P|P:800000>1000000'&&L.odd_ok_name&&L.odd_ok_at,'확인 저장 (그때 내용 · 이름 · 시각)',L.odd_ok);
 const C=await p.evaluate(()=>window.__S.DATA.pm_order_change.filter(x=>x.field==='odd_ok'));
 ok(C.length===1&&C[0].after_val===L.odd_ok,'변경 이력에 「특이사항 확인」',C);
 ok(await oddN(p)===0,'특이사항 숫자 0 — 목록에서 빠짐');
 ok(await p.locator('[data-row="47894KF|2/1"]').count()===0,'특이사항 보기에서 줄 사라짐');
 await p.click('[data-odd-btn]'); await W(300);
 ok(await p.locator('[data-row="47894KF|2/1"] [data-odd-rev]').count()===0,'일반 목록에서도 배지 없음');
 await p.click('[data-po-link="47894KF"]'); await W(500);
 ok(await p.locator('[data-odd-done]').count()===1,'PO 상세에 「✓ 특이사항 확인」 회색 표시',await p.locator('[data-odd-done]').count());
 await p.screenshot({path:'/tmp/jsportal-test/out/odd_done.png'});
 await p.click('[data-odd-undo]'); await W(700);
 const L2=await p.evaluate(()=>window.__S.DATA.pm_order_line.find(x=>x.id==='l1'));
 ok(!L2.odd_ok,'확인 취소 → 기록 지움',L2.odd_ok);
 ok(await oddN(p)===1,'다시 특이사항 1');
 ok(errs.length===0,'오류 없음',errs);
}
// 확인한 뒤 내용이 바뀌면 다시 나온다 (단가만 바뀐 경우)
{const {p,errs}=await mk();
 await p.evaluate(()=>{const l=window.__S.DATA.pm_order_line.find(x=>x.id==='l1'); l.odd_ok='R:N>P|P:800000>900000'; l.odd_ok_name='김교한'; l.odd_ok_at=new Date().toISOString()});
 await p.reload(); await W(2000);
 ok(await oddN(p)===1,'확인했던 내용과 다르면 다시 특이사항');
 await p.evaluate(()=>{const l=window.__S.DATA.pm_order_line.find(x=>x.id==='l1'); l.odd_ok='R:N>P|P:800000>1000000'});
 ok(errs.length===0,'오류 없음',errs);
}
// 여러 줄 한꺼번에 (선택 → 「✓ 특이사항 확인」) · 모바일 카드
{const {p,errs}=await mk();
 await p.click('[data-odd-btn]'); await W(300);
 await p.check('[data-check="47894KF|2/1"]'); await W(200);
 ok(await p.locator('[data-bulk-odd-ok]').count()===1,'선택하면 「✓ 특이사항 확인 1」 버튼');
 await p.click('[data-bulk-odd-ok]'); await W(800);
 ok(await oddN(p)===0,'한꺼번에 확인 → 0');
 ok(errs.length===0,'오류 없음',errs);
 const m=await mk(400);
 await m.p.click('[data-odd-btn]').catch(()=>{}); await W(300);
 ok(await m.p.locator('[data-mcard="47894KF|2/1"] [data-odd-ok]').count()===1,'모바일 카드에도 「✓ 확인」');
 ok(m.errs.length===0,'모바일 오류 없음',m.errs);
}
console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
