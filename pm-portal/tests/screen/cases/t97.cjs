// v4.167.2 — ASSY 출고 박스 불출표 엑셀 (화면 필터 그대로)
const {chromium}=require('playwright'); const XLSX=require('/tmp/jsportal-test/repo/node_modules/xlsx');
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();const errs=[];const ctx=await b.newContext({acceptDownloads:true,viewport:{width:1500,height:950}});const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(()=>{ const o=HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click=function(){ if(this.download) window.__lastDl=this.download; return o.call(this) } });
await p.goto('http://localhost:8765/app.html?obv=1&r='+encodeURIComponent('/outbound'));await p.waitForTimeout(2500)
const sels=await p.$$('main select'); await sels[0].selectOption({index:1}); await p.waitForTimeout(800)
const s2=await p.$$('main select'); const opts=await s2[1].$$eval('option',a=>a.map(o=>[o.value,o.textContent])); const pj=opts.find(o=>/110153030/.test(o[1])); await s2[1].selectOption(pj[0]); await p.waitForTimeout(1800)
const codes=()=>p.$$eval('table tbody tr',a=>a.map(r=>(r.querySelector('td:nth-child(7)')||{}).textContent).filter(Boolean))
const grab=async()=>{ const [d]=await Promise.all([p.waitForEvent('download'),p.click('[data-out-excel]')]); const f=await d.path(); const wb=XLSX.readFile(f); const ws=wb.Sheets[wb.SheetNames[0]]; const aoa=XLSX.utils.sheet_to_json(ws,{header:1,defval:''}); const hi=aoa.findIndex(r=>r[0]==='No'); return {name:d.suggestedFilename(), aoa, head:aoa.slice(0,hi), rows:aoa.slice(hi+1).filter(r=>r.some(Boolean)), hdr:aoa[hi]} }
let x=await grab(); const scr=await codes()
const fn=await p.evaluate(()=>window.__lastDl||''); ok(/^박스불출표_(AX-)?110153030.*_\d{4}-\d{2}-\d{2}\.xlsx$/.test(fn),'파일 이름',fn)
ok(x.hdr.includes('불출수량')&&x.hdr.includes('제조사품번'),'열',x.hdr)
ok(JSON.stringify(x.rows.map(r=>r[x.hdr.indexOf('기준코드')]))===JSON.stringify(scr),'기본(출고 대상) — 화면 줄과 같음',{xl:x.rows.map(r=>r[5]),scr})
ok(/보기: 출고 대상/.test(JSON.stringify(x.head)),'위에 조건 표시',x.head)
await p.click('[data-out-view-btn="all"]'); await p.fill('[data-out-bomq]','bkn 3p'); await p.waitForTimeout(500)
x=await grab()
ok(x.rows.length===1&&x.rows[0][x.hdr.indexOf('기준코드')]==='AX-6200111','보기 전체 + 검색 → 1줄',x.rows)
ok(/검색: bkn 3p/.test(JSON.stringify(x.head)),'검색 조건 표시',x.head)
await p.fill('[data-out-bomq]',''); await p.click('[data-out-view-btn="exclude"]'); await p.waitForTimeout(300)
x=await grab(); const r=x.rows[0]||[]
ok(x.rows.length===1&&r[0]===''&&r[x.hdr.indexOf('불출수량')]===0,'불출 미대상 줄 — No 빈칸 · 불출수량 0',r)
ok(errs.length===0,'오류 없음',errs); console.log(`t97 ${pass}/${pass+fail}`);await b.close();})();
