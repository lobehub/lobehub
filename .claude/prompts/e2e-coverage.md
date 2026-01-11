# E2E BDD Test Coverage Assistant

You are an E2E testing assistant. Your task is to add BDD behavior tests to improve E2E coverage for the LobeHub application.

## Prerequisites

Before starting, read the following documents:

- `e2e/CLAUDE.md` - E2E testing guide and best practices
- `e2e/docs/local-setup.md` - Local environment setup

## Target Modules

Based on the product architecture, prioritize modules by coverage status:

| Module           | Sub-features                              | Priority | Status |
| ---------------- | ----------------------------------------- | -------- | ------ |
| **Agent**        | Builder, Conversation, Task               | P0       | 🚧     |
| **Agent Group**  | Builder, Group Chat                       | P0       | ⏳      |
| **Page (Docs)**  | Sidebar CRUD ✅, Document Editing, Copilot | P0       | 🚧     |
| **Knowledge**    | Create, Upload, RAG Conversation          | P1       | ⏳      |
| **Memory**       | View, Edit, Associate                     | P2       | ⏳      |
| **Home Sidebar** | Agent Mgmt, Group Mgmt                    | P1       | ✅      |
| **Community**    | Browse, Interactions, Detail Pages        | P1       | ✅      |
| **Settings**     | User Settings, Model Provider             | P2       | ⏳      |

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

### 3. Design Test Scenarios

**Step 3.1**: Identify user journeys for the selected module

- What are the core user interactions?
- What are the expected outcomes?
- What edge cases should be covered?

**Step 3.2**: Create feature file with BDD scenarios

Feature file location: `e2e/src/features/{category}/{feature-name}.feature`

**Naming conventions**:

- `journeys/` - User journey tests (experience baseline)
- `smoke/` - Smoke tests (quick validation)
- `regression/` - Regression tests

**Feature file template**:

```gherkin
@journey @P1 @{module-tag}
Feature: {Feature Name in Chinese}

  作为用户，我希望能够 {user goal}，
  以便 {business value}

  Background:
    Given 用户已登录系统

  @{TEST-ID-001}
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

### 4. Implement Step Definitions

**Step 4.1**: Create step definition file

Location: `e2e/src/steps/{category}/{step-name}.steps.ts`

**Step definition template**:

```typescript
import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { CustomWorld } from '../../support/world';

Given('用户已登录系统', async function (this: CustomWorld) {
  console.log('   📍 Step: Logging in...');
  // Implementation
  console.log('   ✅ Login completed');
});

When('用户执行某操作', async function (this: CustomWorld) {
  console.log('   📍 Step: Performing action...');
  // Implementation
  console.log('   ✅ Action completed');
});

Then('应该看到预期结果', async function (this: CustomWorld) {
  console.log('   📍 Step: Verifying result...');
  // Assertions
  console.log('   ✅ Verification passed');
});
```

**Step 4.2**: Add hooks if needed

Update `e2e/src/steps/hooks.ts` for new tag prefixes:

```typescript
// Add new tag prefix handling
const tagPrefix = getTagPrefix(pickle); // e.g., 'AGENT-', 'PAGE-', etc.
```

### 5. Setup Mocks (If Needed)

For LLM-related tests, use the mock framework:

```typescript
import { llmMockManager, presetResponses } from '../../mocks/llm';

// Setup mock before navigation
llmMockManager.setResponse('user message', 'Expected AI response');
await llmMockManager.setup(this.page);
```

### 6. Run and Verify Tests

**Step 6.1**: Start local environment

```bash
# From project root
bun e2e/scripts/setup.ts --start
```

**Step 6.2**: Run the new tests

```bash
cd e2e

# Run specific test by tag
HEADLESS=false BASE_URL=http://localhost:3006 \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  pnpm exec cucumber-js --config cucumber.config.js --tags "@{TEST-ID}"

# Debug mode (show browser)
HEADLESS=false BASE_URL=http://localhost:3006 \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres \
  pnpm exec cucumber-js --config cucumber.config.js --tags "@{module-tag}"
```

**Step 6.3**: Fix any failures

- Check screenshots in `e2e/screenshots/`
- Adjust selectors and waits as needed
- Ensure tests pass consistently

### 7. Update Documentation

Update `e2e/CLAUDE.md` coverage matrix if needed:

- Mark module status as 🚧 (in progress) or ✅ (completed)
- Add new test file paths to directory structure

### 8. Create Pull Request

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

  - [ ] User journey: {journey description}
  - [ ] Smoke tests: {if applicable}
  - [ ] Edge cases: {if applicable}

  ## Test Execution

  ```bash
  # Run these tests
  cd e2e && pnpm exec cucumber-js --config cucumber.config.js --tags "@{module-tag}"
  ````

  ---

  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  ```
  ```

## Important Rules

- **DO** write feature files in Chinese (贴近产品需求)
- **DO** add appropriate tags (@journey, @P0/@P1/@P2, @module-name)
- **DO** mock LLM responses for stability
- **DO** add console logs in step definitions for debugging
- **DO** handle element visibility issues (desktop/mobile dual components)
- **DO** use `page.waitForTimeout()` for animation/transition waits
- **DO NOT** depend on actual LLM API calls
- **DO NOT** create flaky tests (ensure stability before PR)
- **DO NOT** modify production code unless adding data-testid attributes
- **DO NOT** skip running tests locally before creating PR

## Element Locator Best Practices

### Rich Text Editor (contenteditable)

```typescript
// Correct way to input in contenteditable
await container.click();
await this.page.waitForTimeout(500);
await this.page.keyboard.type(message, { delay: 30 });
await this.page.keyboard.press('Enter');
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
