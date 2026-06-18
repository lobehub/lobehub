'use client';

import { ClaudeCodeIdentifier } from '@lobechat/builtin-tool-claude-code/client';

import { defineFixtures, single, variants } from './_helpers';

const linearIssueApiName = 'mcp__claude_ai_Linear__save_issue';
const linearIssueResult = {
  description:
    '## 背景\n\n当前客户端侧有三种 agent runtime 路径，它们都在处理同一类 agent run 生命周期，但生命周期控制点不一致。\n\n## 目标\n\n建立一套共享的 post-complete hooks，让 queue message、topic title、Agent Signal、unread completion 和 notification 都通过同一入口收敛。',
  id: 'LOBE-10205',
  links: [
    {
      title: 'PR #15766: refactor(chat): unify agent run lifecycle',
      url: 'https://github.com/lobehub/lobehub/pull/15766',
    },
  ],
  state: { name: 'In Review' },
  title: '统一三种客户端 Agent Runtime 的 run 生命周期 hooks',
  url: 'https://linear.app/lobehub/issue/LOBE-10205',
};

export default defineFixtures({
  identifier: ClaudeCodeIdentifier,
  meta: {
    description: 'Anthropic Claude Code render previews.',
    title: 'Claude Code',
  },
  apiList: [
    {
      description: 'Spawn and summarize a sub-agent task.',
      name: 'Agent',
    },
    {
      description: 'Run a shell command.',
      name: 'Bash',
    },
    {
      description: 'Patch file contents.',
      name: 'Edit',
    },
    {
      description: 'Find files by glob pattern.',
      name: 'Glob',
    },
    {
      description: 'Search file contents.',
      name: 'Grep',
    },
    {
      description: 'Read file content.',
      name: 'Read',
    },
    {
      description: 'Schedule when to resume work.',
      name: 'ScheduleWakeup',
    },
    {
      description: 'Run a Claude Code skill.',
      name: 'Skill',
    },
    {
      description: 'Create a new task (CC 2.1.143+ replacement for TodoWrite).',
      name: 'TaskCreate',
    },
    {
      description: 'Inspect a single task by id.',
      name: 'TaskGet',
    },
    {
      description: 'List all tasks.',
      name: 'TaskList',
    },
    {
      description: 'Read output from a background task.',
      name: 'TaskOutput',
    },
    {
      description: 'Stop a background task.',
      name: 'TaskStop',
    },
    {
      description: 'Update an existing task by id.',
      name: 'TaskUpdate',
    },
    {
      description: 'Track todo progress (pre-2.1.143 legacy).',
      name: 'TodoWrite',
    },
    {
      description: 'Look up deferred tools by name or keyword.',
      name: 'ToolSearch',
    },
    {
      description: 'Fetch a URL and answer a prompt about it.',
      name: 'WebFetch',
    },
    {
      description: 'Search the web.',
      name: 'WebSearch',
    },
    {
      description: 'Write a new file.',
      name: 'Write',
    },
    {
      description: 'Update a Linear issue through MCP.',
      name: linearIssueApiName,
    },
  ],
  fixtures: {
    Agent: single({
      args: {
        prompt:
          'Inspect the generated preview fixtures and reply with a short note about the riskiest missing case.',
      },
      content:
        '- Search-driven renders still need richer empty-state fixtures.\n- The grouped execute-tasks preview depends on seeded agent-group state.',
    }),
    Bash: variants([
      {
        args: { command: 'rg -n "TodoListRender" packages src' },
        content:
          'packages/builtin-tools/src/codex/TodoListRender.tsx:11:const TodoListRender = memo<...>',
        label: 'Match found',
        pluginState: {
          exitCode: 0,
          isBackground: false,
          output:
            'packages/builtin-tools/src/codex/TodoListRender.tsx:11:const TodoListRender = memo<...>',
          stdout:
            'packages/builtin-tools/src/codex/TodoListRender.tsx:11:const TodoListRender = memo<...>',
          success: true,
        },
      },
      {
        args: { command: 'bun run type-check' },
        content:
          'src/features/DevPanel/RenderGallery/ToolPreview.tsx(48,12): error TS2304: Cannot find name "Foo".\n',
        label: 'Non-zero exit',
        pluginState: {
          exitCode: 2,
          isBackground: false,
          output:
            'src/features/DevPanel/RenderGallery/ToolPreview.tsx(48,12): error TS2304: Cannot find name "Foo".\n',
          stderr:
            'src/features/DevPanel/RenderGallery/ToolPreview.tsx(48,12): error TS2304: Cannot find name "Foo".\n',
          success: false,
        },
      },
      {
        args: { command: 'find . -name "*.tsx" -not -path "*/node_modules/*" | head -20' },
        content: Array.from({ length: 20 }, (_, i) => `./src/components/Card${i}.tsx`).join('\n'),
        label: 'Large output',
        pluginState: {
          exitCode: 0,
          isBackground: false,
          output: Array.from({ length: 20 }, (_, i) => `./src/components/Card${i}.tsx`).join('\n'),
          stdout: Array.from({ length: 20 }, (_, i) => `./src/components/Card${i}.tsx`).join('\n'),
          success: true,
        },
      },
    ]),
    Edit: single({
      args: {
        file_path: 'src/spa/router/desktopRouter.config.desktop.tsx',
        new_string: "path: 'tasks',",
        old_string: "path: 'tasks',",
      },
    }),
    Glob: single({
      args: { path: 'src/routes', pattern: '**/index.tsx' },
      content: 'src/routes/(main)/agent/index.tsx\nsrc/routes/(main)/devtools/index.tsx',
    }),
    Grep: variants([
      {
        args: { path: 'packages', pattern: 'BuiltinRenderProps', type: 'ts' },
        content:
          'packages/types/src/tool/builtin.ts:244:export interface BuiltinRenderProps<Arguments = any, State = any, Content = any> {\npackages/builtin-tools/src/renders.ts:18:type Render = (p: BuiltinRenderProps) => ReactNode;',
        label: 'Many matches',
      },
      {
        args: { path: 'src', pattern: 'NEVER_MATCH_THIS_TOKEN', type: 'tsx' },
        content: '',
        label: 'No matches',
      },
    ]),
    Read: single({
      args: { file_path: 'packages/builtin-tools/src/renders.ts' },
      content:
        "1  import { RunCommandRender } from '@lobechat/shared-tool-ui/renders';\n2  export interface BuiltinRenderRegistryEntry { ... }",
    }),
    ScheduleWakeup: single({
      args: {
        delaySeconds: 1200,
        reason: 'Recheck the failing build once dependencies finish installing.',
      },
    }),
    Skill: single({
      args: { skill: 'codebase-search' },
      content: 'Use ripgrep first, then open only the relevant files to keep context sharp.',
    }),
    TaskOutput: single({
      args: { block: false, task_id: 'task-build-2025-04-25', timeout_ms: 8000 },
      content:
        '✅  Vite: compile and bundle finished (200) http://localhost:9876/\nDebug Proxy: https://app.lobehub.com/_dangerous_local_dev_proxy?debug-host=http://localhost:9876',
    }),
    TaskStop: single({
      args: { task_id: 'task-build-2025-04-25' },
      content: 'Background task stopped (exit code 0).',
    }),
    // Task tools — the renderer reads `pluginState.todos.items`, which the
    // CC adapter synthesizes from the accumulated TaskCreate / TaskUpdate /
    // TaskList history. Fixtures supply that snapshot directly.
    TaskCreate: variants([
      {
        args: {
          activeForm: 'Reading hosts',
          description: 'Read /etc/hosts and capture the content.',
          subject: 'Read hosts',
        },
        content: 'Task #1 created successfully: Read hosts',
        label: 'First create',
        pluginState: {
          todos: {
            items: [{ id: '1', status: 'todo', text: 'Read hosts' }],
            updatedAt: '2026-05-16T07:23:19.639Z',
          },
        },
      },
      {
        args: {
          activeForm: 'Drafting summary',
          description: 'Summarize findings.',
          subject: 'Draft summary',
        },
        content: 'Task #3 created successfully: Draft summary',
        label: 'Third create with prior progress',
        pluginState: {
          todos: {
            items: [
              { id: '1', status: 'completed', text: 'Read hosts' },
              { id: '2', status: 'processing', text: 'Counting lines' },
              { id: '3', status: 'todo', text: 'Draft summary' },
            ],
            updatedAt: '2026-05-16T07:24:00.000Z',
          },
        },
      },
    ]),
    TaskGet: single({
      args: { taskId: '1' },
      content: 'Task #1: Read hosts\nStatus: in_progress\nDescription: Read /etc/hosts content',
    }),
    TaskList: variants([
      {
        args: {},
        content:
          '#1 [in_progress] Read hosts\n#2 [pending] Count lines\n#3 [pending] Draft summary',
        label: 'Mixed progress',
        pluginState: {
          todos: {
            items: [
              { id: '1', status: 'processing', text: 'Read hosts' },
              { id: '2', status: 'todo', text: 'Count lines' },
              { id: '3', status: 'todo', text: 'Draft summary' },
            ],
            updatedAt: '2026-05-16T07:24:30.000Z',
          },
        },
      },
      {
        args: {},
        content:
          '#1 [completed] Read hosts\n#2 [completed] Count lines\n#3 [completed] Draft summary',
        label: 'All done',
        pluginState: {
          todos: {
            items: [
              { id: '1', status: 'completed', text: 'Read hosts' },
              { id: '2', status: 'completed', text: 'Count lines' },
              { id: '3', status: 'completed', text: 'Draft summary' },
            ],
            updatedAt: '2026-05-16T07:25:00.000Z',
          },
        },
      },
    ]),
    TaskUpdate: variants([
      {
        args: { status: 'in_progress', taskId: '1' },
        content: 'Updated task #1 status',
        label: 'Mark in_progress',
        pluginState: {
          todos: {
            items: [
              { id: '1', status: 'processing', text: 'Read hosts' },
              { id: '2', status: 'todo', text: 'Count lines' },
            ],
            updatedAt: '2026-05-16T07:23:35.000Z',
          },
        },
      },
      {
        args: { status: 'completed', taskId: '1' },
        content: 'Updated task #1 status',
        label: 'Mark completed',
        pluginState: {
          todos: {
            items: [
              { id: '1', status: 'completed', text: 'Read hosts' },
              { id: '2', status: 'processing', text: 'Counting lines' },
            ],
            updatedAt: '2026-05-16T07:23:50.000Z',
          },
        },
      },
      {
        args: { status: 'deleted', taskId: '2' },
        content: 'Deleted task #2',
        label: 'Mark deleted',
        pluginState: {
          todos: {
            items: [{ id: '1', status: 'processing', text: 'Read hosts' }],
            updatedAt: '2026-05-16T07:24:10.000Z',
          },
        },
      },
    ]),
    TodoWrite: variants([
      {
        args: {
          todos: [
            {
              activeForm: 'Capture current registry coverage',
              content: 'Capture current registry coverage',
              status: 'completed',
            },
            {
              activeForm: 'Build /devtools page',
              content: 'Build /devtools page',
              status: 'in_progress',
            },
            {
              activeForm: 'Audit missing fixtures',
              content: 'Audit missing fixtures',
              status: 'pending',
            },
          ],
        },
        label: 'Mixed progress',
      },
      {
        args: {
          todos: [
            {
              activeForm: 'Plan render gallery rewrite',
              content: 'Plan render gallery rewrite',
              status: 'pending',
            },
            {
              activeForm: 'Sketch lifecycle modes',
              content: 'Sketch lifecycle modes',
              status: 'pending',
            },
          ],
        },
        label: 'All pending',
      },
      {
        args: {
          todos: [
            {
              activeForm: 'Migrate fixtures to variants',
              content: 'Migrate fixtures to variants',
              status: 'completed',
            },
            {
              activeForm: 'Verify in /devtools',
              content: 'Verify in /devtools',
              status: 'completed',
            },
            {
              activeForm: 'Push to remote',
              content: 'Push to remote',
              status: 'completed',
            },
          ],
        },
        label: 'All done',
      },
    ]),
    ToolSearch: single({
      args: { max_results: 5, query: 'select:Read,Edit,Grep' },
      content: 'Loaded 3 deferred tool schemas: Read, Edit, Grep.',
    }),
    WebFetch: single({
      args: {
        prompt: 'Summarize the key changes in the latest release.',
        url: 'https://github.com/lobehub/lobe-chat/releases/latest',
      },
      content:
        '## LobeChat v1.0\n\n- New agent runtime with tool streaming\n- Faster cold start\n- Fixed a memory leak in the chat store',
    }),
    WebSearch: single({
      args: {
        allowed_domains: ['developer.mozilla.org'],
        query: 'CSS container queries browser support',
      },
      content:
        '1. Container queries — MDN — developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment\n2. Can I use: CSS Container Queries — caniuse.com/css-container-queries',
    }),
    Write: single({
      args: {
        content: "export const previewEnabled = process.env.NODE_ENV === 'development';\n",
        file_path: 'src/routes/(main)/devtools/featureFlag.ts',
      },
    }),
    [linearIssueApiName]: single({
      args: {
        id: 'LOBE-10205',
        links: linearIssueResult.links,
        state: 'In Review',
      },
      content: JSON.stringify(linearIssueResult),
    }),
  },
});
