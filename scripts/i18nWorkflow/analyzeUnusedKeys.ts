import * as fs from 'node:fs';
import * as path from 'node:path';

import { consola } from 'consola';
import { colors } from 'consola/utils';
import { glob } from 'glob';

import { IGNORED_FILES, PROTECTED_KEY_PATTERNS } from './protectedPatterns';

interface I18nKey {
  fullKey: string;
  key: string;
  namespace: string;
}

interface UnusedKey extends I18nKey {
  filePath: string;
}

/**
 * Check if a key should be protected (considered as "used")
 */
function isProtectedKey(namespace: string, key: string): boolean {
  // Check if namespace is in protected list
  if (PROTECTED_KEY_PATTERNS.includes(namespace)) {
    return true;
  }

  // Check if key matches any protected pattern
  const fullKey = `${namespace}.${key}`;
  return PROTECTED_KEY_PATTERNS.some((pattern) => {
    // Exact namespace match
    if (pattern === namespace) return true;
    // Partial key match (e.g., "error.code" matches "error.code.NOT_FOUND")
    if (fullKey.startsWith(pattern + '.')) return true;
    return false;
  });
}

/**
 * Recursively extract all keys from a nested object
 */
function extractKeysFromObject(obj: any, namespace: string, prefix: string = ''): I18nKey[] {
  const keys: I18nKey[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recursively extract keys from nested objects
      keys.push(...extractKeysFromObject(value, namespace, fullKey));
    } else {
      // This is a leaf node (actual translation)
      keys.push({
        fullKey: `${namespace}:${fullKey}`,
        key: fullKey,
        namespace,
      });
    }
  }

  return keys;
}

/**
 * Load all i18n keys from src/locales/default
 */
function loadAllI18nKeys(): I18nKey[] {
  const defaultLocalesPath = path.join(process.cwd(), 'src/locales/default');
  const allKeys: I18nKey[] = [];

  // Get all TypeScript files except index.ts and ignored files
  const ignoredFiles: string[] = [...IGNORED_FILES];
  const files = fs
    .readdirSync(defaultLocalesPath)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts' && !ignoredFiles.includes(f));

  consola.info(`Found ${files.length} namespace files (ignored: ${ignoredFiles.join(', ')})`);

  for (const file of files) {
    const namespace = path.basename(file, '.ts');
    const filePath = path.join(defaultLocalesPath, file);

    try {
      // Use require to load the TypeScript file (after it's compiled)

      const loadedModule = require(filePath);
      const translations = loadedModule.default || loadedModule;

      const keys = extractKeysFromObject(translations, namespace);
      allKeys.push(...keys);

      consola.success(colors.cyan(namespace.padEnd(20)), colors.gray(`${keys.length} keys`));
    } catch (error) {
      consola.error(`Failed to load ${file}:`, error);
    }
  }

  return allKeys;
}

/**
 * Find all t() function calls in the codebase
 */
