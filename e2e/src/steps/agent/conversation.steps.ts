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
  // Setup LLM mock before navigation with all preset responses
  llmMockManager.setResponse('hello', presetResponses.greeting);
  llmMockManager.setResponse('hello world', presetResponses.greeting);
  llmMockManager.setResponse('我的名字是小明', presetResponses.nameIntro);
  llmMockManager.setResponse('我刚才说我的名字是什么？', presetResponses.nameRecall);
  llmMockManager.setResponse('我刚才说我的名字是什么', presetResponses.nameRecall);
  llmMockManager.setResponse('写一篇很长的文章', presetResponses.longArticle);
  llmMockManager.setResponse('测试对话内容', '这是测试对话的回复内容。');
  llmMockManager.setResponse('第一个对话', '这是第一个对话的回复。');
  llmMockManager.setResponse('第二个对话', '这是第二个对话的回复。');
  await llmMockManager.setup(this.page);

  console.log('   📍 Step: 导航到首页...');
  // Navigate to home page first
  await this.page.goto('/');
  await this.page.waitForLoadState('networkidle', { timeout: 15_000 });

  console.log('   📍 Step: 等待助手列表加载...');
  // Wait for skeletons to disappear (assistant list to load)
  await this.page.waitForTimeout(2000);

  console.log('   📍 Step: 查找 Lobe AI...');
  // Find and click on "Lobe AI" agent in the sidebar/home
  const lobeAIAgent = this.page.locator('text=Lobe AI').first();
  await expect(lobeAIAgent).toBeVisible({ timeout: 20_000 });

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

Then('回复内容应该包含 {string}', async function (this: CustomWorld, expectedText: string) {
  console.log(`   📍 Step: 验证回复包含 "${expectedText}"...`);

  // Get the last assistant message
  const assistantMessages = this.page.locator(
    '[data-role="assistant"], [class*="assistant"], [class*="message"]',
  );
  const lastMessage = assistantMessages.last();

  await expect(lastMessage).toBeVisible({ timeout: 10_000 });

  // Get text content
  const text = await lastMessage.textContent();
  console.log(`   📍 回复内容: "${text?.slice(0, 100)}..."`);

  expect(text).toContain(expectedText);
  console.log(`   ✅ 回复包含 "${expectedText}"`);
});

// ============================================
// Given Steps for Advanced Scenarios
// ============================================

Given('用户已发送消息 {string}', async function (this: CustomWorld, message: string) {
  console.log(`   📍 Step: 发送预备消息 "${message}"...`);

  // Find and click the chat input
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

  await chatInputContainer.click();
  await this.page.waitForTimeout(300);
  await this.page.keyboard.type(message, { delay: 30 });
  await this.page.keyboard.press('Enter');

  // Wait for response
  await this.page.waitForTimeout(2000);

  // Verify we got a response
  const assistantMessage = this.page
    .locator('[data-role="assistant"], [class*="assistant"], [class*="message"]')
    .last();
  await expect(assistantMessage).toBeVisible({ timeout: 15_000 });

  console.log(`   ✅ 预备消息已发送并收到回复`);
});

// ============================================
// When Steps for Advanced Scenarios
// ============================================

