// v4.171.0 — 품목 승인 제조사 · REV
const {chromium}=require('playwright'); const fs=require('fs');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const SHOT='/tmp/jsportal-test/out/shots/'; fs.mkdirSync(SHOT,{recursive:true});
const HTM='/mnt/user-data/attachments/96ead1cc-aff3-559b-b524-50d082b4103d/8663b313-_110153030_M_40_REL_report__1_.htm';
(async()=>{const b=await chromium.launch();const errs=[];
const pg=async(r,q='')=>{const p=await b.newPage({viewport:{width:1440,height:900}});p.on('pageerror',e=>errs.push(r+': '+e.message.slice(0,160)));await p.goto('http://localhost:8765/app.html?'+q+'r='+encodeURIComponent(r));await p.waitForTimeout(1800);return p}

console.log('① 기준코드 DB — 목록에 승인 수 · REV')
let p=await pg('/master/items','imeta=1&')
await p.fill('input[placeholder*="검색"]','AX-').catch(()=>{}); await p.keyboard.press('Enter'); await p.waitForTimeout(1500)
const chip=await p.$eval('tr:has-text("SCREW PAN HD") [data-item-mfrs]',e=>({n:e.dataset.itemMfrs,t:e.textContent,title:e.title})).catch(()=>null)
ok(chip&&chip.t==='승인 2'&&/NBK/.test(chip.title),'SCREW — 「승인 2」 · 마우스 올리면 제조사 목록',chip)
ok(await p.$eval('[data-item-rev]',e=>e.dataset.itemRev).catch(()=>null)==='B.3','품명 앞 최신 REV B.3 (A.9 보다 위)')
const warn=await p.$$eval('[data-item-mfrs]',a=>a.map(e=>e.textContent))
ok(warn.includes('⚠ 승인목록 밖'),'차단기 — 대표 제조사품번(BKN-3P-20A)이 승인 목록에 없음 → 경고',warn)
await p.screenshot({path:SHOT+'im_list.png'})
console.log('② 더블클릭 — 승인 제조사 표 · REV 이력')
await p.dblclick('tr:has-text("SCREW PAN HD M4X8")'); await p.waitForTimeout(1000)
const rows=await p.$$eval('[data-item-mfr]',a=>a.map(e=>e.dataset.itemMfr))
ok(rows.length===2&&rows[0]==='SPHS-M4-8','지금 쓰는 2건 (우선 먼저)',rows)
ok(/빠진 제조사 1건/.test(await p.$eval('[data-item-meta]',e=>e.innerText)),'빠진 제조사 1건 따로')
ok(/지금 대표/.test(await p.$eval('[data-item-meta]',e=>e.innerText)),'우리 대표 제조사품번 표시')
ok(await p.$$eval('[data-item-revs] li',a=>a.map(e=>e.innerText.split(/\s/)[0]).join(','))==='B.3,A.9','REV 이력 B.3 · A.9 (최신 위)')
ok(/AX-110153030/.test(await p.$eval('[data-item-same-mpn]',e=>e.innerText).catch(()=>'')),'같은 제조사품번(SPS-M4X8) 쓰는 다른 품번')
await p.screenshot({path:SHOT+'im_detail.png',fullPage:true}); await p.close()

console.log('③ 다른 승인 제조사품번으로 검색')
p=await pg('/master/items','imeta=1&')
await p.fill('input[placeholder*="검색"]','SPS-M4X8'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500)
const names=await p.$$eval('table tbody tr',a=>a.map(r=>r.innerText).join('|'))
ok(/SCREW PAN HD/.test(names),'NBK 품번으로 찾아도 SCREW 나옴',names.slice(0,200)); await p.close()

console.log('④ 표 없을 때 — 예전처럼')
p=await pg('/master/items','')
await p.evaluate(()=>{ window.__S.MISSING=[...(window.__S.MISSING||[]),'pm_item_mfr','pm_item_rev'] })
await p.fill('input[placeholder*="검색"]','AX-'); await p.keyboard.press('Enter'); await p.waitForTimeout(1500)
ok(await p.$$eval('table tbody tr',a=>a.length)>=3&&!(await p.$('[data-item-mfrs]')),'목록 정상 · 칩 없음'); await p.close()

console.log('⑤ BOM 올리기 — HTM')
p=await pg('/customer/ax/bom','')
await p.evaluate(()=>{ window.__S.RPCFN = window.__S.RPCFN||{}; window.__S.RPCFN.pm_bom_delete_safe=()=>[{snap_id:1,cnt:0}]; window.__S.RPCFN.pm_bom_archive=()=>[]; window.__S.RPCFN.get_bom_assemblies=()=>[]; window.__S.RPCFN.pm_item_meta_sync = (a)=>{ window.__meta=(window.__meta||[]).concat(a.p_rows); window.__src=a.p_src; return { items:a.p_rows.length, missing:0, missing_codes:[], rev_new:3, rev_up:[{code:'AX-500001491',from:'C.5',to:'C.7'}], older:0, mfr_new:12, mfr_off:1 } } })
const inp=await p.$$('input[type=file]'); let fileInp=null
for (const i of inp) { const acc=await i.getAttribute('accept'); if(/htm/i.test(acc||'')) fileInp=i }
await (fileInp||inp[0]).setInputFiles(HTM); await p.waitForTimeout(2500)
const mm=await p.$eval('[data-multi-mfr]',e=>e.innerText).catch(()=>'')
ok(/2곳 이상 55/.test(mm),'미리보기 — 승인 제조사 2곳 이상 55 (제조사 단종 · 사용 금지 빼고)',mm)
await p.click('button:has-text("DB에 저장")')
for (let k=0;k<40;k++){ await p.waitForTimeout(1000); if (await p.$('[data-bom-itemmeta]')) break }
console.log('   ', (await p.evaluate(()=>document.body.innerText.match(/(저장 완료|일부만 저장|저장 오류)[^\n]{0,160}/)?.[0]||'')).slice(0,200))
const sent=await p.evaluate(()=>window.__meta||[])
const e491=sent.find(r=>r.code==='AX-500001491'), e911=sent.find(r=>r.code==='AX-510001911')
ok(sent.length>200,'품목 정보 보냄',sent.length)
ok(e491&&e491.ver==='C.7'&&e491.mfrs.length===2,'500001491 — C.7 · 제조사 2',e491)
ok(e911&&e911.mfrs.some(m=>m.status==='Preferred'&&m.mfr==='ABB CONTROLS')&&!e911.mfrs.some(m=>/\(/.test(m.mfr_pn)),'510001911 — 상태는 따로 · 품번에 (Preferred) 안 붙음',e911)
ok(/^110153030 M\.40$/.test(await p.evaluate(()=>window.__src)),'출처 = 110153030 M.40',await p.evaluate(()=>window.__src))
const res=await p.$eval('[data-bom-itemmeta]',e=>e.innerText).catch(()=>'')
ok(/승인 제조사 새로 12/.test(res)&&/빠짐 1/.test(res)&&/AX-500001491 C\.5 → C\.7/.test(res),'저장 결과 알림',res)
const np=await p.evaluate(()=>window.__S.DATA.items.find(i=>i.std_code==='AX-510001911'))
ok(np&&np.manufacturer==='ABB CONTROLS'&&np.manufacturer_code==='54104','새 품목 대표 제조사 = Preferred (ABB 54104)',np&&[np.manufacturer,np.manufacturer_code])
await p.screenshot({path:SHOT+'im_bom.png'}); await p.close()

console.log(errs.length?errs:'  페이지 오류 없음'); ok(!errs.length,'페이지 오류 0')
console.log(`t100 ${pass}/${pass+fail}`); await b.close()})()
