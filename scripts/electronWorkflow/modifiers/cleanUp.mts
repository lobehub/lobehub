import { Lang, parse } from '@ast-grep/napi';
import path from 'node:path';

import { isDirectRun, runStandalone, updateFile } from './utils.mjs';

const hasUseServerDirective = (code: string) =>
  /^\s*['"]use server['"]\s*;?/m.test(code.trimStart());

export const cleanUpCode = async (TEMP_DIR: string) => {
  // Remove 'use server'
  const filesToRemoveUseServer = [
    'src/features/DevPanel/CacheViewer/getCacheEntries.ts',
    'src/server/translation.ts',
  ];

  for (const file of filesToRemoveUseServer) {
    const filePath = path.join(TEMP_DIR, file);
    console.log(`  Processing ${file}...`);
    await updateFile({
      filePath,
      name: `cleanUpCode:removeUseServer:${file}`,
      transformer: (code) => {
        // Prefer a deterministic text rewrite for directive prologue:
        // remove ONLY the top-level `'use server';` directive if present.
        const next = code.replace(/^\s*['"]use server['"]\s*;\s*\r?\n?/, '');
        if (next !== code) return next;

        // Fallback to AST rewrite (in case of odd formatting)
        const ast = parse(Lang.TypeScript, code);
        const root = ast.root();

        const useServer =
          root.find({
            rule: { pattern: "'use server'" },
          }) ||
          root.find({
            rule: { pattern: '"use server"' },
          });

        if (!useServer) return code;

        let curr = useServer.parent();
        while (curr) {
          if (curr.kind() === 'expression_statement') {
            curr.replace('');
            break;
          }
          if (curr.kind() === 'program') break;
          curr = curr.parent();
        }

        return root.text();
      },
      assertAfter: (code) => !hasUseServerDirective(code),
    });
  }
};

if (isDirectRun(import.meta.url)) {
  await runStandalone('cleanUpCode', cleanUpCode, [
    { lang: Lang.Tsx, path: 'src/components/mdx/Image.tsx' },
    { lang: Lang.TypeScript, path: 'src/features/DevPanel/CacheViewer/getCacheEntries.ts' },
    { lang: Lang.TypeScript, path: 'src/server/translation.ts' },
  ]);
}