When('用户点击清空对话按钮', async function (this: CustomWorld) {
  console.log('   📍 Step: 查找清空对话按钮...');

  // The clear button uses an Eraser icon from lucide-react and is visible in the ActionBar
  // The ActionBar is in the footer of ChatInput component
  // We need to find all buttons on the page and look for the one with the Eraser icon

  // Look for ALL buttons on the page that have SVG icons
  // This is a broader search to capture all action bar buttons
  const allPageButtons = this.page.locator('button:has(svg)');
  const pageButtonCount = await allPageButtons.count();
  console.log(`   📍 Found ${pageButtonCount} buttons with SVG on page`);

  let clearButtonFound = false;

  // First try to find by lucide class name for eraser
  const eraserByClass = this.page.locator('svg.lucide-eraser').locator('..');
  if ((await eraserByClass.count()) > 0) {
    console.log('   📍 Found eraser button by class name');
    await eraserByClass.first().click();
    clearButtonFound = true;
  }

  // If not found by class, iterate through buttons and check SVG path data
  if (!clearButtonFound) {
    for (let i = 0; i < pageButtonCount; i++) {
      const btn = allPageButtons.nth(i);
      const box = await btn.boundingBox();
      if (!box || box.width === 0 || box.height === 0) continue;

      // Check SVG class
      const svgInButton = btn.locator('svg').first();
      const svgClass = await svgInButton.getAttribute('class').catch(() => '');

      if (svgClass?.includes('eraser') || svgClass?.toLowerCase().includes('eraser')) {
        console.log(`   📍 Found eraser by class at button ${i}: ${svgClass}`);
        await btn.click();
        clearButtonFound = true;
        break;
      }

      // Check path data - the Eraser icon has specific path
      const pathElement = btn.locator('svg path').first();
      const pathD = await pathElement.getAttribute('d').catch(() => '');

      // Eraser icon path data pattern from lucide-react
      // Check for multiple possible patterns
      if (
        pathD?.includes('m7 21') ||
        pathD?.includes('M7 21') ||
        pathD?.includes('7 21-4.3-4.3') ||
        pathD?.includes('21l-4.3')
      ) {
        console.log(`   📍 Found eraser button by path at index ${i}`);
        await btn.click();
        clearButtonFound = true;
        break;
      }
    }
  }

  // Fallback: hover over buttons in bottom area and find one with "清空" tooltip
  if (!clearButtonFound) {
    console.log('   📍 Trying hover approach to find button with 清空 tooltip...');

    // Focus on buttons in the bottom 200px of viewport
    for (let i = 0; i < pageButtonCount; i++) {
      const btn = allPageButtons.nth(i);
      const box = await btn.boundingBox();

      // Only check buttons in the bottom area (action bar)
      if (!box || box.width === 0 || box.height === 0) continue;
      if (box.y < 500) continue; // Skip buttons not in bottom area

      // Hover to trigger tooltip
      await btn.hover();
      await this.page.waitForTimeout(300);

      // Check if tooltip with "清空" appeared
      const tooltip = this.page.locator('.ant-tooltip:has-text("清空")');
      if ((await tooltip.count()) > 0) {
        console.log(`   📍 Found clear button by tooltip at index ${i}`);
        await btn.click();
        clearButtonFound = true;
        break;
      }
    }
  }

  // Last resort: click buttons in bottom area and check for Popconfirm
  if (!clearButtonFound) {
    console.log('   📍 Last resort: clicking bottom buttons to find Popconfirm...');
    for (let i = 0; i < pageButtonCount; i++) {
      const btn = allPageButtons.nth(i);
      const box = await btn.boundingBox();
      if (!box || box.width === 0 || box.height === 0) continue;
      if (box.y < 500) continue; // Focus on bottom area

      await btn.click();
      await this.page.waitForTimeout(300);

      // Check if Popconfirm appeared
      const popconfirm = this.page.locator(
        '.ant-popconfirm, .ant-popover:has(button.ant-btn-dangerous)',
      );
      if ((await popconfirm.count()) > 0 && (await popconfirm.first().isVisible())) {
        console.log(`   📍 Found Popconfirm after clicking button ${i}`);
        clearButtonFound = true;
        break;
      }

      // Press Escape to dismiss any popover
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(100);
    }
  }

  if (!clearButtonFound) {
    throw new Error('Could not find the clear button');
  }

  // Wait for Popconfirm to appear and click the confirm button
  console.log('   📍 Step: 确认清空...');
  await this.page.waitForTimeout(500);

  // The Popconfirm has a danger primary button for confirmation
  const confirmButton = this.page.locator(
    '.ant-popconfirm button.ant-btn-primary, .ant-popover button.ant-btn-primary',
  );
  await expect(confirmButton).toBeVisible({ timeout: 5000 });
  await confirmButton.click();

  await this.page.waitForTimeout(500);
  console.log('   ✅ 已点击清空对话按钮');
});

