/**
 * Home Sidebar Agent Steps
 *
 * Step definitions for Home page Agent management E2E tests
 * - Rename
 * - Pin/Unpin
 * - Delete
 */
import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { TEST_USER } from '../../support/seedTestUser';
import { type CustomWorld, WAIT_TIMEOUT } from '../../support/world';

// ============================================
// Helper Functions
// ============================================

async function inputNewName(
  this: CustomWorld,
  newName: string,
  pressEnter: boolean,
): Promise<void> {
  await this.page.waitForTimeout(300);

  // Primary: find input inside EditingPopover (data-testid) or antd Popover
  const renameInput = this.page
    .locator('[data-testid="editing-popover"] input, .ant-popover input')
    .first();

  await renameInput.waitFor({ state: 'visible', timeout: 5000 });
  await renameInput.click();
  await renameInput.clear();
  await renameInput.fill(newName);

  if (pressEnter) {
    await renameInput.press('Enter');
  } else {
    // Click the save button (ActionIcon with Check icon) next to the input
    const saveButton = this.page
      .locator('[data-testid="editing-popover"] svg.lucide-check, .ant-popover svg.lucide-check')
      .first();
    try {
      await saveButton.waitFor({ state: 'visible', timeout: 2000 });
      await saveButton.click();
    } catch {
      // Fallback: press Enter to save
      await renameInput.press('Enter');
    }
  }

  await this.page.waitForTimeout(1000);
  console.log(`   ✅ 已输入新名称 "${newName}"`);
}

/**
 * Create a test agent directly in database
 */
async function createTestAgent(title: string = 'Test Agent'): Promise<string> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL not set');

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();

    const now = new Date().toISOString();
    const agentId = `agent_e2e_test_${Date.now()}`;
    const slug = `test-agent-${Date.now()}`;

    await client.query(
      `INSERT INTO agents (id, slug, title, user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT DO NOTHING`,
      [agentId, slug, title, TEST_USER.id, now],
    );

    console.log(`   📍 Created test agent in DB: ${agentId}`);
    return agentId;
  } finally {
    await client.end();
  }
}

// ============================================
// Given Steps
// ============================================

Given('用户在 Home 页面有一个 Agent', async function (this: CustomWorld) {
  console.log('   📍 Step: 在数据库中创建测试 Agent...');
  const agentId = await createTestAgent('E2E Test Agent');
  this.testContext.createdAgentId = agentId;

  console.log('   📍 Step: 导航到 Home 页面...');
  await this.page.goto('/');
  await this.page.waitForLoadState('networkidle', { timeout: 15_000 });
  await this.page.waitForTimeout(1000);

  console.log('   📍 Step: 查找新创建的 Agent...');
  // Look for the newly created agent in the sidebar by its specific ID
  const agentItem = this.page.locator(`a[href="/agent/${agentId}"]`).first();
  await expect(agentItem).toBeVisible({ timeout: WAIT_TIMEOUT });

  // Store agent reference for later use
  const agentLabel = await agentItem.getAttribute('aria-label');
  this.testContext.targetItemId = agentLabel || agentId;
  this.testContext.targetItemSelector = `a[href="/agent/${agentId}"]`;
  this.testContext.targetType = 'agent';

  console.log(`   ✅ 找到 Agent: ${agentLabel}, id: ${agentId}`);
});

Given('该 Agent 未被置顶', { timeout: 30_000 }, async function (this: CustomWorld) {
  console.log('   📍 Step: 检查 Agent 未被置顶...');
  // Check if the agent has a pin icon - if so, unpin it first
  const targetItem = this.page.locator(this.testContext.targetItemSelector).first();
  // Pin icon uses lucide-react which adds class "lucide lucide-pin"
  const pinIcon = targetItem.locator('svg[class*="lucide-pin"]');

  if ((await pinIcon.count()) > 0) {
    console.log('   📍 Agent 已置顶，开始取消置顶操作...');
    // Unpin it first
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

  console.log('   ✅ Agent 未被置顶');
});

Given('该 Agent 已被置顶', { timeout: 30_000 }, async function (this: CustomWorld) {
  console.log('   📍 Step: 确保 Agent 已被置顶...');
  // Check if the agent has a pin icon - if not, pin it first
  const targetItem = this.page.locator(this.testContext.targetItemSelector).first();
  // Pin icon uses lucide-react which adds class "lucide lucide-pin"
  const pinIcon = targetItem.locator('svg[class*="lucide-pin"]');

  if ((await pinIcon.count()) === 0) {
    console.log('   📍 Agent 未置顶，开始置顶操作...');
    // Pin it first - right-click on the NavItem Block inside the Link
    // The ContextMenuTrigger is attached to the Block component inside the Link
    await targetItem.hover();
    await this.page.waitForTimeout(200);
    await targetItem.click({ button: 'right', force: true });
    await this.page.waitForTimeout(500);

    // Debug: check menu visibility
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
  console.log(`   ✅ Agent 已被置顶: ${isPinned}`);
});

// ============================================
// When Steps
// ============================================

When('用户右键点击该 Agent', { timeout: 30_000 }, async function (this: CustomWorld) {
  console.log('   📍 Step: 右键点击 Agent...');

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
    console.log('   ⚠️ 菜单未出现，重试右键点击...');
  });

  // Debug: check what menus are visible
  const menuItems = await this.page.locator('[role="menuitem"]').count();
  console.log(`   📍 Debug: Found ${menuItems} menu items after right-click`);

  console.log('   ✅ 已右键点击 Agent');
});

