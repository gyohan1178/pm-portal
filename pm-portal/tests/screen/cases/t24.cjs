// v4.102.0 — 생산관리 대상 · 수주대장 ↔ 생산관리 매칭
const {chromium}=require('playwright');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
const W=(ms)=>new Promise(r=>setTimeout(r,ms));
const kv=async(p,k)=>Number((await p.textContent(`[data-pt-kpi="${k}"]`)).replace(/[^\d]/g,'').slice(0,4)) ;
(async()=>{const b=await chromium.launch();
const mk=async(r,q='pt=1',w=1500)=>{const p=await b.newPage({viewport:{width:w,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto(`${base}?${q}&r=${encodeURIComponent(r)}`);await p.waitForTimeout(2000);return {p,errs}};
// 1. AXCELIS
{const {p,errs}=await mk('/production/targets');
 ok(/생산관리 대상/.test(await p.textContent('[data-page-title]')),'메뉴 · 화면 열림');
 ok(/생산관리 대상/.test(await p.textContent('aside, nav')),'사이드바에 「🎯 생산관리 대상」');
 const t=async(k)=>(await p.textContent(`[data-pt-kpi="${k}"]`)).replace(/\s/g,'');
 ok(/진행중3/.test(await t('open')),'AX 생산관리 진행 3',await t('open'));
 ok(/연결됨2/.test(await t('linked')),'수주와 연결 2 (#12 · #13)',await t('linked'));
 ok(/연결안됨1/.test(await t('unlinked')),'연결 안 됨 1',await t('unlinked'));
 ok(/고객사 PO 가 아직 안 붙음/.test(await p.textContent('[data-pt-unlinked-row="#1"]')),'이유: 고객사 PO 안 붙음');
 ok(await p.locator('[data-pt-row="AX-110153030"]').count()===1,'대상 품번 목록 (AX-110153030 · 주요품목)');
 ok(/3\s*·\s*1줄/.test(await p.textContent('[data-pt-row="AX-110153030"]')),'진행 PO 수량 3 · 1줄',await p.textContent('[data-pt-row="AX-110153030"]'));
 ok(await p.locator('[data-pt-auto-add="AX-110158840"]').count()===1,'목록에 없는 AX-11 진행 PO → 「자동 대상」 + 넣기 버튼');
 await p.click('[data-pt-group="Sub 품목"]'); await W(200);
 await p.click('[data-pt-auto-add="AX-110158840"]').catch(()=>{});
 await p.click('[data-pt-group="전체"]'); await W(300);
 await p.click('[data-pt-auto-add="AX-110158840"]'); await W(900);
 let T=await p.evaluate(()=>window.__S.DATA.pm_prod_target.find(x=>x.pn==='AX-110158840'));
 ok(T&&T.active&&T.customer_code==='AX','자동 대상 → 목록에 넣음',T);
 await p.click('[data-pt-row="AX-110158840"] [data-pt-toggle]'); await W(800);
 T=await p.evaluate(()=>window.__S.DATA.pm_prod_target.find(x=>x.pn==='AX-110158840'));
 ok(T.active===false,'「대상」 누르면 「제외」',T.active);
 await p.selectOption('[data-pt-row="AX-110158840"] [data-pt-row-group]',{label:'Sub 품목'}); await W(800);
 T=await p.evaluate(()=>window.__S.DATA.pm_prod_target.find(x=>x.pn==='AX-110158840'));
 ok(T.group_id===2,'그룹 옮기기 → Sub 품목',T.group_id);
 await p.fill('[data-pt-new-group]','하네스 ASSY'); await p.click('[data-pt-add-group]'); await W(800);
 ok(await p.evaluate(()=>window.__S.DATA.pm_prod_group.some(g=>g.name==='하네스 ASSY'&&g.customer_code==='AX')),'그룹 추가');
 await p.screenshot({path:'/tmp/jsportal-test/out/pt_ax.png',fullPage:true});
 ok(errs.length===0,'오류 없음',errs);
}
// 2. CSK · VM · Edwards
{const {p,errs}=await mk('/production/targets');
 await p.click('[data-pt-cust="CSK"]'); await W(800);
 ok((await p.textContent('[data-pt-kpi="unlinked"]')).replace(/\s/g,'').includes('연결안됨1'),'CSK: 연결 안 됨 1 (뷰에 없음)');
 ok(/Plnd PL001/.test(await p.textContent('[data-pt-unlinked-row="JS2609-18"]')),'이유에 Plnd 번호');
 ok(/일정 엑셀/.test(await p.textContent('[data-pt-how]')),'CSK: 생산관리는 일정 엑셀 · 연결만 안내');
 await p.click('[data-pt-cust="VM"]'); await W(800);
 ok(/PROJECT EM3A76/.test(await p.textContent('[data-pt-unlinked-row="EM3A76"]')),'VM: PROJECT 코드 PO 없음 안내');
 await p.click('[data-pt-cust="ED"]'); await W(900);
 const e=async(k)=>(await p.textContent(`[data-pt-kpi="${k}"]`)).replace(/\s/g,'');
 ok(/진행중3/.test(await e('open'))&&/연결됨2/.test(await e('linked'))&&/연결안됨1/.test(await e('unlinked')),'Edwards: 진행 3 · 연결 2 · 안 됨 1',[await e('open'),await e('linked'),await e('unlinked')]);
 ok(/추정」연결호기1/.test(await e('lines'))&&/PO3/.test(await e('lines')),'Edwards: 연결된 PO 3 · 추정 1',await e('lines'));
 ok(/BLENDER BOX Rev.3 OMT #12/.test(await p.textContent('[data-pt-unlinked-row="#12"]')),'Edwards 안 된 이유: 프로젝트 · 호기 PO 없음');
 await p.click('[data-pt-linked] summary'); await W(200);
 ok(await p.locator('[data-pt-linked-row="#13"] [data-pt-guess]').count()===1,'「추정」 표시 · 맨 위');
 await p.screenshot({path:'/tmp/jsportal-test/out/pt_ed.png',fullPage:true});
 ok(errs.length===0,'오류 없음',errs);
}
// 3. 수주대장에 🏭 호기
{const {p,errs}=await mk('/orders');
 const t=await p.getAttribute('[data-row="47894KF|2/1"] [data-prod-link]','data-prod-link');
 ok(t==='#12,#13','수주대장 줄에 「🏭 #12 #13」 (번호 순)',t);
 await p.click('[data-po-link="47894KF"]'); await W(500);
 ok(await p.locator('[data-dline="2/1"] [data-prod-link]').count()===1,'PO 상세에도 🏭');
 ok(errs.length===0,'오류 없음',errs);
 const m=await mk('/orders','pt=1',400);
 ok(await m.p.locator('[data-mcard="47894KF|2/1"] [data-prod-link]').count()===1,'휴대폰 카드에도 🏭');
}
// 4. SQL 전 — 안내만, 수주대장은 그대로
{const {p,errs}=await mk('/production/targets','ptmiss=1');
 ok(await p.locator('[data-pt-sql]').count()===1,'표가 없으면 SQL 안내',await p.textContent('main').catch(()=>''));
 const o=await mk('/orders','ptmiss=1');
 ok(await o.p.locator('[data-prod-link]').count()===0&&o.errs.length===0,'SQL 전 수주대장 오류 없음 (🏭 없음)',o.errs);
}
console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
