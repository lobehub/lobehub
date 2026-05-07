import { defineCase, errorStep, llmStep, toolStep } from '../../builders/defineCase';

// ---------------------------------------------------------------------------
// Helpers — all mapped to lobe-gtd
// ---------------------------------------------------------------------------

/** lobe-gtd / createTodos */
const createTodos = (items: string[], durationMs = 60) =>
  toolStep({
    identifier: 'lobe-gtd',
    apiName: 'createTodos',
    arguments: JSON.stringify({ adds: items }),
    result: {
      createdItems: items,
      todos: {
        items: items.map((text) => ({ text, status: 'todo' as const })),
        updatedAt: new Date().toISOString(),
      },
    },
    durationMs,
  });

/** lobe-gtd / updateTodos — batch operations */
const updateTodos = (
  operations: Array<{ type: string; index?: number; newText?: string; status?: string }>,
  currentItems: Array<{ text: string; status: string }>,
  durationMs = 60,
) =>
  toolStep({
    identifier: 'lobe-gtd',
    apiName: 'updateTodos',
    arguments: JSON.stringify({ operations }),
    result: {
      appliedOperations: operations,
      todos: {
        items: currentItems,
        updatedAt: new Date().toISOString(),
      },
    },
    durationMs,
  });

/** lobe-gtd / createPlan */
const createPlan = (
  goal: string,
  description: string,
  context: string,
  planId: string,
  durationMs = 80,
) =>
  toolStep({
    identifier: 'lobe-gtd',
    apiName: 'createPlan',
    arguments: JSON.stringify({ goal, description, context }),
    result: {
      plan: {
        id: planId,
        goal,
        description,
        context,
        completed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
    durationMs,
  });

/** lobe-gtd / updatePlan */
const updatePlan = (
  planId: string,
  set: { goal?: string; description?: string; context?: string; completed?: boolean },
  durationMs = 60,
) =>
  toolStep({
    identifier: 'lobe-gtd',
    apiName: 'updatePlan',
    arguments: JSON.stringify({ planId, ...set }),
    result: {
      plan: {
        id: planId,
        goal: set.goal ?? 'Updated plan',
        description: set.description ?? '',
        context: set.context ?? '',
        completed: set.completed ?? false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
    durationMs,
  });

/** lobe-gtd / execTask */
const execTask = (description: string, instruction: string, durationMs = 200) =>
  toolStep({
    identifier: 'lobe-gtd',
    apiName: 'execTask',
    arguments: JSON.stringify({ description, instruction }),
    result: {
      parentMessageId: `mock-msg-task-${Date.now()}`,
      task: { description, instruction },
      type: 'execTask' as const,
    },
    durationMs,
  });

/** LLM "breathing" step between tool-call batches — simulates agent processing results */
const breathe = (text: string, durationMs = 250) => llmStep({ text, durationMs });

// ---------------------------------------------------------------------------
// The main case — ~200 lobe-gtd tool calls across 8 phases
// ---------------------------------------------------------------------------

export const todoWriteStress = defineCase({
  id: 'todo-write-stress',
  name: 'TodoWrite × 200 (complex)',
  description:
    '~200 GTD tool calls across 8 realistic phases: discovery, schema audit, store migration, ' +
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
      text: '第一阶段：全面盘点现有代码结构。创建总体计划，再拆解为 15 个待办事项。',
      reasoning: '先创建一个顶层计划文档，再将盘点工作拆解为具体的 todo 项。',
      toolsCalling: [
        { id: 'tc-plan-1', identifier: 'lobe-gtd', apiName: 'createPlan', arguments: '{}' },
        { id: 'tc-todos-1', identifier: 'lobe-gtd', apiName: 'createTodos', arguments: '{}' },
      ],
      durationMs: 600,
    }),
    createPlan(
      'Monorepo 重构',
      '全面迁移 schema、store、router、i18n、组件、测试',
      '涉及 10 张数据库表、15 个 store slice、15 个 TRPC router、15 个 i18n 命名空间、8 个核心组件',
      'plan-migration-001',
    ),
    ...Array.from({ length: 5 }).flatMap((_, batch) => {
      const allItems = [
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
      ];
      return [
        createTodos(allItems.slice(batch * 3, batch * 3 + 3)),
        breathe('已创建一批待办，继续盘点。'),
      ];
    }),
    // Mark first 3 as completed after discovery
    ...Array.from({ length: 5 }).flatMap((_, batch) => [
      updateTodos(
        Array.from({ length: 3 }, (_, j) => ({ type: 'complete' as const, index: batch * 3 + j })),
        Array.from({ length: 15 }, (_, k) => ({
          text: [
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
          ][k],
          status: k < batch * 3 + 3 ? 'completed' : 'todo',
        })),
      ),
      breathe('已标记完成，继续下一批。'),
    ]),

    // =====================================================================
    // Phase 2 — Schema & database migration (28 tools)
    // =====================================================================
    llmStep({
      text: '第二阶段：数据库 schema 迁移。为 10 张核心表创建 todo 并逐一推进。',
      reasoning: '需要逐一检查表结构，添加索引，然后生成迁移脚本。先从核心业务表开始。',
      durationMs: 900,
    }),
    createPlan(
      'Schema 迁移计划',
      '为 10 张核心表添加性能索引并生成 Drizzle 迁移文件',
      '审计 users, messages, agents, conversations, topics, plugins, files, knowledgeBases, documents, chunks',
      'plan-schema-001',
    ),
    createTodos([
      '审计 users 表结构并添加索引',
      '审计 messages 表结构并添加索引',
      '审计 agents 表结构并添加索引',
      '审计 conversations 表结构并添加索引',
      '审计 topics 表结构并添加索引',
    ]),
    createTodos([
      '审计 plugins 表结构并添加索引',
      '审计 files 表结构并添加索引',
      '审计 knowledgeBases 表结构并添加索引',
      '审计 documents 表结构并添加索引',
      '审计 chunks 表结构并添加索引',
    ]),
    // Process each table: mark processing → complete
    ...['users', 'messages', 'agents', 'conversations', 'topics'].flatMap((table, i) => [
      updateTodos(
        [{ type: 'processing', index: i }],
        Array.from({ length: 5 }, (_, k) => ({
          text: [
            '审计 users 表结构并添加索引',
            '审计 messages 表结构并添加索引',
            '审计 agents 表结构并添加索引',
            '审计 conversations 表结构并添加索引',
            '审计 topics 表结构并添加索引',
          ][k],
          status: k === i ? 'processing' : k < i ? 'completed' : 'todo',
        })),
      ),
      execTask(
        `为 ${table} 表添加索引`,
        `检查 src/database/schemas/${table}.ts 的表结构，添加 createdAt 性能索引，生成迁移 SQL`,
      ),
      updateTodos(
        [{ type: 'complete', index: i }],
        Array.from({ length: 5 }, (_, k) => ({
          text: [
            '审计 users 表结构并添加索引',
            '审计 messages 表结构并添加索引',
            '审计 agents 表结构并添加索引',
            '审计 conversations 表结构并添加索引',
            '审计 topics 表结构并添加索引',
          ][k],
          status: k <= i ? 'completed' : 'todo',
        })),
      ),
      breathe(`已处理 ${table} 表，继续下一张。`),
    ]),
    ...['plugins', 'files', 'knowledgeBases', 'documents', 'chunks'].flatMap((table, i) => [
      updateTodos(
        [{ type: 'processing', index: i }],
        Array.from({ length: 5 }, (_, k) => ({
          text: [
            '审计 plugins 表结构并添加索引',
            '审计 files 表结构并添加索引',
            '审计 knowledgeBases 表结构并添加索引',
            '审计 documents 表结构并添加索引',
            '审计 chunks 表结构并添加索引',
          ][k],
          status: k === i ? 'processing' : k < i ? 'completed' : 'todo',
        })),
      ),
      execTask(
        `为 ${table} 表添加索引`,
        `检查 src/database/schemas/${table}.ts 的表结构，添加 createdAt 性能索引，生成迁移 SQL`,
      ),
      updateTodos(
        [{ type: 'complete', index: i }],
        Array.from({ length: 5 }, (_, k) => ({
          text: [
            '审计 plugins 表结构并添加索引',
            '审计 files 表结构并添加索引',
            '审计 knowledgeBases 表结构并添加索引',
            '审计 documents 表结构并添加索引',
            '审计 chunks 表结构并添加索引',
          ][k],
          status: k <= i ? 'completed' : 'todo',
        })),
      ),
      breathe(`已处理 ${table} 表，继续下一张。`),
    ]),
    createTodos(['生成 Drizzle 迁移文件 0042_add_indexes', '运行 drizzle-kit dry-run 验证']),
    updateTodos(
      [
        { type: 'complete', index: 0 },
        { type: 'complete', index: 1 },
      ],
      [
        { text: '生成 Drizzle 迁移文件 0042_add_indexes', status: 'completed' },
        { text: '运行 drizzle-kit dry-run 验证', status: 'completed' },
      ],
    ),

    // =====================================================================
    // Phase 3 — Store slice migration (30 tools)
    // =====================================================================
    llmStep({
      text: '第三阶段：迁移 Zustand store slices 到新的 data-fetching 模式。',
      reasoning:
        '将 15 个 store slice 逐一迁移到 SWR + zustand 模式。先完成的标记 completed，进行中的标记 in_progress。',
      durationMs: 1000,
    }),
    createPlan(
      'Store 迁移计划',
      '将 15 个 Zustand store slice 迁移到 SWR + Zustand 数据获取模式',
      '核心 slice: message, chat, agent, tool, session, topic, file, knowledgeBase, plugin, user, setting, discover, compression',
      'plan-store-001',
    ),
    ...[
      'message',
      'chat',
      'agent',
      'tool',
      'session',
      'topic',
      'file',
      'knowledgeBase',
      'plugin',
      'user',
      'setting',
      'discover',
      'compression',
      'file',
      'notification',
    ].flatMap((slice, i) => [
      createTodos([`迁移 ${slice} store slice 到 SWR 模式`]),
      updateTodos(
        [{ type: 'processing', index: 0 }],
        [{ text: `迁移 ${slice} store slice 到 SWR 模式`, status: 'processing' }],
      ),
      execTask(
        `迁移 ${slice} store slice`,
        `重构 src/store/chat/slices/${slice}/index.ts，将数据获取逻辑迁移到 SWR + Zustand 模式`,
      ),
      updateTodos(
        [{ type: 'complete', index: 0 }],
        [{ text: `迁移 ${slice} store slice 到 SWR 模式`, status: 'completed' }],
      ),
      breathe(`已迁移 ${slice}，继续下一个 slice。`),
    ]),
    updatePlan('plan-store-001', { completed: true }),

    // =====================================================================
    // Phase 4 — TRPC router refactors (25 tools)
    // =====================================================================
    llmStep({
      text: '第四阶段：重构 15 个 TRPC router 到 v11 patterns。',
      reasoning: 'TRPC v11 有更好的类型推断。需要更新每个 router 的 procedure 定义。',
      durationMs: 800,
    }),
    createPlan(
      'TRPC 迁移计划',
      '将 15 个 TRPC router 迁移到 v11 patterns',
      'routers: agent, message, session, topic, file, plugin, knowledgeBase, share, user, setting, notification, discover, generation, tool, thread',
      'plan-trpc-001',
    ),
    createTodos([
      '迁移 agent router 到 TRPC v11',
      '迁移 message router 到 TRPC v11',
      '迁移 session router 到 TRPC v11',
      '迁移 topic router 到 TRPC v11',
      '迁移 file router 到 TRPC v11',
    ]),
    createTodos([
      '迁移 plugin router 到 TRPC v11',
      '迁移 knowledgeBase router 到 TRPC v11',
      '迁移 share router 到 TRPC v11',
      '迁移 user router 到 TRPC v11',
      '迁移 setting router 到 TRPC v11',
    ]),
    createTodos([
      '迁移 notification router 到 TRPC v11',
      '迁移 discover router 到 TRPC v11',
      '迁移 generation router 到 TRPC v11',
      '迁移 tool router 到 TRPC v11',
      '迁移 thread router 到 TRPC v11',
    ]),
    ...[
      'agent',
      'message',
      'session',
      'topic',
      'file',
      'plugin',
      'knowledgeBase',
      'share',
      'user',
      'setting',
      'notification',
      'discover',
      'generation',
      'tool',
      'thread',
    ].flatMap((router, i) => {
      const batch = Math.floor(i / 5);
      const localIdx = i % 5;
      return [
        updateTodos(
          [{ type: 'processing', index: localIdx }],
          Array.from({ length: 5 }, (_, k) => ({
            text: [
              [
                '迁移 agent router 到 TRPC v11',
                '迁移 message router 到 TRPC v11',
                '迁移 session router 到 TRPC v11',
                '迁移 topic router 到 TRPC v11',
                '迁移 file router 到 TRPC v11',
              ],
              [
                '迁移 plugin router 到 TRPC v11',
                '迁移 knowledgeBase router 到 TRPC v11',
                '迁移 share router 到 TRPC v11',
                '迁移 user router 到 TRPC v11',
                '迁移 setting router 到 TRPC v11',
              ],
              [
                '迁移 notification router 到 TRPC v11',
                '迁移 discover router 到 TRPC v11',
                '迁移 generation router 到 TRPC v11',
                '迁移 tool router 到 TRPC v11',
                '迁移 thread router 到 TRPC v11',
              ],
            ][batch][k],
            status: k === localIdx ? 'processing' : k < localIdx ? 'completed' : 'todo',
          })),
        ),
        updateTodos(
          [{ type: 'complete', index: localIdx }],
          Array.from({ length: 5 }, (_, k) => ({
            text: [
              [
                '迁移 agent router 到 TRPC v11',
                '迁移 message router 到 TRPC v11',
                '迁移 session router 到 TRPC v11',
                '迁移 topic router 到 TRPC v11',
                '迁移 file router 到 TRPC v11',
              ],
              [
                '迁移 plugin router 到 TRPC v11',
                '迁移 knowledgeBase router 到 TRPC v11',
                '迁移 share router 到 TRPC v11',
                '迁移 user router 到 TRPC v11',
                '迁移 setting router 到 TRPC v11',
              ],
              [
                '迁移 notification router 到 TRPC v11',
                '迁移 discover router 到 TRPC v11',
                '迁移 generation router 到 TRPC v11',
                '迁移 tool router 到 TRPC v11',
                '迁移 thread router 到 TRPC v11',
              ],
            ][batch][k],
            status: k <= localIdx ? 'completed' : 'todo',
          })),
        ),
        breathe(`已处理 ${router} router，继续。`),
      ];
    }),
    createTodos(['运行 type-check 验证 TRPC 迁移', '修复 type-check 发现的类型问题']),
    updateTodos(
      [
        { type: 'complete', index: 0 },
        { type: 'processing', index: 1 },
      ],
      [
        { text: '运行 type-check 验证 TRPC 迁移', status: 'completed' },
        { text: '修复 type-check 发现的类型问题', status: 'processing' },
      ],
    ),
    execTask('修复 TRPC 类型问题', '运行 bun run type-check，逐一修复类型错误直到通过'),
    updateTodos(
      [{ type: 'complete', index: 1 }],
      [
        { text: '运行 type-check 验证 TRPC 迁移', status: 'completed' },
        { text: '修复 type-check 发现的类型问题', status: 'completed' },
      ],
    ),

    // =====================================================================
    // Phase 5 — i18n key extraction + error recovery (28 tools)
    // =====================================================================
    llmStep({
      text: '第五阶段：i18n key 提取。扫描 15 个命名空间，提取硬编码字符串。',
      reasoning: '逐文件扫描，替换硬编码中文/英文字符串为 i18n key。',
      durationMs: 700,
    }),
    createPlan(
      'i18n 提取计划',
      '扫描 15 个命名空间，提取硬编码字符串为 i18n key',
      '命名空间: common, chat, agent, setting, plugin, tool, auth, file, knowledge, share, discover, notification, onboarding, error, taskTemplate',
      'plan-i18n-001',
    ),
    ...[
      'common',
      'chat',
      'agent',
      'setting',
      'plugin',
      'tool',
      'auth',
      'file',
      'knowledge',
      'share',
    ].flatMap((ns, i) => {
      return [
        createTodos([`提取 ${ns} 命名空间的硬编码字符串`]),
        updateTodos(
          [{ type: 'processing', index: 0 }],
          [{ text: `提取 ${ns} 命名空间的硬编码字符串`, status: 'processing' }],
        ),
        execTask(
          `提取 ${ns} i18n keys`,
          `扫描 src/locales/default/${ns}.ts，将硬编码字符串替换为 i18n key`,
        ),
        updateTodos(
          [{ type: 'complete', index: 0 }],
          [{ text: `提取 ${ns} 命名空间的硬编码字符串`, status: 'completed' }],
        ),
        breathe(`已提取 ${ns}，继续下一个命名空间。`),
      ];
    }),
    ...['discover', 'notification', 'onboarding', 'error', 'taskTemplate'].flatMap((ns) => [
      createTodos([`提取 ${ns} 命名空间的硬编码字符串`]),
      updateTodos(
        [{ type: 'processing', index: 0 }],
        [{ text: `提取 ${ns} 命名空间的硬编码字符串`, status: 'processing' }],
      ),
      execTask(
        `提取 ${ns} i18n keys`,
        `扫描 src/locales/default/${ns}.ts，将硬编码字符串替换为 i18n key`,
      ),
      updateTodos(
        [{ type: 'complete', index: 0 }],
        [{ text: `提取 ${ns} 命名空间的硬编码字符串`, status: 'completed' }],
      ),
      breathe(`已提取 ${ns}，继续下一个命名空间。`),
    ]),
    // Simulate an error + recovery
    errorStep({
      message: 'i18n sync failed: zh-CN/agent.ts has duplicate key "confirmDelete"',
      type: 'I18nSyncError',
    }),
    createTodos(['修复 i18n sync 重复 key 问题']),
    updateTodos(
      [{ type: 'processing', index: 0 }],
      [{ text: '修复 i18n sync 重复 key 问题', status: 'processing' }],
    ),
    execTask(
      '修复 i18n 重复 key',
      '检查 src/locales/zh-CN/agent.ts，合并重复的 confirmDelete key，重新运行 pnpm i18n',
    ),
    updateTodos(
      [{ type: 'complete', index: 0 }],
      [{ text: '修复 i18n sync 重复 key 问题', status: 'completed' }],
    ),

    // =====================================================================
    // Phase 6 — Component rewrites with createStaticStyles (26 tools)
    // =====================================================================
    llmStep({
      text: '第六阶段：将 8 个核心组件从 createStyles 迁移到 createStaticStyles。',
      reasoning: 'createStaticStyles 使用 cssVar，零运行时开销。先迁移高频使用的核心组件。',
      durationMs: 900,
    }),
    createPlan(
      '组件样式迁移计划',
      '将 8 个核心组件从 createStyles 迁移到 createStaticStyles',
      '组件: ChatInput, Conversation, AgentSettings, KnowledgeBase, PluginStore, FileExplorer, ShareModal, UserSettings',
      'plan-styles-001',
    ),
    createTodos([
      '迁移 ChatInput 到 createStaticStyles',
      '迁移 Conversation 到 createStaticStyles',
      '迁移 AgentSettings 到 createStaticStyles',
      '迁移 KnowledgeBase 到 createStaticStyles',
    ]),
    createTodos([
      '迁移 PluginStore 到 createStaticStyles',
      '迁移 FileExplorer 到 createStaticStyles',
      '迁移 ShareModal 到 createStaticStyles',
      '迁移 UserSettings 到 createStaticStyles',
    ]),
    ...[
      'ChatInput',
      'Conversation',
      'AgentSettings',
      'KnowledgeBase',
      'PluginStore',
      'FileExplorer',
      'ShareModal',
      'UserSettings',
    ].flatMap((comp, i) => {
      const localIdx = i % 4;
      return [
        updateTodos(
          [{ type: 'processing', index: localIdx }],
          Array.from({ length: 4 }, (_, k) => ({
            text: [
              [
                '迁移 ChatInput 到 createStaticStyles',
                '迁移 Conversation 到 createStaticStyles',
                '迁移 AgentSettings 到 createStaticStyles',
                '迁移 KnowledgeBase 到 createStaticStyles',
              ],
              [
                '迁移 PluginStore 到 createStaticStyles',
                '迁移 FileExplorer 到 createStaticStyles',
                '迁移 ShareModal 到 createStaticStyles',
                '迁移 UserSettings 到 createStaticStyles',
              ],
            ][Math.floor(i / 4)][k],
            status: k === localIdx ? 'processing' : k < localIdx ? 'completed' : 'todo',
          })),
        ),
        execTask(
          `迁移 ${comp} 样式`,
          `将 src/features/${comp}/index.tsx 中的 createStyles 替换为 createStaticStyles，使用 cssVar`,
        ),
        updateTodos(
          [{ type: 'complete', index: localIdx }],
          Array.from({ length: 4 }, (_, k) => ({
            text: [
              [
                '迁移 ChatInput 到 createStaticStyles',
                '迁移 Conversation 到 createStaticStyles',
                '迁移 AgentSettings 到 createStaticStyles',
                '迁移 KnowledgeBase 到 createStaticStyles',
              ],
              [
                '迁移 PluginStore 到 createStaticStyles',
                '迁移 FileExplorer 到 createStaticStyles',
                '迁移 ShareModal 到 createStaticStyles',
                '迁移 UserSettings 到 createStaticStyles',
              ],
            ][Math.floor(i / 4)][k],
            status: k <= localIdx ? 'completed' : 'todo',
          })),
        ),
        breathe(`已迁移 ${comp}，继续下一个组件。`),
      ];
    }),
    // Verify
    createTodos(['验证迁移后的组件编译通过']),
    updateTodos(
      [{ type: 'processing', index: 0 }],
      [{ text: '验证迁移后的组件编译通过', status: 'processing' }],
    ),
    execTask('编译验证', '运行 bun run type-check 确认迁移后的组件没有类型错误'),
    updateTodos(
      [{ type: 'complete', index: 0 }],
      [{ text: '验证迁移后的组件编译通过', status: 'completed' }],
    ),

    // =====================================================================
    // Phase 7 — Testing (20 tools)
    // =====================================================================
    llmStep({
      text: '第七阶段：编写和修复测试。覆盖 store、router、E2E 三个层面。',
      reasoning: '先写单元测试确保 store 迁移正确，再写集成测试覆盖 router，最后修复 flaky E2E。',
      durationMs: 800,
    }),
    createTodos([
      '写 message store 单元测试',
      '写 chat store 单元测试',
      '写 agent store 单元测试',
      '写 agent router 集成测试',
    ]),
    ...['message store', 'chat store', 'agent store', 'agent router'].flatMap((target, i) => [
      updateTodos(
        [{ type: 'processing', index: i }],
        Array.from({ length: 4 }, (_, k) => ({
          text: [
            '写 message store 单元测试',
            '写 chat store 单元测试',
            '写 agent store 单元测试',
            '写 agent router 集成测试',
          ][k],
          status: k === i ? 'processing' : k < i ? 'completed' : 'todo',
        })),
      ),
      execTask(`编写 ${target} 测试`, `为 ${target} 编写 vitest 测试用例，覆盖核心功能路径`),
      updateTodos(
        [{ type: 'complete', index: i }],
        Array.from({ length: 4 }, (_, k) => ({
          text: [
            '写 message store 单元测试',
            '写 chat store 单元测试',
            '写 agent store 单元测试',
            '写 agent router 集成测试',
          ][k],
          status: k <= i ? 'completed' : 'todo',
        })),
      ),
      breathe(`已完成 ${target}，继续下一项测试。`),
    ]),
    // Fix flaky E2E
    createTodos([
      '修复 login E2E flaky 测试',
      '修复 conversation E2E flaky 测试',
      '运行全量 Vitest 套件',
      '运行 E2E 套件',
    ]),
    ...['login E2E', 'conversation E2E', '全量 Vitest', 'E2E 套件'].flatMap((target, i) => [
      updateTodos(
        [{ type: 'processing', index: i }],
        Array.from({ length: 4 }, (_, k) => ({
          text: [
            '修复 login E2E flaky 测试',
            '修复 conversation E2E flaky 测试',
            '运行全量 Vitest 套件',
            '运行 E2E 套件',
          ][k],
          status: k === i ? 'processing' : k < i ? 'completed' : 'todo',
        })),
      ),
      execTask(`${target}`, `执行 ${target} 相关的测试修复与验证工作`),
      updateTodos(
        [{ type: 'complete', index: i }],
        Array.from({ length: 4 }, (_, k) => ({
          text: [
            '修复 login E2E flaky 测试',
            '修复 conversation E2E flaky 测试',
            '运行全量 Vitest 套件',
            '运行 E2E 套件',
          ][k],
          status: k <= i ? 'completed' : 'todo',
        })),
      ),
      breathe(`已完成 ${target}，继续下一项。`),
    ]),

    // =====================================================================
    // Phase 8 — Final verification (19 tools)
    // =====================================================================
    llmStep({
      text: '第八阶段：最终验证——type-check、完整测试套件、bundle 分析、安全审计。',
      reasoning: '全面跑一遍 CI 流水线的关键步骤，确保迁移没有引入回归。',
      durationMs: 1000,
    }),
    createPlan(
      '最终验证计划',
      '全面验证迁移结果，确保无回归',
      '验证项: type-check, vitest, production build, e2e, security audit, CI workflow, migration guide',
      'plan-verify-001',
    ),
    createTodos(['全量 type-check', '完整 Vitest 套件', '生产构建', 'E2E 套件', '安全审计']),
    ...['全量 type-check', '完整 Vitest 套件', '生产构建', 'E2E 套件', '安全审计'].flatMap(
      (task, i) => [
        updateTodos(
          [{ type: 'processing', index: i }],
          Array.from({ length: 5 }, (_, k) => ({
            text: ['全量 type-check', '完整 Vitest 套件', '生产构建', 'E2E 套件', '安全审计'][k],
            status: k === i ? 'processing' : k < i ? 'completed' : 'todo',
          })),
        ),
        execTask(`执行 ${task}`, `运行 ${task} 确认迁移无回归`),
        updateTodos(
          [{ type: 'complete', index: i }],
          Array.from({ length: 5 }, (_, k) => ({
            text: ['全量 type-check', '完整 Vitest 套件', '生产构建', 'E2E 套件', '安全审计'][k],
            status: k <= i ? 'completed' : 'todo',
          })),
        ),
        breathe(`已完成 ${task}，继续验证。`),
      ],
    ),
    // Final cleanup
    createTodos(['更新 CI workflow', '写迁移指南文档']),
    updateTodos(
      [
        { type: 'processing', index: 0 },
        { type: 'processing', index: 1 },
      ],
      [
        { text: '更新 CI workflow', status: 'processing' },
        { text: '写迁移指南文档', status: 'processing' },
      ],
    ),
    execTask('更新 CI 配置', '修改 .github/workflows/ci.yml 添加并行 vitest shards'),
    execTask('写迁移指南', '创建 docs/MIGRATION.md 记录所有迁移变更和操作步骤'),
    updateTodos(
      [
        { type: 'complete', index: 0 },
        { type: 'complete', index: 1 },
      ],
      [
        { text: '更新 CI workflow', status: 'completed' },
        { text: '写迁移指南文档', status: 'completed' },
      ],
    ),
    updatePlan('plan-verify-001', { completed: true }),
    updatePlan('plan-migration-001', { completed: true }),

    // =====================================================================
    // Done
    // =====================================================================
    llmStep({
      text: '全部 8 个阶段完成。共执行约 200 个 GTD 工具调用，涵盖计划创建、待办管理、任务执行和错误恢复。迁移已通过 type-check、单测、E2E 和安全审计。',
      reasoning: '确认所有 todo 已标记完成，所有 plan 已标记 completed，汇总执行统计。',
      durationMs: 600,
    }),
  ],
});
