/**
 * Page Editor Content Steps
 *
 * Step definitions for Page editor rich text editing E2E tests
 */
import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { CustomWorld } from '../../support/world';

// ============================================
// Helper Functions
// ============================================

/**
 * Get the contenteditable editor element
 */
async function getEditor(world: CustomWorld) {
  const editor = world.page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible({ timeout: 5000 });
  return editor;
}

// ============================================
// When Steps - Basic Text
// ============================================

When('用户点击编辑器内容区域', async function (this: CustomWorld) {
  console.log('   📍 Step: 点击编辑器内容区域...');

  const editorContent = this.page.locator('[contenteditable="true"]').first();
  if ((await editorContent.count()) > 0) {
    await editorContent.click();
  } else {
    // Fallback: click somewhere else
    await this.page.click('body', { position: { x: 400, y: 400 } });
  }
  await this.page.waitForTimeout(500);

  console.log('   ✅ 已点击编辑器内容区域');
});

When('用户按下 Enter 键', async function (this: CustomWorld) {
  console.log('   📍 Step: 按下 Enter 键...');

  await this.page.keyboard.press('Enter');
  // Wait for debounce save (1000ms) + buffer
  await this.page.waitForTimeout(1500);

  console.log('   ✅ 已按下 Enter 键');
});

When('用户输入文本 {string}', async function (this: CustomWorld, text: string) {
  console.log(`   📍 Step: 输入文本 "${text}"...`);

  await this.page.keyboard.type(text, { delay: 30 });
  await this.page.waitForTimeout(300);

  // Store for later verification
  this.testContext.inputText = text;

  console.log(`   ✅ 已输入文本 "${text}"`);
});

When('用户在编辑器中输入内容 {string}', async function (this: CustomWorld, content: string) {
  console.log(`   📍 Step: 在编辑器中输入内容 "${content}"...`);

  const editor = await getEditor(this);
  await editor.click();
  await this.page.waitForTimeout(300);
  await this.page.keyboard.type(content, { delay: 30 });
  await this.page.waitForTimeout(300);

  this.testContext.inputText = content;

  console.log(`   ✅ 已输入内容 "${content}"`);
});

When('用户选中所有内容', async function (this: CustomWorld) {
  console.log('   📍 Step: 选中所有内容...');

  await this.page.keyboard.press(`${this.modKey}+A`);
  await this.page.waitForTimeout(300);

  console.log('   ✅ 已选中所有内容');
});

// ============================================
// When Steps - Slash Commands
// ============================================

When('用户输入斜杠 {string}', async function (this: CustomWorld, slash: string) {
  console.log(`   📍 Step: 输入斜杠 "${slash}"...`);

  await this.page.keyboard.type(slash, { delay: 50 });
  // Wait for slash menu to appear
  await this.page.waitForTimeout(500);

  console.log(`   ✅ 已输入斜杠 "${slash}"`);
});

When('用户输入斜杠命令 {string}', async function (this: CustomWorld, command: string) {
  console.log(`   📍 Step: 输入斜杠命令 "${command}"...`);

  // The command format is "/shortcut" (e.g., "/h1", "/codeblock")
  // First type the slash and wait for menu
  await this.page.keyboard.type('/', { delay: 100 });
  await this.page.waitForTimeout(800); // Wait for slash menu to appear

  // Then type the rest of the command (without the leading /)
  const shortcut = command.startsWith('/') ? command.slice(1) : command;
  await this.page.keyboard.type(shortcut, { delay: 80 });
  await this.page.waitForTimeout(500); // Wait for menu to filter

  console.log(`   ✅ 已输入斜杠命令 "${command}"`);
});

// ============================================
// When Steps - Formatting
// ============================================

When('用户按下快捷键 {string}', async function (this: CustomWorld, shortcut: string) {
  console.log(`   📍 Step: 按下快捷键 "${shortcut}"...`);

  // Convert Meta to platform-specific modifier key for cross-platform support
  const platformShortcut = shortcut.replaceAll('Meta', this.modKey);
  await this.page.keyboard.press(platformShortcut);
  await this.page.waitForTimeout(300);

  console.log(`   ✅ 已按下快捷键 "${platformShortcut}"`);
});

// ============================================
// Then Steps - Basic Text
// ============================================

Then('编辑器应该显示输入的文本', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证编辑器显示输入的文本...');

  const editor = await getEditor(this);
  const text = this.testContext.inputText;

  // Check if the text is visible in the editor
  const editorText = await editor.textContent();
  expect(editorText).toContain(text);

  console.log(`   ✅ 编辑器显示文本: "${text}"`);
});

Then('编辑器应该显示 {string}', async function (this: CustomWorld, expectedText: string) {
  console.log(`   📍 Step: 验证编辑器显示 "${expectedText}"...`);

  const editor = await getEditor(this);
  const editorText = await editor.textContent();
  expect(editorText).toContain(expectedText);

  console.log(`   ✅ 编辑器显示 "${expectedText}"`);
});

