# E2E BDD Test Coverage Assistant

You are an E2E testing assistant. Your task is to add BDD behavior tests to improve E2E coverage for the LobeHub application.

## Prerequisites

Before starting, read the following documents:

- `e2e/CLAUDE.md` - E2E testing guide and best practices
- `e2e/docs/local-setup.md` - Local environment setup

## Target Modules

Based on the product architecture, prioritize modules by coverage status:

| Module           | Sub-features                                        | Priority | Status |
| ---------------- | --------------------------------------------------- | -------- | ------ |
| **Agent**        | Builder, Conversation, Task                         | P0       | 🚧     |
| **Agent Group**  | Builder, Group Chat                                 | P0       | ⏳      |
| **Page (Docs)**  | Sidebar CRUD ✅, Title/Emoji ✅, Rich Text ✅, Copilot | P0       | 🚧     |
| **Knowledge**    | Create, Upload, RAG Conversation                    | P1       | ⏳      |
| **Memory**       | View, Edit, Associate                               | P2       | ⏳      |
| **Home Sidebar** | Agent Mgmt, Group Mgmt                              | P1       | ✅      |
| **Community**    | Browse, Interactions, Detail Pages                  | P1       | ✅      |
| **Settings**     | User Settings, Model Provider                       | P2       | ⏳      |

## Workflow

### 1. Analyze Current Coverage

**Step 1.1**: List existing feature files

```bash
find e2e/src/features -name "*.feature" -type f
```

**Step 1.2**: Review the product modules in `src/app/[variants]/(main)/` to identify untested user journeys

**Step 1.3**: Check `e2e/CLAUDE.md` for the coverage matrix and identify gaps

### 2. Select a Module to Test

**Selection Criteria**:

- Choose ONE module that is NOT yet covered or has incomplete coverage
- Prioritize by: P0 > P1 > P2
- Focus on user journeys that represent core product value

**Module granularity examples**:

- Agent conversation flow
- Knowledge base RAG workflow
- Settings configuration flow
- Page document CRUD operations

### 3. Create Module Directory and README

**Step 3.1**: Create dedicated feature directory

```bash
mkdir -p e2e/src/features/{module-name}
```

**Step 3.2**: Create README.md with feature inventory

Create `e2e/src/features/{module-name}/README.md` with:

- Module overview and routes
- Feature inventory table (功能点、描述、优先级、状态、测试文件)
- Test file structure
- Execution commands
- Known issues

**Example structure** (see `e2e/src/features/page/README.md`):

```markdown
# {Module} 模块 E2E 测试覆盖

## 模块概述
**路由**: `/module`, `/module/[id]`

## 功能清单与测试覆盖

### 1. 功能分组名称

| 功能点 | 描述 | 优先级 | 状态 | 测试文件 |
| ------ | ---- | ------ | ---- | -------- |
| 功能A  | xxx  | P0     | ✅   | `xxx.feature` |
| 功能B  | xxx  | P1     | ⏳   |          |

## 测试文件结构
## 测试执行
## 已知问题
## 更新记录
```

### 4. Explore Module Features

**Step 4.1**: Use Task tool to explore the module

```
Use the Task tool with subagent_type=Explore to thoroughly explore:
- Route structure in src/app/[variants]/(main)/{module}/
- Feature components in src/features/
- Store actions in src/store/{module}/
- All user interactions (buttons, menus, forms)
```

**Step 4.2**: Document all features in README.md

Group features by user journey area (e.g., Sidebar, Editor Header, Editor Content, etc.)

### 5. Design Test Scenarios

**Step 5.1**: Create feature files by functional area

Feature file location: `e2e/src/features/{module}/{area}.feature`

**Naming conventions**:

- `crud.feature` - Basic CRUD operations
- `editor-meta.feature` - Editor metadata (title, icon)
- `editor-content.feature` - Rich text editing
- `copilot.feature` - AI copilot interactions

**Feature file template**:

```gherkin
@journey @P0 @{module-tag}
Feature: {Feature Name in Chinese}

  作为用户，我希望能够 {user goal}，
  以便 {business value}

  Background:
    Given 用户已登录系统

  # ============================================
  # 功能分组注释
  # ============================================

  @{MODULE-AREA-001}
  Scenario: {Scenario description in Chinese}
    Given {precondition}
    When {user action}
    Then {expected outcome}
    And {additional verification}
```

**Tag conventions**:

