'use client';

import { defineFixtures, single, variants } from './_helpers';

const addedFileDiff = `diff --git a/src/routes/(main)/devtools/index.tsx b/src/routes/(main)/devtools/index.tsx
--- /dev/null
+++ b/src/routes/(main)/devtools/index.tsx
@@ -0,0 +1,4 @@
+import DevtoolsPanel from '@/features/DevPanel';
+
+export default DevtoolsPanel;
`;

const modifiedRegistryDiff = `diff --git a/packages/builtin-tools/src/renders.ts b/packages/builtin-tools/src/renders.ts
--- a/packages/builtin-tools/src/renders.ts
+++ b/packages/builtin-tools/src/renders.ts
@@ -12,6 +12,7 @@
 export const builtinRenders = {
   codex: CodexRenders,
+  devtools: DevtoolsRenders,
 };
`;

const linearIssueResult = {
  description:
    '## 背景\n\n当前客户端侧有三种 agent runtime 路径，它们都在处理同一类 agent run 生命周期，但生命周期控制点不一致。\n\n## 目标\n\n建立一套共享的 post-complete hooks，让 queue message、topic title、Agent Signal、unread completion 和 notification 都通过同一入口收敛。',
  id: 'TEST-0000',
  links: [
    {
      title: 'PR #15766: refactor(chat): unify agent run lifecycle',
      url: 'https://github.com/lobehub/lobehub/pull/15766',
    },
  ],
  state: { name: 'In Review' },
  title: '统一三种客户端 Agent Runtime 的 run 生命周期 hooks',
  url: 'https://linear.app/lobehub/issue/TEST-0000',
};

const githubPullRequestResult = {
  base: 'canary',
  body: [
    '#### Description of Change',
    '',
    '- Add a GitHub MCP render for Codex Apps tool calls.',
    '- Replace the raw JSON block with a PR summary card.',
    '',
    '#### How to Test',
    '',
    '- Open the Codex render gallery.',
    '- Check the GitHub create pull request fixture.',
  ].join('\n'),
  draft: false,
  head: 'fix/codex-github-render',
  mergeable: true,
  merged: false,
  number: 16430,
  repository_full_name: 'lobehub/lobehub',
  state: 'open',
  title: 'Render Codex GitHub MCP tool calls',
  updated_at: '2026-06-29T08:20:00Z',
  url: 'https://github.com/lobehub/lobehub/pull/16430',
};

