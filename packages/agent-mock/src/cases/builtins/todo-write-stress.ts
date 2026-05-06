import { defineCase, errorStep, llmStep, toolStep } from '../../builders/defineCase';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const bash = (command: string, output: string, durationMs = 150) =>
  toolStep({
    identifier: 'claude-code',
    apiName: 'Bash',
    arguments: JSON.stringify({ command }),
    result: { exitCode: 0, output, success: true },
    durationMs,
  });

const readFile = (path: string, content: string, durationMs = 100) =>
  toolStep({
    identifier: 'claude-code',
    apiName: 'Read',
    arguments: JSON.stringify({ file_path: path }),
    result: { content },
    durationMs,
  });

const editFile = (path: string, oldStr: string, newStr: string, durationMs = 120) =>
  toolStep({
    identifier: 'claude-code',
    apiName: 'Edit',
    arguments: JSON.stringify({ file_path: path, old_string: oldStr, new_string: newStr }),
    result: { success: true },
    durationMs,
  });

const writeFile = (path: string, content: string, durationMs = 130) =>
  toolStep({
    identifier: 'claude-code',
    apiName: 'Write',
    arguments: JSON.stringify({ file_path: path, content }),
    result: { success: true },
    durationMs,
  });

const glob = (pattern: string, matches: string[], durationMs = 80) =>
  toolStep({
    identifier: 'claude-code',
    apiName: 'Glob',
    arguments: JSON.stringify({ path: 'src', pattern }),
    result: { matches },
    durationMs,
  });

const grep = (pattern: string, results: string[], durationMs = 90) =>
  toolStep({
    identifier: 'claude-code',
    apiName: 'Grep',
    arguments: JSON.stringify({ path: 'src', pattern, type: 'ts' }),
    result: { results },
    durationMs,
  });

const addTodo = (title: string, id: string, durationMs = 60) =>
  toolStep({
    identifier: 'lobe-todo-write',
    apiName: 'addTodo',
    arguments: JSON.stringify({ title }),
    result: { success: true, id, title },
    durationMs,
  });

const updateTodo = (id: string, status: string, title: string, durationMs = 60) =>
  toolStep({
    identifier: 'lobe-todo-write',
    apiName: 'updateTodo',
    arguments: JSON.stringify({ id, status }),
    result: { success: true, id, status, title },
    durationMs,
  });

// ---------------------------------------------------------------------------
// The main case — ~200 tool calls across 8 phases
// ---------------------------------------------------------------------------

