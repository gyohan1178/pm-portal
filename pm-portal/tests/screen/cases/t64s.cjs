const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1400,height:900}});
await p.goto(`http://localhost:8765/app.html?pt=1&mbulk=1&r=${encodeURIComponent('/production/AX')}`);await p.waitForTimeout(2200)
for (const h of ['#71','#72','#73','#74']) await p.locator('tbody tr',{hasText:h}).filter({hasText:'110158840'}).first().locator('td').first().click()
await p.screenshot({path:'t64_bar.png',clip:{x:0,y:0,width:1400,height:500}})
await p.click('[data-bulk-missing-open]');await p.fill('[data-bulk-missing-paste]','5102060\t2\n4021187\t1');await p.waitForTimeout(900)
await p.screenshot({path:'t64_modal.png'});await b.close()})();