```gherkin
@journey      # User journey test (experience baseline)
@smoke        # Smoke test (quick validation)
@regression   # Regression test
@skip         # Skip this test (known issue)

@P0           # Highest priority (CI must run)
@P1           # High priority (Nightly)
@P2           # Medium priority (Pre-release)

@agent        # Agent module
@agent-group  # Agent Group module
@page         # Page/Docs module
@knowledge    # Knowledge base module
@memory       # Memory module
@settings     # Settings module
@home         # Home sidebar module
```

### 6. Implement Step Definitions

**Step 6.1**: Create step definition file

Location: `e2e/src/steps/{module}/{area}.steps.ts`

**Step definition template**:

```typescript
/**
 * {Module} {Area} Steps
 *
 * Step definitions for {description}
 */
import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { CustomWorld } from '../../support/world';

// ============================================
// Given Steps
// ============================================

Given('用户打开一个文稿编辑器', async function (this: CustomWorld) {
  console.log('   📍 Step: 创建并打开一个文稿...');
  // Implementation
  console.log('   ✅ 已打开文稿编辑器');
});

// ============================================
// When Steps
// ============================================

When('用户点击标题输入框', async function (this: CustomWorld) {
  console.log('   📍 Step: 点击标题输入框...');
  // Implementation
  console.log('   ✅ 已点击标题输入框');
});

// ============================================
// Then Steps
// ============================================

Then('文稿标题应该更新为 {string}', async function (this: CustomWorld, title: string) {
  console.log(`   📍 Step: 验证标题为 "${title}"...`);
  // Assertions
  console.log(`   ✅ 标题已更新为 "${title}"`);
});
```

**Step 6.2**: Add hooks if needed

Update `e2e/src/steps/hooks.ts` for new tag prefixes:

```typescript
const testId = pickle.tags.find(
  (tag) =>
    tag.name.startsWith('@COMMUNITY-') ||
    tag.name.startsWith('@AGENT-') ||
    tag.name.startsWith('@HOME-') ||
    tag.name.startsWith('@PAGE-') ||    // Add new prefix
    tag.name.startsWith('@ROUTES-'),
);
```

### 7. Setup Mocks (If Needed)

For LLM-related tests, use the mock framework:

```typescript
import { llmMockManager, presetResponses } from '../../mocks/llm';

// Setup mock before navigation
llmMockManager.setResponse('user message', 'Expected AI response');
await llmMockManager.setup(this.page);
```

### 8. Run and Verify Tests

**Step 8.1**: Start local environment

```bash
# From project root
bun e2e/scripts/setup.ts --start
```

**Step 8.2**: Run dry-run first to verify step definitions

```bash
cd e2e
BASE_URL=http://localhost:3006 \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  pnpm exec cucumber-js --config cucumber.config.js --tags "@{module-tag}" --dry-run
```

**Step 8.3**: Run the new tests

```bash
# Run specific test by tag
HEADLESS=false BASE_URL=http://localhost:3006 \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  pnpm exec cucumber-js --config cucumber.config.js --tags "@{TEST-ID}"

# Run all module tests (excluding skipped)
HEADLESS=true BASE_URL=http://localhost:3006 \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  pnpm exec cucumber-js --config cucumber.config.js --tags "@{module-tag} and not @skip"
```

**Step 8.4**: Fix any failures

- Check screenshots in `e2e/screenshots/`
- Adjust selectors and waits as needed
- For flaky tests, add `@skip` tag and document in README known issues
- Ensure tests pass consistently

### 9. Update Documentation

**Step 9.1**: Update module README.md

- Mark completed features with ✅
- Update test statistics
- Add any known issues

**Step 9.2**: Update this prompt file

- Update module status in Target Modules table
- Add any new best practices learned

### 10. Create Pull Request

- Branch name: `test/e2e-{module-name}`
- Commit message format:
  ```
  ✅ test: add E2E tests for {module-name}
  ```
- PR title: `✅ test: add E2E tests for {module-name}`
- PR body template:

  ````markdown
  ## Summary

  - Added E2E BDD tests for `{module-name}`
  - Feature files added: [number]
  - Scenarios covered: [number]

  ## Test Coverage

  - [x] Feature area 1: {description}
  - [x] Feature area 2: {description}
  - [ ] Feature area 3: {pending}

  ## Test Execution

  ```bash
  # Run these tests
  cd e2e && pnpm exec cucumber-js --config cucumber.config.js --tags "@{module-tag} and not @skip"
  ```

  ---

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ````

## Important Rules

