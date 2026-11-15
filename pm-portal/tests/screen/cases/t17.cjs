// v4.99.0 — 단가 제외 · 견적 접수 근거 표시 · 기타 고객사
const {chromium}=require('playwright');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();
const page=async(r,w=1440)=>{const p=await b.newPage({viewport:{width:w,height:1000}});const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());await p.goto(`${base}?q99=1&r=${encodeURIComponent(r)}`);await p.waitForTimeout(1800);return {p,errs}};
// 1. 견적 접수 — 점검
{const {p,errs}=await page('/sales-quote');
 await p.click('[data-rfq-act="check"]'); await p.waitForTimeout(1500);
 const L=await p.evaluate(()=>window.__S.DATA.pm_rfq_line);
 const l1=L.find(x=>x.id==='rl1'), l2=L.find(x=>x.id==='rl2');
 ok(l1.kind==='item'&&l1.noprice_count===0&&l1.name==='CA RG59B/U','단품 7700039 → AX-7700039 · 품명 비었던 줄에 기준정보 품명 채움',l1);
 ok(l2.kind==='assy'&&l2.noprice_count===1&&JSON.stringify(l2.noprice_codes)==='["AX-5109999"]','어셈블리: 단가 없음 = 진짜 필요한 1개만 (문서 · 스펙 · 소요량 0 제외)',[l2.noprice_count,l2.noprice_codes]);
 ok(l2.name==='ASSY MAIN PD','붙여넣은 품명은 그대로');
 await p.click('[data-rfq-lines="7700039 WIRE 단품 견적"]'); await p.waitForTimeout(400);
 const nm=await p.textContent('[data-rfq-line-name="7700039"]'); ok(/CA RG59B\/U/.test(nm),'품목 표: 매칭된 품명 보임',nm);
 const pr=await p.textContent('[data-rfq-line-price="7700039"]'); ok(/600/.test(pr)&&/근거 없음/.test(pr),'품목 표: 매입가 600원 · 근거 없음 · 확인',pr);
 await p.screenshot({path:'/tmp/jsportal-test/out/q_rfq.png'});
 ok(errs.length===0,'오류 없음',errs);
}
// 2. 기타 고객사 접수
{const {p,errs}=await page('/sales-quote');
 await p.click('[data-rfq-new]'); await p.waitForTimeout(300);
 await p.selectOption('[data-rfq-cs]','__etc'); await p.waitForTimeout(150);
 ok(await p.locator('[data-rfq-etc]').count()===1,'「기타 (직접 입력)」 고르면 이름 칸');
 await p.fill('[data-rfq-title]','신규 고객 케이블 견적'); await p.fill('[data-rfq-paste]','AX-7700039\tCOAX\t\t20');
 await p.click('[data-rfq-save]'); await p.waitForTimeout(600);
 ok(await p.locator('[data-rfq-form]').count()===1,'이름 비우면 저장 안 됨');
 await p.fill('[data-rfq-etc]','한화컨버전스'); await p.screenshot({path:'/tmp/jsportal-test/out/q_etc_form.png'});
 await p.click('[data-rfq-save]'); await p.waitForTimeout(1800);
 const R=await p.evaluate(()=>window.__S.DATA.pm_rfq.find(x=>x.title==='신규 고객 케이블 견적'));
 ok(R&&R.customer_code==='한화컨버전스'&&!R.customer_id,'고객사 이름으로 저장 · 고객사 id 없음',R);
 const L=await p.evaluate((id)=>window.__S.DATA.pm_rfq_line.filter(x=>x.rfq_id===id),R&&R.id);
 ok(L.length===1&&L[0].kind==='item'&&L[0].checked_at,'기타 고객사도 점검 (단품으로 찾음)',L);
 const row=await p.textContent(`tr:has-text("신규 고객 케이블 견적")`); ok(/한화컨버전스/.test(row),'목록에 고객사 이름 그대로',row.slice(0,120));
 await p.selectOption('select:near([data-rfq-search])','__etc').catch(()=>{});
 const opts=await p.$$eval('select option',os=>os.map(o=>o.value)); ok(opts.includes('__etc'),'필터에 「기타」');
 // 견적 작성 →
 await p.click(`tr:has-text("신규 고객 케이블 견적") [data-rfq-act="write"]`); await p.waitForTimeout(2200);
 ok(await p.locator('[data-etc-cust]').count()===1,'견적 작성: 「기타 고객사 · 한화컨버전스」 표시');
 const iss=await p.$eval('[data-quote-issued]',e=>e.value); ok(iss==='한화컨버전스','수신처 = 입력한 고객사 이름',iss);
 ok((await p.$$eval('input',a=>a.map(x=>x.value))).includes('AX-7700039'),'품목이 들어감');
 await p.screenshot({path:'/tmp/jsportal-test/out/q_etc_write.png'});
 ok(errs.length===0,'오류 없음',errs);
}
// 3. 견적 작성 — 어셈블리 부품 표 단가 제외
{const {p,errs}=await page('/sales-quote');
 await p.click('button:has-text("견적 작성")'); await p.waitForTimeout(800);
 const inp=p.locator('input[placeholder*="품번"]').first(); await inp.fill('110153030'); await inp.press('Enter'); await p.waitForTimeout(1800);
 const t=await p.textContent('main'); ok(/단가없음 1/.test(t)&&/단가 제외 3/.test(t),'라인 요약: 단가없음 1 · 단가 제외 3',(t.match(/부품 \d+[^]{0,40}/)||[''])[0]);
 await p.click('button:has-text("▼ 부품")'); await p.waitForTimeout(400);
 const sk=await p.$$eval('[data-skip]',a=>a.map(x=>x.getAttribute('data-skip'))); ok(sk.length===3&&sk.filter(x=>x==='소요량 0').length===2&&sk.includes('스펙 · 문서'),'부품 표: 단가 제외 3줄 (소요량 0 ×2 · 스펙 · 문서)',sk);
 await p.screenshot({path:'/tmp/jsportal-test/out/q_parts.png',fullPage:true});
 ok(errs.length===0,'오류 없음',errs);
}
console.log(`\n${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
