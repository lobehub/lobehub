'use client';

import { ClaudeCodeIdentifier } from '@lobechat/builtin-tool-claude-code/client';

import { defineFixtures, single, variants } from './_helpers';

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
      description: 'Read output from a background task.',
      name: 'TaskOutput',
    },
    {
      description: 'Stop a background task.',
      name: 'TaskStop',
    },
    {
      description: 'Track todo progress.',
      name: 'TodoWrite',
    },
    {
      description: 'Look up deferred tools by name or keyword.',
      name: 'ToolSearch',
    },
    {
      description: 'Write a new file.',
      name: 'Write',
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
    Write: single({
      args: {
        content: "export const previewEnabled = process.env.NODE_ENV === 'development';\n",
        file_path: 'src/routes/(main)/devtools/featureFlag.ts',
      },
    }),
  },
});
