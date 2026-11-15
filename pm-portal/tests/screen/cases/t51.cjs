// v4.121.0 — 생산관리 버튼 정리 · CSK ← 수주대장
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const T=async(p,s)=>((await p.textContent(s).catch(()=>''))||'').replace(/\s+/g,' ').trim();
(async()=>{const b=await chromium.launch();const errs=[];
const pg=async(q,r)=>{const p=await b.newPage({viewport:{width:1500,height:1000}});p.on('pageerror',e=>errs.push(e.message));await p.goto('http://localhost:8765/app.html?'+q+'&r='+encodeURIComponent(r));await p.waitForTimeout(2200);return p};
console.log('① 버튼 정리 — 고객사마다');
for (const c of ['AX','ED','VM','CSK']) {
  const p=await pg('qcv=1&csk=1&cskimp=1','/production/'+c); const body=await T(p,'main');
  ok(!/CSV 가져오기/.test(body),`${c}: 「CSV 가져오기」 없음`);
  ok(/📥 CSV/.test(body),`${c}: 「📥 CSV」 버튼 (v4.168.0 이름 기준)`);
  if(c==='VM') ok(!/노션 PROJECT/.test(body)&&!await p.$('[data-vm-notion]'),'VM: 「노션 PROJECT 올리기」 없음');
  if(c==='CSK') { ok(!/일정표 올리기/.test(body),'CSK: 「일정표 올리기」 없음'); ok(!!await p.$('[data-csk-import]'),'CSK: 「📥 수주대장에서 불러오기」'); }
  if(c==='ED') ok(!!await p.$('[data-ed-import]'),'ED: 수주대장 불러오기 그대로');
  if(c!=='CSK') ok(!await p.$('[data-csk-import]'),`${c}: CSK 단추 없음`);
  await p.close();
}
console.log('② CSK 수주대장 불러오기');
let p=await pg('qcv=1&csk=1&cskimp=1','/production/CSK');
const n0=await p.evaluate(()=>window.__S.DATA.production.filter(x=>x.customer_code==='CSK').length);
await p.click('[data-csk-import]'); await p.waitForTimeout(1200);
const dlg=await T(p,'body');
ok(/새 줄 1 · 발주 번호 맞춤 1/.test(dlg),'확인 창 제목 — 새 줄 1 · 맞춤 1');
ok(/＋ JS2611-90 · SCS0195S-0T1-ON028 \(SCSB124028AF\) — 발주 예정 · 납기 11-20/.test(dlg),'새 줄 미리보기');
ok(/↻ JS2610-46 — 발주 번호 — → 6001400001 · Prod — → 8700001/.test(dlg),'맞춤 미리보기 (발주 번호 · Prod)',dlg.match(/↻[^＋]{0,80}/)?.[0]);
ok(/이미 있음 1대/.test(dlg),'그대로 1대 (JS2610-47 — 빈 발주 번호는 덮지 않음)');
await p.click('button:has-text("불러오기 실행")'); await p.waitForTimeout(1800);
const D=await p.evaluate(()=>JSON.stringify(window.__S.DATA.production.filter(x=>x.customer_code==='CSK')));
const rows=JSON.parse(D);
ok(rows.length===n0+1,'CSK 줄 1개 늘어남',rows.length-n0);
const nw=rows.find(r=>r.hogi==='JS2611-90');
ok(nw&&nw.status==='PO접수'&&nw.po_received===false&&nw.req_date==='2026-11-20'&&nw.part==='SCSB124028AF'&&nw.pn==='SCS0195S-0T1-ON028'&&nw.company==='CSK','새 줄 칸 (상태 · 발주 예정 → 발주서 접수 ✗ · 납기 · 구분 · 품번)',nw);
ok(nw&&nw.csk.mgmt==='JS2611-90'&&nw.csk.plnd==='505999'&&nw.csk.prod==='8709999'&&nw.csk.pre_assy==='ECK03431-32'&&nw.csk.src==='수주대장'&&/^pbcsk/.test(nw.id),'새 줄 csk 칸 · id',nw&&nw.csk);
const ex=rows.find(r=>r.hogi==='JS2610-46');
ok(ex.csk.po_no==='6001400001'&&ex.csk.prod==='8700001'&&ex.csk.plnd==='PLX1'&&ex.po_received===true&&ex.status==='PO접수','있는 줄 — 발주 번호 · Prod 맞춤 · PO 접수 ✔ · 상태 그대로',ex);
ok(/수주대장 맞춤/.test(JSON.stringify(ex.changes)),'변경 이력 남음');
const same=rows.find(r=>r.hogi==='JS2610-47');
ok(same.status==='완료'&&!same.csk.po_no,'JS2610-47 그대로');
ok(!!await p.$('text=JS2611-90'),'화면에 새 줄 보임');
await p.click('[data-csk-import]'); await p.waitForTimeout(1200);
ok(/새로 만들 줄이 없습니다/.test(await T(p,'body')),'다시 누르면 「새로 만들 줄이 없습니다」');
await p.close();
console.log('③ SQL 전');
p=await pg('qcv=1&csk=1&cskimp=nofn','/production/CSK');
await p.click('[data-csk-import]'); await p.waitForTimeout(1200);
ok(/CSK생산_수주불러오기_반영_261030\.sql/.test(await T(p,'body')),'SQL 먼저 실행 안내');
await p.close();
ok(!errs.length,'페이지 오류 없음',errs);
console.log(`\n${pass} 통과 / ${fail} 실패`);await b.close();process.exit(fail?1:0)})();
