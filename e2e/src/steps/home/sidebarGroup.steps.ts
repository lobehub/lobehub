/**
 * Home Sidebar Agent Group Steps
 *
 * Step definitions for Home page Agent Group management E2E tests
 * - Rename
 * - Pin/Unpin
 * - Delete
 */
import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { TEST_USER } from '../../support/seedTestUser';
import type { CustomWorld } from '../../support/world';
import { WAIT_TIMEOUT } from '../../support/world';

/**
 * Create a test chat group directly in database
 */
async function createTestGroup(title: string = 'Test Group'): Promise<string> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL not set');

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();

    const now = new Date().toISOString();
    const groupId = `group_e2e_test_${Date.now()}`;

    await client.query(
      `INSERT INTO chat_groups (id, title, user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT DO NOTHING`,
      [groupId, title, TEST_USER.id, now],
    );

    console.log(`   📍 Created test group in DB: ${groupId}`);
    return groupId;
  } finally {
    await client.end();
  }
}

// ============================================
// Given Steps
// ============================================

Given('用户在 Home 页面有一个 Agent Group', async function (this: CustomWorld) {
  console.log('   📍 Step: 在数据库中创建测试 Agent Group...');
  const groupId = await createTestGroup('E2E Test Group');
  this.testContext.createdGroupId = groupId;

  console.log('   📍 Step: 导航到 Home 页面...');
  await this.page.goto('/');
  await this.page.waitForLoadState('networkidle', { timeout: 15_000 });
  await this.page.waitForTimeout(1000);

  console.log('   📍 Step: 查找新创建的 Agent Group...');
  const groupItem = this.page.locator(`a[href="/group/${groupId}"]`).first();
  await expect(groupItem).toBeVisible({ timeout: WAIT_TIMEOUT });

  const groupLabel = await groupItem.getAttribute('aria-label');
  this.testContext.targetItemId = groupLabel || groupId;
  this.testContext.targetItemSelector = `a[href="/group/${groupId}"]`;
  this.testContext.targetType = 'group';

  console.log(`   ✅ 找到 Agent Group: ${groupLabel}, id: ${groupId}`);
});

Given('该 Agent Group 未被置顶', { timeout: 30_000 }, async function (this: CustomWorld) {
  console.log('   📍 Step: 检查 Agent Group 未被置顶...');
  const targetItem = this.page.locator(this.testContext.targetItemSelector).first();
  // Pin icon uses lucide-react which adds class "lucide lucide-pin"
  const pinIcon = targetItem.locator('svg[class*="lucide-pin"]');

  if ((await pinIcon.count()) > 0) {
    console.log('   📍 Agent Group 已置顶，开始取消置顶操作...');
    await targetItem.hover();
    await this.page.waitForTimeout(200);
    await targetItem.click({ button: 'right', force: true });
    await this.page.waitForTimeout(500);
    const unpinOption = this.page.getByRole('menuitem', { name: /取消置顶|unpin/i });
    await unpinOption.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
      console.log('   ⚠️ 取消置顶选项未找到');
    });
    if ((await unpinOption.count()) > 0) {
      await unpinOption.click();
      await this.page.waitForTimeout(500);
    }
    // Close menu if still open
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);
  }

  console.log('   ✅ Agent Group 未被置顶');
});

Given('该 Agent Group 已被置顶', { timeout: 30_000 }, async function (this: CustomWorld) {
  console.log('   📍 Step: 确保 Agent Group 已被置顶...');
  const targetItem = this.page.locator(this.testContext.targetItemSelector).first();
  // Pin icon uses lucide-react which adds class "lucide lucide-pin"
  const pinIcon = targetItem.locator('svg[class*="lucide-pin"]');

  if ((await pinIcon.count()) === 0) {
    console.log('   📍 Agent Group 未置顶，开始置顶操作...');
    await targetItem.hover();
    await this.page.waitForTimeout(200);
    await targetItem.click({ button: 'right', force: true });
    await this.page.waitForTimeout(500);

    const menuItems = await this.page.locator('[role="menuitem"]').count();
    console.log(`   📍 Debug: 发现 ${menuItems} 个菜单项`);

    const pinOption = this.page.getByRole('menuitem', { name: /置顶|pin/i });
    await pinOption.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
      console.log('   ⚠️ 置顶选项未找到');
    });
    if ((await pinOption.count()) > 0) {
      await pinOption.click();
      await this.page.waitForTimeout(500);
      console.log('   ✅ 已点击置顶选项');
    }
    // Close menu if still open
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);
  }

  // Verify pin is now visible
  await this.page.waitForTimeout(500);
  const pinIconAfter = targetItem.locator('svg[class*="lucide-pin"]');
  const isPinned = (await pinIconAfter.count()) > 0;
  console.log(`   ✅ Agent Group 已被置顶: ${isPinned}`);
});

// ============================================
// When Steps
// ============================================

When('用户右键点击该 Agent Group', { timeout: 30_000 }, async function (this: CustomWorld) {
  console.log('   📍 Step: 右键点击 Agent Group...');

  const targetItem = this.page.locator(this.testContext.targetItemSelector).first();

  // Hover first to ensure element is interactive
  await targetItem.hover();
  await this.page.waitForTimeout(200);

  // Right-click with force option to ensure it triggers
  await targetItem.click({ button: 'right', force: true });
  await this.page.waitForTimeout(500);

  // Wait for context menu to appear
  const menuItem = this.page.locator('[role="menuitem"]').first();
  await menuItem.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {
    console.log('   ⚠️ 菜单未出现');
  });

  const menuItems = await this.page.locator('[role="menuitem"]').count();
  console.log(`   📍 Debug: Found ${menuItems} menu items after right-click`);

  console.log('   ✅ 已右键点击 Agent Group');
});

When('用户悬停在该 Agent Group 上', async function (this: CustomWorld) {
  console.log('   📍 Step: 悬停在 Agent Group 上...');

  const targetItem = this.page.locator(this.testContext.targetItemSelector).first();
  await targetItem.hover();
  await this.page.waitForTimeout(500);

  console.log('   ✅ 已悬停在 Agent Group 上');
});

// ============================================
// Then Steps
// ============================================

Then('Agent Group 应该显示置顶图标', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证显示置顶图标...');

  await this.page.waitForTimeout(500);
  const targetItem = this.page.locator(this.testContext.targetItemSelector).first();
  // Pin icon uses lucide-react which adds class "lucide lucide-pin"
  const pinIcon = targetItem.locator('svg[class*="lucide-pin"]');
  await expect(pinIcon).toBeVisible({ timeout: 5000 });

  console.log('   ✅ 置顶图标已显示');
});

Then('Agent Group 不应该显示置顶图标', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证不显示置顶图标...');

  await this.page.waitForTimeout(500);
  const targetItem = this.page.locator(this.testContext.targetItemSelector).first();
  // Pin icon uses lucide-react which adds class "lucide lucide-pin"
  const pinIcon = targetItem.locator('svg[class*="lucide-pin"]');
  await expect(pinIcon).not.toBeVisible({ timeout: 5000 });

  console.log('   ✅ 置顶图标未显示');
});

Then('Agent Group 应该从列表中移除', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证 Agent Group 已移除...');

  await this.page.waitForTimeout(500);

  const deletedItem = this.page.locator(this.testContext.targetItemSelector);
  await expect(deletedItem).not.toBeVisible({ timeout: 5000 });

  console.log('   ✅ Agent Group 已从列表中移除');
});
