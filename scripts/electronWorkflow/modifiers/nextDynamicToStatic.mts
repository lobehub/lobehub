/* eslint-disable no-undef */
import { Lang, parse } from '@ast-grep/napi';
import { glob } from 'glob';
import fs from 'fs-extra';
import path from 'node:path';

import { invariant, isDirectRun, runStandalone } from './utils.mjs';

interface DynamicImportInfo {
  componentName: string;
  end: number;
  importPath: string;
  start: number;
}

const extractDynamicImports = (code: string): DynamicImportInfo[] => {
  const ast = parse(Lang.Tsx, code);
  const root = ast.root();

  const results: DynamicImportInfo[] = [];

  const dynamicCalls = root.findAll({
    rule: {
      pattern: 'const $NAME = dynamic(() => import($PATH))',
    },
  });

  for (const call of dynamicCalls) {
    const range = call.range();
    const text = call.text();

    const nameMatch = text.match(/const\s+(\w+)\s*=/);
    invariant(
      nameMatch,
      `[convertNextDynamicToStatic] Failed to extract component name from dynamic call: ${text.slice(0, 100)}`,
    );

    const importMatch = text.match(/import\s*\(\s*["']([^"']+)["']\s*\)/);
    invariant(
      importMatch,
      `[convertNextDynamicToStatic] Failed to extract import path from dynamic call: ${text.slice(0, 100)}`,
    );

    results.push({
      componentName: nameMatch![1],
      end: range.end.index,
      importPath: importMatch![1],
      start: range.start.index,
    });
  }

  const dynamicCallsWithOptions = root.findAll({
    rule: {
      pattern: 'const $NAME = dynamic(() => import($PATH), $OPTIONS)',
    },
  });

  for (const call of dynamicCallsWithOptions) {
    const range = call.range();
    const text = call.text();

    const nameMatch = text.match(/const\s+(\w+)\s*=/);
    invariant(
      nameMatch,
      `[convertNextDynamicToStatic] Failed to extract component name from dynamic call: ${text.slice(0, 100)}`,
    );

    const importMatch = text.match(/import\s*\(\s*["']([^"']+)["']\s*\)/);
    invariant(
      importMatch,
      `[convertNextDynamicToStatic] Failed to extract import path from dynamic call: ${text.slice(0, 100)}`,
    );

    const alreadyExists = results.some(
      (r) => r.componentName === nameMatch![1] && r.importPath === importMatch![1],
    );
    if (alreadyExists) continue;

    results.push({
      componentName: nameMatch![1],
      end: range.end.index,
      importPath: importMatch![1],
      start: range.start.index,
    });
  }

  return results;
};

const generateImportStatements = (imports: DynamicImportInfo[]): string => {
  const uniqueImports = new Map<string, string>();

  for (const imp of imports) {
    if (!uniqueImports.has(imp.importPath)) {
      uniqueImports.set(imp.importPath, imp.componentName);
    }
  }

  const sortedPaths = [...uniqueImports.keys()].sort();

  return sortedPaths
    .map((importPath) => {
      const componentName = uniqueImports.get(importPath)!;
      return `import ${componentName} from '${importPath}';`;
    })
    .join('\n');
};

const findImportInsertPosition = (code: string, filePath: string): number => {
  const ast = parse(Lang.Tsx, code);
  const root = ast.root();

  const imports = root.findAll({
    rule: {
      kind: 'import_statement',
    },
  });

  invariant(
    imports.length > 0,
    `[convertNextDynamicToStatic] No import statements found in ${filePath}`,
  );

  const lastImport = imports.at(-1)!;
  return lastImport.range().end.index;
};

const removeDynamicImport = (code: string): string => {
  const patterns = [
    /import dynamic from ["']@\/libs\/next\/dynamic["'];\n?/g,
    /import dynamic from ["']next\/dynamic["'];\n?/g,
  ];

  let result = code;
  for (const pattern of patterns) {
    result = result.replace(pattern, '');
  }

  return result;
};

const removeUnusedLoadingImport = (code: string): string => {
  const codeWithoutImport = code.replaceAll(/import Loading from ["'][^"']+["'];?\n?/g, '');
  if (!/\bLoading\b/.test(codeWithoutImport)) {
    return code.replaceAll(/import Loading from ["'][^"']+["'];?\n?/g, '');
  }
  return code;
};

const transformFile = (code: string, filePath: string): string => {
  const imports = extractDynamicImports(code);

  if (imports.length === 0) {
    return code;
  }

  const importStatements = generateImportStatements(imports);

  const edits: Array<{ end: number; start: number; text: string }> = [];

  for (const imp of imports) {
    edits.push({
      end: imp.end,
      start: imp.start,
      text: '',
    });
  }

  edits.sort((a, b) => b.start - a.start);

  let result = code;
  for (const edit of edits) {
    let endIndex = edit.end;
    while (result[endIndex] === '\n' || result[endIndex] === '\r') {
      endIndex++;
    }
    result = result.slice(0, edit.start) + result.slice(endIndex);
  }

  const insertPos = findImportInsertPosition(result, filePath);
  if (importStatements) {
    result = result.slice(0, insertPos) + '\n' + importStatements + result.slice(insertPos);
  }

  result = removeDynamicImport(result);
  result = removeUnusedLoadingImport(result);

  result = result.replaceAll(/\n{3,}/g, '\n\n');

  return result;
};

export const convertNextDynamicToStatic = async (TEMP_DIR: string) => {
  const appDirs = [
    { dir: path.join(TEMP_DIR, 'src/app/(variants)'), label: 'src/app/(variants)' },
    { dir: path.join(TEMP_DIR, 'src/app/[variants]'), label: 'src/app/[variants]' },
  ];

  console.log('  Processing next/dynamic → static imports...');

  let processedCount = 0;

  for (const { dir, label } of appDirs) {
    if (!(await fs.pathExists(dir))) {
      continue;
    }

    const files = await glob('**/*.tsx', { cwd: dir });

    for (const file of files) {
      const filePath = path.join(dir, file);
      const code = await fs.readFile(filePath, 'utf8');

      if (!code.includes('dynamic(')) {
        continue;
      }

      const transformed = transformFile(code, `${label}/${file}`);

      if (transformed !== code) {
        await fs.writeFile(filePath, transformed);
        processedCount++;
        console.log(`    Transformed: ${label}/${file}`);
      }
    }
  }

  console.log(`    Processed ${processedCount} files with dynamic imports`);
};

if (isDirectRun(import.meta.url)) {
  await runStandalone('convertNextDynamicToStatic', convertNextDynamicToStatic, []);
}
