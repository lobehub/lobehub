'use client';

import { defineFixtures, single } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-skills',
  fixtures: {
    activateSkill: single({
      content: 'Use a fixture-backed route to preview all builtin tool cards locally.',
      pluginState: {
        description: 'Reusable workflow for internal preview harnesses.',
        name: 'Preview Builder',
      },
    }),
    execScript: single({
      args: { command: 'pnpm lint src/routes/(main)/devtools' },
      content: 'No lint issues found.',
      pluginState: {
        command: 'pnpm lint src/routes/(main)/devtools',
      },
    }),
    readReference: single({
      content:
        'export const listBuiltinRenderEntries = () => [{ identifier: "codex", apiName: "todo_list" }];\n',
      pluginState: {
        encoding: 'utf-8',
        fullPath: '/workspace/packages/builtin-tools/src/renders.ts',
        path: 'packages/builtin-tools/src/renders.ts',
        size: 2048,
      },
    }),
    runCommand: single({
      args: { command: 'bunx vitest run src/spa/router/desktopRouter.sync.test.tsx' },
      content: '1 passed',
      pluginState: {
        exitCode: 0,
        isBackground: false,
        output: '1 passed',
        stdout: '1 passed',
        success: true,
      },
    }),
  },
});
