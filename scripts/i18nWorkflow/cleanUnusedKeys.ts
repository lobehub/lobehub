import * as fs from 'node:fs';
import * as path from 'node:path';

import { consola } from 'consola';
import { colors } from 'consola/utils';

import { IGNORED_FILES } from './protectedPatterns';

interface UnusedKey {
  filePath: string;
  fullKey: string;
  key: string;
  namespace: string;
}

interface ReportData {
  generatedAt: string;
  statistics: {
    totalKeys: number;
    unusedKeys: number;
    usageRate: string;
    usedKeys: number;
  };
  unusedKeys: UnusedKey[];
  unusedKeysByNamespace: Array<{
    count: number;
    keys: string[];
    namespace: string;
  }>;
}

/**
 * Remove a key from a nested object
 */
function removeKeyFromObject(obj: any, keyPath: string): boolean {
  const keys = keyPath.split('.');
  const lastKey = keys.pop()!;

  let current = obj;
  const parents: Array<{ key: string; obj: any }> = [];

  // Navigate to the parent of the target key
  for (const key of keys) {
    if (!current[key]) {
      return false; // Key path doesn't exist
    }
    parents.push({ key, obj: current });
    current = current[key];
  }

  // Remove the key
  if (lastKey in current) {
    delete current[lastKey];

    // Clean up empty parent objects
    for (let i = parents.length - 1; i >= 0; i--) {
      const { obj, key } = parents[i];
      if (Object.keys(obj[key]).length === 0) {
        delete obj[key];
      } else {
        break; // Stop if parent still has other keys
      }
    }

    return true;
  }

  return false;
}

/**
 * Clean unused keys from TypeScript default locale files
 */
function cleanDefaultLocaleFiles(unusedKeys: UnusedKey[], dryRun: boolean = true) {
  const defaultLocalesPath = path.join(process.cwd(), 'src/locales/default');

  // Get ignored namespace names from IGNORED_FILES (remove .ts extension)
  const ignoredNamespaces = new Set(IGNORED_FILES.map((f) => f.replace('.ts', '')));

  // Group by namespace
  const byNamespace = new Map<string, string[]>();
  for (const key of unusedKeys) {
    // Skip ignored namespaces (from IGNORED_FILES)
    if (ignoredNamespaces.has(key.namespace)) {
      continue;
    }

    if (!byNamespace.has(key.namespace)) {
      byNamespace.set(key.namespace, []);
    }
    byNamespace.get(key.namespace)!.push(key.key);
  }

  consola.info(`Processing ${byNamespace.size} namespace files...`);
  consola.info('');

  let totalRemoved = 0;

  for (const [namespace, keys] of byNamespace.entries()) {
    const filePath = path.join(defaultLocalesPath, `${namespace}.ts`);

    if (!fs.existsSync(filePath)) {
      consola.warn(`File not found: ${filePath}`);
      continue;
    }

    try {
      const loadedModule = require(filePath);
      const translations = loadedModule.default || loadedModule;

      // Create a deep copy to avoid modifying the original
      const updatedTranslations = structuredClone(translations);

      let removedCount = 0;

      // Remove each unused key
      for (const key of keys) {
        if (removeKeyFromObject(updatedTranslations, key)) {
          removedCount++;
          totalRemoved++;
        }
      }

      if (removedCount > 0) {
        consola.info(
          colors.cyan(namespace.padEnd(20)),
          colors.gray('→'),
          colors.red(`${removedCount} keys to remove`),
        );

        if (!dryRun) {
          // Generate new content

          const newContent = generateTypeScriptContent(updatedTranslations);

          // Write back to file
          fs.writeFileSync(filePath, newContent, 'utf8');
          consola.success(`  ✓ Updated ${filePath}`);
        } else {
          consola.info(`  ${colors.gray('(dry run - no changes made)')}`);
        }
      }
    } catch (error) {
      consola.error(`Failed to process ${namespace}:`, error);
    }
  }

  return totalRemoved;
}

/**
 * Clean unused keys from JSON locale files
 */
