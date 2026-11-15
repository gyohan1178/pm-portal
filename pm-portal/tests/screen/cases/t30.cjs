// v4.103.0 — 수주대장에서 체크 → 📦 자재 요청 (영업 화면 · 구매자재 화면 · 휴대폰)
const {chromium}=require('playwright');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
const W=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{const b=await chromium.launch();
const mk=async(me,w=1500,extra='')=>{const p=await b.newPage({viewport:{width:w,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(()=>{try{localStorage.setItem('pm_coach_seen_orders-sales','1')}catch{}});   // 처음 안내(v4.104.0)는 t32 에서 따로
  await p.goto(`${base}?fastx=1${extra}&me=${encodeURIComponent(JSON.stringify(me))}&r=${encodeURIComponent('/orders')}`);await p.waitForTimeout(2200);
  await p.evaluate(()=>{const S=window.__S; S.DATA.pm_material_request=S.DATA.pm_material_request||[]; S.RPCFN.pm_request_create=({p_rows})=>{p_rows.forEach((r,i)=>S.DATA.pm_material_request.push({id:'mrx'+S.DATA.pm_material_request.length,req_no:'MR-T1',status:'요청',...r}));return p_rows.length}});
  return {p,errs}};
// ① 영업 화면 (정민)
{const {p,errs}=await mk({name:'이정민',dept:'영업',role:'user'});
 ok(/영업/.test(await p.textContent('[data-view-badge]')),'영업 화면');
 ok(await p.locator('[data-check="47894KF|2/1"]').count()===1,'영업 화면에도 체크 칸');
 await p.check('[data-check="47894KF|2/1"]'); await p.check('[data-check="PO2610000242|1/1"]'); await W(300);
 ok(await p.locator('[data-bulk-mr]').count()===1,'「📦 자재 요청 2」 버튼',await p.textContent('[data-bulk]').catch(()=>''));
 ok(await p.locator('[data-reply-form], [data-bulk-dlv]').count()===0,'영업 화면엔 회신 · 납품 표시 버튼 없음');
 await p.click('[data-bulk-mr]'); await W(700);
 ok(await p.locator('[data-mr-modal]').count()===1,'자재 요청 창 열림');
 ok(await p.inputValue('[data-mr-requester]')==='이정민','요청자 = 로그인한 사람');
 ok(/PO 47894KF 외 1건|PO PO2610000242 외 1건/.test(await p.inputValue('[data-mr-purpose]')),'사용 목적 기본값 (PO 번호)',await p.inputValue('[data-mr-purpose]'));
 ok(await p.inputValue('[data-mr-need]')==='2026-11-20','필요일 = 가장 빠른 납기 (11-20)',await p.inputValue('[data-mr-need]'));
 const q=await p.$$eval('[data-mr-qty]',a=>a.map(x=>x.value));
 ok(q.includes('3')&&q.includes('11'),'수량 = 남은 수량 (3 · 11)',q);
 ok(/코드 미등록/.test(await p.textContent('[data-mr-row="수주 PO PO2610000242 · 1/1"]')),'코드 없는 고객사 품번은 「코드 미등록」 안내');
 await p.screenshot({path:'/tmp/jsportal-test/out/mr_modal.png'});
 await p.fill('[data-mr-row="수주 PO 47894KF · 2/1"] [data-mr-qty]','2');
 await p.click('[data-mr-submit]'); await W(900);
 const R=await p.evaluate(()=>window.__S.DATA.pm_material_request.filter(r=>/^수주 PO/.test(r.reason||'')));
 ok(R.length===2,'자재 요청 2줄 저장',R.length);
 const a=R.find(r=>r.reason==='수주 PO 47894KF · 2/1')||{};
 ok(a.item_id==='a1'&&a.std_code==='AX-110153030'&&a.qty===2&&a.check_dept==='구매자재팀'&&a.requester_name==='이정민'&&a.need_date==='2026-11-20'&&a.unit==='EA','저장 내용 (품목 · 고친 수량 2 · 확인부서 · 요청자 · 필요일)',a);
 const v=R.find(r=>r.reason==='수주 PO PO2610000242 · 1/1')||{};
 ok(v.item_id==null&&v.std_code==='790-3003-320'&&/EDA PC ETHERNET/.test(v.item_name),'코드 없는 줄은 고객사 품번 · 품명으로',v);
 ok(a.customer_code===''||a.customer_code==null,'고객사 둘 섞이면 자동 판별(빈칸)',a.customer_code);
 ok(await p.locator('[data-mr-modal]').count()===0 && await p.locator('[data-bulk-mr]').count()===0 && await p.getAttribute('[data-bulk]','data-bulk-open')==='0','등록 후 창 닫힘 · 선택 해제');
 // 같은 줄 다시 → 「이미 요청」 알림
 await p.check('[data-check="47894KF|2/1"]'); await W(200); await p.click('[data-bulk-mr]'); await W(900);
 ok(await p.locator('[data-mr-dup]').count()===1 && /MR-T1/.test(await p.textContent('[data-mr-prev]')),'같은 줄 다시 요청하면 「이미 요청 MR-… · 요청」 알림');
 await p.click('[data-mr-del]'); await W(200);
 ok(await p.locator('[data-mr-submit]').isDisabled(),'줄을 다 빼면 등록 버튼 꺼짐');
 ok(errs.length===0,'오류 없음',errs); await p.close();
}
// ② 구매자재 화면 — 기존 일괄 버튼 + 자재 요청 · 하네스팀이면 종류 필수
{const {p,errs}=await mk({});
 await p.check('[data-check="47894KF|2/1"]'); await W(300);
 ok(await p.locator('[data-bulk-dlv]').count()===1 && await p.locator('[data-bulk-mr]').count()===1,'구매자재 화면: 납품 표시 등 그대로 + 📦 자재 요청');
 await p.click('[data-bulk-mr]'); await W(700);
 ok(await p.inputValue('[data-mr-requester]')==='김교한','요청자 김교한');
 await p.click('[data-mr-dept="하네스팀"]'); await p.click('[data-mr-submit]'); await W(600);
 ok((await p.evaluate(()=>window.__S.DATA.pm_material_request.filter(r=>/^수주 PO/.test(r.reason||'')).length))===0,'하네스팀인데 종류 안 고르면 저장 안 됨');
 await p.click('[data-mr-kind="자재"]'); await p.click('[data-mr-urg="긴급"]'); await p.click('[data-mr-submit]'); await W(800);
 const R=await p.evaluate(()=>window.__S.DATA.pm_material_request.filter(r=>/^수주 PO/.test(r.reason||'')));
 ok(R.length===1&&R[0].check_dept==='하네스팀'&&R[0].req_kind==='자재'&&R[0].urgency==='긴급'&&R[0].customer_code==='AX','하네스팀 · 자재 · 긴급 · 고객사 AX 로 저장',R[0]);
 ok(errs.length===0,'오류 없음',errs); await p.close();
}
// ③ 휴대폰 (영업)
{const {p,errs}=await mk({name:'이정민',dept:'영업',role:'user'},400);
 await p.check('[data-mcard="47894KF|2/1"] [data-check]'); await W(300);
 await p.click('[data-bulk-mr]'); await W(700);
 const box=await p.locator('[data-mr-modal] > div').boundingBox();
 ok(box && box.width<=400,'휴대폰에서 창이 화면 안',box);
 await p.screenshot({path:'/tmp/jsportal-test/out/mr_m.png'});
 ok(errs.length===0,'오류 없음',errs); await p.close();
}
console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