When('用户悬停在该 Agent 上', async function (this: CustomWorld) {
  console.log('   📍 Step: 悬停在 Agent 上...');

  const targetItem = this.page.locator(this.testContext.targetItemSelector).first();
  await targetItem.hover();
  await this.page.waitForTimeout(500);

  console.log('   ✅ 已悬停在 Agent 上');
});

When('用户点击更多操作按钮', async function (this: CustomWorld) {
  console.log('   📍 Step: 点击更多操作按钮...');

  const targetItem = this.page.locator(this.testContext.targetItemSelector).first();
  const moreButton = targetItem.locator('svg.lucide-ellipsis, svg.lucide-more-horizontal').first();

  if ((await moreButton.count()) > 0) {
    await moreButton.click();
  } else {
    // Fallback: find any visible ellipsis button
    const allEllipsis = this.page.locator('svg.lucide-ellipsis');
    for (let i = 0; i < (await allEllipsis.count()); i++) {
      const ellipsis = allEllipsis.nth(i);
      if (await ellipsis.isVisible()) {
        await ellipsis.click();
        break;
      }
    }
  }

  await this.page.waitForTimeout(500);
  console.log('   ✅ 已点击更多操作按钮');
});

When('用户在菜单中选择重命名', async function (this: CustomWorld) {
  console.log('   📍 Step: 选择重命名选项...');

  const renameOption = this.page.getByRole('menuitem', { name: /^(rename|重命名)$/i });
  await expect(renameOption).toBeVisible({ timeout: 5000 });
  await renameOption.click();
  await this.page.waitForTimeout(500);

  console.log('   ✅ 已选择重命名选项');
});

When('用户在菜单中选择置顶', async function (this: CustomWorld) {
  console.log('   📍 Step: 选择置顶选项...');

  const pinOption = this.page.getByRole('menuitem', { name: /^(pin|置顶)$/i });
  await expect(pinOption).toBeVisible({ timeout: 5000 });
  await pinOption.click();
  await this.page.waitForTimeout(500);

  console.log('   ✅ 已选择置顶选项');
});

When('用户在菜单中选择取消置顶', async function (this: CustomWorld) {
  console.log('   📍 Step: 选择取消置顶选项...');

  const unpinOption = this.page.getByRole('menuitem', { name: /^(unpin|取消置顶)$/i });
  await expect(unpinOption).toBeVisible({ timeout: 5000 });
  await unpinOption.click();
  await this.page.waitForTimeout(500);

  console.log('   ✅ 已选择取消置顶选项');
});

When('用户在菜单中选择删除', async function (this: CustomWorld) {
  console.log('   📍 Step: 选择删除选项...');

  const deleteOption = this.page.getByRole('menuitem', { name: /^(delete|删除)$/i });
  await expect(deleteOption).toBeVisible({ timeout: 5000 });
  await deleteOption.click();
  await this.page.waitForTimeout(300);

  console.log('   ✅ 已选择删除选项');
});

When('用户在弹窗中确认删除', async function (this: CustomWorld) {
  console.log('   📍 Step: 确认删除...');

  const confirmButton = this.page.locator('.ant-modal-confirm-btns button.ant-btn-dangerous');
  await expect(confirmButton).toBeVisible({ timeout: 5000 });
  await confirmButton.click();
  await this.page.waitForTimeout(500);

  console.log('   ✅ 已确认删除');
});

When('用户输入新的名称 {string}', async function (this: CustomWorld, newName: string) {
  console.log(`   📍 Step: 输入新名称 "${newName}"...`);
  await inputNewName.call(this, newName, false);
});

When('用户输入新的名称 {string} 并按 Enter', async function (this: CustomWorld, newName: string) {
  console.log(`   📍 Step: 输入新名称 "${newName}" 并按 Enter...`);
  await inputNewName.call(this, newName, true);
});

// ============================================
// Then Steps
// ============================================

Then('该项名称应该更新为 {string}', async function (this: CustomWorld, expectedName: string) {
  console.log(`   📍 Step: 验证名称为 "${expectedName}"...`);

  await this.page.waitForTimeout(1000);
  const renamedItem = this.page.getByText(expectedName, { exact: true }).first();
  await expect(renamedItem).toBeVisible({ timeout: 5000 });

  console.log(`   ✅ 名称已更新为 "${expectedName}"`);
});

Then('Agent 应该显示置顶图标', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证显示置顶图标...');

  await this.page.waitForTimeout(500);
  const targetItem = this.page.locator(this.testContext.targetItemSelector).first();
  // Pin icon uses lucide-react which adds class "lucide lucide-pin"
  const pinIcon = targetItem.locator('svg[class*="lucide-pin"]');
  await expect(pinIcon).toBeVisible({ timeout: 5000 });

  console.log('   ✅ 置顶图标已显示');
});

Then('Agent 不应该显示置顶图标', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证不显示置顶图标...');

  await this.page.waitForTimeout(500);
  const targetItem = this.page.locator(this.testContext.targetItemSelector).first();
  // Pin icon uses lucide-react which adds class "lucide lucide-pin"
  const pinIcon = targetItem.locator('svg[class*="lucide-pin"]');
  await expect(pinIcon).not.toBeVisible({ timeout: 5000 });

  console.log('   ✅ 置顶图标未显示');
});

Then('Agent 应该从列表中移除', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证 Agent 已移除...');

  await this.page.waitForTimeout(500);

  // Use unique selector based on agent ID (href) to avoid false positives
  // when multiple agents have the same name
  if (this.testContext.targetItemSelector) {
    const deletedItem = this.page.locator(this.testContext.targetItemSelector);
    await expect(deletedItem).not.toBeVisible({ timeout: 5000 });
  }

  console.log('   ✅ Agent 已从列表中移除');
});
