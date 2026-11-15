// v4.100.0 — 견적 불가 · 접수 수정 · 국문/영문 견적서 · 업무 흐름 권한
const {chromium}=require('playwright');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
const W=(ms)=>new Promise(r=>setTimeout(r,ms));
// v4.104.0 — 브라우저 prompt 대신 포털 확인 창: 입력 칸을 채우고 확인
const modal=async(p,v)=>{await p.waitForSelector('[data-confirm-dialog]',{timeout:3000});if(await p.$('[data-confirm-input]'))await p.fill('[data-confirm-input]',v);await p.click('[data-confirm-ok]')};
(async()=>{const b=await chromium.launch();
const mk=async(r,me,q='q99=1')=>{const p=await b.newPage({viewport:{width:1500,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
  let ans=[];p.on('dialog',d=>{const a=ans.shift();d.accept(a===undefined?'':a)});p.setAnswers=(a)=>{ans=a};
  await p.goto(`${base}?${q}${me?'&me='+encodeURIComponent(JSON.stringify(me)):''}&r=${encodeURIComponent(r)}`);await p.waitForTimeout(1800);return {p,errs}};
// 1. 견적 불가
{const {p,errs}=await mk('/sales-quote');
 await p.click('tr:has-text("7700039 WIRE 단품 견적") [data-rfq-act="check"]'); await W(1500);
 await p.click('[data-rfq-lines="7700039 WIRE 단품 견적"]'); await W(400);
 await p.selectOption('[data-rfq-nq-sel="7700039"]','단종'); await modal(p,'고객사 단종 통보'); await W(900);
 let L=await p.evaluate(()=>window.__S.DATA.pm_rfq_line.find(x=>x.id==='rl1'));
 ok(L.noquote==='단종'&&L.noquote_memo==='고객사 단종 통보','품목 견적 불가 + 사유 저장',L);
 ok(/견적 불가 1품목/.test(await p.textContent('tr:has-text("7700039 WIRE 단품 견적")')),'접수 줄에 「견적 불가 1품목」');
 ok(await p.locator('tr:has-text("7700039 WIRE 단품 견적") [data-rfq-act="nq-close"]').count()===0,'아직 다른 품목이 남아 닫기 버튼 없음');
 await p.click('[data-rfq-lines="7700039 WIRE 단품 견적"]').catch(()=>{}); await W(200);
 if(await p.locator('[data-rfq-nq-sel="110153030"]').count()===0){await p.click('[data-rfq-lines="7700039 WIRE 단품 견적"]'); await W(300)}
 await p.selectOption('[data-rfq-nq-sel="110153030"]','제작 불가'); await modal(p,''); await W(900);
 ok(await p.locator('tr:has-text("7700039 WIRE 단품 견적") [data-rfq-act="nq-close"]').count()===1,'모든 품목 불가 → 「🚫 견적 불가로 닫기」');
 await p.screenshot({path:'/tmp/jsportal-test/out/q_nq.png'});
 await p.click('tr:has-text("7700039 WIRE 단품 견적") [data-rfq-act="nq-close"]'); await modal(p,'단종 · 제작 불가 — 고객사 회신 완료'); await W(900);
 const R=await p.evaluate(()=>window.__S.DATA.pm_rfq.find(x=>x.id==='r2')); ok(R.status==='불가'&&/고객사 회신/.test(R.result_memo),'접수 「불가」로 닫힘 + 사유',R);
 ok(errs.length===0,'오류 없음',errs);
}
// 2. 접수 수정
{const {p,errs}=await mk('/sales-quote');
 await p.click('tr:has-text("LE Spare") [data-rfq-act="edit"]'); await W(400);
 ok(await p.locator('[data-rfq-edit-lines]').count()===1,'✏ 수정 → 지금 품목 목록');
 await p.fill('[data-rfq-title]','LE Spare (수정)');
 await p.click('[data-rfq-edit-del="AX-6200111"]');
 await p.fill('[data-rfq-paste]','AX-5000472\tTIE WRAP\t\t10');
 await p.screenshot({path:'/tmp/jsportal-test/out/q_edit.png'});
 await p.click('[data-rfq-save]'); await W(1800);
 const R=await p.evaluate(()=>window.__S.DATA.pm_rfq.find(x=>x.id==='r1')); ok(R.title==='LE Spare (수정)','건명 수정',R.title);
 const L=await p.evaluate(()=>window.__S.DATA.pm_rfq_line.filter(x=>x.rfq_id==='r1').map(x=>x.pn));
 ok(!L.includes('AX-6200111')&&L.includes('AX-5000472')&&L.includes('AX-5100052'),'품목 빼기 · 더하기',L);
 const add=await p.evaluate(()=>window.__S.DATA.pm_rfq_line.find(x=>x.pn==='AX-5000472'&&x.rfq_id==='r1')); ok(!!add.checked_at,'더한 품목 점검됨',add);
 ok(errs.length===0,'오류 없음',errs);
}
// 3. 국문 / 영문 견적서
{const {p,errs}=await mk('/sales-quote');
 await p.evaluate(()=>{for(const k of Object.keys(localStorage)) if(k.startsWith('pm_quote_contact')) localStorage.removeItem(k)});
 await p.reload(); await W(1800);
 await p.click('button:has-text("견적 작성")'); await W(800);
 ok((await p.textContent('[data-quote-title]')).includes('견 적 서'),'기본 = 국문 「견 적 서」');
 ok(await p.$eval('[data-quote-contact-name]',e=>e.value)==='김교한','국문 담당 = 로그인한 사람 이름');
 const sk=await p.textContent('[data-quote-supplier="ko"]'); ok(/\(주\)진선테크/.test(sk)&&/홍천석, 김동호/.test(sk)&&/차돌로 98/.test(sk),'국문 공급자 (사업자등록증)',sk.slice(0,120));
 await p.fill('[data-quote-contact-phone]','010-1234-5678');
 await p.click('[data-quote-lang-btn="en"]'); await W(300);
 ok((await p.textContent('[data-quote-title]')).includes('QUOTE'),'영문 = QUOTE');
 const se=await p.textContent('[data-quote-supplier="en"]'); ok(/ChunSeok Hong, DongHo Kim/.test(se),'영문 CEO 공동대표',se.slice(0,160));
 ok(await p.$eval('[data-quote-contact-name]',e=>e.value)===''&&await p.$eval('[data-quote-contact-phone]',e=>e.value)==='','영문 Contact · 연락처 처음엔 공란');
 await p.fill('[data-quote-contact-name]','Gyohan Kim'); await p.fill('[data-quote-contact-phone]','82+10-1234-5678');
 await p.screenshot({path:'/tmp/jsportal-test/out/q_en.png'});
 await p.click('[data-quote-lang-btn="ko"]'); await W(300);
 ok(await p.$eval('[data-quote-contact-name]',e=>e.value)==='김교한'&&await p.$eval('[data-quote-contact-phone]',e=>e.value)==='010-1234-5678','국문으로 돌아오면 국문 담당 그대로');
 await p.screenshot({path:'/tmp/jsportal-test/out/q_ko.png'});
 await p.reload(); await W(1800); await p.click('button:has-text("견적 작성")'); await W(800);
 ok(await p.$eval('[data-quote-contact-phone]',e=>e.value)==='010-1234-5678','다시 열어도 국문 연락처 기억');
 await p.click('[data-quote-lang-btn="en"]'); await W(300);
 ok(await p.$eval('[data-quote-contact-name]',e=>e.value)==='Gyohan Kim','다시 열어도 영문 Contact 기억');
 const ks=await p.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('pm_quote_contact'))); ok(ks.includes('pm_quote_contact.u1'),'계정별로 저장',ks);
 ok(errs.length===0,'오류 없음',errs);
}
// 4. 업무 흐름 권한
{const off={dept:'제조',role:'editor',menu_scope:['floor','-flow']}; const {p,errs}=await mk('/flow',off,'');
 ok(await p.locator('[data-flowmap], [data-workflow]').count()===0,'흐름 끈 계정: /flow 열면 다른 화면으로');
 ok(!/업무 흐름/.test(await p.textContent('aside, nav').catch(()=>'')),'사이드바에 업무 흐름 없음');
 const on={dept:'제조',role:'editor',menu_scope:['floor']}; const r2=await mk('/flow',on,'');
 ok(await r2.p.locator('[data-flowmap], [data-workflow]').count()>=1,'예전 계정(기록 없음)은 그대로 보임');
 const ad=await mk('/users',null,'');
 ok(errs.length===0&&r2.errs.length===0,'오류 없음',[errs,r2.errs]);
}
console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
