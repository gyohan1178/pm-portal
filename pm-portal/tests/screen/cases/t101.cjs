// v4.172.0 — 검색에 승인 대체품 · 사용 금지
const {chromium}=require('playwright'); const fs=require('fs');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const SHOT='/tmp/jsportal-test/out/shots/';
(async()=>{const b=await chromium.launch();const errs=[];
const pg=async(r,q='',vp={width:1440,height:900})=>{const p=await b.newPage({viewport:vp});p.on('pageerror',e=>errs.push(r+': '+e.message.slice(0,160)));await p.goto('http://localhost:8765/app.html?imeta=1&'+q+'r='+encodeURIComponent(r));await p.waitForTimeout(1800);
  await p.evaluate(()=>{ const M=window.__S.DATA.pm_item_mfr; M.push(
    { id: 11, item_id: 'p1', mfr: 'BADCO', mfr_pn: 'BAD-M4', status: 'Do Not Use', active: true },
    { id: 12, item_id: 'p1', mfr: 'OLDMAKER', mfr_pn: 'OB-M4', status: 'Approved - OBS by Mfr', active: true },
    { id: 13, item_id: 'p2', mfr: 'LS산전', mfr_pn: 'BKN-3P-20A', status: 'Do Not Use', active: true },
    { id: 14, item_id: 'p2', mfr: 'EATON', mfr_pn: 'FAZ-C20/3', status: 'Preferred', active: true }) ; M.splice(M.findIndex(x=>x.id===4),1); window.__S.DATA.pm_item_cps=[{item_id:'p1',kind:'Limited',ver:'A.0',file_name:'5100052_A_0_REL.doc'},{item_id:'p2',kind:'Sole',ver:'B.1',file_name:'6200111_B_1_REL.doc'}] }); return p}
const T=(p,s)=>p.$eval(s,e=>e.innerText.replace(/\s+/g,' ')).catch(()=>'')

console.log('① 통합 검색 — 대체 가능 · 단종 · 사용 금지')
let p=await pg('/search')
await p.fill('input[placeholder*="기준코드"]','SCREW PAN'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500)
const t1=await T(p,'tr:has-text("AX-5100052") [data-mfr-alt]')
ok(/↳ 대체 승인/.test(t1)&&/SPS-M4X8/.test(t1),'NBK SPS-M4X8 = ↳ 대체 승인 (보조 줄)',t1)
ok(await p.$('tr:has-text("AX-5100052") [data-cps="Limited"]'),'CPS Limited 표')
ok(!/대체 승인[^↳]*SPHS-M4-8/.test(t1),'지금 대표(SPHS-M4-8)는 대체 목록에 다시 안 나옴',t1)
ok(/↳ 단종/.test(t1)&&/OB-M4/.test(t1),'OBS by Mfr → ↳ 단종',t1)
ok(/BADCO BAD-M4/.test(await p.$eval('tr:has-text("AX-5100052") [data-mfr-chip="dnu"]',e=>e.textContent).catch(()=>'')),'Do Not Use → ↳ 사용 금지 (취소선)')
await p.screenshot({path:SHOT+'s_common.png'})
console.log('② 대체품 품번 · 사용 금지 품번으로 검색')
await p.fill('input[placeholder*="기준코드"]','SPS-M4X8'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500)
ok(/AX-5100052/.test(await T(p,'table')),'대체품 품번으로 SCREW 나옴')
ok(await p.$('tr:has-text("AX-5100052") [data-mfr-chip].bg-yellow-100'),'걸린 품번 형광')
await p.fill('input[placeholder*="기준코드"]','BAD-M4'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500)
ok(/AX-5100052/.test(await T(p,'table'))&&await p.$('[data-mfr-chip="dnu"].bg-yellow-100'),'사용 금지 품번으로도 나오되 그 줄 형광')
console.log('③ 우리 대표 품번이 사용 금지')
await p.fill('input[placeholder*="기준코드"]','CIRCUIT BREAKER'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500)
ok(await p.$('tr:has-text("AX-6200111") [data-mfr-mine="dnu"]'),'⛔ 지금 품번 고객사 사용 금지')
ok(await p.$('tr:has-text("AX-6200111") [data-cps="Sole"]'),'차단기 CPS Sole')
ok(/FAZ-C20\/3/.test(await T(p,'tr:has-text("AX-6200111") [data-mfr-alt]')),'대신 쓸 EATON FAZ-C20/3 (우선) 보임')
await p.close()

console.log('④ 현장 검색 — 표 · 휴대폰 카드 · 상세')
p=await pg('/field-search')
const inp=await p.$('[data-fs-search="product"] input'); await inp.fill('SCREW PAN'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500)
ok(/대체 승인/.test(await T(p,'[data-fs-row]:has-text("AX-5100052") [data-mfr-alt]')),'표에 대체 가능')
await p.screenshot({path:SHOT+'s_field.png'}); await p.close()
p=await pg('/field-search','',{width:390,height:844})
const inp2=await p.$('[data-fs-search="product"] input'); await inp2.fill('SCREW PAN'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500)
ok(await p.$('[data-fs-card]:has-text("AX-5100052") [data-mfr-chip="dnu"]'),'휴대폰 카드에 사용 금지')
await p.click('[data-fs-card]:has-text("AX-5100052")'); await p.waitForTimeout(700)
ok(/고객사 승인 제조사/.test(await p.evaluate(()=>document.body.innerText)),'상세 창에 승인 제조사')
await p.screenshot({path:SHOT+'s_field_m.png'}); await p.close()

console.log('⑤ 기준코드 DB 칩 — 사용 금지는 승인 수에서 뺌')
p=await pg('/master/items')
await p.evaluate(()=>window.__qc.invalidateQueries({queryKey:['itemMeta']}))
await p.fill('input[placeholder*="검색"]','AX-'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500)
ok(await p.$eval('tr:has-text("SCREW PAN HD") [data-item-mfrs]',e=>e.textContent)==='승인 2','SCREW 「승인 2」 (사용 금지 · 단종 빼고)')
ok(await p.$eval('tr:has-text("CIRCUIT BREAKER") [data-item-mfrs]',e=>e.textContent)==='⚠ 사용 금지','차단기 — 대표 품번 사용 금지')
ok(await p.$eval('tr:has-text("CIRCUIT BREAKER") [data-item-cps]',e=>e.textContent)==='Sole','기준코드 DB 목록에 Sole')
await p.dblclick('tr:has-text("SCREW PAN HD M4X8")'); await p.waitForTimeout(900)
ok(await p.$('[data-item-cps="Limited"]'),'품목 상세에 CPS Limited')
await p.close()
console.log(errs.length?errs:'  페이지 오류 없음'); ok(!errs.length,'페이지 오류 0')
console.log(`t101 ${pass}/${pass+fail}`); await b.close()})()
