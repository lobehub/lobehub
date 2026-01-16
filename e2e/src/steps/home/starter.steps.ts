/**
 * Home Starter Steps
 *
 * Step definitions for Home page Starter E2E tests
 * - Create Agent from Home input
 * - Create Group from Home input
 * - Verify Agent/Group appears in sidebar after returning to Home
 */
import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { llmMockManager, presetResponses } from '../../mocks/llm';
import { CustomWorld, WAIT_TIMEOUT } from '../../support/world';

// Store created IDs for verification
let createdAgentId: string | null = null;
let createdGroupId: string | null = null;

// ============================================
// Given Steps
// ============================================

Given('用户在 Home 页面', async function (this: CustomWorld) {
  console.log('   📍 Step: 设置 LLM mock...');
  // Setup LLM mock before navigation (for agent/group builder message)
  llmMockManager.setResponse('E2E Test Agent', presetResponses.greeting);
  llmMockManager.setResponse('E2E Test Group', presetResponses.greeting);
  await llmMockManager.setup(this.page);

  console.log('   📍 Step: 导航到 Home 页面...');
  await this.page.goto('/');
  await this.page.waitForLoadState('networkidle', { timeout: 15_000 });
  await this.page.waitForTimeout(1000);

  // Reset IDs for each test
  createdAgentId = null;
  createdGroupId = null;

  console.log('   ✅ 已进入 Home 页面');
});

// ============================================
// When Steps
// ============================================

When('用户点击创建 Agent 按钮', async function (this: CustomWorld) {
  console.log('   📍 Step: 点击创建 Agent 按钮...');

  // Find the "Create Agent" button by text (supports both English and Chinese)
  const createAgentButton = this.page
    .getByRole('button', { name: /create agent|创建智能体/i })
    .first();

  await expect(createAgentButton).toBeVisible({ timeout: WAIT_TIMEOUT });
  await createAgentButton.click();
  await this.page.waitForTimeout(500);

  console.log('   ✅ 已点击创建 Agent 按钮');
});

When('用户点击创建 Group 按钮', async function (this: CustomWorld) {
  console.log('   📍 Step: 点击创建 Group 按钮...');

  // Find the "Create Group" button by text (supports both English and Chinese)
  const createGroupButton = this.page
    .getByRole('button', { name: /create group|创建群组/i })
    .first();

  await expect(createGroupButton).toBeVisible({ timeout: WAIT_TIMEOUT });
  await createGroupButton.click();
  await this.page.waitForTimeout(500);

  console.log('   ✅ 已点击创建 Group 按钮');
});

When('用户在输入框中输入 {string}', async function (this: CustomWorld, message: string) {
  console.log(`   📍 Step: 在输入框中输入 "${message}"...`);

  // The chat input is a contenteditable editor, need to click first then type
  const chatInputContainer = this.page.locator('[data-testid="chat-input"]').first();

  // If data-testid not found, try alternative selectors
  let inputFound = false;
  if ((await chatInputContainer.count()) > 0) {
    await chatInputContainer.click();
    inputFound = true;
  } else {
    // Try to find the editor by its contenteditable attribute
    const editor = this.page.locator('[contenteditable="true"]').first();
    if ((await editor.count()) > 0) {
      await editor.click();
      inputFound = true;
    }
  }

  if (!inputFound) {
    throw new Error('Could not find chat input');
  }

  await this.page.waitForTimeout(300);
  await this.page.keyboard.type(message, { delay: 30 });

  console.log(`   ✅ 已输入 "${message}"`);
});

When('用户按 Enter 发送', async function (this: CustomWorld) {
  console.log('   📍 Step: 按 Enter 发送...');

  // Listen for navigation to capture the agent/group ID
  const navigationPromise = this.page.waitForURL(/\/(agent|group)\/.*\/profile/, {
    timeout: 30_000,
  });

  await this.page.keyboard.press('Enter');

  // Wait for navigation to profile page
  await navigationPromise;
  await this.page.waitForLoadState('networkidle', { timeout: 15_000 });

  // Extract agent/group ID from URL
  const currentUrl = this.page.url();

  const agentMatch = currentUrl.match(/\/agent\/([^/]+)/);
  if (agentMatch) {
    createdAgentId = agentMatch[1];
    console.log(`   📍 Created agent ID: ${createdAgentId}`);
  }

  const groupMatch = currentUrl.match(/\/group\/([^/]+)/);
  if (groupMatch) {
    createdGroupId = groupMatch[1];
    console.log(`   📍 Created group ID: ${createdGroupId}`);
  }

  console.log('   ✅ 已发送消息');
});

When('用户返回 Home 页面', async function (this: CustomWorld) {
  console.log('   📍 Step: 返回 Home 页面...');

  await this.page.goto('/');
  await this.page.waitForLoadState('networkidle', { timeout: 15_000 });
  await this.page.waitForTimeout(1000);

  console.log('   ✅ 已返回 Home 页面');
});

// ============================================
// Then Steps
// ============================================

Then('页面应该跳转到 Agent 的 profile 页面', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证页面跳转到 Agent profile 页面...');

  // Check current URL matches /agent/{id}/profile pattern
  const currentUrl = this.page.url();
  expect(currentUrl).toMatch(/\/agent\/[^/]+\/profile/);

  console.log('   ✅ 已跳转到 Agent profile 页面');
});

Then('页面应该跳转到 Group 的 profile 页面', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证页面跳转到 Group profile 页面...');

  // Check current URL matches /group/{id}/profile pattern
  const currentUrl = this.page.url();
  expect(currentUrl).toMatch(/\/group\/[^/]+\/profile/);

  console.log('   ✅ 已跳转到 Group profile 页面');
});

Then('新创建的 Agent 应该在侧边栏中显示', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证 Agent 在侧边栏中显示...');

  // Wait for sidebar to be visible and data to load
  await this.page.waitForTimeout(1500);

  // Check if the agent appears in sidebar by its link (primary assertion)
  // This proves that refreshAgentList() was called and the sidebar was updated
  if (!createdAgentId) {
    throw new Error('Agent ID was not captured during creation');
  }

  const agentLink = this.page.locator(`a[href="/agent/${createdAgentId}"]`).first();
  await expect(agentLink).toBeVisible({ timeout: WAIT_TIMEOUT });
  console.log(`   ✅ 找到 Agent 链接: /agent/${createdAgentId}`);

  // Get the aria-label or text content to verify it's the correct agent
  const ariaLabel = await agentLink.getAttribute('aria-label');
  console.log(`   📍 Agent aria-label: ${ariaLabel}`);

  console.log('   ✅ Agent 已在侧边栏中显示');
});

Then('新创建的 Group 应该在侧边栏中显示', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证 Group 在侧边栏中显示...');

  // Wait for sidebar to be visible and data to load
  await this.page.waitForTimeout(1500);

  // Check if the group appears in sidebar by its link (primary assertion)
  // This proves that refreshAgentList() was called and the sidebar was updated
  if (!createdGroupId) {
    throw new Error('Group ID was not captured during creation');
  }

  const groupLink = this.page.locator(`a[href="/group/${createdGroupId}"]`).first();
  await expect(groupLink).toBeVisible({ timeout: WAIT_TIMEOUT });
  console.log(`   ✅ 找到 Group 链接: /group/${createdGroupId}`);

  // Get the aria-label or text content to verify it's the correct group
  const ariaLabel = await groupLink.getAttribute('aria-label');
  console.log(`   📍 Group aria-label: ${ariaLabel}`);

  console.log('   ✅ Group 已在侧边栏中显示');
});
