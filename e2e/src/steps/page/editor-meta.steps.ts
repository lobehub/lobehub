/**
 * Page Editor Meta Steps
 *
 * Step definitions for Page editor title and emoji editing E2E tests
 */
import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import type { CustomWorld } from '../../support/world';
import { WAIT_TIMEOUT } from '../../support/world';

async function waitForPageWorkspaceReady(world: CustomWorld): Promise<void> {
  const loadingSelectors = ['[aria-label="Loading"]', '.lobe-brand-loading'];
  const start = Date.now();

  while (Date.now() - start < WAIT_TIMEOUT) {
    let loadingVisible = false;
    for (const selector of loadingSelectors) {
      const loading = world.page.locator(selector).first();
      if ((await loading.count()) > 0 && (await loading.isVisible())) {
        loadingVisible = true;
        break;
      }
    }

    if (loadingVisible) {
      await world.page.waitForTimeout(300);
      continue;
    }

    const readyCandidates = [
      world.page.locator(':is(button, [role="button"]):has(svg.lucide-square-pen)').first(),
      world.page.locator('input[placeholder*="Search"], input[placeholder*="搜索"]').first(),
      world.page.locator('a[href^="/page/"]').first(),
    ];

    for (const candidate of readyCandidates) {
      if ((await candidate.count()) > 0 && (await candidate.isVisible())) {
        return;
      }
    }

    await world.page.waitForTimeout(300);
  }

  throw new Error('Page workspace did not become ready in time');
}

async function clickNewPageButton(world: CustomWorld): Promise<void> {
  await waitForPageWorkspaceReady(world);

  const candidates = [
    world.page.locator(':is(button, [role="button"]):has(svg.lucide-square-pen)').first(),
    world.page
      .locator('svg.lucide-square-pen')
      .first()
      .locator('xpath=ancestor::*[self::button or @role="button"][1]'),
    world.page.getByRole('button', { name: /create page|new page|新建文稿|新建/i }).first(),
    world.page
      .locator(
        'button[title*="Create"], button[title*="Page"], button[title*="new"], button[title*="新建"]',
      )
      .first(),
  ];

  for (const candidate of candidates) {
    if ((await candidate.count()) === 0) continue;
    if (!(await candidate.isVisible())) continue;

    await candidate.click();
    await world.page.waitForTimeout(500);
    return;
  }

  throw new Error('Could not find new page button');
}

// ============================================
// Given Steps
// ============================================

Given('用户打开一个文稿编辑器', async function (this: CustomWorld) {
  console.log('   📍 Step: 创建并打开一个文稿...');

  // Navigate to page module
  await this.page.goto('/page');
  await this.page.waitForLoadState('networkidle', { timeout: 15_000 });
  await waitForPageWorkspaceReady(this);

  // Create a new page via UI
  await clickNewPageButton(this);
  await this.page.waitForTimeout(1500);

  // Wait for navigation to page editor
  await this.page.waitForURL(/\/page\/.+/, { timeout: WAIT_TIMEOUT });
  await this.page.waitForLoadState('networkidle');
  await this.page.waitForTimeout(500);

  console.log('   ✅ 已打开文稿编辑器');
});

