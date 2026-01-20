/**
 * Page CRUD Steps
 *
 * Step definitions for Page (文稿) CRUD E2E tests
 * - Create
 * - Rename
 * - Duplicate
 * - Delete
 */
import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { CustomWorld, WAIT_TIMEOUT } from '../../support/world';

// ============================================
// Helper Functions
// ============================================

async function inputPageName(
  this: CustomWorld,
  newName: string,
  pressEnter: boolean,
): Promise<void> {
  await this.page.waitForTimeout(300);

  // Try to find the popover input or inline editing input
  const inputSelectors = [
    '.ant-popover-inner input',
    '.ant-popover-content input',
    '.ant-popover input',
    'input[type="text"]:visible',
  ];

  let renameInput = null;

  for (const selector of inputSelectors) {
    try {
      const locator = this.page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout: 2000 });
      renameInput = locator;
      break;
    } catch {
      // Try next selector
    }
  }

  if (!renameInput) {
    // Fallback: find any visible input
    const allInputs = this.page.locator('input:visible');
    const count = await allInputs.count();

    for (let i = 0; i < count; i++) {
      const input = allInputs.nth(i);
      const placeholder = (await input.getAttribute('placeholder').catch(() => '')) || '';
      if (placeholder.includes('Search') || placeholder.includes('搜索')) continue;

      const isInPopover = await input.evaluate((el) => {
        return el.closest('.ant-popover') !== null || el.closest('[class*="popover"]') !== null;
      });

      if (isInPopover || count <= 2) {
        renameInput = input;
        break;
      }
    }
  }

  if (renameInput) {
    await renameInput.click();
    await renameInput.clear();
    await renameInput.fill(newName);

    if (pressEnter) {
      await renameInput.press('Enter');
    } else {
      await this.page.click('body', { position: { x: 10, y: 10 } });
    }
  } else {
    // Keyboard fallback (use modKey for cross-platform support)
    await this.page.keyboard.press(`${this.modKey}+A`);
    await this.page.waitForTimeout(50);
    await this.page.keyboard.type(newName, { delay: 20 });

    if (pressEnter) {
      await this.page.keyboard.press('Enter');
    } else {
      await this.page.click('body', { position: { x: 10, y: 10 } });
    }
  }

  await this.page.waitForTimeout(1000);
  console.log(`   ✅ 已输入新名称 "${newName}"`);
}

// ============================================
// Given Steps
// ============================================

Given('用户在 Page 页面', async function (this: CustomWorld) {
  console.log('   📍 Step: 导航到 Page 页面...');
  await this.page.goto('/page');
  await this.page.waitForLoadState('networkidle', { timeout: 15_000 });
  await this.page.waitForTimeout(1000);

  console.log('   ✅ 已进入 Page 页面');
});

