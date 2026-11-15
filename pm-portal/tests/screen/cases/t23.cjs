// v4.101.0 — 수주대장 AX PO 엑셀 한 번에 (수주대장 · 고객사 PO · 생산관리) + SREV/BREV
const {chromium}=require('playwright');
const XL=require('/tmp/jsportal-test/repo/node_modules/xlsx');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
const W=(ms)=>new Promise(r=>setTimeout(r,ms));
const H=(x)=>({Item:x.pn,'Item Desc':'','Order Number':x.n,'Order Lines':x.ol,'Del Line':x.dl,CCN:'K',SRev:x.srev,BRev:x.brev,Quantity:x.qty,'Unit Price':x.price,'Promise Date':x.due});
const wb=XL.utils.book_new();
XL.utils.book_append_sheet(wb,XL.utils.json_to_sheet([
  {pn:'110153030',n:'47894KF',ol:'2',dl:'1',srev:'Q',brev:'P',qty:3,price:1000000,due:'2026-12-30'},   // 기존 줄: SREV P→Q · BREV 새로 P
  {pn:'110153030',n:'49000KF',ol:'1',dl:'1',srev:'Q',brev:'Q',qty:2,price:1000000,due:'2027-01-20'},   // 새 PO
].map(H)),'Current Data');
XL.utils.book_append_sheet(wb,XL.utils.json_to_sheet([{Item:'1',현황:''}]).constructor ? XL.utils.aoa_to_sheet([['Item','Order Number','Order Lines','Del Line','Quantity','Unit Price','Promise Date','현황']]) : null,'Received');
const buf=XL.write(wb,{type:'buffer',bookType:'xlsx'});
(async()=>{const b=await chromium.launch();
const mk=async(w=1500)=>{const p=await b.newPage({viewport:{width:w,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto(`${base}?r=${encodeURIComponent('/orders')}`);await p.waitForTimeout(2000);return {p,errs}};
{const {p,errs}=await mk();
 // 반영 전 — BREV 없음 · SREV P
 ok(/S P/.test(await p.textContent('[data-row="47894KF|2/1"] [data-rev-chip]'))&&/B —/.test(await p.textContent('[data-row="47894KF|2/1"] [data-rev-chip]')),'AX 줄: 「S P / B —」 두 칸 표시',await p.textContent('[data-row="47894KF|2/1"] [data-rev-chip]'));
 await p.setInputFiles('[data-ax-file]',{name:'AXCELIS_PO.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:buf}); await W(1200);
 ok(/수주대장 · 고객사 PO · 생산관리 한 번에/.test(await p.textContent('body')),'수주대장에서 파일 고르면 「한 번에」 창이 열림');
 ok(/2행 읽음/.test(await p.textContent('body')),'파일을 바로 읽음 (2행)');
 await p.click('button:has-text("변경 감지 분석")'); await W(1500);
 const ord=await p.textContent('[data-cpo-ord]');
 ok(/수주대장도 같이/.test(ord)&&/새 PO\s*1/.test(ord)&&/SREV 1/.test(ord)&&/BREV 1/.test(ord),'분석: 수주대장 새 PO 1 · SREV 1 · BREV 1',ord);
 await p.screenshot({path:'/tmp/jsportal-test/out/cpo_both.png'});
 await p.click('button:has-text("적용 (")'); await W(2500);
 const L=await p.evaluate(()=>window.__S.DATA.pm_order_line.find(x=>x.id==='l1'));
 ok(L.rev==='Q'&&L.brev==='P','수주대장 줄: SREV Q · BREV P 로 바뀜',{rev:L.rev,brev:L.brev});
 const O=await p.evaluate(()=>window.__S.DATA.pm_order.find(x=>x.po_no==='49000KF'));
 ok(!!O,'수주대장에 새 PO 49000KF');
 const NL=await p.evaluate((id)=>window.__S.DATA.pm_order_line.filter(x=>x.order_id===id).map(x=>x.rev+'/'+x.brev),O&&O.id);
 ok(NL.length===1&&NL[0]==='Q/Q','새 PO 줄에도 SREV · BREV',NL);
 const C=await p.evaluate(()=>window.__S.DATA.purchase_orders.filter(x=>x.order_type==='customer_po').map(x=>x.po_number+'/'+x.item_rev+'/'+x.item_brev));
 ok(C.length===2&&C.includes('47894KF/Q/P'),'고객사 PO 표에도 같이 (2줄 · SREV/BREV)',C);
 const H2=await p.evaluate(()=>window.__S.DATA.pm_order_change.filter(x=>x.field==='brev'||x.field==='rev').map(x=>x.field+':'+x.before_val+'>'+x.after_val));
 ok(H2.includes('brev:null>P')&&H2.includes('rev:P>Q'),'변경 이력에 SREV · BREV',H2);
 const res=await p.textContent('body');
 ok(/수주대장\(새 PO 1/.test(res),'결과 문구에 수주대장 포함',(res.match(/적용 완료[^✕]*/)||[''])[0].slice(0,300));
 const RPC=await p.evaluate(()=>window.__S.RPC.map(x=>x.fn));
 ok(RPC.includes('pm_sync_done_hogi'),'생산관리 연동도 같이 돌림 (기존과 같음)',RPC);
 ok(errs.length===0,'오류 없음',errs);
}
console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
