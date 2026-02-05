import { Lang, parse } from '@ast-grep/napi';
import path from 'node:path';

import { invariant, isDirectRun, runStandalone, updateFile } from './utils.mjs';

const removeSuspenseWrapper = (code: string): string => {
  const ast = parse(Lang.Tsx, code);
  const root = ast.root();

  const suspenseElements = root.findAll({
    rule: {
      has: {
        has: {
          kind: 'identifier',
          regex: '^Suspense$',
        },
        kind: 'jsx_opening_element',
      },
      kind: 'jsx_element',
    },
  });

  if (suspenseElements.length === 0) {
    return code;
  }

  const edits: Array<{ end: number; start: number; text: string }> = [];

  for (const suspense of suspenseElements) {
    const range = suspense.range();

    const children = suspense.children();
    let childrenText = '';

    for (const child of children) {
      const kind = child.kind();
      if (
        kind === 'jsx_element' ||
        kind === 'jsx_self_closing_element' ||
        kind === 'jsx_fragment'
      ) {
        childrenText = child.text();
        break;
      }
    }

    if (childrenText) {
      edits.push({
        end: range.end.index,
        start: range.start.index,
        text: childrenText,
      });
    }
  }

  edits.sort((a, b) => b.start - a.start);

  let result = code;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }

  return result;
};

const removeUnusedImports = (code: string): string => {
  let result = code;

  if (!result.includes('<Suspense')) {
    result = result.replaceAll(/,?\s*Suspense\s*,?/g, (match) => {
      if (match.startsWith(',') && match.endsWith(',')) {
        return ',';
      }
      return '';
    });

    result = result.replaceAll(/{\s*,/g, '{');
    result = result.replaceAll(/,\s*}/g, '}');
    result = result.replaceAll(/{\s*}/g, '');
    result = result.replaceAll(/import\s+{\s*}\s+from\s+["'][^"']+["'];\n?/g, '');
  }

  if (!result.includes('<Loading') && !result.includes('Loading />')) {
    result = result.replaceAll(
      /import Loading from ["']@\/components\/Loading\/BrandTextLoading["'];\n?/g,
      '',
    );
  }

  result = result.replaceAll(/\n{3,}/g, '\n\n');

  return result;
};

export const removeSuspenseFromConversation = async (TEMP_DIR: string) => {
  const filePath = path.join(
    TEMP_DIR,
    'src/app/[variants]/(main)/agent/features/Conversation/index.tsx',
  );

  console.log('  Removing Suspense from Conversation/index.tsx...');

  await updateFile({
    assertAfter: (code) => {
      const noSuspenseElement = !/<Suspense/.test(code);
      return noSuspenseElement;
    },
    filePath,
    name: 'removeSuspenseFromConversation',
    transformer: (code) => {
      invariant(
        /<Suspense/.test(code),
        '[removeSuspenseFromConversation] No Suspense element found in Conversation/index.tsx',
      );

      let result = removeSuspenseWrapper(code);
      result = removeUnusedImports(result);

      return result;
    },
  });
};

if (isDirectRun(import.meta.url)) {
  await runStandalone('removeSuspenseFromConversation', removeSuspenseFromConversation, [
    { lang: Lang.Tsx, path: 'src/app/[variants]/(main)/agent/features/Conversation/index.tsx' },
  ]);
}
