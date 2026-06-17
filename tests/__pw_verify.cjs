const { chromium } = require('playwright'); 
async function run(){ 
  const browser = await chromium.launch(); 
  const page = await browser.newPage(); 
  page.on('pageerror', err => console.log('PAGEERROR', err.message)); 
  await page.goto('http://localhost:5000', { waitUntil: 'domcontentloaded', timeout: 15000 }); 
  await page.waitForTimeout(1200); 
