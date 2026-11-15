// v4.114.1 — 구매발주 여러 칸 차례 정렬
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1500,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(()=>{ try{localStorage.clear()}catch{} });
await p.goto('http://localhost:8765/app.html?d13=1&r='+encodeURIComponent('/customer/ax/purchase'));await p.waitForTimeout(2500);
await p.evaluate(()=>{ const P=window.__S.DATA.purchase_orders; P.push(
  {id:'po4',customer_id:'cid-ax',item_id:'p2',order_type:'purchase',po_number:'JS-261001-01',qty_ordered:5,qty_received:0,qty_remaining:5,unit_price:32000,promise_date:'2026-10-25',status:'진행중',order_date:'2026-10-01',vendor_id:'v1'},
  {id:'po5',customer_id:'cid-ax',item_id:'p1',order_type:'purchase',po_number:'JS-261002-01',qty_ordered:7,qty_received:0,qty_remaining:7,unit_price:50,promise_date:'2026-11-20',status:'진행중',order_date:'2026-10-02',vendor_id:'v2'});
  window.__S.DATA.purchase_orders.forEach(x=>{ x.vendors = window.__S.DATA.vendors.find(v=>v.id===x.vendor_id) }); window.__qc.invalidateQueries() });
await p.waitForTimeout(1500);
const rows=async()=>p.$$eval('table tbody tr',t=>t.map(r=>r.textContent).map(s=>(s.match(/JS-\d{6}-\d{2}/)||[''])[0]).filter(Boolean));
console.log('    처음',await rows());
const head=lbl=>p.locator('thead th span',{hasText:lbl}).first();
await head('구매처').click(); await p.waitForTimeout(300);
await head('받을 날').click(); await p.waitForTimeout(300);
const r=await rows(); console.log('    구매처→받을날',r);
const vOf={'JS-261020-01':'파워일렉','JS-261001-01':'파워일렉','JS-261008-03':'로이코','JS-261009-01':'로이코','JS-261002-01':'로이코'};
const vs=r.map(x=>vOf[x]); ok(vs.join()===[...vs].sort((a,b)=>a.localeCompare(b,'ko')).join(),'구매처끼리 묶임',vs);
ok(r.indexOf('JS-261001-01')<r.indexOf('JS-261020-01'),'파워일렉 안에서 받을 날 순 (10-25 → 11-03)');
ok(r.indexOf('JS-261008-03')<r.indexOf('JS-261002-01'),'로이코 안에서 받을 날 순 (10-21 → 11-20)');
const hv=await head('구매처').textContent(), hd=await head('받을 날').textContent();
ok(/①▲/.test(hv)&&/②▲/.test(hd),'머리글 ①▲ ②▲',[hv,hd]);
ok(/① 구매처 ▲/.test(await p.textContent('[data-po-sorts]'))&&/② 받을 날/.test(await p.textContent('[data-po-sorts]')),'정렬 막대');
await head('받을 날').click(); await p.waitForTimeout(300);
const r2=await rows(); ok(r2.indexOf('JS-261020-01')<r2.indexOf('JS-261001-01'),'② 한 번 더 → 받을 날 ▼ (구매처 묶음은 그대로)',r2);
await head('받을 날').click(); await p.waitForTimeout(300);
ok(/①?▲/.test(await head('구매처').textContent())&&!/[▲▼]/.test(await head('받을 날').textContent()),'또 누르면 받을 날만 빠짐');
await p.click('[data-po-sort-clear]'); await p.waitForTimeout(300);
ok(!await p.$('[data-po-sorts]')&&!/[▲▼]/.test(await head('구매처').textContent()),'정렬 초기화');
ok(errs.length===0,'오류 없음',errs);
console.log(`\nt43 ${pass}/${pass+fail}`);await b.close();process.exit(fail?1:0)})();
