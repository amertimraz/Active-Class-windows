const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:5000';

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const page = await browser.newPage();

  try {
    // Navigate to games page
    await page.goto(`${TARGET_URL}/pages/games.html`);
    
    // Wait for the platform game card to appear
    await page.waitForSelector('a[href="/pages/platform-game.html"]', { timeout: 5000 });
    
    // Click on the platform game
    await page.click('a[href="/pages/platform-game.html"]');
    
    // Wait for game to load
    await page.waitForSelector('#game-container', { timeout: 10000 });
    
    // Wait for the game to render (player, platforms, coins)
    await page.waitForTimeout(3000);
    
    // Take screenshot
    await page.screenshot({ 
      path: '/Amer/ActiveClass/app_clean/classroom-manager/platform-game-screenshot.png', 
      fullPage: true 
    });
    
    console.log('Screenshot saved to platform-game-screenshot.png');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await browser.close();
  }
})();
