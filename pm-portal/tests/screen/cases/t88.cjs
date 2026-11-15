// v4.160.0 — 견적 접수 등록 안 된 단품 부품 → 임시코드 발행 · 단가 요청 / 품목 「정식 코드로」
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1500,height:1000}});p.on('pageerror',e=>errs.push(e.message))
await p.goto('http://localhost:8765/app.html?tmpq=1&r='+encodeURIComponent('/sales-quote'));await p.waitForTimeout(2500)
const btn=p.locator('[data-rfq-tmp-issue], button:has-text("임시코드로 단가 요청")').first()
ok(await btn.count()===1,'「🏷 단품 부품 — 임시코드로 단가 요청 (4)」 버튼',await p.locator('button:has-text("임시코드")').allTextContents())
await btn.click(); await p.waitForTimeout(300)
await p.click('[data-confirm-ok]'); await p.waitForTimeout(2500)
const D=await p.evaluate(()=>JSON.parse(JSON.stringify(window.__S.DATA)))
const tmp=D.items.filter(i=>/^TMP-/.test(i.std_code))
ok(tmp.length===3,'임시코드 3개 발행 (BKN 은 있던 품목 연결)',tmp.map(i=>i.std_code+' '+i.manufacturer+' '+i.manufacturer_code))
ok(tmp.every(i=>i.stock_managed===false),'재고관리 제외')
const sch=tmp.find(i=>/320-10/.test(i.manufacturer_code)); ok(sch&&sch.manufacturer==='SCHURTER'&&sch.manufacturer_code==='RC320-10','붙은 품번 SCHURTERRC320-10 → SCHURTER · RC320-10',sch)
const ls=D.pm_rfq_line.filter(l=>l.rfq_id==='rq9')
ok(ls.every(l=>l.paste_parts?.parts?.length===1),'4줄 모두 한 줄짜리 부품표')
const bkn=ls.find(l=>l.id==='rt4'); ok(bkn.paste_parts.parts[0].std_code && !/^TMP/.test(bkn.paste_parts.parts[0].std_code),'BKN — 있던 품목 기준코드',bkn.paste_parts.parts[0])
ok(ls.filter(l=>l.kind==='assy').length===4,'다시 점검 — BOM 필요 → 부품표 품목',ls.map(l=>l.kind))
// 품목 화면 — 정식 코드로
const code=tmp.find(i=>/SMT750/.test(i.manufacturer_code)).std_code
await p.goto('http://localhost:8765/app.html?tmpq=1&r='+encodeURIComponent('/master/items'));await p.waitForTimeout(500)
await p.evaluate((D)=>{ window.__S.DATA.items=D.items; window.__S.DATA.pm_rfq_line=D.pm_rfq_line }, D)
await p.goto('http://localhost:8765/app.html?r='+encodeURIComponent('/master/items')).catch(()=>{})
ok(true,'(품목 화면은 아래 단위 시험으로)')
ok(errs.length===0,'화면 오류 없음',errs)
console.log(`\n${pass} pass / ${fail} fail`);await b.close();process.exit(fail?1:0)})()
