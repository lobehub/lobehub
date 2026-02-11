/* eslint-disable no-undef */
import { Lang, parse } from '@ast-grep/napi';
import path from 'node:path';

import { invariant, isDirectRun, runStandalone, updateFile } from './utils.mjs';

interface DynamicImportInfo {
  componentName: string;
  end: number;
  importPath: string;
  key: string;
  start: number;
}

const extractDynamicImportsFromMap = (code: string): DynamicImportInfo[] => {
  const results: DynamicImportInfo[] = [];

  const regex =
    /\[SettingsTabs\.(\w+)]:\s*dynamic\(\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)/g;

  let match;
  while ((match = regex.exec(code)) !== null) {
    const key = match[1];
    const importPath = match[2];

    const componentName = key.charAt(0).toUpperCase() + key.slice(1) + 'Tab';

    results.push({
      componentName,
      end: 0,
      importPath,
      key,
      start: 0,
    });
  }

  return results;
};

const generateStaticImports = (imports: DynamicImportInfo[]): string => {
  return imports.map((imp) => `import ${imp.componentName} from '${imp.importPath}';`).join('\n');
};

const generateStaticComponentMap = (imports: DynamicImportInfo[]): string => {
  const entries = imports.map((imp) => `  [SettingsTabs.${imp.key}]: ${imp.componentName},`);

  return `const componentMap: Record<string, React.ComponentType<{ mobile?: boolean }>> = {\n${entries.join('\n')}\n}`;
};

export const convertSettingsContentToStatic = async (TEMP_DIR: string) => {
  const filePath = path.join(
    TEMP_DIR,
    'src/app/[variants]/(main)/settings/features/SettingsContent.tsx',
  );

  console.log('  Processing SettingsContent.tsx dynamic imports...');

  await updateFile({
    assertAfter: (code) => {
      const noDynamic = !/dynamic\(\s*\(\)\s*=>\s*import/.test(code);
      const hasStaticMap = /componentMap:\s*Record<string,/.test(code);
      return noDynamic && hasStaticMap;
    },
    filePath,
    name: 'convertSettingsContentToStatic',
    transformer: (code) => {
      const imports = extractDynamicImportsFromMap(code);

      invariant(
        imports.length > 0,
        '[convertSettingsContentToStatic] No dynamic imports found in SettingsContent.tsx',
      );

      console.log(`    Found ${imports.length} dynamic imports in componentMap`);

      const staticImports = generateStaticImports(imports);
      const staticComponentMap = generateStaticComponentMap(imports);

      let result = code;

      result = result.replace(/import dynamic from ["']@\/libs\/next\/dynamic["'];\n?/, '');

      result = result.replace(
        /import Loading from ["']@\/components\/Loading\/BrandTextLoading["'];\n?/,
        '',
      );

      const ast = parse(Lang.Tsx, result);
      const root = ast.root();

      const lastImport = root
        .findAll({
          rule: {
            kind: 'import_statement',
          },
        })
        .at(-1);

      invariant(
        lastImport,
        '[convertSettingsContentToStatic] No import statements found in SettingsContent.tsx',
      );

      const insertPos = lastImport!.range().end.index;
      result =
        result.slice(0, insertPos) +
        "\nimport type React from 'react';\n" +
        staticImports +
        result.slice(insertPos);

      const componentMapRegex = /const componentMap = {[\S\s]*?\n};/;
      invariant(
        componentMapRegex.test(result),
        '[convertSettingsContentToStatic] componentMap declaration not found in SettingsContent.tsx',
      );

      result = result.replace(componentMapRegex, staticComponentMap + ';');

      result = result.replaceAll(/\n{3,}/g, '\n\n');

      return result;
    },
  });
};

if (isDirectRun(import.meta.url)) {
  await runStandalone('convertSettingsContentToStatic', convertSettingsContentToStatic, [
    { lang: Lang.Tsx, path: 'src/app/[variants]/(main)/settings/features/SettingsContent.tsx' },
  ]);
}
