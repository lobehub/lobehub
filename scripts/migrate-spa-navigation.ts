#!/usr/bin/env bun
/**
 * Script to migrate SPA internal components from @/libs/next/navigation
 * to React Router version hooks.
 *
 * For files in (main) directory:
 * - usePathname -> @/app/[variants]/(main)/hooks/usePathname
 * - useSearchParams -> @/app/[variants]/(main)/hooks/useSearchParams
 * - useRouter -> @/app/[variants]/(main)/hooks/useRouter
 *
 * @see RFC 147: LOBE-2850 - Phase 3
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Files that should be migrated to React Router version
const SPA_FILES = [
  // (main) directory files using @/libs/next/navigation
  'src/app/[variants]/(main)/community/_layout/Sidebar/Header/Nav.tsx',
  'src/app/[variants]/(main)/group/_layout/Sidebar/Header/Nav.tsx',
  'src/app/[variants]/(main)/group/_layout/Sidebar/Topic/hooks/useTopicNavigation.ts',
  'src/app/[variants]/(main)/group/_layout/Sidebar/Topic/hooks/useThreadNavigation.ts',
  'src/app/[variants]/(main)/chat/_layout/Sidebar/Header/Nav.tsx',
  'src/app/[variants]/(main)/chat/_layout/Sidebar/Topic/hooks/useTopicNavigation.ts',
  'src/app/[variants]/(main)/chat/_layout/Sidebar/Topic/hooks/useThreadNavigation.ts',
  'src/app/[variants]/(main)/memory/_layout/Sidebar/Header/Nav.tsx',
];

interface MigrationResult {
  changes: string[];
  filePath: string;
}

async function migrateFile(relativePath: string): Promise<MigrationResult | null> {
  const fullPath = join(__dirname, '..', relativePath);
  const content = await readFile(fullPath, 'utf8');
  let newContent = content;
  const changes: string[] = [];

  // Check what hooks are being imported from @/libs/next/navigation
  const importMatch = content.match(
    /import\s*\{([^}]+)\}\s*from\s*["']@\/libs\/next\/navigation["']/,
  );

  if (!importMatch) {
    console.log(`⏭️  ${relativePath} - No @/libs/next/navigation import found`);
    return null;
  }

  const importedHooks = importMatch[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`📝 ${relativePath}`);
  console.log(`   Imported hooks: ${importedHooks.join(', ')}`);

  // Build new imports
  const newImports: string[] = [];

  for (const hook of importedHooks) {
    switch (hook) {
      case 'usePathname': {
        newImports.push(`import { usePathname } from '@/app/[variants]/(main)/hooks/usePathname';`);
        changes.push('usePathname -> React Router version');

        break;
      }
      case 'useSearchParams': {
        newImports.push(
          `import { useSearchParams } from '@/app/[variants]/(main)/hooks/useSearchParams';`,
        );
        changes.push('useSearchParams -> React Router version');

        break;
      }
      case 'useRouter': {
        newImports.push(`import { useRouter } from '@/app/[variants]/(main)/hooks/useRouter';`);
        changes.push('useRouter -> React Router version');

        break;
      }
      default: {
        // Keep other imports (like notFound, redirect) from next/navigation
        console.log(`   ⚠️  Unknown hook "${hook}" - keeping original import`);
      }
    }
  }

  if (newImports.length === 0) {
    console.log(`   ⏭️  No hooks to migrate`);
    return null;
  }

  // Replace the old import with new imports
  newContent = newContent.replace(
    /import\s*\{[^}]+\}\s*from\s*["']@\/libs\/next\/navigation["'];?\n?/,
    newImports.join('\n') + '\n',
  );

  if (newContent !== content) {
    await writeFile(fullPath, newContent, 'utf8');
    for (const change of changes) {
      console.log(`   ✅ ${change}`);
    }
    return { changes, filePath: relativePath };
  }

  return null;
}

async function main() {
  console.log('🚀 Starting SPA navigation migration...\n');

  const results: MigrationResult[] = [];

  for (const file of SPA_FILES) {
    try {
      const result = await migrateFile(file);
      if (result) {
        results.push(result);
      }
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`📊 Migration Summary:`);
  console.log(`   - Files processed: ${SPA_FILES.length}`);
  console.log(`   - Files modified: ${results.length}`);
  console.log('\n✨ SPA navigation migration complete!');
}

await main();