function cleanLocaleJsonFiles(unusedKeys: UnusedKey[], dryRun: boolean = true) {
  const localesPath = path.join(process.cwd(), 'locales');
  const locales = fs
    .readdirSync(localesPath)
    .filter((f) => fs.statSync(path.join(localesPath, f)).isDirectory());

  consola.info(`Processing ${locales.length} locale directories...`);
  consola.info('');

  // Get ignored namespace names from IGNORED_FILES (remove .ts extension)
  const ignoredNamespaces = new Set(IGNORED_FILES.map((f) => f.replace('.ts', '')));

  // Group by namespace
  const byNamespace = new Map<string, string[]>();
  for (const key of unusedKeys) {
    // Skip ignored namespaces (from IGNORED_FILES)
    if (ignoredNamespaces.has(key.namespace)) {
      continue;
    }

    if (!byNamespace.has(key.namespace)) {
      byNamespace.set(key.namespace, []);
    }
    byNamespace.get(key.namespace)!.push(key.key);
  }

  let totalRemoved = 0;

  for (const locale of locales) {
    consola.info(colors.cyan(`Locale: ${locale}`));

    for (const [namespace, keys] of byNamespace.entries()) {
      const filePath = path.join(localesPath, locale, `${namespace}.json`);

      if (!fs.existsSync(filePath)) {
        continue;
      }

      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const translations = JSON.parse(content);

        let removedCount = 0;

        // Remove each unused key
        for (const key of keys) {
          if (removeKeyFromObject(translations, key)) {
            removedCount++;
            totalRemoved++;
          }
        }

        if (removedCount > 0) {
          consola.info(
            `  ${colors.gray(namespace.padEnd(20))} → ${colors.red(removedCount + ' keys removed')}`,
          );

          if (!dryRun) {
            // Write back to file with pretty formatting
            fs.writeFileSync(filePath, JSON.stringify(translations, null, 2) + '\n', 'utf8');
          }
        }
      } catch (error) {
        consola.error(`Failed to process ${locale}/${namespace}:`, error);
      }
    }

    consola.info('');
  }

  return totalRemoved;
}

/**
 * Check if a key needs quotes in TypeScript object notation
 */
function needsQuotes(key: string): boolean {
  // Keys that need quotes:
  // - Contains special characters (-, ., spaces, etc.)
  // - Starts with a number
  // - Is a reserved keyword
  return !/^[$_a-z][\w$]*$/i.test(key);
}

/**
 * Generate TypeScript file content from object
 */
function generateTypeScriptContent(obj: any): string {
  const jsonString = JSON.stringify(obj, null, 2);

  // Convert JSON to TypeScript object notation
  // Handle keys that need quotes vs those that don't
  let tsContent = jsonString.replaceAll(/"([^"]+)":/g, (match, key) => {
    if (needsQuotes(key)) {
      // Keep quotes for keys with special characters
      return `'${key}':`;
    }
    // Remove quotes for valid identifiers
    return `${key}:`;
  });

  // Use single quotes for string values
  tsContent = tsContent.replaceAll(/: "([^"]*)"/g, ": '$1'");

  return `export default ${tsContent};\n`;
}

/**
 * Main function
 */
async function main() {
  const reportPath = path.join(process.cwd(), 'i18n-unused-keys-report.json');

  // Check if report exists
  if (!fs.existsSync(reportPath)) {
    consola.error(
      `Report file not found: ${reportPath}\n` +
        'Please run "bun run workflow:i18n-analyze" first to generate the report.',
    );
    throw new Error('Report file not found');
  }

  // Load report
  const reportContent = fs.readFileSync(reportPath, 'utf8');
  const report: ReportData = JSON.parse(reportContent);

  consola.box('🧹 Clean Unused i18n Keys');
  consola.info('');

  // Show statistics
  consola.info(colors.cyan('Statistics from report:'));
  consola.info(`  Total keys: ${report.statistics.totalKeys}`);
  consola.info(`  Used keys: ${report.statistics.usedKeys}`);
  consola.info(`  Unused keys: ${colors.red(report.statistics.unusedKeys.toString())}`);
  consola.info(`  Usage rate: ${report.statistics.usageRate}`);
  consola.info('');

  if (report.unusedKeys.length === 0) {
    consola.success('No unused keys to clean!');
    return;
  }

  // Ask for confirmation
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--no-dry-run');

  if (dryRun) {
    consola.warn('Running in DRY RUN mode - no files will be modified');
    consola.info('To actually clean the files, run: bun run workflow:i18n-clean --no-dry-run');
    consola.info('');
  } else {
    consola.warn('⚠️  WARNING: This will modify your locale files!');
    consola.info('Make sure you have committed your changes or have a backup.');
    consola.info('');
  }

  // Clean default locale files (TypeScript)
  consola.box('Step 1: Cleaning default locale files (TypeScript)');
  const removedFromDefault = cleanDefaultLocaleFiles(report.unusedKeys, dryRun);
  consola.info('');

  // Clean locale JSON files
  consola.box('Step 2: Cleaning locale JSON files');
  const removedFromJson = cleanLocaleJsonFiles(report.unusedKeys, dryRun);
  consola.info('');

  // Summary
  consola.box('Summary');
  consola.info(`Keys marked for removal: ${colors.red(report.unusedKeys.length.toString())}`);
  consola.info(
    `Total operations: ${colors.yellow((removedFromDefault + removedFromJson).toString())}`,
  );

  if (dryRun) {
    consola.info('');
    consola.warn('This was a DRY RUN - no files were modified');
    consola.info('To actually clean the files, run:');
    consola.info(colors.cyan('  bun run workflow:i18n-clean --no-dry-run'));
  } else {
    consola.success('✓ Cleanup completed!');
    consola.info('');
    consola.info('Next steps:');
    consola.info('  1. Review the changes with git diff');
    consola.info('  2. Run "bun run i18n" to regenerate all locale files');
    consola.info('  3. Test your application');
    consola.info('  4. Commit the changes');
  }
}

main();
