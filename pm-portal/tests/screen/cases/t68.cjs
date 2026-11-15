// v4.141.0 — 수주대장 납기 일괄 변경
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const T=async(p,s)=>(await p.textContent(s).catch(()=>'')||'').replace(/\s+/g,' ').trim();
(async()=>{const b=await chromium.launch();const errs=[];
const mk=async(me)=>{const ctx=await b.newContext({viewport:{width:1500,height:1000}});
  await ctx.addInitScript(()=>{try{localStorage.setItem('pm_coach_seen_orders-sales','1');localStorage.setItem('pm_coach_seen_orders-buy','1')}catch{}});
  const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));
  await p.goto(`http://localhost:8765/app.html?${me?'me='+encodeURIComponent(JSON.stringify(me))+'&':''}r=${encodeURIComponent('/orders')}`);await p.waitForTimeout(2200);return p}
const line=(p,id)=>p.evaluate((id)=>JSON.parse(JSON.stringify(window.__S.DATA.pm_order_line.find(r=>r.id===id))),id)
const chg=(p)=>p.evaluate(()=>JSON.parse(JSON.stringify((window.__S.DATA.pm_order_change||[]).filter(c=>['due_date','reply_reset'].includes(c.field)))))
const R1='[data-row="47894KF|2/1"]', R2='[data-row="PO2610000242|1/1"]'
console.log('① 구매자재 화면 — 2품목 납기 당김 · 사유')
let p=await mk()
ok(!!await p.$(R1)&&!!await p.$(R2),'두 줄 보임')
await p.click(R1+' input[type=checkbox]'); await p.click(R2+' input[type=checkbox]'); await p.waitForTimeout(300)
ok(!!await p.$('[data-bulk-due-ctl]'),'일괄 줄에 「📅 납기」')
ok(await p.$eval('[data-bulk-due]',e=>e.disabled),'날짜 고르기 전엔 변경 꺼짐')
await p.fill('[data-bulk-due-date]','2026-12-10'); await p.click('[data-bulk-due]'); await p.waitForTimeout(300)
const dlg=await T(p,'[data-confirm-dialog]'); console.log('    ',dlg.slice(0,260))
ok(/2품목 납기를 2026-12-10 로/.test(dlg)&&/당겨지는 1품목은 구매자재 회신이 지워져/.test(dlg),'확인 창 — 2품목 · 당겨지는 1품목 회신 다시',dlg)
ok(/2026-12-30 → 2026-12-10 \(회신 다시\)/.test(dlg)&&/2026-11-20 → 2026-12-10/.test(dlg),'줄마다 전 → 후')
await p.fill('[data-confirm-input]','고객사 요청'); await p.click('[data-confirm-ok]'); await p.waitForTimeout(1000)
let l1=await line(p,'l1'), l2=await line(p,'l2')
ok(l1.due_date==='2026-12-10'&&l2.due_date==='2026-12-10','두 줄 납기 2026-12-10')
ok(l1.reply==null&&l1.reply_memo==null,'당겨진 줄(조건부 회신) → 회신 비움',l1.reply)
let c=await chg(p); ok(c.length===3&&c.filter(x=>x.field==='due_date').every(x=>x.after_val==='2026-12-10 · 고객사 요청'&&x.changed_name==='김교한')&&c.find(x=>x.field==='due_date'&&x.before_val==='2026-12-30'),'변경 이력 — 납기 2줄(사유 포함) · 회신 초기화 1',c)
ok(/2026-12-10/.test(await T(p,R1))&&!await p.$(R1+' input[type=checkbox]:checked'),'화면 바로 바뀜 · 체크 풀림')
ok(/납기 변경 2품목 · 회신 초기화 1/.test(await T(p,'body')),'안내 + 되돌리기')
console.log('② 되돌리기')
await p.click('[data-undo-snack-run]'); await p.waitForTimeout(900)
l1=await line(p,'l1'); l2=await line(p,'l2')
ok(l1.due_date==='2026-12-30'&&l1.reply==='조건부'&&l1.reply_memo==='EFEM 판금 11/27 입고'&&l2.due_date==='2026-11-20','납기 · 회신 원래대로',[l1.due_date,l1.reply,l2.due_date])
await p.close()
console.log('③ 영업 화면 — 미루기 (회신 그대로) · 같은 날짜 건너뜀')
p=await mk({dept:'영업',role:'editor',is_lead:false})
await p.click(R1+' input[type=checkbox]'); await p.click(R2+' input[type=checkbox]'); await p.waitForTimeout(300)
ok(!!await p.$('[data-bulk-due-ctl]'),'영업 일괄 줄에도 「📅 납기」')
await p.fill('[data-bulk-due-date]','2026-12-30'); await p.click('[data-bulk-due]'); await p.waitForTimeout(300)
const d2=await T(p,'[data-confirm-dialog]'); ok(/1품목 납기를 2026-12-30 로/.test(d2)&&/이미 2026-12-30 인 1품목은 건너뜁니다/.test(d2)&&!/회신이 지워져/.test(d2),'1품목만 · 같은 날짜 건너뜀 · 회신 안내 없음',d2.slice(0,200))
await p.click('[data-confirm-ok]'); await p.waitForTimeout(900)
l1=await line(p,'l1'); l2=await line(p,'l2')
ok(l2.due_date==='2026-12-30'&&l1.reply==='조건부','미룬 줄만 바뀜 · 회신 그대로')
ok((await chg(p)).filter(x=>x.after_val==='2026-12-30').length===1,'사유 없으면 날짜만 이력')
await p.click(R1+' input[type=checkbox]'); await p.fill('[data-bulk-due-date]','2026-12-30'); await p.click('[data-bulk-due]'); await p.waitForTimeout(300)
ok(/이미 납기 2026-12-30/.test(await T(p,'body'))&&!await p.$('[data-confirm-dialog]'),'바꿀 게 없으면 알림만')
await p.screenshot({path:'/tmp/jsportal-test/out/t68.png',clip:{x:240,y:0,width:1260,height:420}})
ok(errs.length===0,'오류 없음',errs);
console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close();})();