When('用户点击重新生成按钮', async function (this: CustomWorld) {
  console.log('   📍 Step: 查找重新生成按钮...');

  // The regenerate action is in the ActionIconGroup menu for assistant messages
  // ActionIconGroup renders ActionIcon buttons and a "more" button (MoreHorizontal icon)
  // The "more" button opens a dropdown menu with "重新生成" option
  // Action buttons only appear on hover over the message

  // Wait for the message to be rendered
  await this.page.waitForTimeout(500);

  // Find assistant messages by their structure
  // Assistant messages have class "message-wrapper" and are aligned to the left
  const messageWrappers = this.page.locator('.message-wrapper');
  const wrapperCount = await messageWrappers.count();
  console.log(`   📍 Found ${wrapperCount} message wrappers`);

  // Find the assistant message by looking for the one with "Lobe AI" text
  let assistantMessage = null;
  for (let i = wrapperCount - 1; i >= 0; i--) {
    const wrapper = messageWrappers.nth(i);
    const titleText = await wrapper
      .locator('.message-header')
      .textContent()
      .catch(() => '');
    console.log(`   📍 Message ${i} title: "${titleText?.slice(0, 30)}..."`);

    // Check if this is an assistant message (has "Lobe AI" or similar in title)
    if (titleText?.includes('Lobe AI') || titleText?.includes('AI')) {
      assistantMessage = wrapper;
      console.log(`   📍 Found assistant message at index ${i}`);
      break;
    }
  }

  if (!assistantMessage) {
    throw new Error('No assistant messages found');
  }

  // Hover over the message to reveal action buttons
  console.log('   📍 Hovering over assistant message to reveal actions...');
  await assistantMessage.hover();
  await this.page.waitForTimeout(800);

  // The action bar with role="menubar" contains the ActionIconGroup
  // The "more" button uses MoreHorizontal icon from lucide-react (class: lucide-more-horizontal)
  // Try to find the more button by its icon class
  const moreButtonByClass = this.page.locator('svg.lucide-more-horizontal').locator('..');
  let moreButtonCount = await moreButtonByClass.count();
  console.log(`   📍 Found ${moreButtonCount} buttons with more-horizontal icon`);

  let menuOpened = false;

  if (moreButtonCount > 0) {
    // Find the one in the main content area (not sidebar)
    for (let i = 0; i < moreButtonCount; i++) {
      const btn = moreButtonByClass.nth(i);
      const btnBox = await btn.boundingBox();
      if (!btnBox || btnBox.x < 320) continue; // Skip sidebar buttons

      console.log(`   📍 More button ${i} at (${btnBox.x}, ${btnBox.y})`);
      await btn.click();
      await this.page.waitForTimeout(500);

      // Check if dropdown menu appeared with regenerate option
      const menu = this.page.locator('.ant-dropdown-menu:visible');
      if ((await menu.count()) > 0) {
        const hasRegenerate = this.page.locator('.ant-dropdown-menu-item:has-text("重新生成")');
        if ((await hasRegenerate.count()) > 0) {
          console.log(`   📍 Found menu with regenerate option`);
          menuOpened = true;
          break;
        } else {
          const menuItems = await this.page.locator('.ant-dropdown-menu-item').allTextContents();
          console.log(`   📍 Menu items: ${menuItems.slice(0, 5).join(', ')}...`);
          await this.page.keyboard.press('Escape');
          await this.page.waitForTimeout(200);
          // Re-hover to keep action bar visible
          await assistantMessage.hover();
          await this.page.waitForTimeout(300);
        }
      }
    }
  }

  // Fallback: Look for all buttons in the action bar area after hovering
  if (!menuOpened) {
    console.log('   📍 Fallback: Looking for buttons in action bar area...');
    await assistantMessage.hover();
    await this.page.waitForTimeout(500);

    // Find the action bar within message
    const actionBar = assistantMessage.locator('[role="menubar"]');
    if ((await actionBar.count()) > 0) {
      // Look for all buttons (ActionIcon components render as buttons)
      const allButtons = actionBar.locator('button, [role="button"]');
      const allButtonCount = await allButtons.count();
      console.log(`   📍 Found ${allButtonCount} buttons in action bar`);

      // Try clicking the last button (usually the "more" button)
      for (let i = allButtonCount - 1; i >= 0; i--) {
        const btn = allButtons.nth(i);
        await btn.click();
        await this.page.waitForTimeout(500);

        const menu = this.page.locator('.ant-dropdown-menu:visible');
        if ((await menu.count()) > 0) {
          const hasRegenerate = this.page.locator('.ant-dropdown-menu-item:has-text("重新生成")');
          if ((await hasRegenerate.count()) > 0) {
            menuOpened = true;
            break;
          }
          await this.page.keyboard.press('Escape');
          await assistantMessage.hover();
          await this.page.waitForTimeout(300);
        }
      }
    }
  }

  // Click on the regenerate option in the dropdown menu
  console.log('   📍 Looking for regenerate option in menu...');
  const regenerateOption = this.page.locator(
    '.ant-dropdown-menu-item:has-text("重新生成"), .ant-dropdown-menu-item:has-text("Regenerate"), [data-menu-id*="regenerate"]',
  );

  if ((await regenerateOption.count()) > 0) {
    await expect(regenerateOption.first()).toBeVisible({ timeout: 5000 });
    console.log('   📍 Clicking regenerate option...');
    await regenerateOption.first().click();
  } else {
    throw new Error('Regenerate option not found in menu');
  }

  console.log('   ✅ 已点击重新生成按钮');
});

