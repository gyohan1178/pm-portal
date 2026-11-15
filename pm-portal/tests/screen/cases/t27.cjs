// v4.103.0 — 수주대장 빠르게 열기 (진행 중 줄만 · 지난 이력은 필요할 때 · 예상 매출은 DB 합계)
const {chromium}=require('playwright');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
const W=(ms)=>new Promise(r=>setTimeout(r,ms));
const T=async(p,s)=>(await p.textContent(s).catch(()=>'')||'').replace(/\s/g,'');
(async()=>{const b=await chromium.launch();
const mk=async(flags,w=1500)=>{const p=await b.newPage({viewport:{width:w,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto(`${base}?odd=1&fastx=1&proj=1${flags}&r=${encodeURIComponent('/orders')}`);await p.waitForTimeout(2200);return {p,errs}};
const reads=(p)=>p.evaluate(()=>({R:{...(window.__S.READS||{})},S:JSON.parse(JSON.stringify(window.__S.SELS||{})),RPC:window.__S.RPC.map(x=>x.fn+':'+(x.args?.p_q??''))}));
const snap=async(p)=>({money:await T(p,'[data-money-total]'),cust:await T(p,'[data-money-cust]'),odd:await T(p,'[data-odd-btn]'),np:await T(p,'[data-noprice]'),rows:await p.locator('[data-row]').count()});
// ① 빠르게
const F=await mk('');
let r=await reads(F.p);
ok(r.R.pm_order_line_live_v>0 && r.R.pm_order_line_hist_v>0,'진행 중 보기 · 지난 줄 보기로 받음',r.R);
ok(!r.R.pm_order_line,'처음엔 수주 줄 전체(pm_order_line)를 안 받음',r.R.pm_order_line);
ok((r.S.pm_order_line_live_v||[]).some(c=>/odd_ok/.test(c)&&/brev/.test(c)),'진행 중 줄 받을 때 특이사항 확인 · BREV 칸 같이 받음',r.S.pm_order_line_live_v);
ok(r.RPC.some(x=>x.startsWith('pm_order_money')),'예상 매출은 DB 합계(pm_order_money)',r.RPC);
const fs=await snap(F.p);
ok(/AX-110153030/.test(await T(F.p,'[data-row="47894KF|2/1"]'))&&/ASSYMAINPD/.test(await T(F.p,'[data-row="47894KF|2/1"]')),'진행 중 줄에 품번 · 품명 보임 (보기에서 같이 받음)',await T(F.p,'[data-row="47894KF|2/1"]'));
// ② 예전처럼 전부 (보기 없음 = SQL 전)
const O=await mk('&nov=1');
let r2=await reads(O.p);
ok(r2.R.pm_order_line>0,'SQL 전이면 예전처럼 전부 받음',r2.R);
const os=await snap(O.p);
ok(fs.money===os.money && fs.money.length>1,'예상 매출 합계 같음',[fs.money,os.money]);
ok(fs.cust===os.cust,'고객사별 금액 · 납품 완료 · 예정 같음',[fs.cust,os.cust]);
ok(fs.odd===os.odd,'특이사항 숫자 같음',[fs.odd,os.odd]);
ok(fs.np===os.np,'단가 없는 품목 숫자 같음',[fs.np,os.np]);
ok(fs.rows===os.rows && fs.rows>0,'진행 중 목록 줄 수 같음',[fs.rows,os.rows]);
ok(F.errs.length===0 && O.errs.length===0,'오류 없음',[...F.errs,...O.errs]);
// ③ 검색 — 숫자가 검색을 따라감 (두 방식 같음)
for (const q of ['PO2610','47894','zzz']) {
  await F.p.fill('[data-search]',q); await O.p.fill('[data-search]',q); await W(1200)
  const a=await snap(F.p), c=await snap(O.p)
  ok(a.money===c.money && a.cust===c.cust && a.np===c.np && a.rows===c.rows,`검색 「${q}」: 예상 매출 · 단가 없음 · 줄 수 같음`,[a,c])
}
await F.p.fill('[data-search]',''); await O.p.fill('[data-search]',''); await W(800);
// ④ 납품 완료 보기 → 그때 전부 받음
await F.p.selectOption('[data-viewsel]','done'); await W(1500);
r=await reads(F.p);
ok(r.R.pm_order_line>0,'「납품 완료」 고르면 지난 이력까지 받음',r.R.pm_order_line);
ok(await F.p.locator('[data-row^="PO-DONE-1|"]').count()===1,'다 끝난 PO(PO-DONE-1) 줄 보임');
await O.p.selectOption('[data-viewsel]','done'); await W(800);
ok(await F.p.locator('[data-row]').count()===await O.p.locator('[data-row]').count(),'납품 완료 줄 수 예전과 같음');
await F.p.selectOption('[data-viewsel]','live'); await W(600);
// ⑤ PO 상세 — 새로 연 화면(빠르게)에서 납품 끝난 · 취소 줄까지
const G=await mk('');
await G.p.click('[data-po-link="47894KF"]'); await W(1200);
const dt=await T(G.p,'[data-po-drawer]');
ok(/AX-110158840/.test(dt),'PO 상세에 납품 끝난 줄(AX-110158840) 보임',dt.slice(0,300));
ok(/AX-5100052/.test(dt),'PO 상세에 취소된 줄(AX-5100052) 보임');
r=await reads(G.p);
ok((r.S.pm_order_line||[]).length>=1 && !(r.R.pm_order_line>3),'그 PO 줄만 받음 (전체 아님)',r.R.pm_order_line);
ok(G.errs.length===0,'오류 없음',G.errs);
// ⑥ 새로고침해도 「확인」한 특이사항은 안 나옴 (예전엔 칸을 안 받아 다시 나왔음)
const K=await mk('&okd=1');
ok(/특이사항0/.test(await T(K.p,'[data-odd-btn]')),'확인한 특이사항 — 새로고침 뒤에도 0',await T(K.p,'[data-odd-btn]'));
const KO=await mk('&okd=1&nov=1');
ok(/특이사항0/.test(await T(KO.p,'[data-odd-btn]')),'SQL 전(전부 받기)도 0',await T(KO.p,'[data-odd-btn]'));
// ⑦ 칸 추가 SQL 전(odd_ok · brev 없음) — 그래도 열림
const N=await mk('&nocol=1');
ok((await N.p.locator('[data-row]').count())>0 && N.errs.length===0,'확인 · BREV 칸 없어도 목록 열림',N.errs);
const N2=await mk('&nocol=1&nov=1');
ok((await N2.p.locator('[data-row]').count())>0 && N2.errs.length===0,'칸 없음 + 보기 없음도 열림',N2.errs);
// ⑧ 탭(이카운트 대조) → 전부
const E=await mk('');
await E.p.click('[data-oi-tab="ecount"]').catch(()=>{}); await W(1500);
r=await reads(E.p); ok(r.R.pm_order_line>0,'이카운트 대조 탭은 전부 받음',r.R);
ok(E.errs.length===0,'오류 없음',E.errs);
// ⑨ 휴대폰
const M=await mk('',400);
ok((await M.p.locator('[data-mcard]').count())>0 && M.errs.length===0,'휴대폰 카드 목록 열림',M.errs);
console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
