// v4.149.0 — 부품표 단가 요청 (견적 작성 → 견적 접수 → 구매 단가 입력 → 견적 작성) · 견적 접수 품목에 부품표 붙이기
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const T=async(p,s)=>(await p.textContent(s).catch(()=>'')||'').replace(/\s+/g,' ').trim();
const PASTE=['제조사\t제조사품번\t품명\t수량\t단가','MISUMI\tSPHS-M4-8\tSCREW\t10\t','LS산전\tbkn 3p 20a\tBREAKER\t1\t','OMRON\tG2R-2-SND DC24\tRELAY\t2\t18500','NEWCO\tX-999\tNEW PART\t4\t'].join('\n')
;(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1500,height:1100}});p.on('pageerror',e=>errs.push(e.message));
const S=()=>p.evaluate(()=>JSON.parse(JSON.stringify({rfq:window.__S.DATA.pm_rfq,line:window.__S.DATA.pm_rfq_line})))
await p.goto('http://localhost:8765/app.html?pq=1&r='+encodeURIComponent('/sales-quote'));await p.waitForTimeout(2000)
console.log('① 견적 작성 — 부품표 ASSY → 💲 단가 요청')
await p.click('button:has-text("✍ 견적 작성")');await p.waitForTimeout(1200)
await p.click('[data-quote-parts-paste]'); await p.waitForTimeout(300)
await p.fill('[data-qp-name]','GAS BOX ASSY (신규)'); await p.fill('#qp-qty','2'); await p.fill('[data-qp-labor]','100,000')
await p.fill('[data-qp-text]',PASTE); await p.click('[data-qp-check]'); await p.waitForTimeout(800)
await p.click('[data-qp-add]'); await p.waitForTimeout(600)
ok(!!await p.$('[data-paste-req]'),'단가 없는 부품이 있어 「💲 단가 요청」 버튼')
await p.click('[data-paste-req]'); await p.waitForTimeout(300)
await p.fill('[data-confirm-input]','GAS BOX 신규 견적'); await p.click('[data-confirm-ok]'); await p.waitForTimeout(1500)
let s=await S(); const R=s.rfq.find(r=>r.title==='GAS BOX 신규 견적'); const L=R&&s.line.find(l=>l.rfq_id===R.id)
ok(R&&R.price_req_at&&R.customer_code==='ax'&&R.customer_id==='cid-ax','견적 접수 생성 · 단가 요청 표시',R)
ok(L&&L.kind==='assy'&&L.noprice_count===1&&JSON.stringify(L.noprice_codes)==='["MPN:X-999"]'&&L.qty===2,'품목 — 부품표 · 단가 없음 1 (MPN:X-999)',L&&{k:L.kind,n:L.noprice_count,c:L.noprice_codes,q:L.qty})
const pp=L?.paste_parts?.parts||[]; ok(pp.length===4&&L.paste_parts.labor===100000,'부품표 4 · 작업비 저장',L?.paste_parts?.labor)
ok(JSON.stringify(pp.map(x=>[x.price,x.src]))===JSON.stringify([[50,'실적가'],[32000,'실적가'],[18500,'붙인 단가'],[null,null]]),'단가 · 출처',pp.map(x=>[x.price,x.src]))
ok(/단가 요청함 · GAS BOX 신규 견적/.test(await T(p,'[data-paste-req-done]')),'줄에 「단가 요청함」')
console.log('② 견적 접수 — 단계 · 부품표 표시')
await p.click('button:has-text("📥 견적 접수 현황")'); await p.waitForTimeout(1200)
const row=`tr[data-rfq="GAS BOX 신규 견적"]`
ok(/단가 요청/.test(await T(p,row)),'단계 ③ 단가 요청',await T(p,row))
console.log('③ 견적 접수 — 코드 전 품목에 부품표 붙이기 (rq2)')
const row2=`tr[data-rfq="신규 제어반 (코드 전)"]`
ok(!!await p.$(`${row2} [data-rfq-act="paste-open"]`),'BOM 필요 건에 「부품표 붙이기」 안내 버튼')
await p.click(`${row2} [data-rfq-act="paste-open"]`); await p.waitForTimeout(400)
await p.click('[data-rfq-paste="CTRL-BOX-NEW"]'); await p.waitForTimeout(400)
ok(await p.$eval('[data-qp-name]',e=>e.disabled&&e.value==='CONTROL BOX (신규)'),'품명 · 품번 접수 그대로 (잠금)')
await p.fill('[data-qp-text]',['OMRON\tG2R-2-SND DC24\tRELAY\t2\t','ABC\tZZ-1\tSPECIAL\t1\t'].join('\n')); await p.click('[data-qp-check]'); await p.waitForTimeout(800)
await p.click('[data-qp-add]'); await p.waitForTimeout(1500)
s=await S(); const L2=s.line.find(l=>l.id==='rp1')
ok(L2.kind==='assy'&&L2.paste_parts?.parts?.length===2&&L2.noprice_count>=1&&L2.noprice_codes.includes('MPN:ZZ-1'),'부품표 저장 · 점검 → 부품표 품목',{k:L2.kind,c:L2.noprice_codes})
ok(/📋 부품표 · 부품 2/.test(await T(p,'[data-rfq-paste-kind="CTRL-BOX-NEW"]')),'점검 칸 「📋 부품표 · 부품 2」')
ok(!/MPN:/.test(await T(p,'[data-rfq-line-price="CTRL-BOX-NEW"]'))&&/ZZ-1/.test(await T(p,'[data-rfq-line-price="CTRL-BOX-NEW"]')),'없는 부품 표시에 「MPN:」 안 붙음',await T(p,'[data-rfq-line-price="CTRL-BOX-NEW"]'))
console.log('④ 구매자재 — 품목 단가 등록 화면에서 부품표 부품 단가 입력')
await p.click(`${row} [data-rfq-act="quote"]`); await p.waitForTimeout(1800)
const pr='[data-price-req="MPN:X-999"]'
const t=await T(p,pr); ok(/X-999/.test(t)&&/📋 부품표/.test(t)&&/NEWCO/.test(t)&&/NEW PART/.test(t)&&!/MPN:/.test(t),'요청 목록 — 부품표 부품 (제조사 · 품명)',t)
await p.fill(`${pr} [data-price-req-pin-input]`,'7,000'); await p.click(`${pr} [data-price-req-pin-ok]`); await p.waitForTimeout(1800)
s=await S(); const L3=s.line.find(l=>l.id===L.id); const R3=s.rfq.find(r=>r.id===R.id)
const x=L3.paste_parts.parts.find(q=>q.mpn==='X-999'); ok(x.price===7000&&x.src==='구매 입력'&&x.by==='김교한','부품표에 단가 · 구매 입력 · 누가',x)
ok(L3.noprice_count===0&&R3.price_done_at,'다시 점검 → 단가 없음 0 · 요청 끝 자동',{n:L3.noprice_count,d:R3.price_done_at})
ok(!await p.$(pr),'목록에서 빠짐')
console.log('⑤ 견적 작성 — 채워진 단가로 부품표 ASSY')
await p.click('a[href="/sales-quote"]'); await p.waitForTimeout(1500)
await p.click(`${row} [data-rfq-act="write"]`); await p.waitForTimeout(1800)
const tr='.qs-edit tbody tr.align-top'
ok(/부품표/.test(await T(p,`${tr} [data-temp-bom]`)),'줄 = 부품표 ASSY')
const mat=Number((await p.$eval(`${tr} td:nth-child(11) input`,e=>e.value)).replace(/[^0-9]/g,'')); ok(mat===97500,'자재비 50×10+32000+18500×2+7000×4',mat)
ok(!/단가없음/.test(await T(p,tr)),'단가없음 없음')
const lab=Number((await p.$eval(`${tr} td:nth-child(12) input`,e=>e.value).catch(()=>'0')).replace(/[^0-9]/g,'')); ok(lab===100000,'작업비 따라옴',lab)
ok(errs.length===0,'오류 없음',errs);
console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close();})();
