import { Lang, parse } from '@ast-grep/napi';
import fs from 'fs-extra';
import path from 'node:path';

import { invariant, isDirectRun, runStandalone, updateFile } from './utils.mjs';

interface Edit {
  end: number;
  start: number;
  text: string;
}

export const modifyNextConfig = async (TEMP_DIR: string) => {
  const defineConfigPath = path.join(TEMP_DIR, 'src', 'libs', 'next', 'config', 'define-config.ts');
  const legacyNextConfigPath = path.join(TEMP_DIR, 'next.config.ts');

  const nextConfigPath = fs.existsSync(defineConfigPath) ? defineConfigPath : legacyNextConfigPath;
  if (!fs.existsSync(nextConfigPath)) {
    throw new Error(`[modifyNextConfig] next config not found: ${nextConfigPath}`);
  }

  console.log(`  Processing ${path.relative(TEMP_DIR, nextConfigPath)}...`);
  await updateFile({
    assertAfter: (code) => /output\s*:\s*["']export["']/.test(code) && !/withPWA\s*\(/.test(code),
    filePath: nextConfigPath,
    name: 'modifyNextConfig',
    transformer: (code) => {
      const ast = parse(Lang.TypeScript, code);
      const root = ast.root();
      const edits: Edit[] = [];

      // Find nextConfig declaration
      const nextConfigDecl = root.find({
        rule: {
          pattern: 'const nextConfig: NextConfig = { $$$ }',
        },
      });
      if (!nextConfigDecl) {
        throw new Error('[modifyNextConfig] nextConfig declaration not found');
      }

      // 1. Remove redirects
      const redirectsPair = nextConfigDecl.find({
        rule: {
          pattern: 'redirects: $A',
        },
      });
      if (redirectsPair) {
        const range = redirectsPair.range();
        edits.push({ end: range.end.index, start: range.start.index, text: '' });
      }

      // 2. Remove headers
      const headersMethod = nextConfigDecl
        .findAll({
          rule: {
            kind: 'method_definition',
          },
        })
        .find((node) => {
          const text = node.text();
          return text.startsWith('async headers') || text.startsWith('headers');
        });
      if (headersMethod) {
        const range = headersMethod.range();
        edits.push({ end: range.end.index, start: range.start.index, text: '' });
      }

      // 3. Remove spread element
      const spreads = nextConfigDecl.findAll({
        rule: {
          kind: 'spread_element',
        },
      });

      const isObjectLevelSpread = (node: any) => node.parent()?.kind() === 'object';

      const standaloneSpread = spreads.find((node) => {
        if (!isObjectLevelSpread(node)) return false;
        const text = node.text();
        return text.includes('isStandaloneMode') && text.includes('standaloneConfig');
      });

      const objectLevelSpread = standaloneSpread ? null : spreads.find(isObjectLevelSpread);

      const spreadToRemove = standaloneSpread || objectLevelSpread;
      if (spreadToRemove) {
        const range = spreadToRemove.range();
        edits.push({ end: range.end.index, start: range.start.index, text: '' });
      }

      // 4. Inject/force output: 'export'
      const outputPair = nextConfigDecl.find({
        rule: {
          pattern: 'output: $A',
        },
      });
      if (outputPair) {
        const range = outputPair.range();
        edits.push({ end: range.end.index, start: range.start.index, text: "output: 'export'" });
      } else {
        const objectNode = nextConfigDecl.find({
          rule: { kind: 'object' },
        });
        if (!objectNode) {
          throw new Error('[modifyNextConfig] nextConfig object not found');
        }
        {
          const range = objectNode.range();
          // Insert after the opening brace `{
          edits.push({
            end: range.start.index + 1,
            start: range.start.index + 1,
            text: "\n  output: 'export',",
          });
        }
      }

      // Remove withPWA wrapper
      const withPWA = root.find({
        rule: {
          pattern: 'withPWA($A)',
        },
      });
      if (withPWA) {
        const inner = withPWA.getMatch('A');
        if (!inner) {
          throw new Error('[modifyNextConfig] withPWA inner config not found');
        }
        {
          const range = withPWA.range();
          edits.push({ end: range.end.index, start: range.start.index, text: inner.text() });
        }
      }

      // Apply edits
      edits.sort((a, b) => b.start - a.start);
      let newCode = code;
      for (const edit of edits) {
        newCode = newCode.slice(0, edit.start) + edit.text + newCode.slice(edit.end);
      }

      // Cleanup commas (syntax fix)
      // 1. Double commas ,, -> , (handle spaces/newlines between)
      newCode = newCode.replaceAll(/,(\s*,)+/g, ',');
      // 2. Leading comma in object { , -> {
      newCode = newCode.replaceAll(/{\s*,/g, '{');

      return newCode;
    },
  });
};

if (isDirectRun(import.meta.url)) {
  await runStandalone('modifyNextConfig', modifyNextConfig, [
    { lang: Lang.TypeScript, path: 'src/libs/next/config/define-config.ts' },
    { lang: Lang.TypeScript, path: 'next.config.ts' },
  ]);
}
