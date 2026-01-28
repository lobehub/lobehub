/* eslint-disable no-undef */
import { Lang, parse } from '@ast-grep/napi';
import path from 'node:path';

import { invariant, isDirectRun, runStandalone, updateFile } from './utils.mjs';

interface ImportInfo {
  defaultImport?: string;
  namedImports: string[];
}

interface DynamicElementInfo {
  componentName: string;
  end: number;
  importPath: string;
  isNamedExport: boolean;
  namedExport?: string;
  start: number;
}

const toPascalCase = (str: string): string => {
  return str
    .split(/[_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
};

const generateComponentName = (
  importPath: string,
  namedExport?: string,
  existingNames: Set<string> = new Set(),
): string => {
  if (namedExport) {
    let name = namedExport;
    let counter = 1;
    while (existingNames.has(name)) {
      name = `${namedExport}${counter++}`;
    }
    return name;
  }

  const segments = importPath
    .split('/')
    .filter((s) => s && !s.startsWith('.'))
    .map((s) => s.replace(/^\((.+)\)$/, '$1').replace(/^\[(.+)]$/, '$1'));

  const meaningfulSegments = segments.slice(-3).filter(Boolean);

  let baseName =
    meaningfulSegments.length > 0
      ? meaningfulSegments.map((s) => toPascalCase(s)).join('') + 'Page'
      : 'Page';

  let name = baseName;
  let counter = 1;
  while (existingNames.has(name)) {
    name = `${baseName}${counter++}`;
  }

  return name;
};

const extractDynamicElements = (code: string): DynamicElementInfo[] => {
  const ast = parse(Lang.Tsx, code);
  const root = ast.root();

  const results: DynamicElementInfo[] = [];
  const existingNames = new Set<string>();

  const dynamicCalls = root.findAll({
    rule: {
      pattern: 'dynamicElement($IMPORT_FN, $DEBUG_ID)',
    },
  });

  for (const call of dynamicCalls) {
    const range = call.range();
    const text = call.text();

    const importMatch = text.match(/import\s*\(\s*["']([^"']+)["']\s*\)/);
    invariant(
      importMatch,
      `[convertDynamicToStatic] Failed to extract import path from dynamicElement call: ${text.slice(0, 100)}`,
    );

    const importPath = importMatch![1];

    const thenMatch = text.match(/\.then\s*\(\s*\(\s*(\w+)\s*\)\s*=>\s*\1\.(\w+)\s*\)/);
    const namedExport = thenMatch ? thenMatch[2] : undefined;

    const componentName = generateComponentName(importPath, namedExport, existingNames);
    existingNames.add(componentName);

    results.push({
      componentName,
      end: range.end.index,
      importPath,
      isNamedExport: !!namedExport,
      namedExport,
      start: range.start.index,
    });
  }

  return results;
};

const buildImportMap = (elements: DynamicElementInfo[]): Map<string, ImportInfo> => {
  const importMap = new Map<string, ImportInfo>();

  for (const el of elements) {
    const existing = importMap.get(el.importPath) || { namedImports: [] };

    if (el.isNamedExport && el.namedExport) {
      if (!existing.namedImports.includes(el.namedExport)) {
        existing.namedImports.push(el.namedExport);
      }
    } else {
      existing.defaultImport = el.componentName;
    }

    importMap.set(el.importPath, existing);
  }

  return importMap;
};

const generateImportStatements = (importMap: Map<string, ImportInfo>): string => {
  const statements: string[] = [];

  const sortedPaths = [...importMap.keys()].sort();

  for (const importPath of sortedPaths) {
    const info = importMap.get(importPath)!;
    const parts: string[] = [];

    if (info.defaultImport) {
      parts.push(info.defaultImport);
    }

    if (info.namedImports.length > 0) {
      parts.push(`{ ${info.namedImports.join(', ')} }`);
    }

    if (parts.length > 0) {
      statements.push(`import ${parts.join(', ')} from '${importPath}';`);
    }
  }

  return statements.join('\n');
};

const findImportInsertPosition = (code: string): number => {
  const ast = parse(Lang.Tsx, code);
  const root = ast.root();

  const imports = root.findAll({
    rule: {
      kind: 'import_statement',
    },
  });

  invariant(imports.length > 0, '[convertDynamicToStatic] No import statements found in file');

  const lastImport = imports.at(-1)!;
  return lastImport.range().end.index;
};

const removeDynamicElementImport = (code: string): string => {
  const ast = parse(Lang.Tsx, code);
  const root = ast.root();

  const utilsRouterImport = root.find({
    rule: {
      kind: 'import_statement',
      pattern: "import { $$$IMPORTS } from '@/utils/router'",
    },
  });

  if (!utilsRouterImport) {
    return code;
  }

  const importText = utilsRouterImport.text();

  if (!importText.includes('dynamicElement')) {
    return code;
  }

  const importSpecifiers = utilsRouterImport.findAll({
    rule: {
      kind: 'import_specifier',
    },
  });

  const specifiersToKeep = importSpecifiers
    .map((spec) => spec.text())
    .filter((text) => !text.includes('dynamicElement'));

  if (specifiersToKeep.length === 0) {
    const range = utilsRouterImport.range();
    let endIndex = range.end.index;
    if (code[endIndex] === '\n') {
      endIndex++;
    }
    return code.slice(0, range.start.index) + code.slice(endIndex);
  }

  const newImport = `import { ${specifiersToKeep.join(', ')} } from '@/utils/router';`;
  const range = utilsRouterImport.range();
  return code.slice(0, range.start.index) + newImport + code.slice(range.end.index);
};

export const convertDynamicToStatic = async (TEMP_DIR: string) => {
  const routerConfigPath = path.join(
    TEMP_DIR,
    'src/app/[variants]/router/desktopRouter.config.tsx',
  );

  console.log('  Processing dynamicElement → static imports...');

  await updateFile({
    assertAfter: (code) => {
      const noDynamicElement = !/dynamicElement\s*\(/.test(code);
      const hasStaticImports = /^import .+ from ["']\.\.\/\(main\)/m.test(code);
      return noDynamicElement && hasStaticImports;
    },
    filePath: routerConfigPath,
    name: 'convertDynamicToStatic',
    transformer: (code) => {
      const elements = extractDynamicElements(code);

      invariant(
        elements.length > 0,
        '[convertDynamicToStatic] No dynamicElement calls found in desktopRouter.config.tsx',
      );

      console.log(`    Found ${elements.length} dynamicElement calls`);

      const importMap = buildImportMap(elements);
      const importStatements = generateImportStatements(importMap);

      const edits: Array<{ end: number; start: number; text: string }> = [];

      for (const el of elements) {
        edits.push({
          end: el.end,
          start: el.start,
          text: `<${el.componentName} />`,
        });
      }

      edits.sort((a, b) => b.start - a.start);

      let result = code;
      for (const edit of edits) {
        result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
      }

      const insertPos = findImportInsertPosition(result);
      result = result.slice(0, insertPos) + '\n' + importStatements + result.slice(insertPos);

      result = removeDynamicElementImport(result);

      return result;
    },
  });
};

if (isDirectRun(import.meta.url)) {
  await runStandalone('convertDynamicToStatic', convertDynamicToStatic, [
    { lang: Lang.Tsx, path: 'src/app/[variants]/router/desktopRouter.config.tsx' },
  ]);
}
