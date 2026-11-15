const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1500,height:1100}});
 await p.addInitScript(()=>{ window.print=()=>{} });
 await p.goto('http://localhost:8765/app.html?qsup=buy&r='+encodeURIComponent('/sales-quote'));await p.waitForTimeout(2000);
 await p.evaluate(()=>{const D=window.__S.DATA; for(let i=0;i<45;i++){D.items.push({id:'z'+i,std_code:'AX-Z'+(1000+i),name:'TERMINAL RING TONGUE PART '+i+(i%7==0?' WITH A VERY LONG DESCRIPTION FOR WRAP TEST':''),category:'부품',type:'자재',unit:'EA',purchase_price:100+i*37,manufacturer:'MOLEX',manufacturer_code:'19099-00'+i}); D.bom.push({id:'zb'+i,customer_id:'cid-ax',project_id:'pj9',item_id:'z'+i,level:1,qty_per_unit:(i%3)+1,seq:10+i,quote_excluded:false})}})
 await p.click('button:has-text("✍ 견적 작성")');await p.waitForTimeout(1200);
 const pn=p.locator('input[placeholder="품번 입력 (ASSY·단품 자동 판별)"]'); await pn.fill('990000001'); await pn.press('Enter'); await p.waitForTimeout(2000);
 await p.check('[data-quote-detail]'); if(process.env.MK) await p.check('[data-quote-detail-maker]'); if(process.env.MODE) await p.selectOption('[data-quote-print-mode]',process.env.MODE); await p.click('[data-quote-print]'); await p.waitForTimeout(300)
 console.log('rows',await p.$$eval('[data-qd-row]',a=>a.length),'sheets',await p.$$eval('[data-qd-sheet]',a=>a.length))
 await p.pdf({path:'t65e'+(process.env.MODE||'')+'.pdf',landscape:true,format:'A4',printBackground:true,preferCSSPageSize:true}); await b.close()})();
