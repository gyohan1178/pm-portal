// v4.145.0 — 현장 검색 BOM 조회 엑셀 · CSV
const {chromium}=require('playwright'); const ExcelJS=require('/tmp/jsportal-test/repo/node_modules/exceljs'); const fs=require('fs')
let pass=0,fail=0; const ok=(c,m,x)=>{ if(c){pass++;console.log('  ✓',m)}else{fail++;console.log('  ✗',m,x===undefined?'':JSON.stringify(x))} };
(async()=>{const b=await chromium.launch();const errs=[];const p=await b.newPage({viewport:{width:1400,height:900},acceptDownloads:true});p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8765/app.html?r='+encodeURIComponent('/field-search'));await p.waitForTimeout(1800)
await p.evaluate(()=>{const D=window.__S.DATA; D.items.push({id:'s1',std_code:'AX-5200001',name:'TERMINAL, RING',category:'부품',unit:'EA',manufacturer:'MOLEX',manufacturer_code:'19099-0010',dept:'하네스'}); D.bom.push({id:'b3',customer_id:'cid-ax',project_id:'pj1',item_id:'s1',level:2,qty_per_unit:2.5,seq:3,item_rev:'A'}); D.projects[0].rev='B'})
await p.click('button:has-text("📋 BOM 조회")'); await p.waitForTimeout(300)
const inp=p.locator('input[placeholder^="어셈블리 기준코드"]'); await inp.fill('AX-110153030'); await inp.press('Enter'); await p.waitForTimeout(1500)
ok(!!await p.$('[data-fs-bom-xlsx]')&&!!await p.$('[data-fs-bom-csv]'),'BOM 머리에 엑셀 · CSV 버튼')
let [dl]=await Promise.all([p.waitForEvent('download'),p.click('[data-fs-bom-xlsx]')]); const fx='/tmp/jsportal-test/out/t72.xlsx'; await dl.saveAs(fx)
ok(/^BOM_AX-110153030_RevB_\d{4}-\d\d-\d\d\.xlsx$/.test(dl.suggestedFilename()),'파일 이름',dl.suggestedFilename())
const wb=new ExcelJS.Workbook(); await wb.xlsx.readFile(fx); const ws=wb.getWorksheet('BOM')
ok(/BOM 전개 — AX-110153030  Rev B/.test(ws.getCell('A1').value),'제목',ws.getCell('A1').value)
ok(/부품 3줄 \(1레벨 2\)/.test(ws.getCell('A2').value),'조회 조건 줄',ws.getCell('A2').value)
ok(ws.getRow(4).values.slice(1).join('|')==='No|LV|기준코드|품명|BOM REV|도면 최신 REV|REV 대조|구분|부서|제조사|제조사품번|단위|소요량','머리글')
const r7=ws.getRow(7).values.slice(1); ok(r7[1]==='L2'&&r7[2]==='    └ AX-5200001'&&r7[12]===2.5&&r7[9]==='MOLEX','2레벨 들여쓰기 · 소요량 숫자',r7)
ok(ws.views[0].ySplit===4&&!!ws.autoFilter,'머리글 고정 · 필터')
;[dl]=await Promise.all([p.waitForEvent('download'),p.click('[data-fs-bom-csv]')]); const fc='/tmp/jsportal-test/out/t72.csv'; await dl.saveAs(fc)
const csv=fs.readFileSync(fc,'utf8'); ok(csv.charCodeAt(0)===0xFEFF,'CSV 첫 글자 BOM (엑셀 한글 안 깨짐)')
const lines=csv.slice(1).split('\r\n'); ok(lines.length===4&&lines[0].startsWith('No,LV,기준코드')&&/"TERMINAL, RING"/.test(lines[3])&&lines[3].endsWith(',2.5'),'CSV 줄 · 쉼표 들어간 품명은 따옴표',lines[3])
ok(errs.length===0,'오류 없음',errs);
console.log(`결과: 통과 ${pass} · 실패 ${fail}`);await b.close();})();
