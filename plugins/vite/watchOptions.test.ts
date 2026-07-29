import { describe, expect, it } from 'vitest';

import { createViteWatchOptions } from './watchOptions';

describe('viteWatchOptions', () => {
  const { ignored: isIgnored } = createViteWatchOptions([
    '/repo',
    '/repo/lobehub',
    String.raw`C:\repo`,
    String.raw`C:\repo\lobehub`,
  ]);

  it.each([
    '/repo/.agents/skills/example/SKILL.md',
    '/repo/lobehub/.cursor/rules/example.mdc',
    '/repo/.next/server/app.js',
    '/repo/lobehub/.turbo/cache/entry',
    '/repo/doc/guide.md',
    '/repo/docs/guide.md',
    '/repo/lobehub/src/features/Chat/__tests__/index.test.ts',
    '/repo/devtools/inspector.ts',
    '/repo/lobehub/scripts/build.mts',
    '/repo/lobehub/apps/cli/src/index.ts',
    '/repo/lobehub/apps/desktop/src/main.ts',
    '/repo/src/app/layout.tsx',
    '/repo/lobehub/src/server/service.ts',
    '/repo/packages/database/src/index.ts',
    String.raw`C:\repo\lobehub\packages\database\src\index.ts`,
    '/repo/.env.local',
    '/repo/src/features/Chat/index.spec.tsx',
  ])('ignores paths outside the SPA runtime: %s', (filePath) => {
    expect(isIgnored(filePath)).toBe(true);
  });

  it.each([
    '/repo/src/features/Chat/index.tsx',
    '/repo/lobehub/src/routes/(main)/chat/index.tsx',
    '/repo/packages/types/src/index.ts',
    '/repo/lobehub/packages/locales/src/default/common.ts',
    '/repo/locales/en-US/common.json',
    '/repo/public/logo.svg',
    '/repo/lobehub/public/logo.svg',
    '/repo/apps',
    '/repo/apps/server/src/utils/workspacePermissions.ts',
    '/repo/apps/web/src/index.ts',
    '/repo/lobehub/src/routes/(main)/agent/docs/index.tsx',
    '/repo/lobehub/packages/model-runtime/docs/test-coverage.md',
    '/repo/packages/database-client/src/index.ts',
    '/repo/packages/example/src/app/index.ts',
    '/repo/lobehub/packages/example/src/server/index.ts',
    '/repo/src/application/index.ts',
    '/other/repo/docs/guide.md',
  ])('keeps SPA runtime paths watched: %s', (filePath) => {
    expect(isIgnored(filePath)).toBe(false);
  });
});
