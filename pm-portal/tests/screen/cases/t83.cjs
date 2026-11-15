// v4.156.0 — 부족 계산 실패를 「부족 없음」으로 보이지 않게
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();
for (const mode of ['err','ok']) {
  const p=await b.newPage({viewport:{width:1500,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto(`http://localhost:8765/app.html?${mode==='ok'?'shok=1&':''}r=${encodeURIComponent('/customer/ax/short')}`)
  // 월별(기본 보기)
  await p.waitForSelector(mode==='err'?'[data-shortage-error]':'text=AX-6200111',{timeout:20000}).catch(()=>{})
  const n1=await p.locator('[data-shortage-error]').count()
  if (mode==='err') {
    ok(n1===1,'월별 — 계산 실패 줄 보임',n1)
    const t=n1?await p.locator('[data-shortage-error]').textContent():''
    ok(/부족 계산 실패/.test(t)&&/다시 계산/.test(t),'월별 — 문구 · 다시 계산 버튼',t.slice(0,160))
  } else {
    ok(n1===0,'월별 — 정상이면 실패 줄 없음',n1)
    ok(await p.locator('text=AX-6200111').count()>0,'월별 — 부족 품목 보임')
  }
  // 발주 상세 보기
  await p.locator('button',{hasText:'발주 상세'}).first().click().catch(()=>{})
  await p.waitForTimeout(mode==='err'?9000:1500)
  const n2=await p.locator('[data-shortage-error]').count()
  ok(mode==='err'?n2===1:n2===0,`[${mode}] 발주 상세 — 실패 줄 ${mode==='err'?'보임':'없음'}`,n2)
  if (mode==='err' && n2) {
    const before=await p.evaluate(()=>window.__RPCN||0)
    await p.locator('[data-shortage-error] button').first().click()
    await p.waitForTimeout(500)
    ok(true,'다시 계산 버튼 누름')
  }
  await p.screenshot({path:`/tmp/jsportal-test/out/sh_${mode}.png`})
  ok(errs.length===0,`[${mode}] 화면 오류 없음`,errs)
  await p.close()
}
console.log(`\n${pass} pass / ${fail} fail`);await b.close();process.exit(fail?1:0)})()