Given('用户在 Page 页面有一个文稿', async function (this: CustomWorld) {
  console.log('   📍 Step: 导航到 Page 页面...');
  await this.page.goto('/page');
  await this.page.waitForLoadState('networkidle', { timeout: 15_000 });
  await this.page.waitForTimeout(1000);

  console.log('   📍 Step: 通过 UI 创建新文稿...');
  // Click the new page button to create via UI (ensures proper server-side creation)
  const newPageButton = this.page.locator('svg.lucide-square-pen').first();
  await newPageButton.click();
  await this.page.waitForTimeout(1500);

  // Wait for the new page to be created and URL to change
  await this.page.waitForURL(/\/page\/.+/, { timeout: WAIT_TIMEOUT });

  // Create a unique title for this test page
  const uniqueTitle = `E2E Page ${Date.now()}`;

  console.log(`   📍 Step: 重命名为唯一标题 "${uniqueTitle}"...`);
  // Find the new page in sidebar (use link selector to avoid matching editor title)
  // Sidebar page items are rendered as <a href="/page/xxx"> links

  // Debug: check how many links exist
  const allPageLinks = this.page.locator('a[href^="/page/"]');
  const linkCount = await allPageLinks.count();
  console.log(`   📍 Debug: Found ${linkCount} page links in sidebar`);

  // Find the Untitled page link
  const pageItem = allPageLinks.filter({ hasText: /Untitled|无标题/ }).first();
  const pageItemCount = await allPageLinks.filter({ hasText: /Untitled|无标题/ }).count();
  console.log(`   📍 Debug: Found ${pageItemCount} Untitled page links`);

  await expect(pageItem).toBeVisible({ timeout: 5000 });
  console.log('   📍 Debug: Page item is visible');

  // Right-click to open context menu and rename
  await pageItem.click({ button: 'right' });
  console.log('   📍 Debug: Right-clicked on page item');
  await this.page.waitForTimeout(500);

  // Debug: check menu items
  const menuItemCount = await this.page.locator('[role="menuitem"]').count();
  console.log(`   📍 Debug: Found ${menuItemCount} menu items after right-click`);

  const renameOption = this.page.getByRole('menuitem', { name: /rename|重命名/i });
  await expect(renameOption).toBeVisible({ timeout: 5000 });
  console.log('   📍 Debug: Rename option is visible');
  await renameOption.click();
  console.log('   📍 Debug: Clicked rename option');
  await this.page.waitForTimeout(800);

  // Wait for rename popover to appear and find the input
  // Try multiple selectors for the input
  const inputSelectors = [
    '.ant-popover input',
    '.ant-popover-content input',
    '[class*="popover"] input',
    'input[placeholder]',
  ];

  let popoverInput = null;
  for (const selector of inputSelectors) {
    const inputs = this.page.locator(selector);
    const count = await inputs.count();
    console.log(`   📍 Debug: Selector "${selector}" found ${count} inputs`);
    if (count > 0) {
      // Find the visible one
      for (let i = 0; i < count; i++) {
        const input = inputs.nth(i);
        if (await input.isVisible()) {
          const placeholder = await input.getAttribute('placeholder');
          // Skip search input
          if (placeholder && (placeholder.includes('Search') || placeholder.includes('搜索'))) {
            continue;
          }
          popoverInput = input;
          break;
        }
      }
      if (popoverInput) break;
    }
  }

  if (!popoverInput) {
    throw new Error('Could not find popover input for renaming');
  }

  console.log('   📍 Debug: Popover input found');
  await expect(popoverInput).toBeVisible({ timeout: 5000 });

  // Clear and input the unique name
  await popoverInput.click();
  await popoverInput.clear();
  await popoverInput.fill(uniqueTitle);
  console.log(`   📍 Debug: Filled input with "${uniqueTitle}"`);

  // Press Enter to confirm
  await popoverInput.press('Enter');
  await this.page.waitForTimeout(1000);

  // Wait for the renamed page to be visible
  const renamedItem = this.page.getByText(uniqueTitle, { exact: true }).first();
  await expect(renamedItem).toBeVisible({ timeout: WAIT_TIMEOUT });

  // Store page reference for later use
  this.testContext.targetItemTitle = uniqueTitle;
  this.testContext.targetType = 'page';

  console.log(`   ✅ 找到文稿: ${uniqueTitle}`);
});