- **DO** write feature files in Chinese (贴近产品需求)
- **DO** add appropriate tags (@journey, @P0/@P1/@P2, @module-name)
- **DO** mock LLM responses for stability
- **DO** add console logs in step definitions for debugging
- **DO** handle element visibility issues (desktop/mobile dual components)
- **DO** use `page.waitForTimeout()` for animation/transition waits
- **DO** support both Chinese and English text (e.g., `/^(无标题|Untitled)$/`)
- **DO** create unique test data with timestamps to avoid conflicts
- **DO NOT** depend on actual LLM API calls
- **DO NOT** create flaky tests (ensure stability before PR)
- **DO NOT** modify production code unless adding data-testid attributes
- **DO NOT** skip running tests locally before creating PR

## Element Locator Best Practices

### Rich Text Editor (contenteditable)

```typescript
// Correct way to input in contenteditable
const editor = this.page.locator('[contenteditable="true"]').first();
await editor.click();
await this.page.waitForTimeout(500);
await this.page.keyboard.type(message, { delay: 30 });
```

### Slash Commands

```typescript
// Type slash and wait for menu to appear
await this.page.keyboard.type('/', { delay: 100 });
await this.page.waitForTimeout(800); // Wait for slash menu

// Type command shortcut
await this.page.keyboard.type('h1', { delay: 80 });
await this.page.keyboard.press('Enter');
```

### Handling i18n (Chinese/English)

```typescript
// Support both languages for default values
const defaultTitleRegex = /^(无标题|Untitled)$/;
const pageItem = this.page.getByText(defaultTitleRegex).first();

// Or for buttons
const button = this.page.getByRole('button', { name: /choose.*icon|选择图标/i });
```

### Creating Unique Test Data

```typescript
// Use timestamps to avoid conflicts between test runs
const uniqueTitle = `E2E Page ${Date.now()}`;
```

### Handling Multiple Matches

```typescript
// Use .first() or .nth() for multiple matches
const element = this.page.locator('[data-testid="item"]').first();

// Or filter by visibility
const items = await this.page.locator('[data-testid="item"]').all();
for (const item of items) {
  if (await item.isVisible()) {
    await item.click();
    break;
  }
}
```

### Adding data-testid

If needed for reliable element selection, add `data-testid` to components:

```tsx
<Component data-testid="unique-identifier" />
```

## Common Test Patterns

### Navigation Test

```gherkin
Scenario: 用户导航到目标页面
  Given 用户已登录系统
  When 用户点击侧边栏的 "{menu-item}"
  Then 应该跳转到 "{expected-url}"
  And 页面标题应包含 "{expected-title}"
```

### CRUD Test

```gherkin
Scenario: 创建新项目
  Given 用户已登录系统
  When 用户点击创建按钮
  And 用户输入名称 "{name}"
  And 用户点击保存
  Then 应该看到新创建的项目 "{name}"

Scenario: 编辑项目
  Given 用户已创建项目 "{name}"
  When 用户打开项目编辑
  And 用户修改名称为 "{new-name}"
  And 用户保存更改
  Then 项目名称应更新为 "{new-name}"

Scenario: 删除项目
  Given 用户已创建项目 "{name}"
  When 用户删除该项目
  And 用户确认删除
  Then 项目列表中不应包含 "{name}"
```

### Editor Title/Meta Test

```gherkin
Scenario: 编辑文稿标题
  Given 用户打开一个文稿编辑器
  When 用户点击标题输入框
  And 用户输入标题 "我的测试文稿"
  And 用户按下 Enter 键
  Then 文稿标题应该更新为 "我的测试文稿"
```

### Rich Text Editor Test

```gherkin
Scenario: 通过斜杠命令插入一级标题
  Given 用户打开一个文稿编辑器
  When 用户点击编辑器内容区域
  And 用户输入斜杠命令 "/h1"
  And 用户按下 Enter 键
  And 用户输入文本 "一级标题内容"
  Then 编辑器应该包含一级标题
```

### LLM Interaction Test

```gherkin
Scenario: AI 对话基本流程
  Given 用户已登录系统
  And LLM Mock 已配置
  When 用户发送消息 "{user-message}"
  Then 应该收到 AI 回复 "{expected-response}"
  And 消息应显示在对话历史中
```

## Debugging Tips

1. **Use HEADLESS=false** to see browser actions
2. **Check screenshots** in `e2e/screenshots/` on failure
3. **Add console.log** in step definitions
4. **Increase timeouts** for slow operations
5. **Use `page.pause()`** for interactive debugging
6. **Run dry-run first** to verify all step definitions exist
7. **Use @skip tag** for known flaky tests, document in README

## Reference Implementations

See these completed modules for reference:

- **Page module**: `e2e/src/features/page/` - Full implementation with README, multiple feature files
- **Community module**: `e2e/src/features/community/` - Smoke and interaction tests
- **Home sidebar**: `e2e/src/features/home/` - Agent and Group management tests
