import { Lang, parse } from '@ast-grep/napi';
import fs from 'fs-extra';
import path from 'node:path';

import { isDirectRun, runStandalone, updateFile } from './utils.mjs';

/**
 * Remove the URL rewrite logic from the proxy middleware.
 * For Electron static export, we don't need URL rewriting since pages are pre-rendered.
 */
const removeUrlRewriteLogic = (code: string): string => {
  const ast = parse(Lang.TypeScript, code);
  const root = ast.root();
  const edits: Array<{ end: number; start: number; text: string }> = [];

  // Find the defaultMiddleware arrow function
  const defaultMiddleware = root.find({
    rule: {
      pattern: 'const defaultMiddleware = ($REQ) => { $$$ }',
    },
  });

  if (!defaultMiddleware) {
    console.warn('  ⚠️  defaultMiddleware not found, skipping URL rewrite removal');
    return code;
  }

  // Replace the entire defaultMiddleware function with a simplified version
  // that just returns NextResponse.next() for non-API routes
  const range = defaultMiddleware.range();

  const simplifiedMiddleware = `const defaultMiddleware = (request: NextRequest) => {
    const url = new URL(request.url);
    logDefault('Processing request: %s %s', request.method, request.url);

    // skip all api requests
    if (backendApiEndpoints.some((path) => url.pathname.startsWith(path))) {
      logDefault('Skipping API request: %s', url.pathname);
      return NextResponse.next();
    }

    return NextResponse.next();
  }`;

  edits.push({ end: range.end.index, start: range.start.index, text: simplifiedMiddleware });

  // Apply edits
  if (edits.length === 0) return code;

  edits.sort((a, b) => b.start - a.start);
  let result = code;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }

  return result;
};

const assertUrlRewriteRemoved = (code: string): boolean =>
  // Ensure the URL rewrite related code is removed
  !/NextResponse\.rewrite\(/.test(code) &&
  !/RouteVariants\.serializeVariants/.test(code) &&
  !/url\.pathname = nextPathname/.test(code);

/**
 * Rename [variants] directories to (variants) under src/app
 */
const renameVariantsDirectories = async (TEMP_DIR: string): Promise<void> => {
  const srcAppPath = path.join(TEMP_DIR, 'src', 'app');

  // Recursively find and rename [variants] directories
  const renameRecursively = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const oldPath = path.join(dir, entry.name);

        if (entry.name === '[variants]') {
          const newPath = path.join(dir, '(variants)');

          // If (variants) already exists, remove it first
          if (await fs.pathExists(newPath)) {
            console.log(`    Removing existing: ${path.relative(TEMP_DIR, newPath)}`);
            await fs.remove(newPath);
          }

          console.log(
            `    Renaming: ${path.relative(TEMP_DIR, oldPath)} -> ${path.relative(TEMP_DIR, newPath)}`,
          );
          await fs.rename(oldPath, newPath);
          // Continue searching in the renamed directory
          await renameRecursively(newPath);
        } else {
          // Continue searching in subdirectories
          await renameRecursively(oldPath);
        }
      }
    }
  };

  await renameRecursively(srcAppPath);
};

/**
 * Update all imports that reference [variants] to use (variants)
 */
const updateVariantsImports = async (TEMP_DIR: string): Promise<void> => {
  const srcPath = path.join(TEMP_DIR, 'src');

  // Pattern to match imports containing [variants]
  const variantsImportPattern = /(\[variants])/g;

  const processFile = async (filePath: string): Promise<void> => {
    const content = await fs.readFile(filePath, 'utf8');

    if (!content.includes('[variants]')) {
      return;
    }

    const updated = content.replaceAll('[variants]', '(variants)');

    if (updated !== content) {
      console.log(`    Updated imports: ${path.relative(TEMP_DIR, filePath)}`);
      await fs.writeFile(filePath, updated);
    }
  };

  const processDirectory = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and other non-source directories
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }
        await processDirectory(fullPath);
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx|mts|mjs)$/.test(entry.name)) {
        await processFile(fullPath);
      }
    }
  };

  await processDirectory(srcPath);
};

export const modifyStaticExport = async (TEMP_DIR: string): Promise<void> => {
  // 1. Remove URL rewrite logic from define-config.ts
  const defineConfigPath = path.join(TEMP_DIR, 'src', 'libs', 'next', 'proxy', 'define-config.ts');
  console.log('  Processing src/libs/next/proxy/define-config.ts...');
  await updateFile({
    assertAfter: assertUrlRewriteRemoved,
    filePath: defineConfigPath,
    name: 'modifyStaticExport:removeUrlRewrite',
    transformer: removeUrlRewriteLogic,
  });

  // 2. Rename [variants] directories to (variants)
  console.log('  Renaming [variants] directories to (variants)...');
  await renameVariantsDirectories(TEMP_DIR);

  // 3. Update all imports referencing [variants]
  console.log('  Updating imports referencing [variants]...');
  await updateVariantsImports(TEMP_DIR);
};

if (isDirectRun(import.meta.url)) {
  await runStandalone('modifyStaticExport', modifyStaticExport, [
    { lang: Lang.TypeScript, path: 'src/libs/next/proxy/define-config.ts' },
  ]);
}