export default defineFixtures({
  identifier: 'codex',
  meta: {
    description: 'Codex-specific render previews and shared command cards.',
    title: 'Codex',
  },
  apiList: [
    {
      description: 'Show a warning emitted by the Codex runtime.',
      name: 'error',
    },
    {
      description: 'Run a shell command in Codex.',
      name: 'command_execution',
    },
    {
      description: 'Preview Codex file change summaries.',
      name: 'file_change',
    },
    {
      description: 'Preview Codex MCP tool rendering.',
      name: 'mcp_tool_call',
    },
    {
      description: 'Preview Codex todo list rendering.',
      name: 'todo_list',
    },
    {
      description: 'Preview Codex web search rendering.',
      name: 'web_search',
    },
  ],
  fixtures: {
    error: single({
      args: {
        id: 'item_0',
        message:
          'This session was recorded with model `gpt-5.5` but is resuming with `gpt-5.6-sol`. Consider switching back to the original model.',
        type: 'error',
      },
      content: 'Completed error.',
    }),
    command_execution: single({
      args: { command: "/bin/zsh -lc 'bun run type-check'" },
      content: 'Checked 1247 files in 2.3s\nNo type errors found.',
      pluginState: {
        exitCode: 0,
        isBackground: false,
        output: 'Checked 1247 files in 2.3s\nNo type errors found.',
        stdout: 'Checked 1247 files in 2.3s\nNo type errors found.',
        success: true,
      },
    }),
    file_change: single({
      args: {
        changes: [
          {
            diffText: addedFileDiff,
            kind: 'add',
            linesAdded: 62,
            linesDeleted: 0,
            path: 'src/routes/(main)/devtools/index.tsx',
          },
          {
            diffText: modifiedRegistryDiff,
            kind: 'modify',
            linesAdded: 23,
            linesDeleted: 0,
            path: 'packages/builtin-tools/src/renders.ts',
          },
          {
            kind: 'rename',
            linesAdded: 28,
            linesDeleted: 0,
            path: 'tmp/devtools-preview-old.tsx',
          },
        ],
      },
      content: 'File changes applied (1 added, 1 modified, 1 renamed).',
      pluginState: {
        changes: [
          {
            kind: 'add',
            linesAdded: 62,
            linesDeleted: 0,
            path: 'src/routes/(main)/devtools/index.tsx',
          },
          {
            kind: 'modify',
            linesAdded: 23,
            linesDeleted: 0,
            path: 'packages/builtin-tools/src/renders.ts',
          },
          {
            kind: 'rename',
            linesAdded: 28,
            linesDeleted: 0,
            path: 'tmp/devtools-preview-old.tsx',
          },
        ],
        diffText: `${addedFileDiff}\n${modifiedRegistryDiff}`,
        linesAdded: 113,
        linesDeleted: 0,
      },
    }),
    mcp_tool_call: variants([
      {
        args: {
          arguments: {
            code: "const result = await import('./package.json', { with: { type: 'json' } });\nresult.default.name;",
          },
          server: 'node_repl',
          tool: 'js',
        },
        content: '@lobehub/desktop',
        label: 'Node REPL',
        pluginState: {
          arguments: {
            code: "const result = await import('./package.json', { with: { type: 'json' } });\nresult.default.name;",
          },
          result: {
            content: [{ text: '@lobehub/desktop', type: 'text' }],
            isError: false,
          },
          server: 'node_repl',
          status: 'completed',
          tool: 'js',
        },
      },
      {
        args: {
          arguments: {
            id: 'TEST-0000',
            links: linearIssueResult.links,
            state: 'In Review',
          },
          server: 'mcp__codex_apps__linear',
          tool: 'linear_save_issue',
        },
        content: JSON.stringify(linearIssueResult),
        label: 'Linear update issue',
        pluginState: {
          arguments: {
            id: 'TEST-0000',
            links: linearIssueResult.links,
            state: 'In Review',
          },
          result: {
            content: [{ text: JSON.stringify(linearIssueResult), type: 'text' }],
            isError: false,
          },
          server: 'mcp__codex_apps__linear',
          status: 'completed',
          tool: 'linear_save_issue',
        },
      },
      {
        args: {
          arguments: {
            base: 'canary',
            head: 'fix/codex-github-render',
            repository_full_name: 'lobehub/lobehub',
            title: 'Render Codex GitHub MCP tool calls',
          },
          server: 'mcp__codex_apps__github',
          tool: 'github_create_pull_request',
        },
        content: JSON.stringify(githubPullRequestResult),
        label: 'GitHub create pull request',
        pluginState: {
          arguments: {
            base: 'canary',
            head: 'fix/codex-github-render',
            repository_full_name: 'lobehub/lobehub',
            title: 'Render Codex GitHub MCP tool calls',
          },
          result: {
            content: [{ text: JSON.stringify(githubPullRequestResult), type: 'text' }],
            isError: false,
          },
          server: 'mcp__codex_apps__github',
          status: 'completed',
          tool: 'github_create_pull_request',
        },
      },
    ]),
    todo_list: single({
      args: {
        items: [
          { completed: true, text: 'Wire up the render registry export' },
          { completed: false, text: 'Build a devtools preview page' },
          { completed: false, text: 'Verify every tool render fixture' },
        ],
      },
      content: 'Todo list updated (1/3 completed).',
    }),
    web_search: single({
      args: {
        query: 'Codex tool render examples',
        results: [
          {
            snippet: 'A compact preview of Codex builtin tool output in the chat timeline.',
            title: 'Codex tool render examples',
            url: 'https://example.com/codex-render',
          },
          {
            snippet: 'How LobeHub maps builtin tool inspectors, renders, and display controls.',
            title: 'LobeHub builtin tool render registry',
            url: 'https://example.com/lobehub-tools',
          },
        ],
      },
      content:
        'Search results\n\n1. Codex tool render examples - https://example.com/codex-render\n2. LobeHub builtin tool render registry - https://example.com/lobehub-tools',
    }),
  },
});
