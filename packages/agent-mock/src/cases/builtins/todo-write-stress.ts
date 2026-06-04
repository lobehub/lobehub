import { defineCase, errorStep, llmStep, toolStep } from '../../builders/defineCase';

// ---------------------------------------------------------------------------
// Helpers — all mapped to lobe-agent
// ---------------------------------------------------------------------------

/** lobe-agent / createTodos */
const createTodos = (items: string[], durationMs = 60) =>
  toolStep({
    identifier: 'lobe-agent',
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

/** lobe-agent / updateTodos — batch operations */
const updateTodos = (
  operations: Array<{ type: string; index?: number; newText?: string; status?: string }>,
  currentItems: Array<{ text: string; status: string }>,
  durationMs = 60,
) =>
  toolStep({
    identifier: 'lobe-agent',
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

/** lobe-agent / createPlan */
const createPlan = (
  goal: string,
  description: string,
  context: string,
  planId: string,
  durationMs = 80,
) =>
  toolStep({
    identifier: 'lobe-agent',
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

/** lobe-agent / updatePlan */
const updatePlan = (
  planId: string,
  set: { goal?: string; description?: string; context?: string; completed?: boolean },
  durationMs = 60,
) =>
  toolStep({
    identifier: 'lobe-agent',
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

/** lobe-agent / callSubAgent */
const callSubAgent = (description: string, instruction: string, durationMs = 200) =>
  toolStep({
    identifier: 'lobe-agent',
    apiName: 'callSubAgent',
    arguments: JSON.stringify({ description, instruction }),
    result: {
      parentMessageId: `mock-msg-task-${Date.now()}`,
      task: { description, instruction },
      type: 'execSubAgent' as const,
    },
    durationMs,
  });

/** LLM "breathing" step between tool-call batches — simulates agent processing results */
const breathe = (text: string, durationMs = 250) => llmStep({ text, durationMs });

// ---------------------------------------------------------------------------
// The main case — ~200 lobe-agent tool calls across 8 phases
// ---------------------------------------------------------------------------

export const todoWriteStress = defineCase({
  id: 'todo-write-stress',
  name: 'TodoWrite × 200 (complex)',
  description:
    '~200 lobe-agent tool calls across 8 realistic phases: discovery, schema audit, store migration, ' +
    'TRPC refactor, i18n extraction, component rewrites, testing, and final verification.',
  tags: ['stress', 'todo', 'builtin'],

  steps: [
    // =====================================================================
    // Phase 0 — Agent kickoff
    // =====================================================================
    llmStep({
      text: 'I will perform a complete monorepo refactor, estimated to involve approximately 200 tool calls across 8 phases.',
      reasoning:
        'This is a large-scale monorepo migration task. Need to first inventory the existing code, then progressively migrate schema, store, router, i18n, components, and tests, with final comprehensive verification. Each step will generate tool calls.',
      durationMs: 1200,
    }),

    // =====================================================================
    // Phase 1 — Discovery & audit (24 tools)
    // =====================================================================
    llmStep({
      text: 'Phase 1: Comprehensive inventory of existing code structure. Create an overall plan, then break it into 15 todo items.',
      reasoning: 'First create a top-level plan document, then break the inventory work into specific todo items.',
      toolsCalling: [
        { id: 'tc-plan-1', identifier: 'lobe-agent', apiName: 'createPlan', arguments: '{}' },
        { id: 'tc-todos-1', identifier: 'lobe-agent', apiName: 'createTodos', arguments: '{}' },
      ],
      durationMs: 600,
    }),
    createPlan(
      'Monorepo Refactor',
      'Comprehensive migration of schema, store, router, i18n, components, and tests',
      'Covers 10 database tables, 15 store slices, 15 TRPC routers, 15 i18n namespaces, and 8 core components',
      'plan-migration-001',
    ),
    ...Array.from({ length: 5 }).flatMap((_, batch) => {
      const allItems = [
        'Inventory Zustand store slices',
        'Count TRPC routers',
        'Scan for hardcoded antd usage',
        'Check @lobehub/ui consistency',
        'List all Drizzle schema tables',
        'Count Next.js App Router routes',
        'Inventory features/ modules',
        'Scan for hardcoded i18n strings',
        'Find duplicate utility functions',
        'Measure current bundle size',
        'Analyze initial page load performance',
        'Review test coverage',
        'Identify flaky E2E tests',
        'Document CI/CD pipeline',
        'List environment variables',
      ];
      return [
        createTodos(allItems.slice(batch * 3, batch * 3 + 3)),
        breathe('Created a batch of todos, continuing inventory.'),
      ];
    }),
    // Mark first 3 as completed after discovery
    ...Array.from({ length: 5 }).flatMap((_, batch) => [
      updateTodos(
        Array.from({ length: 3 }, (_, j) => ({ type: 'complete' as const, index: batch * 3 + j })),
        Array.from({ length: 15 }, (_, k) => ({
          text: [
            'Inventory Zustand store slices',
            'Count TRPC routers',
            'Scan antd hardcoded usage',
            'Check @lobehub/ui consistency',
            'List all Drizzle schema tables',
            'Count Next.js App Router routes',
            'Inventory features/ modules',
            'Scan hardcoded i18n strings',
            'Find duplicate utility functions',
            'Measure current bundle size',
            'Analyze initial screen load performance',
            'Review test coverage',
            'Identify flaky E2E tests',
            'Document CI/CD pipeline',
            'List environment variables',
          ][k],
          status: k < batch * 3 + 3 ? 'completed' : 'todo',
        })),
      ),
      breathe('Marked as completed, continuing to next batch.'),
    ]),

    // =====================================================================
    // Phase 2 — Schema & database migration (28 tools)
    // =====================================================================
    llmStep({
      text: 'Phase 2: Database schema migration. Create todos for 10 core tables and progress through each.',
      reasoning: 'Need to check table structures one by one, add indexes, then generate migration scripts. Start with core business tables.',
      durationMs: 900,
    }),
    createPlan(
      'Schema Migration Plan',
      'Add performance indexes to 10 core tables and generate Drizzle migration files',
      'Audit users, messages, agents, conversations, topics, plugins, files, knowledgeBases, documents, chunks',
      'plan-schema-001',
    ),
    createTodos([
      'Audit users table structure and add indexes',
      'Audit messages table structure and add indexes',
      'Audit agents table structure and add indexes',
      'Audit conversations table structure and add indexes',
      'Audit topics table structure and add indexes',
    ]),
    createTodos([
      'Audit plugins table structure and add indexes',
      'Audit files table structure and add indexes',
      'Audit knowledgeBases table structure and add indexes',
      'Audit documents table structure and add indexes',
      'Audit chunks table structure and add indexes',
    ]),
    // Process each table: mark processing → complete
    ...['users', 'messages', 'agents', 'conversations', 'topics'].flatMap((table, i) => [
      updateTodos(
        [{ type: 'processing', index: i }],
        Array.from({ length: 5 }, (_, k) => ({
          text: [
            'Audit users table structure and add indexes',
            'Audit messages table structure and add indexes',
            'Audit agents table structure and add indexes',
            'Audit conversations table structure and add indexes',
            'Audit topics table structure and add indexes',
          ][k],
          status: k === i ? 'processing' : k < i ? 'completed' : 'todo',
        })),
      ),
      callSubAgent(
        `Add indexes to ${table} table`,
        `Check src/database/schemas/${table}.ts table structure, add createdAt performance index, generate migration SQL`,
      ),
      updateTodos(
        [{ type: 'complete', index: i }],
        Array.from({ length: 5 }, (_, k) => ({
          text: [
            'Audit users table structure and add indexes',
            'Audit messages table structure and add indexes',
            'Audit agents table structure and add indexes',
            'Audit conversations table structure and add indexes',
            'Audit topics table structure and add indexes',
          ][k],
          status: k <= i ? 'completed' : 'todo',
        })),
      ),
      breathe(`Processed ${table} table, moving to next.`),
    ]),
    ...['plugins', 'files', 'knowledgeBases', 'documents', 'chunks'].flatMap((table, i) => [
      updateTodos(
        [{ type: 'processing', index: i }],
        Array.from({ length: 5 }, (_, k) => ({
          text: [
            'Audit plugins table structure and add indexes',
            'Audit files table structure and add indexes',
            'Audit knowledgeBases table structure and add indexes',
            'Audit documents table structure and add indexes',
            'Audit chunks table structure and add indexes',
          ][k],
          status: k === i ? 'processing' : k < i ? 'completed' : 'todo',
        })),
      ),
      callSubAgent(
        `Add indexes to ${table} table`,
        `Check src/database/schemas/${table}.ts table structure, add createdAt performance index, generate migration SQL`,
      ),
      updateTodos(
        [{ type: 'complete', index: i }],
        Array.from({ length: 5 }, (_, k) => ({
          text: [
            'Audit plugins table structure and add indexes',
            'Audit files table structure and add indexes',
            'Audit knowledgeBases table structure and add indexes',
            'Audit documents table structure and add indexes',
            'Audit chunks table structure and add indexes',
          ][k],
          status: k <= i ? 'completed' : 'todo',
        })),
      ),
      breathe(`Processed ${table} table, moving to next.`),
    ]),
    createTodos(['Generate Drizzle migration file 0042_add_indexes', 'Run drizzle-kit dry-run validation']),
    updateTodos(
      [
        { type: 'complete', index: 0 },
        { type: 'complete', index: 1 },
      ],
      [
        { text: 'Generate Drizzle migration file 0042_add_indexes', status: 'completed' },
        { text: 'Run drizzle-kit dry-run validation', status: 'completed' },
      ],
    ),

    // =====================================================================
    // Phase 3 — Store slice migration (30 tools)
    // =====================================================================
    llmStep({
      text: 'Phase 3: Migrate Zustand store slices to the new data-fetching pattern.',
      reasoning:
        'Migrate 15 store slices one by one to the SWR + zustand pattern. Mark completed ones as completed, in-progress ones as in_progress.',
      durationMs: 1000,
    }),
    createPlan(
      'Store Migration Plan',
      'Migrate 15 Zustand store slices to the SWR + Zustand data-fetching pattern',
      'Core slices: message, chat, agent, tool, session, topic, file, knowledgeBase, plugin, user, setting, discover, compression',
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
      createTodos([`Migrate ${slice} store slice to SWR pattern`]),
      updateTodos(
        [{ type: 'processing', index: 0 }],
        [{ text: `Migrate ${slice} store slice to SWR pattern`, status: 'processing' }],
      ),
      callSubAgent(
        `Migrate ${slice} store slice`,
        `Refactor src/store/chat/slices/${slice}/index.ts, migrate data fetching logic to SWR + Zustand pattern`,
      ),
      updateTodos(
        [{ type: 'complete', index: 0 }],
        [{ text: `Migrate ${slice} store slice to SWR pattern`, status: 'completed' }],
      ),
      breathe(`Migrated ${slice}, continuing to next slice.`),
    ]),
    updatePlan('plan-store-001', { completed: true }),

    // =====================================================================
    // Phase 4 — TRPC router refactors (25 tools)
    // =====================================================================
    llmStep({
      text: 'Phase 4: Refactor 15 TRPC routers to v11 patterns.',
      reasoning: 'TRPC v11 has better type inference. Need to update the procedure definitions for each router.',
      durationMs: 800,
    }),
    createPlan(
      'TRPC Migration Plan',
      'Migrate 15 TRPC routers to v11 patterns',
      'routers: agent, message, session, topic, file, plugin, knowledgeBase, share, user, setting, notification, discover, generation, tool, thread',
      'plan-trpc-001',
    ),
    createTodos([
      'Migrate agent router to TRPC v11',
      'Migrate message router to TRPC v11',
      'Migrate session router to TRPC v11',
      'Migrate topic router to TRPC v11',
      'Migrate file router to TRPC v11',
    ]),
    createTodos([
      'Migrate plugin router to TRPC v11',
      'Migrate knowledgeBase router to TRPC v11',
      'Migrate share router to TRPC v11',
      'Migrate user router to TRPC v11',
      'Migrate setting router to TRPC v11',
    ]),
    createTodos([
      'Migrate notification router to TRPC v11',
      'Migrate discover router to TRPC v11',
      'Migrate generation router to TRPC v11',
      'Migrate tool router to TRPC v11',
      'Migrate thread router to TRPC v11',
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
                'Migrate agent router to TRPC v11',
                'Migrate message router to TRPC v11',
                'Migrate session router to TRPC v11',
                'Migrate topic router to TRPC v11',
                'Migrate file router to TRPC v11',
              ],
              [
                'Migrate plugin router to TRPC v11',
                'Migrate knowledgeBase router to TRPC v11',
                'Migrate share router to TRPC v11',
                'Migrate user router to TRPC v11',
                'Migrate setting router to TRPC v11',
              ],
              [
                'Migrate notification router to TRPC v11',
                'Migrate discover router to TRPC v11',
                'Migrate generation router to TRPC v11',
                'Migrate tool router to TRPC v11',
                'Migrate thread router to TRPC v11',
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
                'Migrate agent router to TRPC v11',
                'Migrate message router to TRPC v11',
                'Migrate session router to TRPC v11',
                'Migrate topic router to TRPC v11',
                'Migrate file router to TRPC v11',
              ],
              [
                'Migrate plugin router to TRPC v11',
                'Migrate knowledgeBase router to TRPC v11',
                'Migrate share router to TRPC v11',
                'Migrate user router to TRPC v11',
                'Migrate setting router to TRPC v11',
              ],
              [
                'Migrate notification router to TRPC v11',
                'Migrate discover router to TRPC v11',
                'Migrate generation router to TRPC v11',
                'Migrate tool router to TRPC v11',
                'Migrate thread router to TRPC v11',
              ],
            ][batch][k],
            status: k <= localIdx ? 'completed' : 'todo',
          })),
        ),
        breathe(`Processed ${router} router, continuing.`),
      ];
    }),
    createTodos(['Run type-check to validate TRPC migration', 'Fix type issues found by type-check']),
    updateTodos(
      [
        { type: 'complete', index: 0 },
        { type: 'processing', index: 1 },
      ],
      [
        { text: 'Run type-check to validate TRPC migration', status: 'completed' },
        { text: 'Fix type issues found by type-check', status: 'processing' },
      ],
    ),
    callSubAgent('Fix TRPC type issues', 'Run bun run type-check, fix type errors one by one until passing'),
    updateTodos(
      [{ type: 'complete', index: 1 }],
      [
        { text: 'Run type-check to validate TRPC migration', status: 'completed' },
        { text: 'Fix type issues found by type-check', status: 'completed' },
      ],
    ),

    // =====================================================================
    // Phase 5 — i18n key extraction + error recovery (28 tools)
    // =====================================================================
    llmStep({
      text: 'Phase 5: i18n key extraction. Scan 15 namespaces, extract hardcoded strings.',
      reasoning: 'Scan file by file, replacing hardcoded Chinese/English strings with i18n keys.',
      durationMs: 700,
    }),
    createPlan(
      'i18n Extraction Plan',
      'Scan 15 namespaces, extract hardcoded strings as i18n keys',
      'Namespaces: common, chat, agent, setting, plugin, tool, auth, file, knowledge, share, discover, notification, onboarding, error, taskTemplate',
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
        createTodos([`Extract hardcoded strings from ${ns} namespace`]),
        updateTodos(
          [{ type: 'processing', index: 0 }],
          [{ text: `Extract hardcoded strings from ${ns} namespace`, status: 'processing' }],
        ),
        callSubAgent(
          `Extract ${ns} i18n keys`,
          `Scan src/locales/default/${ns}.ts, replace hardcoded strings with i18n keys`,
        ),
        updateTodos(
          [{ type: 'complete', index: 0 }],
          [{ text: `Extract hardcoded strings from ${ns} namespace`, status: 'completed' }],
        ),
        breathe(`Extracted ${ns}, continuing to next namespace.`),
      ];
    }),
    ...['discover', 'notification', 'onboarding', 'error', 'taskTemplate'].flatMap((ns) => [
      createTodos([`Extract hardcoded strings from ${ns} namespace`]),
      updateTodos(
        [{ type: 'processing', index: 0 }],
        [{ text: `Extract hardcoded strings from ${ns} namespace`, status: 'processing' }],
      ),
      callSubAgent(
        `Extract ${ns} i18n keys`,
        `Scan src/locales/default/${ns}.ts, replace hardcoded strings with i18n keys`,
      ),
      updateTodos(
        [{ type: 'complete', index: 0 }],
        [{ text: `Extract hardcoded strings from ${ns} namespace`, status: 'completed' }],
      ),
      breathe(`Extracted ${ns}, continuing to next namespace.`),
    ]),
    // Simulate an error + recovery
    errorStep({
      message: 'i18n sync failed: zh-CN/agent.ts has duplicate key "confirmDelete"',
      type: 'I18nSyncError',
    }),
    createTodos(['Fix i18n sync duplicate key issue']),
    updateTodos(
      [{ type: 'processing', index: 0 }],
      [{ text: 'Fix i18n sync duplicate key issue', status: 'processing' }],
    ),
    callSubAgent(
      'Fix i18n duplicate keys',
      'Check src/locales/zh-CN/agent.ts, merge duplicate confirmDelete key, re-run pnpm i18n',
    ),
    updateTodos(
      [{ type: 'complete', index: 0 }],
      [{ text: 'Fix i18n sync duplicate key issue', status: 'completed' }],
    ),

    // =====================================================================
    // Phase 6 — Component rewrites with createStaticStyles (26 tools)
    // =====================================================================
    llmStep({
      text: 'Phase 6: Migrate 8 core components from createStyles to createStaticStyles.',
      reasoning: 'createStaticStyles uses cssVar with zero runtime overhead. Start with the most frequently used core components.',
      durationMs: 900,
    }),
    createPlan(
      'Component Style Migration Plan',
      'Migrate 8 core components from createStyles to createStaticStyles',
      'Components: ChatInput, Conversation, AgentSettings, KnowledgeBase, PluginStore, FileExplorer, ShareModal, UserSettings',
      'plan-styles-001',
    ),
    createTodos([
      'Migrate ChatInput to createStaticStyles',
      'Migrate Conversation to createStaticStyles',
      'Migrate AgentSettings to createStaticStyles',
      'Migrate KnowledgeBase to createStaticStyles',
    ]),
    createTodos([
      'Migrate PluginStore to createStaticStyles',
      'Migrate FileExplorer to createStaticStyles',
      'Migrate ShareModal to createStaticStyles',
      'Migrate UserSettings to createStaticStyles',
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
                'Migrate ChatInput to createStaticStyles',
                'Migrate Conversation to createStaticStyles',
                'Migrate AgentSettings to createStaticStyles',
                'Migrate KnowledgeBase to createStaticStyles',
              ],
              [
                'Migrate PluginStore to createStaticStyles',
                'Migrate FileExplorer to createStaticStyles',
                'Migrate ShareModal to createStaticStyles',
                'Migrate UserSettings to createStaticStyles',
              ],
            ][Math.floor(i / 4)][k],
            status: k === localIdx ? 'processing' : k < localIdx ? 'completed' : 'todo',
          })),
        ),
        callSubAgent(
          `Migrate ${comp} styles`,
          `Replace createStyles with createStaticStyles in src/features/${comp}/index.tsx, using cssVar`,
        ),
        updateTodos(
          [{ type: 'complete', index: localIdx }],
          Array.from({ length: 4 }, (_, k) => ({
            text: [
              [
                'Migrate ChatInput to createStaticStyles',
                'Migrate Conversation to createStaticStyles',
                'Migrate AgentSettings to createStaticStyles',
                'Migrate KnowledgeBase to createStaticStyles',
              ],
              [
                'Migrate PluginStore to createStaticStyles',
                'Migrate FileExplorer to createStaticStyles',
                'Migrate ShareModal to createStaticStyles',
                'Migrate UserSettings to createStaticStyles',
              ],
            ][Math.floor(i / 4)][k],
            status: k <= localIdx ? 'completed' : 'todo',
          })),
        ),
        breathe(`Migrated ${comp}, continuing to next component.`),
      ];
    }),
    // Verify
    createTodos(['Verify migrated components compile without errors']),
    updateTodos(
      [{ type: 'processing', index: 0 }],
      [{ text: 'Verify migrated components compile without errors', status: 'processing' }],
    ),
    callSubAgent('Compile verification', 'Run bun run type-check to confirm no type errors in migrated components'),
    updateTodos(
      [{ type: 'complete', index: 0 }],
      [{ text: 'Verify migrated components compile without errors', status: 'completed' }],
    ),

    // =====================================================================
    // Phase 7 — Testing (20 tools)
    // =====================================================================
    llmStep({
      text: 'Phase 7: Write and fix tests. Cover store, router, and E2E layers.',
      reasoning: 'First write unit tests to ensure correct store migration, then write integration tests for routers, finally fix flaky E2E tests.',
      durationMs: 800,
    }),
    createTodos([
      'Write message store unit tests',
      'Write chat store unit tests',
      'Write agent store unit tests',
      'Write agent router integration tests',
    ]),
    ...['message store', 'chat store', 'agent store', 'agent router'].flatMap((target, i) => [
      updateTodos(
        [{ type: 'processing', index: i }],
        Array.from({ length: 4 }, (_, k) => ({
          text: [
            'Write message store unit tests',
            'Write chat store unit tests',
            'Write agent store unit tests',
            'Write agent router integration tests',
          ][k],
          status: k === i ? 'processing' : k < i ? 'completed' : 'todo',
        })),
      ),
      callSubAgent(`Write ${target} tests`, `Write vitest test cases for ${target}, covering core functionality paths`),
      updateTodos(
        [{ type: 'complete', index: i }],
        Array.from({ length: 4 }, (_, k) => ({
          text: [
            'Write message store unit tests',
            'Write chat store unit tests',
            'Write agent store unit tests',
            'Write agent router integration tests',
          ][k],
          status: k <= i ? 'completed' : 'todo',
        })),
      ),
      breathe(`Completed ${target}, continuing to next test.`),
    ]),
    // Fix flaky E2E
    createTodos([
      'Fix login E2E flaky tests',
      'Fix conversation E2E flaky tests',
      'Run full Vitest test suite',
      'Run E2E test suite',
    ]),
    ...['login E2E', 'conversation E2E', 'full Vitest', 'E2E suite'].flatMap((target, i) => [
      updateTodos(
        [{ type: 'processing', index: i }],
        Array.from({ length: 4 }, (_, k) => ({
          text: [
            'Fix login E2E flaky tests',
            'Fix conversation E2E flaky tests',
            'Run full Vitest test suite',
            'Run E2E test suite',
          ][k],
          status: k === i ? 'processing' : k < i ? 'completed' : 'todo',
        })),
      ),
      callSubAgent(`${target}`, `Execute ${target} related test fixes and validation work`),
      updateTodos(
        [{ type: 'complete', index: i }],
        Array.from({ length: 4 }, (_, k) => ({
          text: [
            'Fix login E2E flaky tests',
            'Fix conversation E2E flaky tests',
            'Run full Vitest test suite',
            'Run E2E test suite',
          ][k],
          status: k <= i ? 'completed' : 'todo',
        })),
      ),
      breathe(`Completed ${target}, continuing.`),
    ]),

    // =====================================================================
    // Phase 8 — Final verification (19 tools)
    // =====================================================================
    llmStep({
      text: 'Phase 8: Final verification — type-check, full test suite, bundle analysis, security audit.',
      reasoning: 'Run all key CI pipeline steps comprehensively to ensure migration introduced no regressions.',
      durationMs: 1000,
    }),
    createPlan(
      'Final Verification Plan',
      'Comprehensively verify migration results, ensure no regressions',
      'Verify: type-check, vitest, production build, e2e, security audit, CI workflow, migration guide',
      'plan-verify-001',
    ),
    createTodos(['Full type-check', 'Complete Vitest suite', 'Production build', 'E2E suite', 'Security audit']),
    ...['Full type-check', 'Complete Vitest suite', 'Production build', 'E2E suite', 'Security audit'].flatMap(
      (task, i) => [
        updateTodos(
          [{ type: 'processing', index: i }],
          Array.from({ length: 5 }, (_, k) => ({
            text: ['Full type-check', 'Complete Vitest suite', 'Production build', 'E2E suite', 'Security audit'][k],
            status: k === i ? 'processing' : k < i ? 'completed' : 'todo',
          })),
        ),
        callSubAgent(`Run ${task}`, `Execute ${task} to confirm migration has no regressions`),
        updateTodos(
          [{ type: 'complete', index: i }],
          Array.from({ length: 5 }, (_, k) => ({
            text: ['Full type-check', 'Complete Vitest suite', 'Production build', 'E2E suite', 'Security audit'][k],
            status: k <= i ? 'completed' : 'todo',
          })),
        ),
        breathe(`Completed ${task}, continuing verification.`),
      ],
    ),
    // Final cleanup
    createTodos(['Update CI workflow', 'Write migration guide doc']),
    updateTodos(
      [
        { type: 'processing', index: 0 },
        { type: 'processing', index: 1 },
      ],
      [
        { text: 'Update CI workflow', status: 'processing' },
        { text: 'Write migration guide doc', status: 'processing' },
      ],
    ),
    callSubAgent('Update CI config', 'Modify .github/workflows/ci.yml to add parallel vitest shards'),
    callSubAgent('Write migration guide', 'Create docs/MIGRATION.md documenting all migration changes and steps'),
    updateTodos(
      [
        { type: 'complete', index: 0 },
        { type: 'complete', index: 1 },
      ],
      [
        { text: 'Update CI workflow', status: 'completed' },
        { text: 'Write migration guide doc', status: 'completed' },
      ],
    ),
    updatePlan('plan-verify-001', { completed: true }),
    updatePlan('plan-migration-001', { completed: true }),

    // =====================================================================
    // Done
    // =====================================================================
    llmStep({
      text: 'All 8 phases complete. Approximately 200 lobe-agent tool calls executed, covering plan creation, todo management, task execution, and error recovery. Migration has passed type-check, unit tests, E2E, and security audit.',
      reasoning: 'Confirm all todos are marked completed, all plans are marked completed, and summarize execution statistics.',
      durationMs: 600,
    }),
  ],
});
