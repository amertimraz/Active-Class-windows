const { chromium } = require('playwright'); 
async function run(){ 
  const browser = await chromium.launch(); 
  const page = await browser.newPage(); 
  page.on('console', msg => console.log('CONSOLE', msg.type(), msg.text())); 
  page.on('pageerror', err => console.log('PAGEERROR', err.message)); 
  await page.goto('http://localhost:5000', { waitUntil: 'domcontentloaded', timeout: 15000 }); 
  await page.waitForTimeout(1500); 
  const appCount = await page.locator('#app').count();
  console.log('appCount', appCount);
  if (appCount > 0) {
    console.log('appLen', (await page.locator('#app').innerHTML()).length);
  }
  await browser.close(); 
} 
run(); 
