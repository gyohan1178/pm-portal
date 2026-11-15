// v4.98.0 — 업무 흐름 지도 · 자료 요청 · 외주 배포 권한 시뮬레이션
const {chromium}=require('playwright');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
const url=(r,me,fc)=>`${base}?doc=1&r=${encodeURIComponent(r)}${me?'&me='+encodeURIComponent(JSON.stringify(me)):''}${fc?'&fc='+encodeURIComponent(JSON.stringify(fc)):''}`;
(async()=>{const b=await chromium.launch();
const page=async(r,me,w=1440)=>{const p=await b.newPage({viewport:{width:w,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(()=>{try{localStorage.clear()}catch{}});
  await p.goto(url(r,me));await p.waitForTimeout(1500);return {p,errs}};
// 1) 관리자(팀장급) — 지도 기본 · 모든 숫자
{const {p,errs}=await page('/flow');
 ok(await p.locator('[data-flowmap]').count()===1,'PC 업무 흐름 = 흐름 지도 기본');
 const nodes=await p.locator('[data-flowmap-node]').count(); ok(nodes===17,'칸 17개',nodes);
 const other=await p.locator('[data-flowmap-node][data-other="1"]').count(); ok(other===0,'팀장급은 숨긴 숫자 없음',other);
 const bubN=await p.locator('[data-flowmap-node="m2"] [data-flowmap-bub]').count(); ok(bubN===0,'생산 칸은 숫자 안 띄움 (현황 숫자 · v4.186.0)',bubN);
 for (const id of ['p3','p4','t3']) ok(await p.locator(`[data-flowmap-node="${id}"] [data-flowmap-bub]`).count()===0,`${id} 칸도 숫자 없음`);
 ok(await p.locator('[data-flowmap-bub]').count()>0,'다른 칸 숫자는 그대로');
 const edges=await p.locator('[data-flowmap-edge]').count(); ok(edges===15,'화살표 15개',edges);
 // 겹침: 칸끼리
 const boxes=await p.$$eval('[data-flowmap-node]',els=>els.map(e=>{const r=e.getBoundingClientRect();return [e.dataset.flowmapNode,r.x,r.y,r.width,r.height]}));
 let ov=[]; for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],c=boxes[j]; if(a[1]<c[1]+c[3]&&c[1]<a[1]+a[3]&&a[2]<c[2]+c[4]&&c[2]<a[2]+a[4]) ov.push(a[0]+'/'+c[0])}
 ok(!ov.length,'칸끼리 안 겹침',ov);
 const labs=await p.$$eval('[data-flowmap-label]',els=>els.map(e=>{const r=e.getBoundingClientRect();return [e.dataset.flowmapLabel,r.x,r.y,r.width,r.height]}));
 let lov=[]; for(const l of labs)for(const a of boxes){ if(l[1]<a[1]+a[3]&&a[1]<l[1]+l[3]&&l[2]<a[2]+a[4]&&a[2]<l[2]+l[4]) lov.push(l[0]+'/'+a[0]) }
 ok(!lov.length,'화살표 이름표가 칸을 가리지 않음',lov);
 const trunc=await p.$$eval('[data-flowmap-node] span',els=>els.filter(e=>e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1).map(e=>e.textContent)); ok(!trunc.length,'칸 이름이 잘리지 않음',trunc);
 const subOv=await p.$$eval('[data-flowmap-subs]',els=>els.filter(e=>e.scrollHeight>e.clientHeight+2).map(e=>e.dataset.flowmapSubs)); ok(!subOv.length,'곁일 칸이 줄 안에 들어감',subOv);
 const hostW=await p.$eval('[data-flowmap-host]',e=>e.getBoundingClientRect().width), boxW=await p.$eval('[data-flowmap]',e=>e.firstChild.clientWidth); ok(hostW<=boxW+1,'1440 에서 가로 스크롤 없음',[hostW,boxW]);
 await p.click('[data-flowmap-node="t1"]'); await p.waitForTimeout(200);
 const st=await p.$$eval('[data-flowmap-edge]',els=>els.filter(e=>e.dataset.state==='hi').map(e=>e.dataset.flowmapEdge).sort().join());
 ok(st==='c,d1,d2,s3s4','새 도면 확인 누르면 도면 흐름만 진하게',st);
 ok(/도면 흐름/.test(await p.textContent('[data-flowmap-sel]')),'아래 줄에 흐름 이름');
 await p.click('[data-flowmap-go="설계변경(CN) 이력"]'); await p.waitForTimeout(600);
 ok(/설계변경/.test(await p.textContent('body')),'화면 열기 버튼으로 이동');
 await p.screenshot({path:'v98_map_admin.png'});
 ok(!errs.length,'오류 없음',errs); await p.close();}
// 2) 제조 팀원 — 흐름은 다, 숫자는 내 부서 + 나와 관련
{const {p,errs}=await page('/flow',{role:'editor',dept:'제조',is_lead:false});
 const leak=await p.$$eval('[data-flowmap-node][data-other="1"] [data-flowmap-bub]',els=>els.map(e=>e.className).filter(c=>!c.includes('border-[#6c5ce7]')));
 ok(!leak.length,'다른 부서 칸에 지연 · 대기 숫자 안 새어 나감',leak);
 const own=await p.locator('[data-flowmap-node="m2"][data-other="0"]').count(); ok(own===1,'내 부서(제조) 칸은 숫자 보임');
 const rel=await p.getAttribute('[data-flowmap-node="q3"]','data-rel'); ok(rel==='20','품질 검수 칸 = 나와 관련(넘긴 검수) 20',rel);
 const p4=await p.$eval('[data-flowmap-node="p4"]',e=>e.querySelector('[data-flowmap-bub]')); ok(p4===null,'구매 입고 칸 숫자 숨김');
 const subLeak=await p.$$eval('[data-flowmap-subs]:not([data-flowmap-subs="제조"]) [data-flowmap-sub]',els=>els.map(e=>e.textContent).filter(t=>/\d/.test(t)&&!/나 \d/.test(t)));
 ok(!subLeak.length,'다른 부서 곁일 숫자 숨김(나와 관련만)',subLeak);
 const lanes=await p.locator('[data-flowmap-lane]').count(); ok(lanes===5,'흐름은 5개 부서 모두 보임');
 await p.screenshot({path:'v98_map_mfg.png'});
 ok(!errs.length,'오류 없음',errs); await p.close();}
// 3) 휴대폰 — 지도 대신 부서별 상세
{const {p,errs}=await page('/flow',{role:'editor',dept:'제조',is_lead:false},412);
 ok(await p.locator('[data-flowmap]').count()===0 && await p.locator('[data-workflow]').count()===1,'휴대폰은 부서별 상세');
 ok(!errs.length,'오류 없음',errs); await p.close();}
// 4) 부서별 상세 탭
{const {p}=await page('/flow');
 await p.click('[data-flow-pagetab-item="detail"]'); await p.waitForTimeout(400);
 ok(await p.locator('[data-workflow]').count()===1 && await p.locator('[data-flowmap]').count()===0,'부서별 상세 탭으로 바뀜');
 await p.close();}
// 5) 자료 요청 — 영업
{const {p,errs}=await page('/doc-request',{role:'editor',dept:'영업',is_lead:false});
 ok(await p.locator('[data-seg-item="inbox"]').count()===1,'영업은 받은 자료 요청 탭');
 const rows=await p.locator('[data-doc-row]').count(); ok(rows===4,'처리 중+받음 아닌 것: 처리 중 4건',rows);
 const late=await p.$eval('[data-doc-kpi]',e=>e.textContent); const td=new Date(Date.now()+9*3600e3).toISOString().slice(0,10); const expLate=['2026-10-28','2026-10-30','2026-10-27','2026-10-20'].filter(d=>d<td).length; ok(new RegExp('필요일지남'+expLate).test(late.replace(/\s/g,'')),'필요일 지남 = 오늘 기준 '+expLate+' (날짜 따라 바뀜)',late);
 // 앞으로 → 뒤로
 await p.click('[data-doc-row="2"] [data-doc-next]'); await p.waitForTimeout(400);
 let s2=await p.getAttribute('[data-doc-row="2"]','data-doc-status'); ok(s2==='1','다음 ▶ → 고객사에 요청함',s2);
 await p.click('[data-doc-row="2"] [data-doc-prev]'); await p.waitForTimeout(400);
 s2=await p.getAttribute('[data-doc-row="2"]','data-doc-status'); ok(s2==='0','◀ 한 칸 되돌리기 → 요청됨',s2);
 const hist=await p.evaluate(()=>window.__S.DATA.pm_doc_request.find(r=>r.id===2).history.length); ok(hist===2,'되돌린 것도 이력에 남음',hist);
 // 고객사 필터 · 요청 문구
 await p.click('[data-seg="cust"] [data-seg-item="AX"]'); await p.waitForTimeout(200);
 const axRows=await p.locator('[data-doc-row]').count(); ok(axRows===2,'AXCELIS 필터 2건',axRows);
 await p.click('[data-doc-mail-btn]'); await p.waitForTimeout(200);
 const mail=await p.textContent('[data-doc-mail-text]'); ok(/5102060 Rev B — drawing/.test(mail) && !/110158840/.test(mail),'AX 요청 문구 — 아직 요청 안 한 것만, 영어',mail);
 await p.click('[data-doc-mark-asked]'); await p.waitForTimeout(500);
 const s3=await p.evaluate(()=>window.__S.DATA.pm_doc_request.find(r=>r.id===3).status); ok(s3===1,'보냈으면 → 고객사에 요청함으로 일괄',s3);
 await p.screenshot({path:'v98_doc_sales.png',fullPage:true});
 ok(!errs.length,'오류 없음',errs); await p.close();}
// 6) 자료 요청 — 제조(요청 부서): 자기 요청만 · 같이 기다리기
{const {p,errs}=await page('/doc-request',{role:'editor',dept:'제조',is_lead:false});
 ok(await p.locator('[data-seg-item="inbox"]').count()===0,'제조는 받은 요청 탭 없음');
 // v4.108.1 — 기본 「전체 부서」: 다른 부서 요청도 다 보임 (처리 중 4건)
 ok(await p.getAttribute('[data-seg="view"] [data-seg-item="all"]','class').then(c=>c.includes('bg-white')),'기본 탭 = 🏢 전체 부서');
 let rows=await p.locator('[data-doc-row]').count(); ok(rows===4,'전체 부서 처리 중 4건 (구매자재 2 · 품질 1 · 제조 1)',rows);
 ok(await p.locator('[data-doc-row="5"] [data-doc-ours]').count()===1 && await p.locator('[data-doc-row="1"] [data-doc-ours]').count()===0,'우리 부서 줄에만 「우리 부서」 표시');
 ok(await p.locator('[data-doc-row="5"] [data-doc-follow]').count()===0 && await p.locator('[data-doc-row="3"] [data-doc-follow]').count()===1,'남의 요청에만 「＋ 같이 기다리기」');
 ok(await p.locator('[data-doc-row="3"] [data-doc-confirm], [data-doc-row="3"] [data-doc-cancel]').count()===0,'남의 요청엔 취소 · 확인 단추 없음');
 await p.click('[data-doc-row="3"] [data-doc-follow]'); await p.waitForTimeout(500);
 const a3=await p.evaluate(()=>window.__S.DATA.pm_doc_request.find(r=>r.id===3).also_depts.join()); ok(a3==='제조','목록에서 같이 기다리기 → 품질 요청에 제조 붙음',a3);
 ok(await p.locator('[data-doc-row="3"] [data-doc-follow]').count()===0 && await p.locator('[data-doc-row="3"] [data-doc-ours]').count()===1,'붙은 뒤엔 단추 사라지고 「우리 부서」',await p.textContent('[data-doc-row="3"]'));
 await p.click('[data-seg="view"] [data-seg-item="mine"]'); await p.waitForTimeout(200);
 rows=await p.locator('[data-doc-row]').count(); ok(rows===2,'우리 부서 요청 = 제조 요청 + 같이 기다리는 1 = 2건',rows);
 await p.click('[data-seg="view"] [data-seg-item="all"]'); await p.waitForTimeout(200);
 await p.evaluate(()=>{const r=window.__S.DATA.pm_doc_request.find(r=>r.id===3); r.also_depts=[]; r.history=[]});
 ok(await p.locator('[data-doc-next]').count()===0,'요청 부서는 진행 넘기기 버튼 없음');
 await p.click('button:has-text("+ 자료 요청")'); await p.waitForTimeout(300);
 await p.fill('[data-doc-pn]','AX-110158840'); await p.locator('[data-doc-pn]').blur(); await p.waitForTimeout(400);
 ok(await p.locator('[data-doc-same]').count()===1,'같은 자료 요청 있음 → 같이 기다리기 안내');
 await p.click('[data-doc-submit]'); await p.waitForTimeout(500);
 const also=await p.evaluate(()=>window.__S.DATA.pm_doc_request.find(r=>r.id===1).also_depts.join()); ok(also==='제조','같이 기다리기로 붙음 (새 줄 안 만듦)',also);
 const n=await p.evaluate(()=>window.__S.DATA.pm_doc_request.length); ok(n===5,'요청 줄 수 그대로',n);
 // 새 요청
 await p.click('button:has-text("+ 자료 요청")'); await p.waitForTimeout(300);
 await p.click('[data-doc-kind="BOM"]'); await p.fill('[data-doc-pn]','110153030'); await p.locator('[data-doc-pn]').blur(); await p.waitForTimeout(400);
 const pn=await p.inputValue('[data-doc-pn]'); ok(pn==='AX-110153030','숫자만 넣으면 AX- 붙여 품목 찾음',pn);
 const custOn=await p.$eval('[data-doc-cust="AX"]',e=>e.className.includes('violet')); ok(custOn,'고객사 자동 선택 AXCELIS');
 await p.click('[data-doc-submit]'); await p.waitForTimeout(500);
 const nr=await p.evaluate(()=>window.__S.DATA.pm_doc_request.find(r=>r.part_no==='AX-110153030')); ok(nr&&nr.kind==='BOM'&&nr.from_dept==='제조'&&nr.customer_code==='AX','새 요청 저장 (BOM · 제조 · AX)',nr);
 ok(!errs.length,'오류 없음',errs); await p.close();}
// 7) 받음 → 요청 부서 확인 · 확인 취소
{const {p}=await page('/doc-request',{role:'editor',dept:'생산기술',is_lead:false});
 await p.click('[data-seg="st"] [data-seg-item="recv"]'); await p.waitForTimeout(200);
 await p.click('[data-doc-row="4"] [data-doc-confirm]'); await p.waitForTimeout(400);
 let s=await p.evaluate(()=>window.__S.DATA.pm_doc_request.find(r=>r.id===4).status); ok(s===3,'요청 부서 ✔ 확인 → 끝',s);
 await p.click('[data-seg="st"] [data-seg-item="done"]'); await p.waitForTimeout(200);
 await p.click('[data-doc-row="4"] [data-doc-unconfirm]'); await p.waitForTimeout(400);
 s=await p.evaluate(()=>window.__S.DATA.pm_doc_request.find(r=>r.id===4).status); ok(s===2,'◀ 확인 취소 → 받음',s);
 await p.close();}
// 8) 외주 배포 대장 권한
{const {p}=await page('/quality/drawing-dist',{role:'editor',dept:'품질',is_lead:false});
 ok(await p.locator('[data-dd-readonly]').count()===1,'품질 = 열람 전용 안내');
 ok(await p.locator('button:has-text("＋ 배포 기록")').count()===0 && await p.locator('button:has-text("전결 승인")').count()===0,'품질은 쓰기 · 승인 버튼 없음');
 ok(await p.locator('[data-dist-tab="ext"]').count()===1,'품질은 외주 탭 보임');
 await p.close();}
{const {p}=await page('/quality/drawing-dist',{role:'editor',dept:'구매자재',is_lead:false});
 ok(await p.locator('button:has-text("＋ 배포 기록")').count()===1,'구매자재 팀원 = 배포 기록 가능');
 ok(await p.locator('tbody input[type=checkbox]').count()===0,'팀원은 전결 승인 체크 없음');
 await p.close();}
{const {p}=await page('/quality/drawing-dist',{role:'editor',dept:'구매자재',is_lead:true});
 ok(await p.locator('tbody input[type=checkbox]').count()>=1,'구매자재 팀장 = 전결 승인 체크');
 await p.close();}
{const {p}=await page('/quality/drawing-dist',{role:'editor',dept:'제조',is_lead:false});
 ok(await p.locator('[data-dist-tab="ext"]').count()===0 && /사내 배포/.test(await p.textContent('body')),'제조는 외주 탭 없이 사내 배포만');
 await p.close();}
// 9) 입구 버튼
{const {p,errs}=await page('/customer/ax/bom');
 ok(await p.locator('[data-doc-req-open]').count()>=1,'BOM 화면에 영업 요청 버튼'); ok(!errs.length,'오류 없음',errs); await p.close();}
{const {p,errs}=await page('/quality/cn'); ok(await p.locator('[data-doc-req-open]').count()>=1,'CN 이력에 요청 버튼'); ok(!errs.length,'오류 없음',errs); await p.close();}
{const {p,errs}=await page('/quality/fai'); ok(await p.locator('[data-doc-req-open]').count()>=1,'초도품 매칭에 요청 버튼'); ok(!errs.length,'오류 없음',errs); await p.close();}
// 10) 사이드바
{const {p}=await page('/',{role:'editor',dept:'영업',is_lead:false});
 const badge=await p.$eval('a[href="/doc-request"]',e=>e.textContent).catch(()=>null); ok(badge&&/자료 요청/.test(badge),'사이드바 자료 요청 메뉴',badge);
 await p.close();}
console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
