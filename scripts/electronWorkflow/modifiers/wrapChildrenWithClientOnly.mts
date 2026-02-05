import { Lang, parse } from '@ast-grep/napi';
import path from 'node:path';

import { invariant, isDirectRun, runStandalone, updateFile } from './utils.mjs';

export const wrapChildrenWithClientOnly = async (TEMP_DIR: string) => {
  const layoutPath = path.join(TEMP_DIR, 'src/app/[variants]/layout.tsx');

  console.log('  Wrapping children with ClientOnly in layout.tsx...');

  await updateFile({
    assertAfter: (code) => {
      const hasClientOnlyImport =
        /import ClientOnly from ["']@\/components\/client\/ClientOnly["']/.test(code);
      const hasLoadingImport =
        /import Loading from ["']@\/components\/Loading\/BrandTextLoading["']/.test(code);
      const hasClientOnlyWrapper = /<ClientOnly fallback={<Loading/.test(code);
      return hasClientOnlyImport && hasLoadingImport && hasClientOnlyWrapper;
    },
    filePath: layoutPath,
    name: 'wrapChildrenWithClientOnly',
    transformer: (code) => {
      const ast = parse(Lang.Tsx, code);
      const root = ast.root();

      let result = code;

      const hasClientOnlyImport =
        /import ClientOnly from ["']@\/components\/client\/ClientOnly["']/.test(code);
      const hasLoadingImport =
        /import Loading from ["']@\/components\/Loading\/BrandTextLoading["']/.test(code);

      const lastImport = root
        .findAll({
          rule: {
            kind: 'import_statement',
          },
        })
        .at(-1);

      invariant(
        lastImport,
        '[wrapChildrenWithClientOnly] No import statements found in layout.tsx',
      );

      const insertPos = lastImport!.range().end.index;
      let importsToAdd = '';

      if (!hasClientOnlyImport) {
        importsToAdd += "\nimport ClientOnly from '@/components/client/ClientOnly';";
      }
      if (!hasLoadingImport) {
        importsToAdd += "\nimport Loading from '@/components/Loading/BrandTextLoading';";
      }

      if (importsToAdd) {
        result = result.slice(0, insertPos) + importsToAdd + result.slice(insertPos);
      }

      const authProviderPattern = /<AuthProvider>\s*{children}\s*<\/AuthProvider>/;
      invariant(
        authProviderPattern.test(result),
        '[wrapChildrenWithClientOnly] Pattern <AuthProvider>{children}</AuthProvider> not found in layout.tsx',
      );

      result = result.replace(
        authProviderPattern,
        `<AuthProvider>
          <ClientOnly fallback={<Loading />}>{children}</ClientOnly>
        </AuthProvider>`,
      );

      return result;
    },
  });
};

if (isDirectRun(import.meta.url)) {
  await runStandalone('wrapChildrenWithClientOnly', wrapChildrenWithClientOnly, [
    { lang: Lang.Tsx, path: 'src/app/[variants]/layout.tsx' },
  ]);
}
