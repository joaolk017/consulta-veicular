const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async()=>{
  fs.mkdirSync('visual-tests',{recursive:true});
  const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
  for(const device of [
    {name:'desktop',width:1440,height:900,isMobile:false},
    {name:'mobile',width:390,height:844,isMobile:true},
    {name:'mobile-small',width:360,height:780,isMobile:true}
  ]){
    const context=await browser.newContext({viewport:{width:device.width,height:device.height},deviceScaleFactor:1,isMobile:device.isMobile,hasTouch:device.isMobile});
    const page=await context.newPage();
    // Impede chamadas a provedores externos; o teste nunca cria cobranças.
    await page.route('**/*',route=>{
      const u=new URL(route.request().url());
      if(u.hostname==='127.0.0.1')return route.continue();
      return route.abort();
    });
    await page.goto('http://127.0.0.1:8765/index.html',{waitUntil:'domcontentloaded'});
    await page.locator('.cv-showcase').waitFor();
    assert.equal(await page.locator('.cv-product').count(),3);
    assert.equal(await page.locator('.cv-demo-table').count(),1);
    assert.equal(await page.locator('.cv-product--gravame .cv-product-action--disabled').count(),1);
    assert.equal(await page.locator('.cv-showcase').getByText('Consulta por CPF').count(),0);
    const dimensions=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));
    assert.ok(dimensions.width<=dimensions.viewport+2,device.name+' possui rolagem horizontal: '+JSON.stringify(dimensions));
    await page.screenshot({path:'visual-tests/'+device.name+'.png',fullPage:true,animations:'disabled'});
    console.log(device.name+' OK: 3 produtos, exemplo fictício, gravame fechado, sem overflow');
    await context.close();
  }
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
