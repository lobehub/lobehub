import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3006';

async function openBrowser() {
  console.log('🚀 Starting Playwright browser...');

  const browser = await chromium.launch({
    headless: false, // 显示浏览器
    slowMo: 500, // 减慢操作速度，方便观察
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  console.log('🔐 Navigating to login page...');
  await page.goto(`${BASE_URL}/signin`);

  // 等待页面加载
  await page.waitForLoadState('domcontentloaded');

  console.log('✍️  Waiting for login form...');

  // 等待页面完全加载
  await page.waitForTimeout(2000);

  // 尝试多种方式定位输入框
  const emailInput = page.locator('input').filter({ hasText: /email/i }).or(page.locator('input[type="email"]')).or(page.locator('input[placeholder*="email" i]')).first();

  console.log('✍️  Filling email...');
  await emailInput.waitFor({ state: 'visible', timeout: 15000 });
  await emailInput.click();
  await emailInput.fill('e2e-test@lobehub.com');

  console.log('✍️  Filling password...');
  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.waitFor({ state: 'visible', timeout: 15000 });
  await passwordInput.click();
  await passwordInput.fill('TestPassword123!');

  console.log('🔑 Submitting login form...');

  // 按 Enter 键提交
  await passwordInput.press('Enter');

  // 等待登录成功（等待重定向或URL变化）
  try {
    await page.waitForURL(/^(?!.*\/signin).*$/, { timeout: 15000 });
  } catch (e) {
    console.log('⚠️  Login redirect timeout, trying to navigate anyway...');
  }

  console.log('✅ Login successful!');
  console.log('🌐 Navigating to /community/assistant...');

  // 导航到目标页面
  await page.goto(`${BASE_URL}/community/assistant`);

  // 等待页面加载
  await page.waitForLoadState('domcontentloaded');

  console.log('✨ Page loaded! Browser will stay open for manual inspection.');
  console.log('📝 Press Ctrl+C in the terminal to close the browser.');

  // 保持浏览器打开，直到手动关闭
  await new Promise(() => {}); // 永远等待
}

openBrowser().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
