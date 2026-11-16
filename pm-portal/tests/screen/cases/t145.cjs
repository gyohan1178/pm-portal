// v4.205.0 — 설정 ⚙ 카톡 아침 알림: SQL 전 안내 · 연결 버튼(카카오 로그인 주소) · 콜백 저장 · 켜기/끄기 · 지금 보내 보기 · 미리보기 · 연결 끊기
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const W=(ms)=>new Promise(r=>setTimeout(r,ms));
const U=(q,r)=>`http://localhost:8765/app.html?${q}&r=${encodeURIComponent(r)}`;
(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1400,height:900}});p.on('pageerror',e=>errs.push(e.message));
const openSet=async()=>{await p.click('button[title="설정"]');await W(600)}
await p.goto(U('x=1','/todo'));await W(1500);await openSet();
ok(/카톡아침알림_반영/.test(await p.$eval('[data-kakao-box]',e=>e.textContent).catch(()=>'')),'SQL 전 — 실행 안내');
// 미연결
await p.goto(U('kakao=0','/todo'));await W(1500);await openSet();
ok(await p.$('[data-kakao-link]')!==null,'미연결 — 「카카오톡 연결하기」');
let nav=null; await p.route('https://kauth.kakao.com/**',r=>{nav=r.request().url();r.fulfill({body:'ok'})});
await p.click('[data-kakao-link]'); await W(1000);
ok(nav&&/client_id=RESTKEY123/.test(nav)&&/scope=talk_message/.test(nav)&&/redirect_uri=http%3A%2F%2Flocalhost%3A8765%2Fkakao%2Fcallback/.test(nav),'카카오 로그인 창으로 (키 · 동의 항목 · 돌아올 주소)',nav);
// 콜백 — 성공 / 실패
await p.goto(U('kakao=0','/kakao/callback?code=abc&state=pm'));await W(1500);
ok(await p.$eval('[data-kakao-cb]',e=>e.dataset.kakaoCb).catch(()=>null)==='ok','콜백 — code 넘겨 연결 완료');
const call=await p.evaluate(()=>(window.__S.FNCALLS||[]).find(c=>c.body.action==='connect'));
ok(call&&call.body.code==='abc'&&/\/kakao\/callback$/.test(call.body.redirect_uri),'서버 함수에 code · 돌아올 주소 전달',call);
await p.screenshot({path:'/tmp/jsportal-test/out/shots/kakao_cb.png'});
await p.goto(U('kakao=0','/kakao/callback?code=zzz'));await W(1500);
ok(/invalid_grant/.test(await p.$eval('[data-kakao-cb]',e=>e.textContent).catch(()=>'')),'콜백 실패 — 이유 표시');
await p.goto(U('kakao=0','/kakao/callback?error=access_denied'));await W(1200);
ok(/취소/.test(await p.$eval('[data-kakao-cb]',e=>e.textContent).catch(()=>'')),'카카오에서 취소 — 안내');
// 연결됨
await p.goto(U('kakao=1','/todo'));await W(1500);await openSet();
ok(await p.$eval('[data-kakao-linked]',e=>e.dataset.kakaoLinked).catch(()=>null)==='on','연결됨 · 켜짐');
await p.click('[data-kakao-pv]');await W(600);
ok(/오늘 챙길 일/.test(await p.$eval('[data-kakao-preview]',e=>e.textContent).catch(()=>'')),'보낼 글 미리보기');
await p.click('[data-kakao-test]');await W(800);
ok(await p.evaluate(()=>(window.__S.FNCALLS||[]).some(c=>c.body.action==='test')),'지금 보내 보기 → 서버 함수 test');
await p.screenshot({path:'/tmp/jsportal-test/out/shots/kakao_box.png'});
await p.click('[data-kakao-toggle]');await W(700);
ok(await p.$eval('[data-kakao-linked]',e=>e.dataset.kakaoLinked).catch(()=>null)==='off','끄기');
await p.click('[data-kakao-unlink]');await W(700);
ok(await p.$('[data-kakao-link]')!==null,'연결 끊기 → 다시 연결 버튼');
await p.goto(U('kakao=no','/todo'));await W(1500);await openSet();
ok(await p.$('[data-kakao-denied]')!==null && await p.$('[data-kakao-link]')===null,'구매자재 · 영업이 아니면 연결 버튼 대신 안내');
ok(!errs.length,'오류 없음',errs); console.log(`t145 ${pass}/${pass+fail}`); await b.close()})()
