import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3006';
const TARGET_PATH = process.env.TARGET_PATH || '/community/assistant';

async function openBrowser() {
  console.log('🚀 Starting Playwright browser...');
  console.log(`🌐 Target URL: ${BASE_URL}${TARGET_PATH}`);

  const browser = await chromium.launch({
    headless: false, // 显示浏览器
    slowMo: 100, // 稍微减慢操作速度
  });

  const context = await browser.newContext({
    viewport: { height: 1080, width: 1920 },
  });

  const page = await context.newPage();

  console.log('📍 Navigating to target page...');
  await page.goto(`${BASE_URL}${TARGET_PATH}`);

  console.log('');
  console.log('✨ Browser is now open!');
  console.log('');
  console.log('📝 If you see a login page:');
  console.log('   Email: e2e-test@lobehub.com');
  console.log('   Password: TestPassword123!');
  console.log('');
  console.log('💡 The browser will stay open for manual inspection.');
  console.log('   Press Ctrl+C in the terminal to close it.');
  console.log('');

  // 保持浏览器打开
  await new Promise(() => {});
}

openBrowser().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
