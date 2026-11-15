const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1500,height:1100}});
 await p.addInitScript(()=>{ window.print=()=>{} });
 await p.goto('http://localhost:8765/app.html?qsup=buy&r='+encodeURIComponent('/sales-quote'));await p.waitForTimeout(2000);
 await p.click('button:has-text("✍ 견적 작성")');await p.waitForTimeout(1200);
 const pn=p.locator('input[placeholder="품번 입력 (ASSY·단품 자동 판별)"]'); await pn.fill('990000001'); await pn.press('Enter'); await p.waitForTimeout(1800);
 await p.check('[data-quote-detail]'); if(process.env.MODE) await p.selectOption('[data-quote-print-mode]',process.env.MODE); await p.click('[data-quote-print]'); await p.waitForTimeout(300)
 if(process.env.CSS) await p.addStyleTag({content:process.env.CSS})
 await p.emulateMedia({media:'print'})
 const r=await p.evaluate(()=>{const s=document.querySelector('.qd-sheet');const a=document.querySelector('.quote-print-area');const cs=getComputedStyle(s);return {sh:s.getBoundingClientRect().height, top:s.getBoundingClientRect().top, areaTop:a.getBoundingClientRect().top, pad:cs.padding, mh:cs.minHeight, tbl:s.querySelector('table').getBoundingClientRect().height}})
 console.log(JSON.stringify(r))
 await p.pdf({path:'t65d.pdf',landscape:true,format:'A4',printBackground:true,preferCSSPageSize:true}); await b.close()})();
