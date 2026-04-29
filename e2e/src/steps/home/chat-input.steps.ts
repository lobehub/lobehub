import { After, Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { llmMockManager } from '../../mocks/llm';
import { type CustomWorld, WAIT_TIMEOUT } from '../../support/world';

const COLD_ROUTE_SCRIPT_DELAY = 2500;

const delay = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

Given(
  '用户在冷启动 Home 页面并延迟 Agent 路由加载',
  { timeout: 45_000 },
  async function (this: CustomWorld) {
    console.log('   📍 Step: 设置快速 LLM mock...');
    llmMockManager.clearResponses();
    llmMockManager.setConfig({
      responseDelay: 0,
      streamChunkSize: 1024,
      streamDelay: 0,
    });
    llmMockManager.setResponse('cold route home message', 'cold route response');
    await llmMockManager.setup(this.page);

    console.log('   📍 Step: 注册冷路由脚本延迟...');
    this.testContext.delayColdAgentScripts = false;

    await this.page.route('**/*', async (route) => {
      const request = route.request();
      const url = request.url();
      const shouldDelay =
        this.testContext.delayColdAgentScripts === true &&
        request.resourceType() === 'script' &&
        (url.includes('/_next/static/') ||
          url.includes('/src/routes/(main)/agent') ||
          url.includes('/src/routes/%28main%29/agent'));

      if (shouldDelay) {
        console.log(`   ⏳ Delaying cold agent script: ${url}`);
        await delay(COLD_ROUTE_SCRIPT_DELAY);
      }

      await route.continue();
    });

    console.log('   📍 Step: 导航到 Home 页面...');
    await this.page.goto('/');

    const chatInputContainer = this.page.locator('[data-testid="chat-input"]').first();
    await expect(chatInputContainer).toBeVisible({ timeout: WAIT_TIMEOUT });

    console.log('   ✅ 已进入冷启动 Home 页面');
  },
);

When('用户按 Enter 从 Home 默认输入发送', { timeout: 45_000 }, async function (this: CustomWorld) {
  console.log('   📍 Step: 启用冷路由延迟并发送默认 Home 消息...');

  await this.page.waitForTimeout(200);
  this.testContext.delayColdAgentScripts = true;

  await this.page.keyboard.press('Enter');

  await this.page.waitForURL(/\/agent\/[^/?#]+/, { timeout: WAIT_TIMEOUT });

  console.log('   ✅ 已触发 Home 默认发送');
});

Then('页面应该跳转到新建 Topic 对话页面', { timeout: 45_000 }, async function (this: CustomWorld) {
  console.log('   📍 Step: 验证 URL 进入新建 Topic...');

  await this.page.waitForURL(/\/agent\/[^/?#]+\/[^/?#]+/, { timeout: 30_000 });

  const currentUrl = this.page.url();
  expect(currentUrl).toMatch(/\/agent\/[^/?#]+\/[^/?#]+/);

  console.log(`   ✅ 已跳转到 Topic 页面: ${currentUrl}`);
});

Then(
  '用户消息 {string} 应该保留在对话中',
  { timeout: 45_000 },
  async function (this: CustomWorld, message: string) {
    console.log(`   📍 Step: 验证用户消息仍在对话中: ${message}`);

    await expect(this.page.getByText(message).first()).toBeVisible({ timeout: WAIT_TIMEOUT });

    console.log('   ✅ 用户消息已保留在对话中');
  },
);

After({ tags: '@chat-input' }, async function (this: CustomWorld) {
  llmMockManager.resetConfig();
  llmMockManager.clearResponses();
  this.testContext.delayColdAgentScripts = false;
});
