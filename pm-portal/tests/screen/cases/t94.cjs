// v4.166.0 — 화면 일관성 1단계: 개별 문제 7개 + 머리글 이름
const {chromium}=require('playwright');
const XLSX=require('/tmp/jsportal-test/repo/node_modules/xlsx');
const fs=require('fs');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
const T=(p,s)=>p.$eval(s,e=>e.innerText.replace(/\s+/g,' ')).catch(()=>'');
const SHOT='/tmp/jsportal-test/out/shots/';
fs.mkdirSync(SHOT,{recursive:true});
(async()=>{const b=await chromium.launch();const errs=[];
const pg=async(r,q='')=>{const p=await b.newPage({viewport:{width:1440,height:900}});p.on('pageerror',e=>errs.push(r+': '+e.message.slice(0,140)));await p.goto('http://localhost:8765/app.html?'+q+'r='+encodeURIComponent(r));await p.waitForTimeout(1800);return p}
const head=p=>p.evaluate(()=>document.querySelector('header')?.innerText.replace(/\s+/g,' ')||'')

console.log('① 고객사 PO 추가 — 품번')
let p=await pg('/customer/ax/cpo')
await p.click('button:has-text("PO 추가")'); await p.waitForTimeout(300)
ok(/품번/.test(await T(p,'.bg-indigo-50\\/30')),'추가 폼에 품번 칸')
const saveBtn='.bg-indigo-50\\/30 button:has-text("저장")'
await p.fill('.bg-indigo-50\\/30 input[type=number]','7')
ok(await p.$eval(saveBtn,e=>e.disabled),'품번 안 고르면 저장 막힘')
await p.fill('.bg-indigo-50\\/30 input[placeholder*="품번"]','5100052'); await p.waitForTimeout(700)
await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForTimeout(300)
const picked=await p.$eval('.bg-indigo-50\\/30 input[placeholder*="품번"]',e=>e.value).catch(()=>'')
if(!/AX-5100052/.test(picked)){ await p.click('text=SCREW PAN HD M4X8').catch(()=>{}); await p.waitForTimeout(300) }
ok(/AX-5100052/.test(await p.$eval('.bg-indigo-50\\/30 input[placeholder*="품번"]',e=>e.value)),'품목 고르면 입력칸에 품번 · 품명')
ok(!(await p.$eval(saveBtn,e=>e.disabled)),'고르면 저장 가능')
await p.screenshot({path:SHOT+'p1_cpo_add.png'})
await p.click(saveBtn); await p.waitForTimeout(900)
const np=await p.evaluate(()=>window.__S.DATA.purchase_orders.filter(r=>r.order_type==='customer_po'&&Number(r.qty_ordered)===7))
ok(np.length===1&&np[0].item_id==='p1','DB — item_id p1 로 저장',np.map(r=>r.item_id))
ok(!('item_q' in (np[0]||{})),'화면용 item_q 는 저장 안 함')
await p.close()

console.log('② 견적 중복 저장 확인')
p=await pg('/sales-quote','qsup=buy&salep=1&')
await p.click('button:has-text("✍ 견적 작성")'); await p.waitForTimeout(1200)
{ const pn=p.locator('input[placeholder="품번 입력 (ASSY·단품 자동 판별)"]'); await pn.fill('GK0001'); await pn.press('Enter'); await p.waitForTimeout(1500) }
await p.fill('input[placeholder="고객사 이름"]','AXCELIS').catch(()=>{})
const nQ=()=>p.evaluate(()=>(window.__S.DATA.pm_quotes||[]).length)
const q0=await nQ()
await p.click('button:has-text("💾 저장")'); await p.waitForTimeout(1800)
ok(await nQ()===q0+1,'첫 저장 — 1건',await nQ()-q0)
ok(!!await p.$('[data-quote-new]'),'저장 완료 줄에 「🆕 새 견적 시작」')
await p.click('button:has-text("💾 저장")'); await p.waitForTimeout(500)
const qd=await T(p,'[role="dialog"]')
ok(/이미 저장한 견적/.test(qd),'두 번째 💾 → 확인 창',qd)
await p.screenshot({path:SHOT+'p1_quote_resave.png'})
await p.click('[data-confirm-cancel], [role="dialog"] button:has-text("그만두기")'); await p.waitForTimeout(600)
ok(await nQ()===q0+1,'그만두기 → 더 안 생김',await nQ()-q0)
await p.click('[data-quote-new]'); await p.waitForTimeout(400)
ok(!(await p.$('[data-quote-new]')),'새 견적 시작 → 화면 비움')
await p.close()

console.log('③ 다품목 출고 — 한 줄 빼기')
p=await pg('/issue','pick=1&')
ok(await p.$$eval('[data-cart-remove]',a=>a.length)===2,'품목 2줄에 ✕ 버튼')
await p.screenshot({path:SHOT+'p1_issue_cart.png'})
await p.click('[data-cart-remove="AX-6200111"]'); await p.waitForTimeout(800)
ok(await p.evaluate(()=>window.__S.DATA.pm_picking.map(r=>r.id).join(','))==='pk1,pk2','직접 담은 1줄은 묻지 않고 빠짐')
await p.click('[data-cart-remove="AX-5100052"]'); await p.waitForTimeout(400)
const dlg=await T(p,'[role="dialog"]')
ok(/호기 2곳/.test(dlg)&&/110153030 #14/.test(dlg),'두 호기면 확인 창 (호기 목록)',dlg)
await p.click('[data-confirm-ok]'); await p.waitForTimeout(800)
ok(await p.evaluate(()=>window.__S.DATA.pm_picking.length)===0,'확인하면 두 줄 다 빠짐')
await p.close()

console.log('④ 납품 일정 변경 — 색 (당겨짐 = 빨강)')
const sc=fs.readFileSync('/tmp/jsportal-test/repo/src/pages/customer/ScheduleChanges.jsx','utf8')
ok(/total_shift < 0 \? 'text-rose-600'/.test(sc)&&/sh < 0 \? 'border-rose-200/.test(sc)&&/pulled \? 'text-rose-500'/.test(sc),'목록 · 배지 · 이력 모두 당겨짐 = rose')

console.log('⑤ 협력사 업로드 — 미리보기 · 분류 유지')
p=await pg('/master/vendors')
await p.evaluate(()=>{ const V=window.__S.DATA.vendors; V.push({id:'v9',name:'기존상사',ecount_code:'E001',category:'가공',contact:'홍길동',phone:'010-1111-2222',email:'a@b.c'}); V.push({id:'v8',name:'같은상사',ecount_code:'E002',category:'자재',contact:'',phone:'',email:''}) })
const wb=XLSX.utils.book_new()
const ws=XLSX.utils.aoa_to_sheet([['(주)진선테크 거래처'],['거래처코드','거래처명','담당자1','전화','Email','사용구분'],['E001','기존상사','김철수','','',''],['E002','같은상사','','','',''],['E003','신규상사','이영희','02-123-4567','n@x.y','']])
XLSX.utils.book_append_sheet(wb,ws,'거래처'); const fp='/tmp/jsportal-test/out/vend_t94.xlsx'; XLSX.writeFile(wb,fp)
await p.setInputFiles('input[type=file]',fp); await p.waitForTimeout(1200)
const pv=await T(p,'[data-vendor-import-preview]')
ok(/신규 1곳/.test(pv)&&/변경 1곳/.test(pv)&&/같음 1곳/.test(pv),'미리보기 — 신규 1 · 변경 1 · 같음 1',pv)
ok(/담당자: 홍길동 → 김철수/.test(pv),'바뀌는 내용 표시',pv)
ok(await p.evaluate(()=>!window.__S.DATA.vendors.find(v=>v.ecount_code==='E003')),'반영 전엔 저장 안 됨')
await p.screenshot({path:SHOT+'p1_vendor_preview.png'})
await p.click('[data-vendor-import-preview] button:has-text("반영")'); await p.waitForTimeout(1200)
const V=await p.evaluate(()=>window.__S.DATA.vendors.filter(v=>v.ecount_code))
const e1=V.find(v=>v.ecount_code==='E001'), e3=V.find(v=>v.ecount_code==='E003')
ok(e1&&!('category' in e1),'기존 거래처 — 분류 안 보냄 (DB 의 가공 그대로)',e1)
ok(e1&&e1.contact==='김철수'&&e1.phone==='010-1111-2222','빈 칸(전화)은 기존 값 유지',e1)
ok(e3&&e3.category==='자재','신규는 자재로',e3)
ok(!(await p.$('[data-vendor-import-preview]')),'반영 뒤 미리보기 닫힘')
await p.close()

console.log('⑥ 회원 관리 — 현장 역할')
p=await pg('/admin')
await p.evaluate(()=>window.__S.DATA.pm_profiles.push({ id:'u3', email:'new@jinsuntech.co.kr', name:'신입', role:'field_edit', status:'approved', dept:'생산', menu_scope:null, is_lead:false, created_at:'2026-11-10T00:00:00Z' }))
await p.click('a[href$="/users"]'); await p.waitForTimeout(1200)
await p.click('button:has-text("활성")'); await p.waitForTimeout(400)
const opts=await p.$$eval('select option',a=>a.map(o=>o.textContent))
ok(opts.includes('현장(수정)')&&opts.includes('현장(열람)'),'권한 선택에 현장(수정) · 현장(열람)',[...new Set(opts)])
ok(await p.$$eval('select',a=>a.some(s=>s.value==='field_edit')),'현장 계정이 「현장(수정)」으로 보임 (예전엔 빈 칸)')
await p.screenshot({path:SHOT+'p1_users_roles.png'})
await p.close()

console.log('⑦ 사이드바 · 머리글 이름')
p=await pg('/production/AX')
ok(/생산 관리/.test(await head(p))&&!/공정 현황판/.test(await head(p)),'/production/AX 머리글 = 생산 관리',await head(p))
ok(/관리자 할 일/.test(await T(p,'aside'))||/관리자 할 일/.test(await p.evaluate(()=>document.body.innerText)),'사이드바 「📋 관리자 할 일」')
await p.close()
for (const [r,want] of [['/inbound','구매'],['/inventory','자재'],['/weekly','분석'],['/master/price','기타'],['/admin','관리자 할 일'],['/production','공정 현황판']]) {
  p=await pg(r); const h=await head(p); ok(h.includes(want),`${r} 머리글에 「${want}」`,h); await p.close()
}

console.log(errs.length?errs:'  페이지 오류 없음'); ok(!errs.length,'페이지 오류 0')
console.log(`t94 ${pass}/${pass+fail}`); await b.close()})()
