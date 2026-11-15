// v4.110.0 — 수주대장 납품 → CSK 생산관리 호기 완료 · 되돌리기
const {chromium}=require('playwright');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
const T=async(p,s)=>(await p.textContent(s).catch(()=>'')||'').replace(/\s+/g,' ').trim();
(async()=>{const b=await chromium.launch();
const mk=async(extra='')=>{
  const ctx=await b.newContext({viewport:{width:1500,height:1000}});
  await ctx.addInitScript(()=>{try{localStorage.setItem('pm_coach_seen_orders-sales','1');localStorage.setItem('pm_coach_seen_orders-buy','1')}catch{}});
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto(`${base}?csk=1${extra}&r=${encodeURIComponent('/orders')}`); await p.waitForTimeout(2200); return {p,errs}};
const S=(p,f,a)=>p.evaluate(f,a);
const prod=(p,id)=>S(p,(id)=>JSON.parse(JSON.stringify(window.__S.DATA.production.find(r=>r.id===id))),id);
const line=(p,id)=>S(p,(id)=>JSON.parse(JSON.stringify(window.__S.DATA.pm_order_line.find(r=>r.id===id))),id);
const today=new Date().toISOString().slice(0,10);
const R1='[data-row="6001363811|00010/1"]', R2='[data-row="6001363812|00010/1"]', RV='[data-row="PO2610000242|1/1"]';

console.log('① CSK 납품 표시 → 생산관리 호기 완료');
{const {p,errs}=await mk();
 ok(!!await p.$(R1),'CSK 줄 보임');
 await p.click(R1+' input[type=checkbox]'); await p.click('[data-bulk-dlv]'); await p.waitForTimeout(900);
 const l=await line(p,'lc1'); ok(+l.delivered_qty===1,'수주대장 납품 1',l);
 let r=await prod(p,'pcx1');
 ok(r.status==='완료','생산관리 JS2610-46 → 완료',r.status);
 ok(r.shipped_date===today,'납품일 = 수주대장 납품일',r.shipped_date);
 const c=r.changes[r.changes.length-1];
 ok(c.type==='납품완료'&&c.src==='수주대장'&&c.prev==='PO접수'&&/6001363811/.test(c.msg),'생산관리 이력에 남김 (이전 상태 PO접수)',c);
 ok(/생산관리 JS2610-46 완료/.test(await T(p,'body')),'안내: 생산관리 JS2610-46 완료');
 ok((await prod(p,'pcx2')).status==='완료'&&(await prod(p,'pvx1')).status==='납품대기','다른 호기는 그대로');

 console.log('② 되돌리기 → 생산관리도 예전 상태로');
 await p.click('[data-undo-snack-run]'); await p.waitForTimeout(900);
 ok(+(await line(p,'lc1')).delivered_qty===0,'수주대장 납품 0');
 r=await prod(p,'pcx1');
 ok(r.status==='PO접수'&&r.shipped_date==null,'생산관리 PO접수 · 납품일 지움',{s:r.status,d:r.shipped_date});
 ok(r.changes[r.changes.length-1].type==='납품취소','이력: 납품취소');
 ok(/완료 취소/.test(await T(p,'body')),'안내: 완료 취소');
 ok(errs.length===0,'오류 없음',errs);}

console.log('③ PO 상세에서 납품 체크 · 해제');
{const {p,errs}=await mk();
 await p.click(R1+' [data-po-link], '+R1+' button:has-text("6001363811")').catch(()=>{});
 await p.waitForTimeout(500);
 let opened=!!await p.$('[data-dline="00010/1"]');
 if(!opened){ await p.click('text=6001363811'); await p.waitForTimeout(500); opened=!!await p.$('[data-dline="00010/1"]') }
 ok(opened,'PO 상세 열림');
 await p.click('[data-dlv="00010/1"]'); await p.waitForTimeout(900);
 ok((await prod(p,'pcx1')).status==='완료','상세에서 체크 → 완료');
 await p.click('[data-dlv="00010/1"]'); await p.waitForTimeout(900);
 const r=await prod(p,'pcx1');
 ok(r.status==='PO접수'&&+(await line(p,'lc1')).delivered_qty===0,'체크 해제 → PO접수',r.status);
 ok(errs.length===0,'오류 없음',errs);}

console.log('④ 사람이 미리 완료로 바꾼 호기는 건드리지 않음');
{const {p,errs}=await mk();
 await p.click(R2+' input[type=checkbox]'); await p.click('[data-bulk-dlv]'); await p.waitForTimeout(900);
 let r=await prod(p,'pcx2');
 ok(r.status==='완료'&&r.shipped_date==='2026-10-25'&&r.changes==null,'이미 완료 — 그대로 (납품일 · 이력 안 바뀜)',r);
 await p.click('[data-undo-snack-run]'); await p.waitForTimeout(900);
 r=await prod(p,'pcx2');
 ok(r.status==='완료','되돌려도 사람이 바꾼 완료는 그대로',r.status);
 ok(!/생산관리 JS2610-47/.test(await T(p,'body')),'생산관리 안내 없음');
 ok(errs.length===0,'오류 없음',errs);}

console.log('⑤ VM 납품 → VM 생산관리는 자동으로 안 바꿈 (현장작업이 남음)');
{const {p,errs}=await mk();
 await p.click(RV+' input[type=checkbox]'); await p.click('[data-bulk-dlv]'); await p.waitForTimeout(900);
 ok(+(await line(p,'l2')).delivered_qty===11,'VM 납품 저장');
 ok((await prod(p,'pvx1')).status==='납품대기','VM 생산관리 그대로');
 ok(errs.length===0,'오류 없음',errs);}

console.log('⑥ 생산관리 저장 실패 — 납품은 저장되고 안내만');
{const {p,errs}=await mk();
 await S(p,()=>{window.__S.FAIL['production:update']='permission denied'});
 await p.click(R1+' input[type=checkbox]'); await p.click('[data-bulk-dlv]'); await p.waitForTimeout(900);
 ok(+(await line(p,'lc1')).delivered_qty===1,'수주대장 납품은 저장됨');
 ok((await prod(p,'pcx1')).status==='PO접수','생산관리는 못 바뀜');
 ok(/생산관리 호기 반영 실패/.test(await T(p,'body')),'실패 안내 — 직접 바꿔 달라고');
 ok(errs.length===0,'오류 없음',errs);}

console.log('⑦ 발주 예정(같은 Plnd) 줄은 판단에서 빠짐');
{const {p}=await mk();
 const pl=await line(p,'lcp'); ok(+pl.delivered_qty===0,'발주 예정 줄은 납품 0 그대로인데');
 await p.click(R1+' input[type=checkbox]'); await p.click('[data-bulk-dlv]'); await p.waitForTimeout(900);
 ok((await prod(p,'pcx1')).status==='완료','실제 PO 줄만 보고 완료');}

console.log(`\nt36 ${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
