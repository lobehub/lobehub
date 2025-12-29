import { Lang, parse } from '@ast-grep/napi';
import path from 'node:path';

import { isDirectRun, removePathEnsuring, runStandalone, updateFile } from './utils.mjs';

export const modifyRoutes = async (TEMP_DIR: string) => {
  // 1. Delete routes
  const filesToDelete = [
    // Backend API routes
    'src/app/(backend)/api',
    'src/app/(backend)/webapi',
    'src/app/(backend)/trpc',
    'src/app/(backend)/oidc',
    'src/app/(backend)/middleware',
    'src/app/(backend)/f',
    'src/app/(backend)/market',

    // Auth & User routes
    'src/app/[variants]/(auth)',
    'src/app/[variants]/(main)/(mobile)/me',
    'src/app/[variants]/(main)/changelog',
    'src/app/[variants]/oauth',

    // Other app roots
    'src/app/market-auth-callback',
    'src/app/manifest.ts',
    'src/app/robots.tsx',
    'src/app/sitemap.tsx',
    'src/app/sw.ts',

    // Config files
    'src/instrumentation.ts',
    'src/instrumentation.node.ts',

    // Desktop specific routes
    'src/app/desktop/devtools',
    'src/app/desktop/layout.tsx',
  ];

  for (const file of filesToDelete) {
    const fullPath = path.join(TEMP_DIR, file);
    await removePathEnsuring({
      name: `modifyRoutes:delete:${file}`,
      path: fullPath,
    });
  }

  // 2. Modify desktopRouter.config.tsx
  const routerConfigPath = path.join(
    TEMP_DIR,
    'src/app/[variants]/router/desktopRouter.config.tsx',
  );
  console.log('  Processing src/app/[variants]/router/desktopRouter.config.tsx...');
  await updateFile({
    filePath: routerConfigPath,
    name: 'modifyRoutes:desktopRouterConfig',
    transformer: (code) => {
      const ast = parse(Lang.Tsx, code);
      const root = ast.root();

      const changelogNode = root.find({
        rule: {
          pattern: "{ path: 'changelog', $$$ }",
        },
      });
      if (changelogNode) {
        changelogNode.replace('');
      }

      const changelogImport = root.find({
        rule: {
          pattern: "import('../(main)/changelog')",
        },
      });
      if (changelogImport) {
        // Find the closest object (route definition) and remove it
        let curr = changelogImport.parent();
        while (curr) {
          if (curr.kind() === 'object') {
            curr.replace('');
            break;
          }
          curr = curr.parent();
        }
      }

      return root.text();
    },
    assertAfter: (code) => !/\bchangelog\b/.test(code),
  });
};

if (isDirectRun(import.meta.url)) {
  await runStandalone('modifyRoutes', modifyRoutes, [
    { lang: Lang.Tsx, path: 'src/app/[variants]/router/desktopRouter.config.tsx' },
  ]);
}