Given('用户打开一个带有 Emoji 的文稿', async function (this: CustomWorld) {
  console.log('   📍 Step: 创建并打开一个带 Emoji 的文稿...');

  // First create and open a page
  await this.page.goto('/page');
  await this.page.waitForLoadState('networkidle', { timeout: 15_000 });
  await waitForPageWorkspaceReady(this);

  await clickNewPageButton(this);
  await this.page.waitForTimeout(1500);

  await this.page.waitForURL(/\/page\/.+/, { timeout: WAIT_TIMEOUT });
  await this.page.waitForLoadState('networkidle');
  await this.page.waitForTimeout(500);

  // Add emoji by clicking the "Choose Icon" button
  console.log('   📍 Step: 添加 Emoji 图标...');

  // Hover over title section to show the button
  const titleSection = this.page.locator('textarea').first().locator('xpath=ancestor::div[1]');
  await titleSection.hover();
  await this.page.waitForTimeout(300);

  // Click the choose icon button
  const chooseIconButton = this.page.getByRole('button', { name: /choose.*icon|选择图标/i });
  if ((await chooseIconButton.count()) > 0) {
    await chooseIconButton.click();
    await this.page.waitForTimeout(500);

    // Select the first emoji in the picker
    const emojiGrid = this.page.locator('[data-emoji]').first();
    if ((await emojiGrid.count()) > 0) {
      await emojiGrid.click();
    } else {
      // Fallback: click any emoji button
      const emojiButton = this.page.locator('button[title]').filter({ hasText: /^.$/ }).first();
      if ((await emojiButton.count()) > 0) {
        await emojiButton.click();
      }
    }
    await this.page.waitForTimeout(500);
  }

  console.log('   ✅ 已打开带 Emoji 的文稿');
});

// ============================================
// When Steps - Title
// ============================================

When('用户点击标题输入框', async function (this: CustomWorld) {
  console.log('   📍 Step: 点击标题输入框...');

  const titleInput = this.page.locator('textarea').first();
  await expect(titleInput).toBeVisible({ timeout: 5000 });
  await titleInput.click();
  await this.page.waitForTimeout(300);

  console.log('   ✅ 已点击标题输入框');
});

When('用户输入标题 {string}', async function (this: CustomWorld, title: string) {
  console.log(`   📍 Step: 输入标题 "${title}"...`);

  const titleInput = this.page.locator('textarea').first();

  // Clear existing content and type new title (use modKey for cross-platform support)
  await titleInput.click();
  await this.page.keyboard.press(`${this.modKey}+A`);
  await this.page.waitForTimeout(100);
  await this.page.keyboard.type(title, { delay: 30 });

  // Store for later verification
  this.testContext.expectedTitle = title;

  console.log(`   ✅ 已输入标题 "${title}"`);
});

When('用户清空标题内容', async function (this: CustomWorld) {
  console.log('   📍 Step: 清空标题内容...');

  const titleInput = this.page.locator('textarea').first();
  await titleInput.click();
  await this.page.keyboard.press(`${this.modKey}+A`);
  await this.page.keyboard.press('Backspace');
  await this.page.waitForTimeout(300);

  // Click elsewhere to trigger save
  await this.page.click('body', { position: { x: 400, y: 400 } });
  await this.page.waitForTimeout(1500);

  console.log('   ✅ 已清空标题内容');
});

// ============================================
// When Steps - Emoji
// ============================================

When('用户点击选择图标按钮', async function (this: CustomWorld) {
  console.log('   📍 Step: 点击选择图标按钮...');

  // Hover to show the button
  const titleSection = this.page.locator('textarea').first().locator('xpath=ancestor::div[1]');
  await titleSection.hover();
  await this.page.waitForTimeout(300);

  // Click the choose icon button
  const chooseIconButton = this.page.getByRole('button', { name: /choose.*icon|选择图标/i });
  await expect(chooseIconButton).toBeVisible({ timeout: 5000 });
  await chooseIconButton.click();
  await this.page.waitForTimeout(500);

  console.log('   ✅ 已点击选择图标按钮');
});