Given('用户在 Page 页面有一个文稿 {string}', async function (this: CustomWorld, title: string) {
  console.log('   📍 Step: 导航到 Page 页面...');
  await this.page.goto('/page');
  await this.page.waitForLoadState('networkidle', { timeout: 15_000 });
  await this.page.waitForTimeout(1000);

  console.log('   📍 Step: 通过 UI 创建新文稿...');
  // Click the new page button to create via UI
  const newPageButton = this.page.locator('svg.lucide-square-pen').first();
  await newPageButton.click();
  await this.page.waitForTimeout(1500);

  // Wait for the new page to be created
  await this.page.waitForURL(/\/page\/.+/, { timeout: WAIT_TIMEOUT });

  // Default title is "无标题" (Untitled) - support both languages
  const defaultTitleRegex = /^(无标题|Untitled)$/;

  console.log(`   📍 Step: 通过右键菜单重命名文稿为 "${title}"...`);
  // Find the new page in sidebar (use link selector to avoid matching editor title)
  // Sidebar page items are rendered as <a href="/page/xxx"> links
  const pageItem = this.page
    .locator('a[href^="/page/"]')
    .filter({ hasText: defaultTitleRegex })
    .first();
  await expect(pageItem).toBeVisible({ timeout: 5000 });

  // Right-click to open context menu
  await pageItem.click({ button: 'right' });
  await this.page.waitForTimeout(500);

  // Select rename option
  const renameOption = this.page.getByRole('menuitem', { name: /rename|重命名/i });
  await expect(renameOption).toBeVisible({ timeout: 5000 });
  await renameOption.click();
  await this.page.waitForTimeout(800);

  // Wait for rename popover to appear and find the input
  const inputSelectors = [
    '.ant-popover input',
    '.ant-popover-content input',
    '[class*="popover"] input',
    'input[placeholder]',
  ];

  let popoverInput = null;
  for (const selector of inputSelectors) {
    const inputs = this.page.locator(selector);
    const count = await inputs.count();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const input = inputs.nth(i);
        if (await input.isVisible()) {
          const placeholder = await input.getAttribute('placeholder');
          if (placeholder && (placeholder.includes('Search') || placeholder.includes('搜索'))) {
            continue;
          }
          popoverInput = input;
          break;
        }
      }
      if (popoverInput) break;
    }
  }

  if (!popoverInput) {
    throw new Error('Could not find popover input for renaming');
  }

  await expect(popoverInput).toBeVisible({ timeout: 5000 });

  // Clear and input the new name
  await popoverInput.click();
  await popoverInput.clear();
  await popoverInput.fill(title);

  // Press Enter to confirm
  await popoverInput.press('Enter');
  await this.page.waitForTimeout(1000);

  console.log('   📍 Step: 查找文稿...');
  const renamedItem = this.page.getByText(title, { exact: true }).first();
  await expect(renamedItem).toBeVisible({ timeout: WAIT_TIMEOUT });

  this.testContext.targetItemTitle = title;
  this.testContext.targetType = 'page';

  console.log(`   ✅ 找到文稿: ${title}`);
});

// ============================================
// When Steps
// ============================================

When('用户点击新建文稿按钮', async function (this: CustomWorld) {
  console.log('   📍 Step: 点击新建文稿按钮...');

  // Look for the SquarePen icon button (new page button)
  const newPageButton = this.page.locator('svg.lucide-square-pen').first();

  if ((await newPageButton.count()) > 0) {
    await newPageButton.click();
  } else {
    // Fallback: look for button with title containing "new" or "新建"
    const buttonByTitle = this.page
      .locator('button[title*="new"], button[title*="新建"], [role="button"][title*="new"]')
      .first();
    if ((await buttonByTitle.count()) > 0) {
      await buttonByTitle.click();
    } else {
      throw new Error('Could not find new page button');
    }
  }

  await this.page.waitForTimeout(1000);
  console.log('   ✅ 已点击新建文稿按钮');
});

When('用户右键点击该文稿', async function (this: CustomWorld) {
  console.log('   📍 Step: 右键点击文稿...');

  const title = this.testContext.targetItemTitle || this.testContext.createdPageTitle;
  // Find the page item by its title text, then find the parent clickable block
  const titleElement = this.page.getByText(title, { exact: true }).first();
  await expect(titleElement).toBeVisible({ timeout: 5000 });

  // Right-click on the title element (the NavItem Block wraps the text)
  await titleElement.click({ button: 'right' });

  await this.page.waitForTimeout(800);

  // Debug: check what menus are visible
  const menuItems = await this.page.locator('[role="menuitem"]').count();
  console.log(`   📍 Debug: Found ${menuItems} menu items after right-click`);

  console.log('   ✅ 已右键点击文稿');
});