async function findAllTranslationCalls(): Promise<Set<string>> {
  const usedKeys = new Set<string>();

  // Patterns to search for translation calls
  const patterns = [
    'src/**/*.{ts,tsx,js,jsx}',
    'apps/desktop/src/**/*.{ts,tsx,js,jsx}',
    'packages/**/src/**/*.{ts,tsx,js,jsx}', // Include packages directory
    '!**/*.test.{ts,tsx}',
    '!**/*.spec.{ts,tsx}',
    '!**/node_modules/**',
    '!**/.next/**',
  ];

  consola.start('Scanning codebase for translation calls...');

  const files = await glob(patterns);
  consola.info(`Found ${files.length} files to scan`);

  // Regular expressions to match translation calls
  // Mark dynamic patterns with special flag to handle them differently
  const regexPatterns: Array<{
    // Whether this pattern captures dynamic keys
    captureNs?: boolean;
    isDynamic?: boolean;
    pattern: RegExp; // Whether pattern can capture namespace
  }> = [
    // Static patterns
    { pattern: /\bt\w*\(\s*["'`]([^"'`]+)["'`]/g },
    {
      captureNs: true,
      pattern: /\bt\w*\(\s*["'`]([^"'`]+)["'`]\s*,\s*\{[^}]*ns:\s*["'`]([^"'`]+)["'`]/g,
    },
    { pattern: /i18n\.t\(\s*["'`]([^"'`]+)["'`]/g },
    { pattern: /\bt\w*\([^)]*\?\s*["'`]([^"'`]+)["'`]/g },
    { pattern: /\bt\w*\([^)]*:\s*["'`]([^"'`]+)["'`]/g },
    { pattern: /<Trans[^>]+i18nKey=["']([^"']+)["']/g },
    { pattern: /<Trans[^>]+i18nKey=\{["']([^"']+)["']\}/g },
    { captureNs: true, pattern: /<Trans[^>]+i18nKey=["']([^"']+)["'][\s\S]*?ns=["']([^"']+)["']/g },
    {
      captureNs: true,
      pattern: /<Trans[^>]+i18nKey=\{["']([^"']+)["']\}[\s\S]*?ns=\{["']([^"']+)["']\}/g,
    },

    // Dynamic patterns (template strings, concatenations, etc.)
    // Pattern 1: t(`prefix.${var}.suffix`) - variable in the middle
    { captureNs: false, isDynamic: true, pattern: /\bt\w*\(\s*`([^$`]+)\$\{[^}]+\}([^`]*)`/g },
    // Pattern 2: t(`${var}.suffix`) - variable at the start
    { captureNs: false, isDynamic: true, pattern: /\bt\w*\(\s*`\$\{[^}]+\}([^`]+)`/g },
    // Pattern 3: t(`prefix.${var}.suffix`, { ns: 'namespace' }) - with explicit ns
    {
      captureNs: true,
      isDynamic: true,
      pattern: /\bt\w*\(\s*`([^$`]*)\$\{[^}]+\}([^`]*)`\s*,\s*\{[^}]*ns:\s*["'`]([^"'`]+)["'`]/g,
    },
    // Pattern 4: t(`${var}.suffix`, { ns: 'namespace' }) - variable at start with ns
    {
      captureNs: true,
      isDynamic: true,
      pattern: /\bt\w*\(\s*`\$\{[^}]+\}([^`]+)`\s*,\s*\{[^}]*ns:\s*["'`]([^"'`]+)["'`]/g,
    },
    // Pattern 5: String concatenation
    { isDynamic: true, pattern: /\bt\w*\(\s*["'`]([^"'`]+)["'`]\s*\+/g },
    // Pattern 6: <Trans> with dynamic keys
    { isDynamic: true, pattern: /<Trans[^>]+i18nKey=\{`([^$`]+)\$\{[^}]+\}([^`]*)`\}/g },
  ];

  let totalMatches = 0;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');

    // Extract namespace from useTranslation hook
    const useTranslationMatch = content.match(/useTranslation\(\s*["'`]([^"'`]+)["'`]\s*\)/g);
    const useTranslationMultiMatch = content.match(/useTranslation\(\s*\[([^\]]+)\]\s*\)/g);

    // Extract aliases: const { t: tAuth } = useTranslation('auth')
    const aliasPattern =
      /const\s*\{\s*t\s*:\s*(\w+)\s*\}\s*=\s*useTranslation\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
    const aliasMatches = content.matchAll(aliasPattern);

    const namespacesInFile = new Set<string>();
    const aliasToNamespace = new Map<string, string>();

    // Extract namespaces from useTranslation('namespace')
    if (useTranslationMatch) {
      for (const match of useTranslationMatch) {
        const ns = match.match(/["'`]([^"'`]+)["'`]/)?.[1];
        if (ns) namespacesInFile.add(ns);
      }
    }

    // Extract namespaces from useTranslation(['ns1', 'ns2'])
    if (useTranslationMultiMatch) {
      for (const match of useTranslationMultiMatch) {
        const nsArray = match.match(/\[([^\]]+)\]/)?.[1];
        if (nsArray) {
          const namespaces = nsArray.match(/["'`]([^"'`]+)["'`]/g);
          if (namespaces) {
            for (const ns of namespaces) {
              const cleanNs = ns.replaceAll(/["'`]/g, '');
              namespacesInFile.add(cleanNs);
            }
          }
        }
      }
    }

    // Extract alias mappings (e.g., tAuth -> 'auth')
    for (const match of aliasMatches) {
      const alias = match[1];
      const namespace = match[2];
      aliasToNamespace.set(alias, namespace);
      namespacesInFile.add(namespace);
    }

    // Find all t() calls
    for (const { pattern: regex, captureNs, isDynamic } of regexPatterns) {
      const matches = content.matchAll(regex);

      for (const match of matches) {
        totalMatches++;
        const fullMatch = match[0];
        const key = match[1];
        let explicitNs: string | undefined;

        // For patterns with captureNs, namespace is in a different position
        if (captureNs && isDynamic) {
          // Dynamic patterns with ns: match[1] + match[2] = key parts, match[3] = ns
          explicitNs = match[3] || match[2]; // Try match[3] first, fall back to match[2]
        } else if (captureNs) {
          // Static patterns with ns: match[1] = key, match[2] = ns
          explicitNs = match[2];
        }

        if (!key) continue;

        // Extract function name (t, tAuth, tCommon, etc.)
        const funcNameMatch = fullMatch.match(/\b(t\w*)\(/);
        const funcName = funcNameMatch?.[1] || 't';

        // Check if it's an alias with known namespace
        let aliasNamespace: string | undefined;
        if (funcName !== 't' && aliasToNamespace.has(funcName)) {
          aliasNamespace = aliasToNamespace.get(funcName);
        }

        // Handle dynamic keys differently
        if (isDynamic) {
          // For dynamic patterns, extract the static prefix/suffix
          // e.g., t(`mcp.details.${var}.title`) -> "mcp.details." and ".title"
          // e.g., t(`${var}.title`) -> ".title"
          let prefix = '';
          let suffix = '';

          if (match[2] !== undefined) {
            // Pattern has both prefix and suffix: match[1] = prefix, match[2] = suffix
            prefix = match[1] || '';
            suffix = match[2] || '';
          } else {
            // Pattern has only suffix (var at start): match[1] = suffix
            suffix = match[1] || '';
          }

          // Combine prefix and suffix for the pattern
          const pattern = (prefix + suffix).trim();
          if (!pattern) continue; // Skip if nothing to protect

          // Determine the namespace
          let targetNs: string | undefined;
          if (aliasNamespace) {
            targetNs = aliasNamespace;
          } else if (explicitNs) {
            targetNs = explicitNs;
          } else if (namespacesInFile.size === 1) {
            targetNs = [...namespacesInFile][0];
          } else if (namespacesInFile.size > 0) {
            // Multiple namespaces, add prefix pattern for each
            for (const ns of namespacesInFile) {
              usedKeys.add(`${ns}:${pattern}*`);
            }
            continue;
          }

          if (targetNs) {
            usedKeys.add(`${targetNs}:${pattern}*`);
          }
          continue;
        }

        // Handle static keys
        if (explicitNs) {
          // Has explicit namespace
          usedKeys.add(`${explicitNs}:${key}`);
        } else if (aliasNamespace) {
          // Using alias (e.g., tAuth('key'))
          usedKeys.add(`${aliasNamespace}:${key}`);
        } else if (key.includes(':')) {
          // Key already includes namespace (e.g., t('common:key'))
          usedKeys.add(key);
        } else {
          // Use namespaces from useTranslation hook
          if (namespacesInFile.size > 0) {
            for (const ns of namespacesInFile) {
              usedKeys.add(`${ns}:${key}`);
            }
          } else {
            // Default to 'common' if no namespace found
            usedKeys.add(`common:${key}`);
          }
        }
      }
    }
  }

  consola.success(`Found ${totalMatches} translation calls`);
  consola.info(`Extracted ${usedKeys.size} unique keys`);

  return usedKeys;
}

/**
 * Find unused i18n keys
 */
function findUnusedKeys(allKeys: I18nKey[], usedKeys: Set<string>): UnusedKey[] {
  const unused: UnusedKey[] = [];
  const protectedKeys: UnusedKey[] = [];

  // Extract prefix patterns from usedKeys
  // e.g., "discover:mcp.details.*" means any key starting with "mcp.details." in discover namespace
  const prefixPatterns: Array<{ namespace: string; prefix: string }> = [];
  for (const key of usedKeys) {
    if (key.includes('*')) {
      const [namespace, pattern] = key.split(':');
      const prefix = pattern.replace(/\*$/, ''); // Remove trailing *
      prefixPatterns.push({ namespace, prefix });
    }
  }

  for (const keyInfo of allKeys) {
    // Check if key is protected by configuration
    if (isProtectedKey(keyInfo.namespace, keyInfo.key)) {
      protectedKeys.push({
        ...keyInfo,
        filePath: `src/locales/default/${keyInfo.namespace}.ts`,
      });
      continue;
    }

    // Check if key matches any prefix pattern (from dynamic usage)
    let matchesPrefix = false;
    for (const { namespace, prefix } of prefixPatterns) {
      if (keyInfo.namespace === namespace && keyInfo.key.startsWith(prefix)) {
        matchesPrefix = true;
        break;
      }
    }

    if (matchesPrefix) {
      protectedKeys.push({
        ...keyInfo,
        filePath: `src/locales/default/${keyInfo.namespace}.ts`,
      });
      continue;
    }

    // Check if key is actually used
    if (!usedKeys.has(keyInfo.fullKey)) {
      unused.push({
        ...keyInfo,
        filePath: `src/locales/default/${keyInfo.namespace}.ts`,
      });
    }
  }

  if (protectedKeys.length > 0) {
    consola.info('');
    consola.info(colors.cyan('Protected keys (considered as used):'));
    consola.info(
      `  ${colors.green(protectedKeys.length.toString())} keys protected by patterns or dynamic usage`,
    );
  }

  return unused;
}

/**
 * Generate report
 */
function generateReport(unusedKeys: UnusedKey[], allKeysCount: number, usedKeysCount: number) {
  consola.box('📊 Unused i18n Keys Analysis Report');

  const actualUsedCount = allKeysCount - unusedKeys.length;

  consola.info('');
  consola.info(colors.cyan('Statistics:'));
  consola.info(`  Total defined keys: ${colors.yellow(allKeysCount.toString())}`);
  consola.info(`  Used keys: ${colors.green(actualUsedCount.toString())}`);
  consola.info(`  Unused keys: ${colors.red(unusedKeys.length.toString())}`);
  consola.info(
    `  Usage rate: ${colors.cyan(((actualUsedCount / allKeysCount) * 100).toFixed(2) + '%')}`,
  );
  consola.info('');
  consola.info(colors.gray('Protected patterns:'));
  consola.info(`  ${colors.gray(PROTECTED_KEY_PATTERNS.map((p) => `"${p}"`).join(', '))}`);
  consola.info('');

  if (unusedKeys.length === 0) {
    consola.success('🎉 All i18n keys are being used!');
    return;
  }

  // Group by namespace
  const byNamespace = new Map<string, UnusedKey[]>();
  for (const key of unusedKeys) {
    if (!byNamespace.has(key.namespace)) {
      byNamespace.set(key.namespace, []);
    }
    byNamespace.get(key.namespace)!.push(key);
  }

  consola.info(colors.yellow('Unused keys by namespace:'));
  consola.info('');

  for (const [namespace, keys] of byNamespace.entries()) {
    consola.warn(
      `${colors.cyan(namespace.padEnd(20))} ${colors.gray('→')} ${colors.red(keys.length + ' unused keys')}`,
    );

    // Show first 10 keys
    const displayKeys = keys.slice(0, 10);
    for (const key of displayKeys) {
      consola.log(`    ${colors.gray('•')} ${key.key}`);
    }

    if (keys.length > 10) {
      consola.log(`    ${colors.gray(`... and ${keys.length - 10} more`)}`);
    }
    consola.info('');
  }

  // Save detailed report to file
  const reportPath = path.join(process.cwd(), 'i18n-unused-keys-report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        statistics: {
          totalKeys: allKeysCount,
          unusedKeys: unusedKeys.length,
          usageRate: ((usedKeysCount / allKeysCount) * 100).toFixed(2) + '%',
          usedKeys: usedKeysCount,
        },
        unusedKeys: unusedKeys.map((k) => ({
          filePath: k.filePath,
          fullKey: k.fullKey,
          key: k.key,
          namespace: k.namespace,
        })),
        unusedKeysByNamespace: Array.from(byNamespace.entries()).map(([ns, keys]) => ({
          count: keys.length,
          keys: keys.map((k) => k.key),
          namespace: ns,
        })),
      },
      null,
      2,
    ),
  );

  consola.success(`Detailed report saved to: ${colors.cyan(reportPath)}`);
}

/**
 * Main function
 */
async function main() {
  consola.start('Starting i18n unused keys analysis...');
  consola.info('');

  // Step 1: Load all defined keys
  consola.box('Step 1: Loading all i18n keys');
  const allKeys = loadAllI18nKeys();
  consola.success(`Total keys loaded: ${allKeys.length}`);
  consola.info('');

  // Step 2: Find all translation calls
  consola.box('Step 2: Finding translation calls in codebase');
  const usedKeys = await findAllTranslationCalls();
  consola.info('');

  // Step 3: Find unused keys
  consola.box('Step 3: Analyzing unused keys');
  const unusedKeys = findUnusedKeys(allKeys, usedKeys);
  consola.info('');

  // Step 4: Generate report
  generateReport(unusedKeys, allKeys.length, usedKeys.size);
}

main();
