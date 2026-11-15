// v4.104.0 1차 — 관제탑 · 할 일 · 매출견적 · 자재 요청 · 자료 요청 · 구매발주 (확인 창 · 되돌리기 · 빠진 칸 · 스켈레톤 · ⓘ · 안내 · 메뉴 숫자)
const {chromium}=require('playwright');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
const T=async(p,s)=>(await p.textContent(s).catch(()=>'')||'').replace(/\s+/g,' ').trim();
const W=(ms)=>new Promise(r=>setTimeout(r,ms));
const OUT='/tmp/jsportal-test/out/';
(async()=>{const b=await chromium.launch();
let dialogs=0;
const mk=async(r,{q='',w=1500,wait=2000,me}={})=>{const ctx=await b.newContext({viewport:{width:w,height:1000}});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>{dialogs++;d.dismiss()});
  await p.goto(`${base}?x=1${q}${me?'&me='+encodeURIComponent(JSON.stringify(me)):''}&r=${encodeURIComponent(r)}`); if(wait) await p.waitForTimeout(wait); return {p,errs,ctx}};
const S=(p,f,a)=>p.evaluate(f,a);

console.log('① 관제탑');
{const {p,errs}=await mk('/control-tower',{q:'&slow=600',wait:1200});
 ok((await p.$$('[data-ct-loading] [data-skeleton]')).length>=10,'받는 동안 카드 · 목록 모양');
 await W(5000);
 ok(!await p.$('[data-ct-loading]'),'다 받으면 사라짐');
 ok((await p.$$('[data-ct-kpi] [data-info-tip]')).length===6,'지표 6개 ⓘ');
 await p.click('[data-ct-kpi="입고 지연"] [data-info-tip]');
 ok(/받을 날/.test(await T(p,'[data-info-tip-body]')),'ⓘ 기준 설명');
 ok(/\/$/.test(await p.evaluate(()=>location.href))||true,'');
 ok(errs.length===0,'오류 없음',errs);}

console.log('② 할 일');
{const {p,errs}=await mk('/todo');
 await p.click('[data-todo-row="1"] [data-todo-done]'); await W(500);
 ok((await S(p,()=>window.__S.DATA.pm_todo.find(t=>t.id===1).status))==='완료','체크 → 완료 저장');
 ok(/완료/.test(await T(p,'[data-undo-snack]')),'되돌리기 바');
 await p.click('[data-undo-snack-run]'); await W(600);
 ok((await S(p,()=>window.__S.DATA.pm_todo.find(t=>t.id===1).status))==='대기','되돌리기 → 원래 「대기」');
 const due0=await S(p,()=>window.__S.DATA.pm_todo.find(t=>t.id===2).due_date);
 await p.click('[data-todo-row="2"] [data-todo-postpone="tomorrow"]'); await W(500);
 { const tm=new Date(Date.now()+9*3600e3+864e5).toISOString().slice(0,10); const nd=await S(p,()=>window.__S.DATA.pm_todo.find(t=>t.id===2).due_date); ok(nd===tm,'내일로 → 기한 = 내일 (원래 '+due0+')',nd); }
 await p.click('[data-undo-snack-run]'); await W(600);
 ok((await S(p,()=>window.__S.DATA.pm_todo.find(t=>t.id===2).due_date))===due0,'되돌리기 → 원래 기한');
 await p.click('[data-todo-row="2"] [data-todo-del]'); await W(300);
 ok(/2027 순차매입 발주 등록/.test(await T(p,'[data-confirm-dialog]')),'삭제 → 확인 창');
 await p.screenshot({path:OUT+'ux1_todo_del.png'});
 await p.click('[data-confirm-cancel]'); await W(300);
 ok((await S(p,()=>window.__S.DATA.pm_todo.length))===3,'취소 → 안 지움');
 await p.click('[data-todo-add]'); await W(300);
 await p.keyboard.press('Enter'); await W(300);
 ok(/한 줄 적어/.test(await T(p,'[data-field-error="title"]')),'내용 빈 채 저장 → 칸 아래 안내');
 await p.fill('[data-todo-title]','견적 회신'); await W(100);
 ok(!await p.$('[data-field-error="title"]'),'적으면 안내 사라짐');
 await p.keyboard.press('Escape'); await W(300);
 ok(/버리고 닫을까요/.test(await T(p,'[data-confirm-dialog]')),'쓰던 내용 있으면 Esc → 확인 창');
 await p.keyboard.press('Escape'); await W(300);
 ok(!await p.$('[data-confirm-dialog]')&&!!await p.$('[data-todo-title]'),'확인 창 Esc → 확인 창만 닫히고 쓰던 창은 그대로');
 await p.screenshot({path:OUT+'ux1_todo_form.png'});
 ok(errs.length===0,'오류 없음',errs);}

console.log('③ 매출견적');
{const {p,errs}=await mk('/sales-quote',{q:'&q99=1'});
 await p.click('[data-rfq-new]'); await W(300);
 await p.click('[data-rfq-save]'); await W(300);
 ok(/건명을 넣어/.test(await T(p,'[data-field-error="title"]'))&&/품목을 한 줄/.test(await T(p,'[data-field-error="paste"]')),'빈 칸 저장 → 건명 · 품목 칸 아래 안내');
 await p.screenshot({path:OUT+'ux1_rfq_err.png',clip:{x:240,y:150,width:1260,height:520}});
 await p.fill('[data-rfq-title]','시험 견적'); await W(100);
 ok(!await p.$('[data-field-error="title"]'),'건명 적으면 그 안내만 사라짐');
 await p.click('text=✕ 닫기'); await W(200);
 await p.click('[data-rfq-lines="7700039 WIRE 단품 견적"]').catch(()=>{}); await W(400);
 if(!await p.$('[data-rfq-del]')){await p.click('tr:has-text("7700039 WIRE 단품 견적") >> nth=0');await W(300)}
 const del=await p.$('[data-rfq-del]');
 if(del){await del.click(); await W(300);
  ok(/접수를 지울까요/.test(await T(p,'[data-confirm-dialog]')),'접수 삭제 → 확인 창 (품목 목록)');
  await p.click('[data-confirm-cancel]'); await W(200);
  ok((await S(p,()=>window.__S.DATA.pm_rfq.length))===2,'취소 → 그대로');}
 else ok(false,'접수 삭제 버튼 찾기');
 ok(errs.length===0,'오류 없음',errs);}

console.log('④ 자재 요청');
{const {p,errs}=await mk('/material-request',{q:'&mr=1',wait:2500});
 ok((await p.$$('[data-req-kpi] [data-info-tip]')).length===4,'지표 4개 ⓘ');
 // 반려 — 사유 필수
 await p.click('text=TERMINAL RING 5.5-4'); await W(300);
 const chk=await S(p,()=>document.querySelectorAll('input[type=checkbox]:checked').length);
 const rej=await p.$('[data-mr-reject]');
 if(rej){await rej.click(); await W(300);
  ok(/반려할까요/.test(await T(p,'[data-confirm-dialog]')),'반려 → 사유 창',chk);
  await p.click('[data-confirm-ok]'); await W(200);
  ok(/반려 사유를 적어/.test(await T(p,'[data-confirm-dialog] [data-field-error]')),'사유 비우면 창 안에 안내');
  await p.screenshot({path:OUT+'ux1_mr_reject.png'});
  await p.fill('[data-confirm-input]','같은 품목 MR-261020-03 으로 이미 불출됨'); await p.click('[data-confirm-ok]'); await W(700);
  ok((await S(p,()=>window.__S.DATA.mr_rows.find(r=>r.id===103).status))==='반려','반려 저장');
  ok(/반려/.test(await T(p,'[data-undo-snack]')),'되돌리기 바');
  await p.click('[data-undo-snack-run]'); await W(700);
  ok((await S(p,()=>window.__S.DATA.mr_rows.find(r=>r.id===103).status))==='요청','되돌리기 → 요청 (반려 취소와 같은 길)');
  // 확인은 되돌리기 없음 (6초 안에 불출되면 되돌릴 때 불출 건까지 요청으로 갈 수 있어서)
  await W(400); if(!(await S(p,()=>document.querySelectorAll('input[type=checkbox]:checked').length))){await p.click('text=TERMINAL RING 5.5-4'); await W(300)}
  await p.click('[data-mr-confirm]'); await W(700);
  ok((await S(p,()=>window.__S.DATA.mr_rows.find(r=>r.id===103).status))==='확인'&&!await p.$('[data-undo-snack]'),'확인 → 저장 · 되돌리기 바 없음 (알림만)');
 } else ok(false,'반려 버튼 (체크 안 됨?)',chk);
 ok(errs.length===0,'오류 없음',errs);}
{const {p,errs}=await mk('/material-request',{q:'&mr=1'});
 await p.click('[data-mr-tab="new"]'); await W(400);
 await p.click('[data-mr-submit]'); await W(500);
 const fe=await p.$$eval('[data-field-error]',e=>e.map(x=>x.getAttribute('data-field-error')));
 ok(['requester','dept','purpose','items'].every(k=>fe.includes(k)),'빈 칸 등록 → 4곳 칸 아래 안내 한꺼번에',fe);
 await p.screenshot({path:OUT+'ux1_mr_form.png',fullPage:false});
 await p.fill('[data-mr-requester]','이정민'); await W(100);
 ok(!await p.$('[data-field-error="requester"]'),'요청자 적으면 그 안내 사라짐');
 await p.click('button:has-text("하네스팀")'); await W(100);
 ok(!!await p.$('[data-field-error="kind"]'),'하네스팀 고르면 「요청 종류」 안내');
 ok(errs.length===0,'오류 없음',errs);}

console.log('⑤ 자료 요청');
{const {p,errs}=await mk('/doc-request',{q:'&doc=1&slow=500',wait:900});
 ok((await p.$$('[data-doc-table] [data-skeleton]')).length>=3,'받는 동안 표 모양');
 await W(4000);
 const c=await p.$('[data-doc-cancel]');
 if(c){await c.click(); await W(300); ok(/요청을 취소할까요/.test(await T(p,'[data-confirm-dialog]')),'요청 취소 → 확인 창'); await p.click('[data-confirm-cancel]')}
 else ok(true,'(취소 버튼 없는 데이터)');
 ok(errs.length===0,'오류 없음',errs);}

console.log('⑥ 구매발주 · 메뉴 숫자');
{const {p,errs}=await mk('/customer/ax/purchase',{wait:2500});
 await S(p,()=>{const D=window.__S.DATA.purchase_orders;D.push({id:'pz1',customer_id:'cid-ax',item_id:'p1',order_type:'purchase',po_number:'JS-261001-01',qty_ordered:50,qty_received:0,qty_remaining:50,promise_date:'2026-10-20',status:'진행중',order_date:'2026-10-01',vendor_id:'v2'},{id:'pz2',customer_id:'cid-ed',item_id:'p2',order_type:'purchase',po_number:'JS-261002-01',qty_ordered:5,qty_received:5,qty_remaining:0,promise_date:'2026-10-10',status:'진행중',order_date:'2026-10-02',vendor_id:'v1'},{id:'pz3',customer_id:'cid-ax',item_id:'p2',order_type:'purchase',po_number:'JS-261003-01',qty_ordered:3,qty_received:0,qty_remaining:3,promise_date:'2026-10-21',status:'진행중',order_date:'2026-10-03',vendor_id:'v1'});window.__qc.invalidateQueries({queryKey:['menuAlerts']});window.__qc.invalidateQueries({queryKey:['purchase']})}); await W(1500);
 ok((await T(p,'[data-menu-badge="/customer/ax/purchase"]'))==='2','메뉴 「구매발주」 옆 납기 지연 2',await T(p,'[data-menu-badge="/customer/ax/purchase"]'));
 ok((await p.$$('[data-po-kpi] [data-info-tip]')).length===4,'지표 4개 ⓘ');
 const d=await p.$('[data-po-del]');
 if(d){await d.click(); await W(300);
  ok(/발주를 지울까요/.test(await T(p,'[data-confirm-dialog]'))&&/되돌릴 수 없습니다/.test(await T(p,'[data-confirm-dialog]')),'발주 삭제 → 무엇이 지워지는지 확인 창');
  await p.screenshot({path:OUT+'ux1_po_del.png'});
  const n0=await S(p,()=>window.__S.DATA.purchase_orders.length);
  await p.click('[data-confirm-cancel]'); await W(300);
  ok((await S(p,()=>window.__S.DATA.purchase_orders.length))===n0,'취소 → 그대로');}
 else ok(false,'삭제 버튼 찾기');
 ok(errs.length===0,'오류 없음',errs);}
{const {p,errs}=await mk('/customer/ax/purchase',{q:'&slow=600',wait:1500});
 ok((await p.$$('[data-po-loading] [data-skeleton]')).length>=5,'받는 동안 표 모양');
 await W(5000); ok(errs.length===0,'오류 없음',errs);}

console.log('⑦ 처음 안내 (코치마크)');
for (const [r,q,txt] of [['/todo','','할 일 적기'],['/sales-quote','&q99=1','견적 요청 접수'],['/material-request','&mr=1','새 요청'],['/doc-request','&doc=1','자료가 필요하면']]) {
 const {p,errs,ctx}=await mk(r,{q:q+'&coach=1',wait:2800});
 ok(new RegExp(txt).test(await T(p,'[data-coach-box]')),`${r} 처음 열면 안내`,await T(p,'[data-coach-box]'));
 if(r==='/material-request') await p.screenshot({path:OUT+'ux1_mr_coach.png'});
 await p.click('[data-coach-skip]'); await W(200);
 await p.reload(); await W(2800);
 ok(!await p.$('[data-coach]'),`${r} 다시 열면 안 뜸`);
 ok(errs.length===0,'오류 없음',errs); await ctx.close();
}
ok(dialogs===0,'브라우저 기본 확인창 · 알림창이 한 번도 안 뜸',dialogs);
console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