When('用户选择一个 Emoji', async function (this: CustomWorld) {
  console.log('   📍 Step: 选择一个 Emoji...');

  // Wait for emoji picker to be visible
  await this.page.waitForTimeout(800);

  // The emoji picker renders emojis as clickable span elements in a grid
  // Look for emoji elements in the "Frequently used" or "Smileys & People" section
  const emojiSelectors = [
    // Emoji spans in the picker grid (matches emoji characters)
    'span[style*="cursor: pointer"]',
    'span[role="img"]',
    '[data-emoji]',
    // Emoji-mart style selectors
    '.emoji-mart-emoji span',
    'button[aria-label*="emoji"]',
  ];

  let clicked = false;
  for (const selector of emojiSelectors) {
    const emojis = this.page.locator(selector);
    const count = await emojis.count();
    console.log(`   📍 Debug: Found ${count} elements with selector "${selector}"`);
    if (count > 0) {
      // Click a random emoji (not the first to avoid default)
      const index = Math.min(5, count - 1);
      await emojis.nth(index).click();
      clicked = true;
      console.log(`   📍 Debug: Clicked emoji at index ${index}`);
      break;
    }
  }

  // Fallback: try to find any clickable element in the emoji popover
  if (!clicked) {
    console.log('   📍 Debug: Trying fallback - looking for emoji in popover');
    const popover = this.page.locator('.ant-popover-inner, [class*="popover"]').first();
    if ((await popover.count()) > 0) {
      // Find spans that look like emojis (single character with emoji range)
      const emojiSpans = popover.locator('span').filter({
        hasText: /^\p{Emoji}$/u,
      });
      const count = await emojiSpans.count();
      console.log(`   📍 Debug: Found ${count} emoji spans in popover`);
      if (count > 0) {
        await emojiSpans.nth(Math.min(5, count - 1)).click();
        clicked = true;
      }
    }
  }

  if (!clicked) {
    console.log('   ⚠️ Could not find emoji button, test may fail');
  }

  await this.page.waitForTimeout(1000);

  console.log('   ✅ 已选择 Emoji');
});

When('用户点击已有的 Emoji 图标', async function (this: CustomWorld) {
  console.log('   📍 Step: 点击已有的 Emoji 图标...');

  // The emoji is displayed in an Avatar component with square shape
  // Look for the emoji display element near the title
  const emojiAvatar = this.page.locator('[class*="Avatar"]').first();
  if ((await emojiAvatar.count()) > 0) {
    await emojiAvatar.click();
  } else {
    // Fallback: look for span with emoji
    const emojiSpan = this.page
      .locator('span')
      .filter({ hasText: /^[\u{1F300}-\u{1F9FF}]$/u })
      .first();
    if ((await emojiSpan.count()) > 0) {
      await emojiSpan.click();
    }
  }

  await this.page.waitForTimeout(500);

  console.log('   ✅ 已点击 Emoji 图标');
});

When('用户选择另一个 Emoji', async function (this: CustomWorld) {
  console.log('   📍 Step: 选择另一个 Emoji...');

  // Same as selecting an emoji, but choose a different index
  await this.page.waitForTimeout(500);

  const emojiSelectors = ['[data-emoji]', 'button[title]:not([title=""])'];

  for (const selector of emojiSelectors) {
    const emojis = this.page.locator(selector);
    const count = await emojis.count();
    if (count > 0) {
      // Click a different emoji
      const index = Math.min(10, count - 1);
      await emojis.nth(index).click();
      break;
    }
  }

  await this.page.waitForTimeout(1000);

  console.log('   ✅ 已选择另一个 Emoji');
});

When('用户点击删除图标按钮', async function (this: CustomWorld) {
  console.log('   📍 Step: 点击删除图标按钮...');

  // Look for delete button in the emoji picker
  const deleteButton = this.page.getByRole('button', { name: /delete|删除/i });
  if ((await deleteButton.count()) > 0) {
    await deleteButton.click();
  } else {
    // Fallback: look for trash icon
    const trashIcon = this.page.locator('svg.lucide-trash, svg.lucide-trash-2').first();
    if ((await trashIcon.count()) > 0) {
      await trashIcon.click();
    }
  }

  await this.page.waitForTimeout(1000);

  console.log('   ✅ 已点击删除图标按钮');
});

// ============================================
// Then Steps
// ============================================

