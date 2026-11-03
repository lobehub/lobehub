#!/usr/bin/env tsx

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

interface WhitelistConfig {
  files?: string[];
  patterns?: string[];
}

const WHITELIST_PATH = '.console-log-whitelist.json';

/**
 * Load whitelist configuration
 */
const loadWhitelist = (): WhitelistConfig => {
  try {
    const content = readFileSync(WHITELIST_PATH, 'utf8');
    return JSON.parse(content);
  } catch {
    return { files: [], patterns: [] };
  }
};

/**
 * Check if a file is whitelisted
 */
const isWhitelisted = (filePath: string, whitelist: WhitelistConfig): boolean => {
  const normalizedPath = filePath.replaceAll('\\', '/');

  // Check exact file matches
  if (whitelist.files?.some((f) => normalizedPath.includes(f.replaceAll('\\', '/')))) {
    return true;
  }

  // Check pattern matches (simple glob-like patterns)
  if (whitelist.patterns) {
    for (const pattern of whitelist.patterns) {
      // Escape dots and replace glob patterns
      // Use a placeholder for ** to avoid conflicts with single *
      let regexPattern = pattern
        .replaceAll('.', '\\.')
        .replaceAll('**', '\u0000DOUBLESTAR\u0000')
        .replaceAll('*', '[^/]*')
        .replaceAll('\u0000DOUBLESTAR\u0000', '.*');

      // If pattern ends with /**, match everything under that directory
      // If pattern ends with **, just match everything from that point
      const regex = new RegExp(`^${regexPattern}`);
      if (regex.test(normalizedPath)) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Main check function
 */
const checkConsoleLogs = () => {
  const whitelist = loadWhitelist();

  console.log('🔍 Checking for console.log statements...\n');

  try {
    // Search for console.log in TypeScript and JavaScript files
    const output = execSync(
      `git grep -n "console\\.log" -- "*.ts" "*.tsx" "*.js" "*.jsx" "*.mts" "*.cts" || true`,
      { encoding: 'utf8' },
    );

    if (!output.trim()) {
      console.log('✅ No console.log statements found!');
      return;
    }

    const lines = output.trim().split('\n');
    const violations: Array<{ content: string; file: string; line: string }> = [];

    for (const line of lines) {
      // Parse git grep output: filename:lineNumber:content
      const match = line.match(/^([^:]+):(\d+):(.+)$/);
      if (!match) continue;

      const [, filePath, lineNumber, content] = match;

      // Skip if whitelisted
      if (isWhitelisted(filePath, whitelist)) {
        continue;
      }

      // Skip comments
      const trimmedContent = content.trim();
      if (trimmedContent.startsWith('//') || trimmedContent.startsWith('*')) {
        continue;
      }

      violations.push({
        content: content.trim(),
        file: filePath,
        line: lineNumber,
      });
    }

    if (violations.length === 0) {
      console.log(
        '✅ No console.log violations found (all matches are whitelisted or in comments)!',
      );
      return;
    }

    // Report violations as warnings
    console.log('⚠️  Found console.log statements in the following files:\n');

    // Use GitHub Actions annotation format for better visibility in CI
    const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

    for (const violation of violations) {
      if (isCI) {
        // GitHub Actions warning annotation format
        console.log(
          `::warning file=${violation.file},line=${violation.line}::console.log found: ${violation.content}`,
        );
      } else {
        console.log(`  ${violation.file}:${violation.line}`);
        console.log(`    ${violation.content}\n`);
      }
    }

    console.log(`\n💡 Total violations: ${violations.length}`);
    console.log(`\n📝 To whitelist files, add them to ${WHITELIST_PATH} in the following format:`);
    console.log(`{
  "files": ["path/to/file.ts"],
  "patterns": ["scripts/**/*.mts", "**/*.test.ts"]
}\n`);

    // Exit with 0 to not block CI, but warnings will still be visible
    process.exit(0);
  } catch (error: unknown) {
    if (error instanceof Error && 'status' in error && error.status !== 0) {
      console.error('❌ Error running git grep:', error.message);
      process.exit(1);
    }
    throw error;
  }
};

checkConsoleLogs();
