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
      description: 'Preview Codex todo list rendering.',
      name: 'todo_list',
    },
  ],
  fixtures: {
    command_execution: single({
      args: { command: 'bun run type-check' },
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
  },
});