When('用户在菜单中选择复制', async function (this: CustomWorld) {
  console.log('   📍 Step: 选择复制选项...');

  // Look for duplicate option (复制 or Duplicate)
  const duplicateOption = this.page.getByRole('menuitem', { name: /复制|duplicate/i });
  await expect(duplicateOption).toBeVisible({ timeout: 5000 });
  await duplicateOption.click();
  await this.page.waitForTimeout(1000);

  console.log('   ✅ 已选择复制选项');
});

When('用户输入新的文稿名称 {string}', async function (this: CustomWorld, newName: string) {
  console.log(`   📍 Step: 输入新名称 "${newName}"...`);
  await inputPageName.call(this, newName, false);
});

When(
  '用户输入新的文稿名称 {string} 并按 Enter',
  async function (this: CustomWorld, newName: string) {
    console.log(`   📍 Step: 输入新名称 "${newName}" 并按 Enter...`);
    await inputPageName.call(this, newName, true);
  },
);

// ============================================
// Then Steps
// ============================================

Then('应该创建一个新的文稿', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证新文稿已创建...');

  await this.page.waitForTimeout(1000);

  // Check if URL changed to a new page
  const currentUrl = this.page.url();
  expect(currentUrl).toMatch(/\/page\/.+/);

  console.log('   ✅ 新文稿已创建');
});

Then('文稿列表中应该显示新文稿', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证文稿列表中显示新文稿...');

  await this.page.waitForTimeout(500);

  // Page list items are rendered with NavItem component (not <a> tags)
  // Look for the untitled page in the sidebar list
  const untitledText = this.page.getByText(/无标题|untitled/i).first();
  await expect(untitledText).toBeVisible({ timeout: 5000 });

  console.log('   ✅ 文稿列表中显示新文稿');
});

Then('该文稿名称应该更新为 {string}', async function (this: CustomWorld, expectedName: string) {
  console.log(`   📍 Step: 验证名称为 "${expectedName}"...`);

  await this.page.waitForTimeout(1000);

  // Look for the renamed item in the list
  const renamedItem = this.page.getByText(expectedName, { exact: true }).first();
  await expect(renamedItem).toBeVisible({ timeout: 5000 });

  console.log(`   ✅ 名称已更新为 "${expectedName}"`);
});

Then('文稿列表中应该出现 {string}', async function (this: CustomWorld, expectedName: string) {
  console.log(`   📍 Step: 验证文稿列表中出现 "${expectedName}"...`);

  await this.page.waitForTimeout(2000);

  // The duplicated page might have "(Copy)" or " (Copy)" or "副本" suffix
  // First try exact match, then try partial match
  let duplicatedItem = this.page.getByText(expectedName, { exact: true }).first();

  if ((await duplicatedItem.count()) === 0) {
    // Try finding page with "Copy" in the name (could be "Original Page (Copy)" or similar)
    const baseName = expectedName.replace(/\s*\(Copy\)$/, '');
    duplicatedItem = this.page.getByText(new RegExp(`${baseName}.*Copy|${baseName}.*副本`)).first();
  }

  if ((await duplicatedItem.count()) === 0) {
    // Fallback: check if there are at least 2 pages with similar name
    const similarPages = this.page.getByText(expectedName.replace(/\s*\(Copy\)$/, '')).all();
    // eslint-disable-next-line unicorn/no-await-expression-member
    const count = (await similarPages).length;
    console.log(`   📍 Debug: Found ${count} pages with similar name`);
    expect(count).toBeGreaterThanOrEqual(2);
    console.log(`   ✅ 文稿列表中出现多个相似名称的文稿`);
    return;
  }

  await expect(duplicatedItem).toBeVisible({ timeout: WAIT_TIMEOUT });
  console.log(`   ✅ 文稿列表中出现 "${expectedName}"`);
});

Then('该文稿应该从列表中移除', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证文稿已移除...');

  await this.page.waitForTimeout(1000);

  const title = this.testContext.targetItemTitle || this.testContext.createdPageTitle;
  if (title) {
    const deletedItem = this.page.getByText(title, { exact: true });
    await expect(deletedItem).not.toBeVisible({ timeout: 5000 });
  }

  console.log('   ✅ 文稿已从列表中移除');
});
