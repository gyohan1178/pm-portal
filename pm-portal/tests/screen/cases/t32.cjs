// v4.104.0 — 수주대장 UX: 스켈레톤 · 지표 ⓘ · 회신 칸 안내 · 되돌리기 · 삭제 확인 · 메뉴 숫자 · 업로드 단계 · 처음 안내
const {chromium}=require('playwright');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
const T=async(p,s)=>(await p.textContent(s).catch(()=>'')||'').replace(/\s+/g,' ').trim();
const OUT='/tmp/jsportal-test/out/';
(async()=>{const b=await chromium.launch();
const mk=async({me,w=1500,extra='',seen=true,wait=2200}={})=>{
  const ctx=await b.newContext({viewport:{width:w,height:1000}});
  if(seen) await ctx.addInitScript(()=>{try{localStorage.setItem('pm_coach_seen_orders-sales','1')}catch{}});
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto(`${base}?fastx=1${seen?'':'&coach=1'}${extra}${me?`&me=${encodeURIComponent(JSON.stringify(me))}`:''}&r=${encodeURIComponent('/orders')}`);
  if(wait) await p.waitForTimeout(wait); return {p,errs,ctx}};
const S=(p,f)=>p.evaluate(f);

console.log('① 느린 연결 — 표 모양 먼저');
{const {p,errs}=await mk({extra:'&slow=800',wait:0});
 await p.waitForTimeout(1600);
 const sk=await p.$$eval('[data-skeleton]',e=>e.length).catch(()=>0);
 ok(sk>=5,'불러오는 동안 스켈레톤 줄',sk);
 ok(!/불러오는 중…/.test(await T(p,'[data-line-table]')),'「불러오는 중…」 글자 대신');
 await p.screenshot({path:OUT+'ux_oi_skel.png',clip:{x:240,y:0,width:1260,height:760}});
 await p.waitForTimeout(4500);
 ok((await p.$$('[data-skeleton]')).length===0,'다 받으면 스켈레톤 사라짐');
 ok(!!await p.$('[data-row="PO2610000242|1/1"]'),'실제 줄 나옴');
 ok(errs.length===0,'오류 없음',errs);}

console.log('② 구매자재 — 지표 ⓘ · 메뉴 숫자 · 회신 칸 안내 · 되돌리기');
{const {p,errs}=await mk();
 ok((await T(p,'[data-menu-badge="/orders"]'))==='1','메뉴 수주대장 옆 미확인 PO 1',await T(p,'[data-menu-badge="/orders"]'));
 await p.click('[data-kpi="미확인"] [data-info-tip]');
 const tip=await T(p,'[data-info-tip-body]');
 ok(/1영업일/.test(tip),'ⓘ 누르면 기준 설명',tip.slice(0,60));
 const ring=await p.$eval('[data-kpi="미확인"]',e=>e.className.includes('ring-2'));
 ok(!ring,'ⓘ 눌러도 지표 거르기는 안 걸림');
 await p.screenshot({path:OUT+'ux_oi_tip.png',clip:{x:240,y:120,width:1000,height:330}});
 await p.mouse.click(1400,950);
 ok(!await p.$('[data-info-tip-body]'),'바깥 누르면 닫힘');
 ok(await p.$$eval('[data-kpi] [data-info-tip]',e=>e.length)===6,'지표 5개 + 예상 매출 ⓘ');

 // 회신 — 결론 안 고르고 저장
 await p.click('[data-row="PO2610000242|1/1"] input[type=checkbox]');
 await p.click('[data-bulk] [data-reply-save]');
 ok(/하나를 고르세요/.test(await T(p,'[data-field-error="reply"]')),'결론 안 고르면 그 자리에 빨간 안내');
 await p.click('[data-bulk] [data-reply="조건부"]');
 ok(!await p.$('[data-field-error="reply"]'),'고르면 안내 사라짐');
 await p.click('[data-bulk] [data-reply-save]');
 ok(/사유가 꼭 필요/.test(await T(p,'[data-field-error="memo"]')),'조건부인데 메모 없으면 메모 칸 아래 안내');
 await (await p.$('[data-bulk]')).screenshot({path:OUT+'ux_oi_err.png'});
 ok((await S(p,()=>window.__S.DATA.pm_order_line.find(l=>l.id==='l2').reply))==null,'안내 뜨는 동안은 저장 안 됨');
 await p.fill('[data-bulk] [data-reply-memo]','EDA PC 12/5 입고 예정');
 await p.click('[data-bulk] [data-reply-save]');
 await p.waitForTimeout(500);
 const sn=await T(p,'[data-undo-snack]');
 ok(/1품목 「조건부」 회신 저장/.test(sn)&&/되돌리기/.test(sn),'저장 → 아래 되돌리기 바',sn);
 let l2=await S(p,()=>window.__S.DATA.pm_order_line.find(l=>l.id==='l2'));
 let o2=await S(p,()=>window.__S.DATA.pm_order.find(o=>o.id==='o2'));
 ok(l2.reply==='조건부'&&!!o2.confirmed_at,'회신 저장 · PO 확인됨');
 await p.waitForTimeout(400);
 ok(!await p.$('[data-menu-badge="/orders"]'),'메뉴 미확인 숫자 사라짐');
 await p.screenshot({path:OUT+'ux_oi_snack.png',clip:{x:240,y:600,width:1260,height:400}});
 await p.click('[data-undo-snack-run]');
 await p.waitForTimeout(700);
 l2=await S(p,()=>window.__S.DATA.pm_order_line.find(l=>l.id==='l2'));
 o2=await S(p,()=>window.__S.DATA.pm_order.find(o=>o.id==='o2'));
 ok(l2.reply==null&&l2.reply_memo==null&&l2.replied_name==null,'되돌리기 → 회신 칸 원래대로(빈 칸)',l2);
 ok(o2.confirmed_at==null,'처음 확인된 PO 는 다시 미확인',o2.confirmed_at);
 const lg=await S(p,()=>window.__S.DATA.pm_order_change.filter(c=>c.before_val==='(되돌림)').length);
 ok(lg===1,'변경 이력에 (되돌림) 남음',lg);
 ok(!await p.$('[data-undo-snack]'),'바 닫힘');
 ok(/미회신|회신 대기|—/.test(await T(p,'[data-row="PO2610000242|1/1"]'))&&!/조건부/.test(await T(p,'[data-row="PO2610000242|1/1"]')),'화면 줄도 원래대로');
 await p.waitForTimeout(400);
 ok((await T(p,'[data-menu-badge="/orders"]'))==='1','메뉴 숫자 다시 1');

 // 이미 확인된 PO(o1) 회신 → 되돌려도 PO 확인은 유지
 await p.click('[data-row="47894KF|2/1"] input[type=checkbox]');
 await p.click('[data-bulk] [data-reply="가능"]');
 await p.click('[data-bulk] [data-reply-save]');
 await p.waitForTimeout(400); await p.click('[data-undo-snack-run]'); await p.waitForTimeout(600);
 const l1=await S(p,()=>window.__S.DATA.pm_order_line.find(l=>l.id==='l1'));
 const o1=await S(p,()=>window.__S.DATA.pm_order.find(o=>o.id==='o1'));
 ok(l1.reply==='조건부'&&l1.reply_memo==='EFEM 판금 11/27 입고','원래 회신(조건부 · 메모) 그대로 돌아옴',l1);
 ok(!!o1.confirmed_at,'원래 확인된 PO 는 확인 유지');

 // 납품 표시 → 되돌리기
 await p.click('[data-row="PO2610000242|1/1"] input[type=checkbox]');
 await p.click('[data-bulk-dlv]'); await p.waitForTimeout(500);
 ok(/납품 표시 1품목/.test(await T(p,'[data-undo-snack]')),'납품 표시 → 되돌리기 바');
 ok((await S(p,()=>window.__S.DATA.pm_order_line.find(l=>l.id==='l2').delivered_qty))===11,'납품 11 저장');
 await p.click('[data-undo-snack-run]'); await p.waitForTimeout(600);
 const d=await S(p,()=>window.__S.DATA.pm_order_line.find(l=>l.id==='l2'));
 ok(+d.delivered_qty===0&&d.delivered_at==null,'되돌리기 → 납품 0',d);
 ok(!!await p.$('[data-row="PO2610000242|1/1"]'),'진행 중 목록에 다시 나옴');

 // 6초 지나면 바 사라짐
 await p.click('[data-row="PO2610000242|1/1"] input[type=checkbox]');
 await p.click('[data-bulk-dlv]'); await p.waitForTimeout(6700);
 ok(!await p.$('[data-undo-snack]'),'6초 지나면 바 자동으로 닫힘');
 ok((await S(p,()=>window.__S.DATA.pm_order_line.find(l=>l.id==='l2').delivered_qty))===11,'닫혀도 저장은 그대로');
 ok(errs.length===0,'오류 없음',errs);}

console.log('③ PO 삭제 — 확인 창');
{const {p,errs}=await mk();
 await p.click('[data-po-link="PO2610000242"]'); await p.waitForTimeout(800);
 await p.click('[data-del]'); await p.waitForTimeout(300);
 const c=await T(p,'[data-confirm-dialog]');
 ok(/PO2610000242 를 수주대장에서 지울까요/.test(c)&&/되돌릴 수 없습니다/.test(c),'무엇이 지워지는지 확인 창',c.slice(0,90));
 ok(/790-3003-320 · 11개/.test(await T(p,'[data-confirm-items]')),'지워질 품목 줄 목록',await T(p,'[data-confirm-items]'));
 await p.screenshot({path:OUT+'ux_oi_del.png'});
 await p.click('[data-confirm-cancel]'); await p.waitForTimeout(300);
 ok((await S(p,()=>window.__S.DATA.pm_order.some(o=>o.id==='o2'))),'취소 → 안 지워짐');
 await p.click('[data-del]'); await p.waitForTimeout(300);
 await p.click('[data-confirm-ok]'); await p.waitForTimeout(600);
 ok(!(await S(p,()=>window.__S.DATA.pm_order.some(o=>o.id==='o2'))),'PO 삭제 누르면 지워짐');
 ok(errs.length===0,'오류 없음',errs);}

console.log('④ PDF 올리기 — 단계 표시');
{const {p,errs}=await mk();
 await p.click('[data-open-upload]'); await p.waitForTimeout(400);
 const st=await p.$$eval('[data-order-upload] [data-step]',e=>e.map(x=>x.getAttribute('data-step-state')));
 ok(st.join()==='on,todo,todo,todo','4단계 · 첫 단계 진행 중',st);
 await p.screenshot({path:OUT+'ux_oi_upload.png',clip:{x:0,y:0,width:1500,height:330}});
 ok(errs.length===0,'오류 없음',errs);}

console.log('⑤ 영업 화면 — 처음 안내');
{const me={name:'이정민',dept:'영업',role:'user'};
 const {p,errs,ctx}=await mk({me,seen:false,wait:2600});
 const box=await T(p,'[data-coach-box]');
 ok(/체크해서 자재 요청/.test(box)&&/1 \//.test(box),'처음 열면 ① 안내가 뜸',box.slice(0,60));
 await p.screenshot({path:OUT+'ux_oi_coach.png'});
 await p.click('[data-coach-next]'); await p.waitForTimeout(300);
 ok(/특이사항 확인/.test(await T(p,'[data-coach-box]')),'다음 → ② 특이사항');
 await p.screenshot({path:OUT+'ux_oi_coach2.png'});
 for(let i=0;i<3&&await p.$('[data-coach-next]');i++){await p.click('[data-coach-next]');await p.waitForTimeout(250)}
 ok(!await p.$('[data-coach]'),'끝까지 보면 닫힘');
 await p.reload(); await p.waitForTimeout(2600);
 ok(!await p.$('[data-coach]'),'다시 열면 안 뜸 (한 번만)');
 await p.click('[data-coach-again]'); await p.waitForTimeout(300);
 ok(/체크해서 자재 요청/.test(await T(p,'[data-coach-box]')),'「💡 안내 다시 보기」로 다시');
 await p.click('[data-coach-skip]');
 ok(!await p.$('[data-menu-badge="/orders"]'),'영업 화면 메뉴엔 미확인 숫자 없음');
 ok(errs.length===0,'오류 없음',errs);
 await ctx.close();}
{const {p,errs}=await mk({seen:false,wait:2600});
 ok(!await p.$('[data-coach]')&&!await p.$('[data-coach-again]'),'구매자재 화면엔 안내 안 뜸');
 ok(errs.length===0,'오류 없음',errs);}

console.log('⑥ 휴대폰 — 카드 스켈레톤');
{const {p,errs}=await mk({w:400,extra:'&slow=800',wait:0});
 await p.waitForTimeout(1600);
 ok((await p.$$('[data-mobile-list] [data-skeleton]')).length>=3,'휴대폰도 카드 모양 먼저');
 await p.screenshot({path:OUT+'ux_oi_skel_m.png'});
 await p.waitForTimeout(4000);
 ok(errs.length===0,'오류 없음',errs);}

console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