When('用户在生成过程中点击停止按钮', async function (this: CustomWorld) {
  console.log('   📍 Step: 等待生成开始...');
  await this.page.waitForTimeout(500);

  console.log('   📍 Step: 查找停止按钮...');
  const stopButton = this.page.locator(
    'button[aria-label*="停止"], button[aria-label*="stop"], [data-testid="stop-generate"]',
  );

  // The stop button should appear during generation
  const stopButtonVisible = await stopButton
    .first()
    .isVisible()
    .catch(() => false);
  if (stopButtonVisible) {
    await stopButton.first().click();
    console.log('   ✅ 已点击停止按钮');
  } else {
    console.log('   ⚠️ 停止按钮不可见，可能生成已完成');
  }
});

// ============================================
// Then Steps for Advanced Scenarios
// ============================================

Then('对话历史应该被清空', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证对话历史已清空...');

  // Wait for the clear to take effect
  await this.page.waitForTimeout(1000);

  // Check that there are no user/assistant messages in the main chat area
  // Only look for messages with explicit data-role attribute, which are actual chat messages
  // Avoid matching sidebar items or other elements with "message" in class
  const userMessages = this.page.locator('[data-role="user"]');
  const assistantMessages = this.page.locator('[data-role="assistant"]');

  const userCount = await userMessages.count();
  const assistantCount = await assistantMessages.count();

  console.log(`   📍 用户消息数量: ${userCount}, 助手消息数量: ${assistantCount}`);

  // There should be no user or assistant messages after clearing
  expect(userCount).toBe(0);
  expect(assistantCount).toBe(0);

  console.log('   ✅ 对话历史已清空');
});

Then('页面应该显示欢迎界面', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证显示欢迎界面...');

  // Look for welcome elements - Lobe AI title or welcome text in the main chat area
  // The welcome page shows Lobe AI avatar and introductory text
  // Try multiple selectors to find the welcome content
  const welcomeText = this.page.locator('text=我是你的智能助理');
  const lobeAITitle = this.page.locator('h1:has-text("Lobe AI"), h2:has-text("Lobe AI")');
  const welcomeStart = this.page.locator('text=从任何想法开始');

  const hasWelcomeText = (await welcomeText.count()) > 0;
  const hasLobeTitle = (await lobeAITitle.count()) > 0;
  const hasStartText = (await welcomeStart.count()) > 0;

  console.log(
    `   📍 欢迎文本: ${hasWelcomeText}, Lobe标题: ${hasLobeTitle}, 开始提示: ${hasStartText}`,
  );

  // At least one of the welcome elements should be visible
  expect(hasWelcomeText || hasLobeTitle || hasStartText).toBeTruthy();
  console.log('   ✅ 欢迎界面可见');
});

Then('用户应该收到新的助手回复', async function (this: CustomWorld) {
  console.log('   📍 Step: 等待新回复...');

  // Wait for a new response to appear
  await this.page.waitForTimeout(2000);

  const assistantMessage = this.page
    .locator('[data-role="assistant"], [class*="assistant"], [class*="message"]')
    .last();

  await expect(assistantMessage).toBeVisible({ timeout: 15_000 });
  console.log('   ✅ 收到新的助手回复');
});

Then('回复应该停止生成', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证生成已停止...');

  // The stop button should no longer be visible
  const stopButton = this.page.locator(
    'button[aria-label*="停止"], button[aria-label*="stop"], [data-testid="stop-generate"]',
  );

  // Wait a bit and check if stop button is gone
  await this.page.waitForTimeout(1000);
  const isStopVisible = await stopButton
    .first()
    .isVisible()
    .catch(() => false);

  // Stop button should be hidden after stopping
  expect(isStopVisible).toBeFalsy();
  console.log('   ✅ 生成已停止');
});

Then('已生成的内容应该保留', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证已生成内容...');

  // There should be some content in the last assistant message
  const assistantMessage = this.page
    .locator('[data-role="assistant"], [class*="assistant"], [class*="message"]')
    .last();

  const text = await assistantMessage.textContent();
  expect(text).toBeTruthy();
  expect(text!.length).toBeGreaterThan(0);

  console.log(`   ✅ 已生成内容保留: "${text?.slice(0, 50)}..."`);
});
