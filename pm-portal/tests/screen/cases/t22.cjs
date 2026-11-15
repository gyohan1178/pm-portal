// v4.101.0 — 자료 요청 「직접 입력」 · 왜 필요한지 목록에 보이기
const {chromium}=require('playwright');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
const W=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{const b=await chromium.launch();
const mk=async(me,q='')=>{const p=await b.newPage({viewport:{width:1500,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto(`${base}?${q}${me?'me='+encodeURIComponent(JSON.stringify(me))+'&':''}r=${encodeURIComponent('/doc-request')}`);await p.waitForTimeout(1800);return {p,errs}};
// 1. 품질에서 CN 내역 요청 (품번 없음)
{const {p,errs}=await mk({role:'editor',dept:'품질',is_lead:false});
 await p.click('[data-doc-req-open]'); await W(400);
 ok((await p.textContent('[data-doc-kind="기타"]')).trim()==='직접 입력','버튼 이름 「직접 입력」');
 await p.click('[data-doc-kind="기타"]'); await W(200);
 ok(await p.locator('[data-doc-label]').count()===1,'직접 입력 → 자료 이름 칸');
 await p.click('[data-doc-cust="AX"]');
 await p.fill('[data-doc-reason]','EFEM PD 리뉴얼 설계변경 이력 확인 — 초도품 성적서에 넣어야 함');
 await p.click('[data-doc-submit]'); await W(500);
 ok(await p.locator('[data-doc-req-modal]').count()===1,'이름 없으면 안 넘어감 (창 그대로)');
 await p.fill('[data-doc-label]','CN 내역'); await W(600);
 await p.click('[data-doc-submit]'); await W(900);
 const R=await p.evaluate(()=>window.__S.DATA.pm_doc_request.find(x=>x.kind_label==='CN 내역'));
 ok(R&&R.kind==='기타'&&R.part_no===''&&R.customer_code==='AX'&&/설계변경/.test(R.reason),'저장: kind 기타 + 이름 CN 내역 · 품번 없음 · 사유',R);
 ok(errs.length===0,'오류 없음',errs);
}
// 2. 영업 화면 — 이름 · 사유가 목록에 바로 보임, 누르면 전체
{const {p,errs}=await mk({role:'editor',dept:'영업',is_lead:false},'docetc=1&');
 ok((await p.textContent('[data-doc-row="9"] [data-doc-kind-label]')).trim()==='CN 내역','자료 칸에 「CN 내역」');
 ok(/품번 없음/.test(await p.textContent('[data-doc-row="9"]')),'품번 칸 「품번 없음」');
 ok(/설계변경 이력 확인/.test(await p.textContent('[data-doc-row="9"] [data-doc-reason-show]')),'💬 사유가 목록에 바로 보임');
 const r1=await p.locator('[data-doc-row="1"] [data-doc-reason-show]').count();
 await p.click('[data-doc-row="9"] [data-doc-reason-show]'); await W(300);
 ok(/110219638 변경점 전체/.test(await p.textContent('[data-doc-reason-full]')),'누르면 아래에 사유 전체');
 await p.screenshot({path:'/tmp/jsportal-test/out/doc_etc.png'});
 await p.click('[data-doc-mail-btn]'); await W(300);
 ok(/CN 내역/.test(await p.textContent('[data-doc-mail-text]')),'고객사 요청 메일에 「CN 내역」',(await p.textContent('[data-doc-mail-text]')).slice(0,200));
 ok(!/undefined|null/.test(await p.textContent('[data-doc-mail-text]')),'메일 문구에 빈 값 표시 없음');
 ok(errs.length===0,'오류 없음',errs);
}
// 3. 같은 이름 요청은 「같이 기다리기」, 다른 이름은 새로
{const {p,errs}=await mk({role:'editor',dept:'구매자재',is_lead:false},'docetc=1&');
 await p.click('[data-doc-req-open]'); await W(300);
 await p.click('[data-doc-kind="기타"]'); await p.click('[data-doc-cust="AX"]'); await p.fill('[data-doc-label]','cn 내역'); await W(800);
 ok(await p.locator('[data-doc-same]').count()===1,'같은 이름(대소문자 무시) → 「같이 기다리기」 안내');
 await p.fill('[data-doc-label]','성적서'); await W(800);
 ok(await p.locator('[data-doc-same]').count()===0,'다른 이름 → 새 요청');
 ok(errs.length===0,'오류 없음',errs);
}
console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
