// v4.144.0 — 하네스 출도 기록 붙여넣어 불출
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const T=async(p,s)=>(await p.textContent(s).catch(()=>'')||'').replace(/\s+/g,' ').trim();
const TXT=['고객사\tPO No\tOrder Line\tDel Line\t프로젝트\t도면번호\t호기\t수량\t공정\t합불\t작업자\t시작시간\t완료시간\t소요(분)',
'Axcelis\t824470\t7\t1\t\t160024189\t\t29\t출도\t\t김교한\t2026. 11. 4. 오후 2:49:33\t2026. 11. 4. 오후 2:49:33\t0',
'Axcelis\tKNSE48259\t4\t3\t\t160022758\t\t1\t출도\t\t김교한\t2026. 11. 4. 오후 2:47:51\t2026. 11. 4. 오후 2:47:51\t0',
'Axcelis\tKNSE48259\t4\t2\t\t160022758\t\t1\t출도\t\t김교한\tx\tx\t0',
'Axcelis\tKNSE48259\t4\t1\t\t160022758\t\t1\t출도\t\t김교한\tx\tx\t0',
'Axcelis\tLM778185\t58\t6\t\t160014240\t\t30\t출도\t\t김교한\tx\tx\t0',
'Axcelis\t825063\t4\t1\t\t160016120\t\t17\t출도\t\t김교한\tx\tx\t0'].join('\n');
(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1500,height:1000}});p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8765/app.html?hrp=1&r='+encodeURIComponent('/production/harness-release'));await p.waitForTimeout(2500)
await p.click('[data-hr-paste]'); await p.waitForTimeout(300)
await p.fill('[data-hr-paste-text]',TXT); await p.click('[data-hr-paste-check]'); await p.waitForTimeout(1000)
const st=await p.$$eval('[data-hr-paste-row]',a=>a.map(e=>e.dataset.hrPasteRow))
ok(JSON.stringify(st)===JSON.stringify(['ok','done','closed','ok','ok','none']),'상태 — 불출할 3 · 이미 불출 · PO 완료 · 없음',st)
const sum=await T(p,'[data-hr-paste-sum]'); ok(/붙인 줄 6/.test(sum)&&/불출할 줄 3/.test(sum)&&/수주대장에 없음 1/.test(sum),'요약',sum)
ok(/도번 다름/.test(await T(p,'[data-hr-paste-row="ok"]:nth-of-type(5), [data-hr-paste-modal] tbody tr:nth-child(5)')),'LM778185 — 도면번호와 품번 다르면 ⚠')
ok(/3줄 불출 표시/.test(await T(p,'[data-hr-paste-issue]')),'버튼 「3줄 불출 표시」')
await p.click('[data-hr-paste-issue]'); await p.waitForTimeout(400)
ok(/3줄을 「불출」로 표시할까요/.test(await T(p,'[data-confirm-dialog]')),'확인 창')
await p.click('[data-confirm-ok]'); await p.waitForTimeout(1200)
const D=await p.evaluate(()=>JSON.parse(JSON.stringify(window.__S.DATA)))
const iss=(id)=>D.purchase_orders.find(x=>x.id===id).material_issued
ok(iss('hp1')&&iss('hp4')&&iss('hp5'),'3줄 불출 체크')
ok(iss('hp2')===true&&iss('hp3')===false,'이미 불출 · 완료 줄은 그대로')
ok(D.production.find(x=>x.id==='hpr1').part_issue===true,'연결된 생산 호기도 불출')
ok(!await p.$('[data-hr-paste-modal]'),'창 닫힘')
ok(/3줄 불출 처리/.test(await T(p,'body')),'안내 · 되돌리기')
console.log('② 되돌리기')
const undo=await p.$('button:has-text("되돌리기")'); if(undo){ await undo.click(); await p.waitForTimeout(1200) }
const D2=await p.evaluate(()=>JSON.parse(JSON.stringify(window.__S.DATA.purchase_orders)))
ok(!D2.find(x=>x.id==='hp1').material_issued&&D2.find(x=>x.id==='hp2').material_issued,'되돌리면 원래대로 (원래 불출이던 줄은 그대로)')
console.log('③ 머리글 없이 붙여도')
await p.click('[data-hr-paste]'); await p.waitForTimeout(300)
await p.fill('[data-hr-paste-text]',TXT.split('\n').slice(1,2).join('\n')); await p.click('[data-hr-paste-check]'); await p.waitForTimeout(800)
ok((await p.$$eval('[data-hr-paste-row]',a=>a.map(e=>e.dataset.hrPasteRow))).join()==='ok','한 줄 · 불출할 줄')
await p.screenshot({path:'/tmp/jsportal-test/out/t71.png'})
ok(errs.length===0,'오류 없음',errs);
console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close();})();
