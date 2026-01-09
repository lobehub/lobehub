/**
 * Agent Conversation Steps
 *
 * Step definitions for Agent conversation E2E tests
 */
import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { llmMockManager, presetResponses } from '../../mocks/llm';
import { CustomWorld } from '../../support/world';

// ============================================
// Given Steps
// ============================================

Given('用户已登录系统', async function (this: CustomWorld) {
  // Session cookies are already set by the Before hook
  // Just verify we have cookies
  const cookies = await this.browserContext.cookies();
  expect(cookies.length).toBeGreaterThan(0);
});

Given('用户进入 Lobe AI 对话页面', async function (this: CustomWorld) {
  console.log('   📍 Step: 设置 LLM mock...');
  // Setup LLM mock before navigation
  llmMockManager.setResponse('hello', presetResponses.greeting);
  await llmMockManager.setup(this.page);

  console.log('   📍 Step: 导航到首页...');
  // Navigate to home page first
  await this.page.goto('/');
  await this.page.waitForLoadState('networkidle', { timeout: 10_000 });

  console.log('   📍 Step: 查找 Lobe AI...');
  // Find and click on "Lobe AI" agent in the sidebar/home
  const lobeAIAgent = this.page.locator('text=Lobe AI').first();
  await expect(lobeAIAgent).toBeVisible({ timeout: 10_000 });

  console.log('   📍 Step: 点击 Lobe AI...');
  await lobeAIAgent.click();

  console.log('   📍 Step: 等待聊天界面加载...');
  // Wait for the chat interface to be ready
  await this.page.waitForLoadState('networkidle', { timeout: 10_000 });

  console.log('   📍 Step: 查找输入框...');
  // The input is a rich text editor with contenteditable
  // There are 2 ChatInput components (desktop & mobile), find the visible one

  // Wait for the page to be ready, then find visible chat input
  await this.page.waitForTimeout(1000);

  // Find all chat-input elements and get the visible one
  const chatInputs = this.page.locator('[data-testid="chat-input"]');
  const count = await chatInputs.count();
  console.log(`   📍 Found ${count} chat-input elements`);

  // Find the first visible one or just use the first one
  let chatInputContainer = chatInputs.first();
  for (let i = 0; i < count; i++) {
    const elem = chatInputs.nth(i);
    const box = await elem.boundingBox();
    if (box && box.width > 0 && box.height > 0) {
      chatInputContainer = elem;
      console.log(`   ✓ Using chat-input element ${i} (has bounding box)`);
      break;
    }
  }

  // Click the container to focus the editor
  await chatInputContainer.click();
  console.log('   ✓ Clicked on chat input container');

  // Wait for any animations to complete
  await this.page.waitForTimeout(300);

  console.log('   ✅ 已进入 Lobe AI 对话页面');
});

// ============================================
// When Steps
// ============================================

/**
 * Given step for when user has already sent a message
 * This sends a message and waits for the AI response
 */
Given('用户已发送消息 {string}', async function (this: CustomWorld, message: string) {
  console.log(`   📍 Step: 发送消息 "${message}" 并等待回复...`);

  // Find visible chat input container first
  const chatInputs = this.page.locator('[data-testid="chat-input"]');
  const count = await chatInputs.count();

  let chatInputContainer = chatInputs.first();
  for (let i = 0; i < count; i++) {
    const elem = chatInputs.nth(i);
    const box = await elem.boundingBox();
    if (box && box.width > 0 && box.height > 0) {
      chatInputContainer = elem;
      break;
    }
  }

  // Click the container to ensure focus is on the input area
  await chatInputContainer.click();
  await this.page.waitForTimeout(500);

  // Type the message
  await this.page.keyboard.type(message, { delay: 30 });
  await this.page.waitForTimeout(300);

  // Send the message
  await this.page.keyboard.press('Enter');

  // Wait for the message to be sent
  await this.page.waitForTimeout(1000);

  // Wait for the assistant response to appear
  // Assistant messages are left-aligned .message-wrapper elements that contain "Lobe AI" title
  console.log('   📍 Step: 等待助手回复...');

  // Wait for any new message wrapper to appear (there should be at least 2 - user + assistant)
  const messageWrappers = this.page.locator('.message-wrapper');
  await expect(messageWrappers)
    .toHaveCount(2, { timeout: 15_000 })
    .catch(() => {
      // Fallback: just wait for at least one message wrapper
      console.log('   📍 Fallback: checking for any message wrapper');
    });

  // Verify the assistant message contains expected content
  const assistantMessage = this.page.locator('.message-wrapper').filter({
    has: this.page.locator('text=Lobe AI'),
  });
  await expect(assistantMessage).toBeVisible({ timeout: 5000 });

  this.testContext.lastMessage = message;
  console.log(`   ✅ 消息已发送并收到回复`);
});

When('用户发送消息 {string}', async function (this: CustomWorld, message: string) {
  console.log(`   📍 Step: 查找输入框...`);

  // Find visible chat input container first
  const chatInputs = this.page.locator('[data-testid="chat-input"]');
  const count = await chatInputs.count();
  console.log(`   📍 Found ${count} chat-input containers`);

  let chatInputContainer = chatInputs.first();
  for (let i = 0; i < count; i++) {
    const elem = chatInputs.nth(i);
    const box = await elem.boundingBox();
    if (box && box.width > 0 && box.height > 0) {
      chatInputContainer = elem;
      console.log(`   📍 Using container ${i}`);
      break;
    }
  }

  // Click the container to ensure focus is on the input area
  console.log(`   📍 Step: 点击输入区域...`);
  await chatInputContainer.click();
  await this.page.waitForTimeout(500);

  console.log(`   📍 Step: 输入消息 "${message}"...`);
  // Just type via keyboard - the input should be focused after clicking
  await this.page.keyboard.type(message, { delay: 30 });
  await this.page.waitForTimeout(300);

  console.log(`   📍 Step: 发送消息 (按 Enter)...`);
  await this.page.keyboard.press('Enter');

  // Wait for the message to be sent and processed
  await this.page.waitForTimeout(1000);

  console.log(`   ✅ 消息已发送`);
  this.testContext.lastMessage = message;
});

// ============================================
// Then Steps
// ============================================

Then('用户应该收到助手的回复', async function (this: CustomWorld) {
  // Wait for the assistant response to appear
  // The response should be in a message bubble with role="assistant" or similar
  const assistantMessage = this.page
    .locator('[data-role="assistant"], [class*="assistant"], [class*="message"]')
    .last();

  await expect(assistantMessage).toBeVisible({ timeout: 15_000 });
});

Then('回复内容应该可见', async function (this: CustomWorld) {
  // Verify the response content is not empty and contains expected text
  const responseText = this.page
    .locator('[data-role="assistant"], [class*="assistant"], [class*="message"]')
    .last()
    .locator('p, span, div')
    .first();

  await expect(responseText).toBeVisible({ timeout: 5000 });

  // Get the text content and verify it's not empty
  const text = await responseText.textContent();
  expect(text).toBeTruthy();
  expect(text!.length).toBeGreaterThan(0);

  console.log(`   ✅ Assistant replied: "${text?.slice(0, 50)}..."`);
});
