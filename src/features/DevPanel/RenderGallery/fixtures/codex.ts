'use client';

import { defineFixtures, single } from './_helpers';

export default defineFixtures({
  identifier: 'codex',
  meta: {
    description: 'Codex-specific render previews and shared command cards.',
    title: 'Codex',
  },
  apiList: [
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
        linesAdded: 113,
        linesDeleted: 0,
      },
    }),
    mcp_tool_call: single({
      args: {
        arguments: {
          code: "const result = await import('./package.json', { with: { type: 'json' } });\nresult.default.name;",
        },
        server: 'node_repl',
        tool: 'js',
      },
      content: '@lobehub/desktop',
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
    }),
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