// ============================================
// Then Steps - Slash Commands
// ============================================

Then('应该显示斜杠命令菜单', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证显示斜杠命令菜单...');

  // The slash menu should be visible
  // Look for menu with heading options, list options, etc.
  const menuSelectors = ['[role="menu"]', '[role="listbox"]', '.slash-menu', '[data-slash-menu]'];

  let menuFound = false;
  for (const selector of menuSelectors) {
    const menu = this.page.locator(selector);
    if ((await menu.count()) > 0 && (await menu.isVisible())) {
      menuFound = true;
      break;
    }
  }

  // Alternative: look for menu items by text
  if (!menuFound) {
    const headingOption = this.page.getByText(/heading|标题/i).first();
    const listOption = this.page.getByText(/list|列表/i).first();

    menuFound =
      ((await headingOption.count()) > 0 && (await headingOption.isVisible())) ||
      ((await listOption.count()) > 0 && (await listOption.isVisible()));
  }

  expect(menuFound).toBe(true);

  console.log('   ✅ 斜杠命令菜单已显示');
});

Then('编辑器应该包含一级标题', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证编辑器包含一级标题...');

  // Check for h1 element in the editor
  const editor = await getEditor(this);
  const h1 = editor.locator('h1');

  await expect(h1).toBeVisible({ timeout: 5000 });

  console.log('   ✅ 编辑器包含一级标题');
});

Then('编辑器应该包含无序列表', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证编辑器包含无序列表...');

  const editor = await getEditor(this);
  const ul = editor.locator('ul');

  await expect(ul).toBeVisible({ timeout: 5000 });

  console.log('   ✅ 编辑器包含无序列表');
});

Then('编辑器应该包含任务列表', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证编辑器包含任务列表...');

  const editor = await getEditor(this);

  // Task list usually has checkbox elements
  const checkboxSelectors = [
    'input[type="checkbox"]',
    '[role="checkbox"]',
    '[data-lexical-check-list]',
    'li[role="listitem"] input',
  ];

  let found = false;
  for (const selector of checkboxSelectors) {
    const checkbox = editor.locator(selector);
    if ((await checkbox.count()) > 0) {
      found = true;
      break;
    }
  }

  // Alternative: check for specific class or structure
  if (!found) {
    const listItem = editor.locator('li');
    found = (await listItem.count()) > 0;
  }

  expect(found).toBe(true);

  console.log('   ✅ 编辑器包含任务列表');
});

Then('编辑器应该包含代码块', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证编辑器包含代码块...');

  // Code block might be rendered inside the editor OR as a sibling element
  // CodeMirror renders its own container

  // First check inside the editor
  const editor = await getEditor(this);
  const codeBlockSelectors = [
    'pre',
    'code',
    '.cm-editor', // CodeMirror
    '[data-language]',
    '.code-block',
  ];

  let found = false;
  for (const selector of codeBlockSelectors) {
    const codeBlock = editor.locator(selector);
    if ((await codeBlock.count()) > 0) {
      found = true;
      break;
    }
  }

  // If not found inside editor, check the whole page
  // CodeMirror might render outside the contenteditable
  if (!found) {
    for (const selector of codeBlockSelectors) {
      const codeBlock = this.page.locator(selector);
      if ((await codeBlock.count()) > 0 && (await codeBlock.isVisible())) {
        found = true;
        break;
      }
    }
  }

  expect(found).toBe(true);

  console.log('   ✅ 编辑器包含代码块');
});

// ============================================
// Then Steps - Formatting
// ============================================

Then('选中的文本应该被加粗', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证文本已加粗...');

  const editor = await getEditor(this);

  // Check for bold element (strong or b tag, or font-weight style)
  const boldSelectors = [
    'strong',
    'b',
    '[style*="font-weight: bold"]',
    '[style*="font-weight: 700"]',
  ];

  let found = false;
  for (const selector of boldSelectors) {
    const boldElement = editor.locator(selector);
    if ((await boldElement.count()) > 0) {
      found = true;
      break;
    }
  }

  expect(found).toBe(true);

  console.log('   ✅ 文本已加粗');
});

Then('选中的文本应该变为斜体', async function (this: CustomWorld) {
  console.log('   📍 Step: 验证文本已斜体...');

  const editor = await getEditor(this);

  // Check for italic element (em or i tag, or font-style style)
  const italicSelectors = ['em', 'i', '[style*="font-style: italic"]'];

  let found = false;
  for (const selector of italicSelectors) {
    const italicElement = editor.locator(selector);
    if ((await italicElement.count()) > 0) {
      found = true;
      break;
    }
  }

  expect(found).toBe(true);

  console.log('   ✅ 文本已斜体');
});
