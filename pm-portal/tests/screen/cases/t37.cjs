// v4.112.0 — 입고 현황 → 이카운트 구매입력 변환
const {chromium}=require('playwright'); const XLSX=require('/tmp/jsportal-test/repo/node_modules/xlsx');
const base='http://localhost:8765/app.html';
let pass=0, fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)} else {fail++;console.log('  ✗',m, x===undefined?'':'→ '+JSON.stringify(x))} };
const T=async(p,s)=>((await p.textContent(s).catch(()=>''))||'').replace(/\s+/g,' ').trim();
(async()=>{const b=await chromium.launch();
const mk=async(extra='')=>{
  const ctx=await b.newContext({viewport:{width:1500,height:1000},acceptDownloads:true});
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto(`${base}?ecp=1${extra}&r=${encodeURIComponent('/inbound')}`); await p.waitForTimeout(1500);
  await p.click('button:has-text("📋 입고 현황")'); await p.waitForTimeout(600);
  const d=await p.$$('input[type=date]'); await d[0].fill('2026-10-01'); await d[1].fill('2026-11-05');
  await p.click('button:has-text("조회")'); await p.waitForTimeout(900); return {p,errs}};
const rowCb=(p,code)=>p.locator(`tr:has-text("${code}") input[type=checkbox]`).first();
const S=(p,f,a)=>p.evaluate(f,a);

console.log('① 버튼 · 표시');
{const {p,errs}=await mk();
 ok(await p.$eval('[data-hist-ecount]',e=>e.matches(':disabled')),'아무것도 안 고르면 버튼 흐리게 (v4.151 자리 고정)');
 ok((await p.$$('[data-ecp-mark]')).length===1,'이미 내려받은 줄(m9)에 「이카운트 ✓」');
 const t=await p.getAttribute('[data-ecp-mark]','title'); ok(/2026-10-21/.test(t),'표시에 내려받은 날 · 사람',t);
 await p.click('thead input[type=checkbox]'); await p.waitForTimeout(300);
ok(/9건 선택/.test(await T(p,'[data-hist-selcount]')),'전체 선택 → 9건 선택');
 await p.click('[data-hist-ecount]'); await p.waitForTimeout(400);
 ok(!!await p.$('[data-ecp-modal]'),'변환 창 열림');
 const body=await T(p,'[data-ecp-modal]');
 ok(/이미 구매입력 엑셀로 내려받았습니다/.test(body)&&/1줄/.test(await T(p,'[data-ecp-done]')),'이미 내려받은 1줄 안내 — 기본으로 뺌');
 ok(await T(p,'[data-ecp-sum="줄"]')==='8','줄 8 (m9 빠짐)',await T(p,'[data-ecp-sum="줄"]'));
 ok(await T(p,'[data-ecp-sum="전표 (순번)"]')==='5장','전표 5장 — 동신 · 발주외 · 이디에스 · 바오 CSK · 바오 AX',await T(p,'[data-ecp-sum="전표 (순번)"]'));
 const sup=72000+2824000+378000+384000+53600+982800+38100+1500000;
 ok(await T(p,'[data-ecp-sum="공급가액 합계"]')===sup.toLocaleString('ko-KR'),'공급가액 합계',await T(p,'[data-ecp-sum="공급가액 합계"]'));
 const s1=await T(p,'[data-ecp-slip="1"]');
 ok(/순번 1/.test(s1)&&/2026-10-13/.test(s1)&&/동신이앤티/.test(s1)&&/4줄/.test(s1)&&/3,658,000/.test(s1)&&/프로젝트 00012/.test(s1),'순번1 동신 10-13 4줄 3,658,000',s1.slice(0,160));
 ok(!!await p.$('[data-ecp-more="1"]'),'4줄 이상은 2줄 + 「더 보기」');
 await p.click('[data-ecp-more="1"]'); await p.waitForTimeout(200);
 ok(/BUS BAR 31 POS/.test(await T(p,'[data-ecp-slip="1"]')),'더 보기 → 전부');
 const s5=await T(p,'[data-ecp-slip="5"]'), s4=await T(p,'[data-ecp-slip="4"]');
 ok(/바오산전/.test(s4)&&/00005/.test(s4)&&/바오산전/.test(s5)&&/00012/.test(s5)&&/미래 날짜/.test(s5),'바오 같은 날 — CSK 00005 · AX 00012 따로, 미래 날짜 표시');
 ok(/발주외/.test(await T(p,'[data-ecp-issues]')),'확인 필요: 발주외 입고');
 ok(/담당자 00022/.test(body)&&/입고창고 00009/.test(body),'고정값 표시');
 ok(errs.length===0,'오류 없음',errs);

 console.log('② 내려받기 → 엑셀 · 표시');
 const [dl]=await Promise.all([p.waitForEvent('download'),p.click('[data-ecp-download]')]);
 const fp='/tmp/jsportal-test/out/ui.xlsx'; await dl.saveAs(fp);
 ok(!!dl,'파일 내려받아짐 (시험용 크롬은 한글 파일이름을 download 로 보여 줌 — 기존 발주서 내려받기와 같은 방식)');
 const wb=XLSX.readFile(fp), a=XLSX.utils.sheet_to_json(wb.Sheets['구매입력'],{header:1,raw:false,defval:''});
 ok(a.length===9&&a[0].length===21,'머리글 + 8줄 · 21칸',[a.length,a[0].length]);
 const H=a[0]; const col=(r,h)=>a[r][H.indexOf(h)];
 const e=a.findIndex(r=>r[H.indexOf('품목코드')]==='AX-5001240');
 ok(col(e,'수량')==='200'&&col(e,'단가')==='268'&&col(e,'공급가액')==='53600'&&col(e,'부가세')==='5360'&&col(e,'적요')==='JS-261012-01'&&col(e,'거래처코드')==='6058174188','이디에스 줄 값');
 ok(!a.some(r=>r[H.indexOf('품목코드')]==='AX-5100052'),'이미 내려받은 m9 는 엑셀에 없음');
 const nopo=a.findIndex(r=>r[H.indexOf('품목코드')]==='AX-170176397');
 ok(col(nopo,'거래처코드')===''&&col(nopo,'거래처명')==='','발주외 — 거래처 비움');
 await p.waitForTimeout(700);
 ok(!await p.$('[data-ecp-modal]'),'창 닫힘');
 const marked=await S(p,()=>window.__S.DATA.stock_movements.filter(r=>r.ecount_purchase_at).map(r=>r.id).sort().join());
 ok(marked==='m1,m2,m3,m4,m5,m6,m7,m8,m9','8줄 표시 + 원래 m9',marked);
 ok((await p.$$('[data-ecp-mark]')).length===9,'표에 「이카운트 ✓」 9줄 (다시 불러옴)');
 ok(/표시 8줄/.test(await T(p,'body')),'안내: 표시 8줄');
 ok(errs.length===0,'오류 없음',errs);}

console.log('③ 다시 고르면 — 그래도 포함 · 표시 지우기');
{const {p,errs}=await mk();
 await rowCb(p,'AX-5100052').check(); await rowCb(p,'AX-5001240').check();
 await p.click('[data-hist-ecount]'); await p.waitForTimeout(300);
 ok(await T(p,'[data-ecp-sum="줄"]')==='1','m9 빠지고 1줄');
 await p.check('[data-ecp-withdone]'); await p.waitForTimeout(200);
 ok(await T(p,'[data-ecp-sum="줄"]')==='2','그래도 포함 → 2줄');
 await p.click('[data-ecp-clear]'); await p.waitForTimeout(700);
 const r=await S(p,()=>window.__S.DATA.stock_movements.find(x=>x.id==='m9'));
 ok(r.ecount_purchase_at==null&&r.ecount_purchase_by==null,'표시 지우기 → m9 표시 없어짐');
 ok((await p.$$('[data-ecp-mark]')).length===0,'표에서도 사라짐');
 ok(errs.length===0,'오류 없음',errs);}

console.log('④ 모두 이미 내려받은 줄만 고르면');
{const {p}=await mk();
 await rowCb(p,'AX-5100052').check(); await p.click('[data-hist-ecount]'); await p.waitForTimeout(300);
 ok(/변환할 줄이 없습니다/.test(await T(p,'[data-ecp-modal]')),'안내');
 ok(await p.isDisabled('[data-ecp-download]'),'내려받기 버튼 꺼짐');}

console.log('⑤ SQL 안 돌렸을 때 — 엑셀은 받고 안내');
{const {p,errs}=await mk();
 await S(p,()=>{ delete window.__S.RPCFN.pm_movement_ecount_mark });
 await rowCb(p,'AX-5001240').check(); await p.click('[data-hist-ecount]'); await p.waitForTimeout(300);
 const [dl]=await Promise.all([p.waitForEvent('download'),p.click('[data-ecp-download]')]);
 ok(!!dl,'엑셀은 내려받아짐');
 await p.waitForTimeout(500);
 ok(/표시를 못 남겼습니다/.test(await T(p,'body')),'「표시를 못 남겼습니다 — SQL 확인」 안내');
 ok(errs.length===0,'오류 없음',errs);}

console.log('⑥ 날짜 변경 · 삭제 버튼 그대로');
{const {p}=await mk();
 await rowCb(p,'AX-5001240').check();
 ok(!!await p.$('[data-hist-date]')&&!!await p.$('[data-hist-del]'),'입고일 변경 · 삭제 버튼 그대로 있음');}

console.log(`\nt37 ${pass}/${pass+fail} 통과`); await b.close(); process.exit(fail?1:0)})();
