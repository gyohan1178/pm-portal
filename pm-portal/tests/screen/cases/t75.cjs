// v4.148.0 — 매출견적 부품표로 ASSY (코드 부여 전)
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const T=async(p,s)=>(await p.textContent(s).catch(()=>'')||'').replace(/\s+/g,' ').trim();
const PASTE=['제조사\t제조사품번\t품명\t수량\t단가','MISUMI\tSPHS-M4-8\tSCREW\t10\t','LS산전\tbkn 3p 20a\tBREAKER\t1\t','OMRON\tG2R-2-SND DC24\tRELAY\t2\t18500','NEWCO\tX-999\tNEW PART\t4\t'].join('\n')
;(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1500,height:1100}});p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(()=>{ window.print=()=>{} })
await p.goto('http://localhost:8765/app.html?r='+encodeURIComponent('/sales-quote'));await p.waitForTimeout(2000)
await p.click('button:has-text("✍ 견적 작성")');await p.waitForTimeout(1200)
await p.click('[data-quote-parts-paste]'); await p.waitForTimeout(300)
await p.fill('[data-qp-name]','GAS BOX ASSY (신규)'); await p.fill('#qp-qty','2'); await p.fill('[data-qp-labor]','100,000')
await p.fill('[data-qp-text]',PASTE); await p.click('[data-qp-check]'); await p.waitForTimeout(800)
const st=await p.$$eval('[data-qp-row]',a=>a.map(e=>e.dataset.qpRow)); ok(JSON.stringify(st)===JSON.stringify(['실적가','실적가','붙인 단가','none']),'제조사품번으로 실적가 · 기호 · 대소문자 무시 · 붙인 단가 · 없음',st)
const sum=await T(p,'[data-qp-sum]'); ok(/부품 4 · 포털 품목 2 · 실적가 2 · 붙인 단가 1 · 단가 없음 1/.test(sum)&&/₩69,500/.test(sum),'요약 · 자재비 50×10+32000+18500×2',sum)
await p.fill('[data-qp-name]',''); await p.click('[data-qp-add]'); ok(/품명을 적어 주세요/.test(await T(p,'[data-qp-modal]')),'품명 빠지면 막음')
await p.fill('[data-qp-name]','GAS BOX ASSY (신규)'); await p.click('[data-qp-add]'); await p.waitForTimeout(600)
ok(!await p.$('[data-qp-modal]'),'창 닫힘')
const tr='.qs-edit tbody tr.align-top'
ok(/부품표/.test(await T(p,`${tr} [data-temp-bom]`)),'줄에 「부품표」 표시')
const mat=Number((await p.$eval(`${tr} td:nth-child(11) input`,e=>e.value)).replace(/[^0-9]/g,'')); ok(mat===69500,'자재비 (100원 반올림)',mat)
const up=await p.$eval(`${tr} td:nth-child(7) input`,e=>Number(e.value)); ok(up>0,'견적 단가 계산됨 '+up)
ok(/단가없음 1/.test(await T(p,tr)),'단가없음 1 표시')
ok(!!await p.$('text=세부견적 —'),'단가 없는 부품이 있어 부품표가 펼쳐짐')
console.log('② 세부견적 — 코드 없는 부품은 제조사품번')
await p.check('[data-quote-detail]'); await p.waitForTimeout(300)
await p.click('[data-quote-print]'); await p.waitForTimeout(300); const dlg=await p.$('[data-confirm-ok]'); if(dlg){ await dlg.click(); await p.waitForTimeout(300) }
const rows=await p.$$eval('[data-qd-row]',a=>a.map(e=>e.dataset.qdRow)); ok(rows.includes('AX-5100052')&&rows.includes('G2R-2-SND DC24'),'세부견적 줄 — 포털 코드 / 코드 없으면 제조사품번',rows)
ok(errs.length===0,'오류 없음',errs);
console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close();})();
