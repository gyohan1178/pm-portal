// v4.138.0 — 세부견적서 (부품별 판매가) 인쇄 · 엑셀
const {chromium}=require('playwright'); const ExcelJS=require('/tmp/jsportal-test/repo/node_modules/exceljs');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const T=(p,s)=>p.$eval(s,e=>e.innerText.replace(/\s+/g,' ')).catch(()=>'');
const N=(t)=>Number(String(t).replace(/[^0-9.]/g,''));
(async()=>{const b=await chromium.launch();const errs=[];
const open=async(q)=>{const p=await b.newPage({viewport:{width:1500,height:1100},acceptDownloads:true});p.on('pageerror',e=>errs.push(e.message));
 await p.addInitScript(()=>{ window.__pr=0; window.print=()=>{ window.__pr++ }; try{localStorage.removeItem('quote_detail_pref')}catch{} });
 await p.goto('http://localhost:8765/app.html?qsup='+q+'&r='+encodeURIComponent('/sales-quote'));await p.waitForTimeout(2000);
 await p.click('button:has-text("✍ 견적 작성")');await p.waitForTimeout(1200);
 const pn=p.locator('input[placeholder="품번 입력 (ASSY·단품 자동 판별)"]'); await pn.fill('990000001'); await pn.press('Enter'); await p.waitForTimeout(1800); return p};
const tr='.qs-edit tbody tr.align-top'
console.log('① 구매 지정 ASSY — 켜기 · 인쇄')
let p=await open('buy')
await p.fill(`${tr} td:nth-child(12) input`,'100,000'); await p.waitForTimeout(400)
const price=()=>p.$eval(`${tr} td:nth-child(7) input`,e=>Number(e.value))
const up=await price(); console.log('    견적 단가',up)
ok(await p.$eval('[data-quote-detail-maker]',e=>e.disabled),'꺼져 있으면 제조사 표기는 흐리게(못 누름) — 칸은 그대로')
ok(await p.isHidden('[data-quote-detail-print]').catch(()=>true),'화면에 세부견적서 안 보임')
await p.check('[data-quote-detail]'); await p.waitForTimeout(300)
ok(await p.$eval(`${tr} td:nth-child(10) input`,e=>e.value)==='세부견적 참조','비고 자동 「세부견적 참조」')
ok(!await p.$('[data-quote-detail-count]'),'경고 없으면 아무 글자 없음 (「ASSY 1건」 없앰)')
ok(/제조사 표기/.test(await T(p,'[data-quote-detail-ctl]')),'「제조사 표기」 체크')
await p.click('[data-quote-print]'); await p.waitForTimeout(300)
ok(await p.evaluate(()=>window.__pr)===1&&/qs-detail/.test(await p.evaluate(()=>document.body.className)),'인쇄 · qs-detail')
await p.pdf({path:'/tmp/jsportal-test/out/t65.pdf',landscape:true,format:'A4',printBackground:true,preferCSSPageSize:true})
let rows=await p.$$eval('[data-qd-row]',a=>a.map(e=>[...e.children].map(c=>c.innerText.trim())))
console.log('    ',JSON.stringify(rows))
ok(rows.length===2&&rows[0][1]==='AX-GBODY01'&&rows[1][1]==='AX-GHOSE01','부품 2줄 (구매 조립품 BODY · HOSE — 하위는 빠짐)')
ok(rows[0].length===8,'제조사 칸 기본 숨김 — 8칸 (끝 = 특이사항)')
ok(rows.some(r=>N(r[5])%10!==0),'부품 단가는 원 단위 그대로 (개별 절삭 안 함)',rows.map(r=>r[5]))
let tot=N(await T(p,'[data-qd-total]')), parts=N(await T(p,'[data-qd-parts]')), lab=await p.$eval('[data-qd-labor]',e=>[e.dataset.qdLabor,e.innerText]).catch(()=>null)
ok(tot===up,'합계 = 견적 단가',[tot,up])
ok(lab&&lab&&/조립 · 배선 · 검사비/.test(lab[1]),'조립 · 배선 · 검사비 줄',lab)
const labAmt=await p.$eval('[data-qd-labor] td:nth-last-child(2)',e=>Number(e.innerText.replace(/[^0-9]/g,''))); const sub=N(await T(p,'[data-qd-subtotal]')), adj=await p.$eval('[data-qd-adjust]',e=>Number(e.dataset.qdAdjust)).catch(()=>null), adjTxt=await T(p,'[data-qd-adjust]')
ok(labAmt===133333&&sub===parts+labAmt&&adj<0&&sub+adj===up&&/단수 절삭/.test(adjTxt)&&/−/.test(adjTxt),'자재 소계 + 조립비 133,333 = 소계 → 단수 절삭(−) → 합계 = 단가',[parts,labAmt,sub,adj,up,adjTxt])
await p.evaluate(()=>window.dispatchEvent(new Event('afterprint'))); await p.waitForTimeout(100)
ok(!/qs-detail/.test(await p.evaluate(()=>document.body.className)),'인쇄 후 클래스 정리')
console.log('② 제조사 표기 켬')
await p.check('[data-quote-detail-maker]'); await p.waitForTimeout(300)
rows=await p.$$eval('[data-qd-row]',a=>a.map(e=>[...e.children].map(c=>c.innerText.trim())))
ok(rows[0].length===10,'제조사 켬 → 10칸',rows)
ok(N(await T(p,'[data-qd-total]'))===up,'합계 그대로')
console.log('③ 네고 — 단가를 손으로 고침')
await p.fill(`${tr} td:nth-child(7) input`,'2000000'); await p.waitForTimeout(300)
ok(N(await T(p,'[data-qd-total]'))===2000000&&!await p.$('[data-qd-adjust]'),'고친 단가에 합계 맞춤 · 절삭 줄 없음',await T(p,'[data-qd-total]'))
console.log('④ 엑셀')
const [dl]=await Promise.all([p.waitForEvent('download'),p.click('button:has-text("📥 엑셀")')])
const f='/tmp/jsportal-test/out/t65.xlsx'; await dl.saveAs(f)
const wb=new ExcelJS.Workbook(); await wb.xlsx.readFile(f)
const names=wb.worksheets.map(w=>w.name); ok(names[0]==='견적서'&&names[1]==='세부견적서'&&names.includes('원가내역(내부)')&&!names.includes('세부견적'),'시트 — 견적서 · 세부견적서 · 원가내역(내부)',names)
const ws=wb.getWorksheet('세부견적서'); const vals=[]; ws.eachRow(r=>vals.push(r.values.slice(1)))
const totRow=vals.find(v=>String(v[0]).includes('합계')); ok(totRow&&totRow.includes(2000000),'엑셀 합계 2,000,000',totRow)
ok(vals.some(v=>v[1]==='AX-GBODY01'),'엑셀 부품 줄')
console.log('⑤ 끄기 — 비고 지움')
await p.uncheck('[data-quote-detail]'); await p.waitForTimeout(200)
ok(await p.$eval(`${tr} td:nth-child(10) input`,e=>e.value)==='','비고 「세부견적 참조」 지움')
await p.click('[data-quote-print]'); await p.waitForTimeout(200)
ok(!/qs-detail/.test(await p.evaluate(()=>document.body.className))&&!await p.$('[data-qd-row]'),'끄면 세부 없음')
await p.close()
console.log('⑥ 미정 ASSY — 단가없음 경고')
p=await open('1'); await p.check('[data-quote-detail]'); await p.waitForTimeout(300)
ok(/단가없음 2/.test(await T(p,'[data-quote-detail-count]')),'단가없음 2 표시',await T(p,'[data-quote-detail-count]'))
await p.click('[data-quote-print]'); await p.waitForTimeout(300)
ok(!(await p.$('[role=dialog]')),'단가 없는 부품만 있으면 확인 창 없이 인쇄 (v4.182.0 — 세부에 빈칸 + 특이사항으로 나감)')
ok(await p.evaluate(()=>window.__pr)===1,'바로 인쇄')
ok(await p.locator('[data-qd-row]').count()>0&&(await p.$$eval('[data-qd-row]',a=>a.filter(x=>/—/.test(x.textContent)).length))===2,'단가 없는 부품 2개도 세부 줄로 (—)')
ok(errs.length===0,'오류 없음',errs);
console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close();})();