export const todoWriteStress = defineCase({
  id: 'todo-write-stress',
  name: 'TodoWrite × 200 (complex)',
  description:
    '~200 tool calls across 8 realistic phases: discovery, schema audit, store migration, ' +
    'TRPC refactor, i18n extraction, component rewrites, testing, and final verification.',
  tags: ['stress', 'todo', 'builtin'],

  steps: [
    // =====================================================================
    // Phase 0 — Agent kickoff
    // =====================================================================
    llmStep({
      text: '我将执行一次完整的 monorepo 重构，预计涉及约 200 个工具调用。按 8 个阶段推进。',
      reasoning:
        '这是一个大规模的 monorepo 迁移任务。需要先盘点现有代码，再逐步推进 schema、store、router、i18n、组件、测试的迁移，最后做全面验证。每一步都会产生工具调用。',
      durationMs: 1200,
    }),

    // =====================================================================
    // Phase 1 — Discovery & audit (24 tools)
    // =====================================================================
    llmStep({
      text: '第一阶段：全面盘点现有代码结构。',
      reasoning: '先用 Glob 和 Grep 了解项目结构，再列出待办事项。',
      toolsCalling: [
        { id: 'tc-discover-1', identifier: 'claude-code', apiName: 'Glob', arguments: '{}' },
        { id: 'tc-discover-2', identifier: 'claude-code', apiName: 'Grep', arguments: '{}' },
      ],
      durationMs: 600,
    }),
    glob('**/index.tsx', ['src/routes/(main)/agent/index.tsx', 'src/routes/(main)/chat/index.tsx', 'src/routes/(main)/devtools/index.tsx']),
    glob('**/*.schema.ts', ['src/database/schemas/users.ts', 'src/database/schemas/messages.ts', 'src/database/schemas/agents.ts']),
    glob('**/router.config.*', ['src/spa/router/desktopRouter.config.tsx', 'src/spa/router/mobileRouter.config.tsx']),
    grep('createStyles', ['src/features/ChatInput/index.tsx:12', 'src/features/Conversation/ChatList/index.tsx:8', 'src/features/AgentSettings/index.tsx:15']),
    grep('hardcoded.*string', ['src/features/Onboarding/Welcome.tsx:42:欢迎使用', 'src/features/Auth/Login.tsx:18:请登录']),
    bash('find src/store -name "*.ts" | wc -l', '47'),
    bash('find src/features -type d -maxdepth 1 | wc -l', '23'),
    bash('ls src/database/schemas/', 'users.ts  messages.ts  agents.ts  topics.ts  plugins.ts  files.ts  knowledgeBases.ts  documents.ts  chunks.ts'),
    ...Array.from({ length: 15 }, (_, i) =>
      addTodo(
        [
          '盘点 Zustand store slices',
          '统计 TRPC routers 数量',
          '扫描 antd 硬编码使用',
          '检查 @lobehub/ui 一致性',
          '列出所有 Drizzle schema 表',
          '统计 Next.js App Router 路由',
          '盘点 features/ 模块',
          '扫描硬编码 i18n 字符串',
          '找出重复工具函数',
          '测量当前 bundle 大小',
          '分析首屏加载性能',
          '审查测试覆盖率',
          '识别 flaky E2E 测试',
          '记录 CI/CD 流水线',
          '列出环境变量',
        ][i],
        `todo-discovery-${i + 1}`,
      ),
    ),

    // =====================================================================
    // Phase 2 — Schema & database migration (28 tools)
    // =====================================================================
    llmStep({
      text: '第二阶段：数据库 schema 迁移。审计 10 张核心表，生成迁移文件。',
      reasoning: '需要逐一检查表结构，添加索引，然后生成 Drizzle 迁移脚本。先从核心业务表开始。',
      durationMs: 900,
    }),
    ...['users', 'messages', 'agents', 'conversations', 'topics', 'plugins', 'files', 'knowledgeBases', 'documents', 'chunks'].flatMap((table) => [
      readFile(
        `src/database/schemas/${table}.ts`,
        `export const ${table} = pgTable('${table}', {\n  id: uuid('id').primaryKey(),\n  createdAt: timestamp('created_at').defaultNow(),\n});`,
      ),
      editFile(
        `src/database/schemas/${table}.ts`,
        `id: uuid('id').primaryKey(),`,
        `id: uuid('id').primaryKey(),\n  // v2: added performance index\n  idx_${table}_created: index('idx_${table}_created').on(createdAt),`,
      ),
    ]),
    writeFile(
      'packages/database/drizzle/0042_add_indexes.sql',
      'CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);\nCREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);',
    ),
    bash('bunx drizzle-kit generate', '✓ Generated 0042_add_indexes.sql'),
    bash('bunx drizzle-kit migrate --dry-run', 'Dry run: 1 migration to apply (0042_add_indexes.sql)'),

    // =====================================================================
    // Phase 3 — Store slice migration (30 tools)
    // =====================================================================
    llmStep({
      text: '第三阶段：迁移 Zustand store slices 到新的 data-fetching 模式。',
      reasoning: '将 15 个 store slice 逐一迁移到 SWR + zustand 模式。先完成的标记 completed，进行中的标记 in_progress。',
      durationMs: 1000,
    }),
    ...['message', 'chat', 'agent', 'tool', 'session', 'topic', 'file', 'knowledgeBase'].flatMap((slice, i) => [
      readFile(`src/store/chat/slices/${slice}/index.ts`, `export const create${slice}Slice = (set, get) => ({...});`),
      editFile(
        `src/store/chat/slices/${slice}/index.ts`,
        `(set, get) => ({`,
        `(set, get) => ({\n  // migrated to SWR pattern`,
      ),
      updateTodo(`todo-store-${i + 1}`, 'completed', `迁移 ${slice} store slice`),
    ]),
    ...['plugin', 'user', 'setting'].flatMap((slice, i) => [
      readFile(`src/store/chat/slices/${slice}/index.ts`, `export const create${slice}Slice = (set, get) => ({...});`),
      updateTodo(`todo-store-${i + 9}`, 'in_progress', `迁移 ${slice} store slice`),
    ]),
    ...['discover', ''].slice(0, 2).map((slice, i) =>
      addTodo(`迁移 ${['discover', 'compression'][i]} store slice`, `todo-store-${i + 15}`),
    ),

    // =====================================================================
    // Phase 4 — TRPC router refactors (25 tools)
    // =====================================================================
    llmStep({
      text: '第四阶段：重构 15 个 TRPC router 到 v11 patterns。',
      reasoning: 'TRPC v11 有更好的类型推断。需要更新每个 router 的 procedure 定义。',
      durationMs: 800,
    }),
    ...['agent', 'message', 'session', 'topic', 'file', 'plugin', 'knowledgeBase', 'share', 'user', 'setting', 'notification', 'discover', 'generation', 'tool', 'thread'].flatMap((router) => [
      readFile(`src/server/routers/lambda/${router}.ts`, `export const ${router}Router = router({...});`),
      editFile(
        `src/server/routers/lambda/${router}.ts`,
        `export const ${router}Router = router({`,
        `// TRPC v11 migration\nexport const ${router}Router = router({`,
      ),
    ]),
    bash('bun run type-check', '✓ No type errors'),
    addTodo('修复 type-check 发现的类型问题', 'todo-trpc-fix-1'),

    // =====================================================================
    // Phase 5 — i18n key extraction + error recovery (28 tools)
    // =====================================================================
    llmStep({
      text: '第五阶段：i18n key 提取。扫描 15 个命名空间，提取硬编码字符串。',
      reasoning: '逐文件扫描，替换硬编码中文/英文字符串为 i18n key。',
      durationMs: 700,
    }),
    ...['common', 'chat', 'agent', 'setting', 'plugin', 'tool', 'auth', 'file', 'knowledge', 'share', 'discover', 'notification', 'onboarding', 'error', 'taskTemplate'].flatMap((ns) => [
      readFile(`src/locales/default/${ns}.ts`, `export default { ... };`),
      editFile(
        `src/locales/default/${ns}.ts`,
        `export default {`,
        `export default {\n  // extracted keys`,
      ),
    ]),
    bash('pnpm i18n', '✓ Synced 15 locale namespaces'),
    // Simulate an error + recovery
    errorStep({ message: 'i18n sync failed: zh-CN/agent.ts has duplicate key "confirmDelete"', type: 'I18nSyncError' }),
    readFile('src/locales/zh-CN/agent.ts', 'export default { confirmDelete: "确认删除", ... }'),
    editFile('src/locales/zh-CN/agent.ts', 'confirmDelete: "确认删除",\n  confirmDelete:', 'confirmDelete: "确认删除",'),
    bash('pnpm i18n', '✓ Synced 15 locale namespaces (retry succeeded)'),

    // =====================================================================
    // Phase 6 — Component rewrites with createStaticStyles (26 tools)
    // =====================================================================
    llmStep({
      text: '第六阶段：将 8 个核心组件从 createStyles 迁移到 createStaticStyles。',
      reasoning: 'createStaticStyles 使用 cssVar，零运行时开销。先迁移高频使用的核心组件。',
      durationMs: 900,
    }),
    ...['ChatInput', 'Conversation', 'AgentSettings', 'KnowledgeBase', 'PluginStore', 'FileExplorer', 'ShareModal', 'UserSettings'].flatMap((comp) => [
      readFile(`src/features/${comp}/index.tsx`, `import { createStyles } from 'antd-style';\nconst { useStyles } = createStyles(...)`),
      editFile(
        `src/features/${comp}/index.tsx`,
        `import { createStyles } from 'antd-style';`,
        `import { createStaticStyles } from '@/styles';`,
      ),
      editFile(
        `src/features/${comp}/index.tsx`,
        `createStyles`,
        `createStaticStyles`,
      ),
    ]),
    // Verify it still builds
    bash('bun run type-check 2>&1 | head -5', '✓ No type errors in migrated components'),

    // =====================================================================
    // Phase 7 — Testing (20 tools)
    // =====================================================================
    llmStep({
      text: '第七阶段：编写和修复测试。覆盖 store、router、E2E 三个层面。',
      reasoning: '先写单元测试确保 store 迁移正确，再写集成测试覆盖 router，最后修复 flaky E2E。',
      durationMs: 800,
    }),
    writeFile(
      'src/store/chat/slices/message/index.test.ts',
      "import { describe, it, expect } from 'vitest';\ndescribe('messageSlice', () => {\n  it('should fetch messages via SWR', async () => {});\n});",
    ),
    writeFile(
      'src/store/chat/slices/chat/index.test.ts',
      "import { describe, it, expect } from 'vitest';\ndescribe('chatSlice', () => {\n  it('should manage conversation state', async () => {});\n});",
    ),
    writeFile(
      'src/store/chat/slices/agent/index.test.ts',
      "import { describe, it, expect } from 'vitest';\ndescribe('agentSlice', () => {\n  it('should handle agent config updates', async () => {});\n});",
    ),
    writeFile(
      'src/server/routers/lambda/__tests__/agent.integration.test.ts',
      "import { describe, it, expect } from 'vitest';\ndescribe('agentRouter', () => {\n  it('should CRUD agents', async () => {});\n});",
    ),
    bash('bunx vitest run --silent src/store/chat/slices/message/index.test.ts', '✓ 1 test passed (12ms)'),
    bash('bunx vitest run --silent src/store/chat/slices/chat/index.test.ts', '✓ 1 test passed (8ms)'),
    bash('bunx vitest run --silent src/store/chat/slices/agent/index.test.ts', '✓ 1 test passed (10ms)'),
    bash('bunx vitest run --silent src/server/routers/lambda/__tests__/agent.integration.test.ts', '✓ 1 test passed (45ms)'),
    // Fix flaky E2E
    readFile('e2e/tests/login.spec.ts', "test('login flow', async ({ page }) => {...});"),
    editFile('e2e/tests/login.spec.ts', "await page.click('button')", "await page.waitForSelector('button');\n    await page.click('button')"),
    readFile('e2e/tests/conversation.spec.ts', "test('create conversation', async ({ page }) => {...});"),
    editFile('e2e/tests/conversation.spec.ts', "page.locator('.chat')", "page.locator('[data-testid=\"chat-input\"]')"),
    bash('bunx playwright test --reporter=line', '✓ 12 passed, 0 failed (34s)'),
    ...Array.from({ length: 8 }, (_, i) =>
      updateTodo(`todo-test-${i + 1}`, 'completed', ['写 message store 测试', '写 chat store 测试', '写 agent store 测试', '写 agent router 集成测试', '修复 login E2E flaky', '修复 conversation E2E flaky', '运行全量 Vitest', '运行 E2E 套件'][i]),
    ),

    // =====================================================================
    // Phase 8 — Final verification (19 tools)
    // =====================================================================
    llmStep({
      text: '第八阶段：最终验证——type-check、完整测试套件、bundle 分析、安全审计。',
      reasoning: '全面跑一遍 CI 流水线的关键步骤，确保迁移没有引入回归。',
      durationMs: 1000,
    }),
    bash('bun run type-check', '✓ No type errors'),
    bash('bunx vitest run --silent', '✓ 847 tests passed (12.3s)'),
    bash('bun run build', '✓ Build succeeded\n  Route (app)                    Size\n  ┌ ○ /                         5.2 kB\n  ├ ○ /chat                     12.1 kB\n  └ ○ /settings                 8.7 kB'),
    bash('bunx playwright test --reporter=line', '✓ 24 passed, 0 failed (58s)'),
    bash('bunx audit-ci --moderate', '✓ No moderate or higher vulnerabilities found'),
    readFile('.github/workflows/ci.yml', 'name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest'),
    editFile('.github/workflows/ci.yml', 'runs-on: ubuntu-latest', 'runs-on: ubuntu-latest\n      # v2: parallel vitest shards'),
    writeFile(
      'docs/MIGRATION.md',
      '# Store Migration Guide\n\n## Overview\nAll store slices have been migrated to SWR + Zustand pattern.\n\n## What Changed\n- `createXxxSlice` now uses `useSWR` for data fetching\n- `createStaticStyles` replaces `createStyles` in components\n- TRPC routers upgraded to v11 patterns',
    ),
    ...[
      '全量 type-check',
      '完整 Vitest 套件',
      '生产构建',
      'E2E 套件',
      '安全审计',
      '更新 CI workflow',
      '写迁移指南',
    ].map((title, i) => updateTodo(`todo-final-${i + 1}`, 'completed', title)),

    // =====================================================================
    // Done
    // =====================================================================
    llmStep({
      text: '全部 8 个阶段完成。共执行约 200 个工具调用，涵盖文件读写、编辑、搜索、shell 命令、待办管理和错误恢复。迁移已通过 type-check、单测、E2E 和安全审计。',
      reasoning: '确认所有 todo 已标记完成，汇总执行统计。',
      durationMs: 600,
    }),
  ],
});