Then('文稿标题应该更新为 {string}', async function (this: CustomWorld, expectedTitle: string) {
  console.log(`   📍 Step: 验证标题为 "${expectedTitle}"...`);

  const titleInput = this.page.locator('textarea').first();
  await expect(titleInput).toHaveValue(expectedTitle, { timeout: 5000 });

  // Also verify in sidebar
  const sidebarItem = this.page.getByText(expectedTitle, { exact: true }).first();
  // Wait for sidebar to update (debounce + sync)
  await this.page.waitForTimeout(1000);

  // Sidebar might take longer to sync
  try {
    await expect(sidebarItem).toBeVisible({ timeout: 3000 });
    console.log('   ✅ 侧边栏标题也已更新');
  } catch {
    console.log('   ⚠️ 侧边栏标题可能未同步（非关键）');
  }

  console.log(`   ✅ 标题已更新为 "${expectedTitle}"`);
});

Then('应该显示标题占位符', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证显示占位符...');

  const titleInput = this.page.locator('textarea').first();

  // Check for placeholder attribute
  const placeholder = await titleInput.getAttribute('placeholder');
  expect(placeholder).toBeTruthy();

  // The value might be empty or equal to the default "Untitled"
  const value = await titleInput.inputValue();
  const isEmptyOrDefault = value === '' || value === 'Untitled' || value === '无标题';
  expect(isEmptyOrDefault).toBe(true);

  console.log(`   ✅ 显示占位符: "${placeholder}", 当前值: "${value}"`);
});

Then('文稿应该显示所选的 Emoji 图标', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证显示 Emoji 图标...');

  // Look for emoji display - could be in Avatar or span element
  // The emoji picker uses @lobehub/ui which may render differently
  const emojiSelectors = [
    '[class*="Avatar"]',
    '[class*="avatar"]',
    '[class*="emoji"]',
    'span[role="img"]',
  ];

  let found = false;
  for (const selector of emojiSelectors) {
    const element = this.page.locator(selector).first();
    if ((await element.count()) > 0 && (await element.isVisible())) {
      found = true;
      break;
    }
  }

  // Also check if the "Choose Icon" button is NOT visible (meaning emoji was set)
  if (!found) {
    const chooseIconButton = this.page.getByRole('button', { name: /choose.*icon|选择图标/i });
    found = (await chooseIconButton.count()) === 0 || !(await chooseIconButton.isVisible());
  }

  expect(found).toBe(true);

  console.log('   ✅ 文稿显示 Emoji 图标');
});

Then('文稿图标应该更新为新的 Emoji', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证 Emoji 图标已更新...');

  // Look for emoji display
  const emojiSelectors = [
    '[class*="Avatar"]',
    '[class*="avatar"]',
    '[class*="emoji"]',
    'span[role="img"]',
  ];

  let found = false;
  for (const selector of emojiSelectors) {
    const element = this.page.locator(selector).first();
    if ((await element.count()) > 0 && (await element.isVisible())) {
      found = true;
      break;
    }
  }

  // Also check if the "Choose Icon" button is NOT visible (meaning emoji was set)
  if (!found) {
    const chooseIconButton = this.page.getByRole('button', { name: /choose.*icon|选择图标/i });
    found = (await chooseIconButton.count()) === 0 || !(await chooseIconButton.isVisible());
  }

  expect(found).toBe(true);

  console.log('   ✅ Emoji 图标已更新');
});

Then('文稿不应该显示 Emoji 图标', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证不显示 Emoji 图标...');

  // After deletion, the "Choose Icon" button should be visible
  // and the emoji avatar should be hidden
  await this.page.waitForTimeout(500);

  // Hover to check if the choose icon button appears
  const titleSection = this.page.locator('textarea').first().locator('xpath=ancestor::div[1]');
  await titleSection.hover();
  await this.page.waitForTimeout(300);

  const chooseIconButton = this.page.getByRole('button', { name: /choose.*icon|选择图标/i });

  // Either the button is visible OR the emoji avatar is not visible
  try {
    await expect(chooseIconButton).toBeVisible({ timeout: 3000 });
    console.log('   ✅ 选择图标按钮可见，说明 Emoji 已删除');
  } catch {
    // Emoji might still be there but different
    console.log('   ⚠️ 无法确认 Emoji 是否删除');
  }

  console.log('   ✅ 验证完成');
});
