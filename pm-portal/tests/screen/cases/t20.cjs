// v4.100.0 추가 — 국문 원화 기본 · 언어 따라 통화 · 주의 알림
const {chromium}=require('playwright');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
const W=(ms)=>new Promise(r=>setTimeout(r,ms));
const cur=(p)=>p.$eval('[data-quote-cur-btn][data-on]',e=>e.textContent);
(async()=>{const b=await chromium.launch();
const mk=async()=>{const p=await b.newPage({viewport:{width:1500,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto(`${base}?q99=1&r=${encodeURIComponent('/sales-quote')}`);await p.waitForTimeout(1800);return {p,errs}};
// 1. 이력 없는 견적
{const {p,errs}=await mk();
 await p.click('tr:has-text("LE Spare") button:has-text("견적 작성")'); await W(1500);
 ok(await cur(p)==='KRW','국문 기본 → 원화(KRW)');
 const t=await p.textContent('.quote-print-area'); ok(/₩/.test(t)&&!/\$\d/.test(t),'견적서 금액 ₩ 표기',t.slice(0,0));
 const n=await p.textContent('[data-quote-notice]'); ok(/신규 접수 건이 아니면 이전 이력을 확인하여 검토 바랍니다/.test(n),'주의 알림 문구');
 ok(await p.locator('[data-quote-notice-hist]').count()===0,'이력 없으면 품목 수 줄 없음');
 await p.click('[data-quote-lang-btn="en"]'); await W(300); ok(await cur(p)==='USD','영문으로 → 달러');
 await p.click('[data-quote-lang-btn="ko"]'); await W(300); ok(await cur(p)==='KRW','국문으로 → 다시 원화');
 await p.click('[data-quote-cur-btn="USD"]'); await W(200); await p.click('[data-quote-lang-btn="ko"]'); await W(200);
 ok(await cur(p)==='USD','같은 언어 다시 눌러도 직접 고른 통화 유지');
 const lines=await p.$$eval('.quote-print-area tbody tr',rs=>rs.length); ok(lines>0,'품목 담김',lines);
 ok(errs.length===0,'오류 없음',errs);
}
// 2. 지난 견적 이력이 있는 품목
{const {p,errs}=await mk();
 await p.evaluate(()=>{window.__S.RPCFN=window.__S.RPCFN||{}; window.__S.RPCFN.pm_quote_history=(a)=>a.p_codes.slice(0,2).map((c,i)=>({std_code:c,unit_price:1000+i,currency:'USD',quote_date:'2026-09-01',quote_no:'Q-2609-00'+i,labor_krw:0}))});
 await p.click('tr:has-text("LE Spare") button:has-text("견적 작성")'); await W(1500);
 const h=await p.getAttribute('[data-quote-notice-hist]','data-quote-notice-hist'); ok(Number(h)>=1,'이력 있는 품목 수 표시',h);
 ok(/직전/.test(await p.textContent('[data-quote-notice-hist]')),'「직전」 단가 확인 안내');
 await p.locator('[data-quote-notice]').screenshot({path:'/tmp/jsportal-test/out/q_notice.png'});
 await p.screenshot({path:'/tmp/jsportal-test/out/q_krw.png'});
 ok(errs.length===0,'오류 없음',errs);
}
console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
