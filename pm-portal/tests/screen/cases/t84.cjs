// v4.156.0 — 호기 연결된 PO 는 수주대장에서 못 지움
const {chromium}=require('playwright');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();
for (const mode of ['link','nolink']) {
  const p=await b.newPage({viewport:{width:1500,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message))
  await p.goto(`http://localhost:8765/app.html?pol=1${mode==='link'?'&dellk=1':''}&r=${encodeURIComponent('/orders')}`);await p.waitForTimeout(2500)
  await p.locator('text=47894KF').first().click(); await p.waitForTimeout(800)
  const del=p.locator('[data-del]'); ok(await del.count()>0,`[${mode}] 지우기 버튼 보임`)
  await del.first().click(); await p.waitForTimeout(500)
  await p.locator('button',{hasText:'PO 삭제'}).last().click(); await p.waitForTimeout(1200)
  const body=await p.textContent('body')
  const gone = await p.evaluate(()=>!(window.__S||{}).x)
  if (mode==='link') ok(/호기가 연결된 PO 라 지울 수 없습니다/.test(body),'연결 있으면 삭제 막고 안내')
  else ok(/삭제했습니다/.test(body),'연결 없으면 삭제됨')
  ok(errs.length===0,`[${mode}] 화면 오류 없음`,errs)
  await p.close()
}
console.log(`\n${pass} pass / ${fail} fail`);await b.close();process.exit(fail?1:0)})()
