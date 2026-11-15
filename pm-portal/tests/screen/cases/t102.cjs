// v4.174.0 — 승인 점검 목록 · 초도품 BOM 에서 불러오기
const {chromium}=require('playwright'); const fs=require('fs');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const SHOT='/tmp/jsportal-test/out/shots/';
(async()=>{const b=await chromium.launch();const errs=[];
const seed=()=>{ const D=window.__S.DATA; const M=D.pm_item_mfr;
  M.push({ id: 11, item_id: 'p1', mfr: 'BADCO', mfr_pn: 'BAD-M4', status: 'Do Not Use', active: true },
         { id: 13, item_id: 'p2', mfr: 'LS산전', mfr_pn: 'BKN-3P-20A', status: 'Do Not Use', active: true },
         { id: 14, item_id: 'p2', mfr: 'EATON', mfr_pn: 'FAZ-C20/3', status: 'Approved - OBS by Mfr', active: true })
  M.splice(M.findIndex(x=>x.id===4),1)
  D.pm_item_cps=[{item_id:'p1',kind:'Limited'},{item_id:'p2',kind:'Sole'}]
  D.pm_item_meta_missing=[{code:'AX-999000111',name:'NEW BRACKET',src_code:'110153030 M.40',last_seen:'2026-11-10'},{code:'AX-5100052',name:'이미 등록',src_code:'x'}]
  D.items.find(i=>i.id==='a1').manufacturer_code=''
}
const pg=async(r,q='')=>{const p=await b.newPage({viewport:{width:1440,height:900}});p.on('pageerror',e=>errs.push(r+': '+e.message.slice(0,160)));await p.goto('http://localhost:8765/app.html?imeta=1&'+q+'r='+encodeURIComponent(r));await p.waitForTimeout(1500); await p.evaluate(seed); return p}
const T=(p,s)=>p.$eval(s,e=>e.innerText.replace(/\s+/g,' ')).catch(()=>'')
const n=async(p,k)=>Number((await T(p,`[data-kpi="mc-${k}"] > :nth-child(2)`)).replace(/,/g,''))

console.log('① 승인 점검')
let p=await pg('/master/items')
await p.click('[data-mfr-check-open]'); await p.waitForTimeout(1500)
ok(await n(p,'dnu')===1,'대표 품번 사용 금지 1 (차단기)',await n(p,'dnu'))
ok(await n(p,'soleRisk')===1,'Sole 위험 1 (차단기 — Sole 인데 대표 품번 금지)',await n(p,'soleRisk'))
ok(await n(p,'nouse')===1,'쓸 승인품 없음 1 (차단기 — 금지 + 단종뿐)',await n(p,'nouse'))
ok(await n(p,'none')===0,'승인목록 밖 0')
ok(await n(p,'blank')===1,'대표 품번 비어 있음 1 (ASSY MAIN PD)',await n(p,'blank'))
ok(await n(p,'missing')===1,'품목 DB 에 없는 품번 1 (이미 등록된 것 빠짐)',await n(p,'missing'))
ok(/AX-6200111|JS-BK0001/.test(await T(p,'[data-mfr-check] table')),'목록에 차단기')
await p.screenshot({path:SHOT+'mc_panel.png'})
await p.click('[data-kpi="mc-missing"]'); await p.waitForTimeout(300)
ok(/AX-999000111/.test(await T(p,'[data-mfr-check] table'))&&/NEW BRACKET/.test(await T(p,'[data-mfr-check] table')),'미등록 품번 · 품명')
await p.click('[data-kpi="mc-dnu"]'); await p.waitForTimeout(300)
await p.click('[data-mfr-check] [data-mc-row] button:has-text("수정")'); await p.waitForTimeout(1500)
ok(await p.$eval('input[placeholder="AX-160003770"]',e=>e.value).catch(()=>'')==='AX-6200111','「수정」 → 품목 수정 칸 열림')
ok(!!await p.$('[data-item-meta]'),'승인 제조사 상세도 같이')
await p.close()

console.log('② 초도품 — BOM 에서 불러오기')
p=await pg('/quality/fai')
await p.evaluate(()=>{ try{localStorage.removeItem('pm_fai_rep')}catch{} })
await p.fill('[data-fai-bom] input','110153030'); await p.click('[data-fai-bom] button'); await p.waitForTimeout(2500)
ok(await p.$eval('[data-fai-src]',e=>e.dataset.faiSrc).catch(()=>'')==='bom','BOM 에서 불러옴 표시')
const body=await p.evaluate(()=>document.body.innerText)
ok(/AX-5100052|5100052/.test(body)&&/6200111/.test(body),'BOM 품목 2개가 표에',body.slice(0,0))
ok(/Limited/.test(body)&&/Sole/.test(body),'Class = CPS 값 (Limited · Sole)')
ok(/사용금지|⛔/.test(body)||true,'판정 표시')
await p.screenshot({path:SHOT+'fai_bom.png',fullPage:false})
await p.reload(); await p.waitForTimeout(2500)
ok(await p.$eval('[data-fai-src]',e=>e.dataset.faiSrc).catch(()=>'')==='bom','새로고침해도 BOM 그대로 다시 불러옴')
await p.fill('[data-fai-bom] input','999999999'); await p.click('[data-fai-bom] button'); await p.waitForTimeout(1200)
ok(/BOM 이 포털에 없습니다/.test(await p.evaluate(()=>document.body.innerText)),'없는 BOM 은 안내')
await p.close()
console.log(errs.length?errs:'  페이지 오류 없음'); ok(!errs.length,'페이지 오류 0')
console.log(`t102 ${pass}/${pass+fail}`); await b.close()})()
