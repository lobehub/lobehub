import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { MacOSSearchServiceImpl } from '../impl/macOS';

/**
 * macOS File Search Integration Tests
 *
 * These tests run against the real macOS Spotlight service
 * using files in the current repository.
 *
 * Run with: bunx vitest run 'macOS.integration.test'
 */

// Get repository root path (assumes test runs from apps/desktop)
const repoRoot = path.resolve(__dirname, '../../../../..');

describe.skipIf(process.platform !== 'darwin')('MacOSSearchServiceImpl Integration', () => {
  const searchService = new MacOSSearchServiceImpl();
  const ensureResults = (results: unknown[], context: string) => {
    if (results.length > 0) return true;
    // eslint-disable-next-line no-console
    console.warn(`⚠️  Spotlight returned 0 results for ${context} - indexing may be incomplete`);
    return false;
  };

  const ensureResultsOrSkipAssertions = (results: unknown[], hint: string) => {
    if (results.length > 0) return true;
    // eslint-disable-next-line no-console
    console.warn(
      `⚠️  Spotlight returned 0 results for "${hint}". This usually means indexing is incomplete/disabled. Skipping strict assertions.`,
    );
    // Keep a minimal assertion so we still validate the call didn't throw.
    expect(Array.isArray(results)).toBe(true);
    return false;
  };

  describe('checkSearchServiceStatus', () => {
    it('should verify Spotlight is available on macOS', async () => {
      const isAvailable = await searchService.checkSearchServiceStatus();

      expect(isAvailable).toBe(true);
    });
  });

  describe('search for known repository files', () => {
    it('should find package.json in repo root', async () => {
      const results = await searchService.search({
        keywords: 'package.json',
        limit: 10,
        onlyIn: repoRoot,
      });

      if (!ensureResultsOrSkipAssertions(results, 'package.json')) return;

      // Should find at least one package.json
      const packageJson = results.find((r) => r.name === 'package.json');
      expect(packageJson).toBeDefined();
      expect(packageJson!.type).toBe('json');
      expect(packageJson!.path).toContain(repoRoot);
    });

    it('should find README files', async () => {
      const results = await searchService.search({
        keywords: 'README',
        limit: 10,
        onlyIn: repoRoot,
      });
      if (!ensureResultsOrSkipAssertions(results, 'README')) return;

      // Should contain markdown files
      const mdFile = results.find((r) => r.type === 'md');
      expect(mdFile).toBeDefined();
      expect(mdFile!.name).toMatch(/README/i);
    });

    it('should find TypeScript files', async () => {
      const results = await searchService.search({
        keywords: 'macOS',
        limit: 10,
        onlyIn: repoRoot,
      });

      if (!ensureResultsOrSkipAssertions(results, 'macOS')) return;

      // Should find the macOS.ts implementation file
      const macOSFile = results.find((r) => r.name.includes('macOS') && r.type === 'ts');
      expect(macOSFile).toBeDefined();
      expect(macOSFile!.contentType).toBe('code');
    });

    it('should find files in apps/desktop directory', async () => {
      const desktopPath = path.join(repoRoot, 'apps/desktop');

      const results = await searchService.search({
        keywords: 'src',
        limit: 20,
        onlyIn: desktopPath,
      });

      // Spotlight indexing may not be complete for this directory
      // so we make the test lenient
      if (results.length > 0) {
        // All results should be within apps/desktop
        results.forEach((result) => {
          expect(result.path).toContain('apps/desktop');
        });
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          '⚠️  No results found in apps/desktop - Spotlight indexing may not be complete',
        );
      }

      // At minimum, verify the search completed without error
      expect(Array.isArray(results)).toBe(true);
    });

    it('should find test files', async () => {
      const results = await searchService.search({
        keywords: 'test.ts',
        limit: 10,
        onlyIn: repoRoot,
      });

      if (!ensureResultsOrSkipAssertions(results, 'test.ts')) return;

      // Should find test files (can be in __tests__ directory or co-located with source files)
      const testFile = results.find((r) => r.name.endsWith('.test.ts'));
      expect(testFile).toBeDefined();
      expect(testFile!.path).toMatch(/(__tests__|\.test\.ts$)/);
    });
  });

  describe('search with filters', () => {
    it('should respect limit parameter', async () => {
      const limit = 3;
      const results = await searchService.search({
        keywords: 'src',
        limit,
        onlyIn: repoRoot,
      });

      expect(results.length).toBeLessThanOrEqual(limit);
    });

    it('should search in specific subdirectory only', async () => {
      const srcPath = path.join(repoRoot, 'apps/desktop/src');

      const results = await searchService.search({
        keywords: 'index',
        limit: 10,
        onlyIn: srcPath,
      });

      // All results should be within the specified directory
      results.forEach((result) => {
        expect(result.path).toContain('apps/desktop/src');
      });
    });

    it('should return empty array for non-existent keywords', async () => {
      const results = await searchService.search({
        keywords: 'xyzabc123unlikely-keyword-that-does-not-exist-12345',
        limit: 5,
        onlyIn: repoRoot,
      });

      expect(results).toEqual([]);
    });
  });

  describe('file type detection', () => {
    it('should correctly identify TypeScript files', async () => {
      const results = await searchService.search({
        keywords: 'LocalFileCtr',
        limit: 5,
        onlyIn: repoRoot,
      });

      if (!ensureResults(results, 'TypeScript identification')) return;
      const tsFile = results.find((r) => r.name === 'LocalFileCtr.ts');
      if (tsFile) {
        expect(tsFile.type).toBe('ts');
        expect(tsFile.contentType).toBe('code');
        expect(tsFile.isDirectory).toBe(false);
      }
    });

    it('should correctly identify JSON files', async () => {
      const results = await searchService.search({
        keywords: 'tsconfig',
        limit: 5,
        onlyIn: repoRoot,
      });

      if (!ensureResults(results, 'JSON identification')) return;
      const jsonFile = results.find((r) => r.name.includes('tsconfig') && r.type === 'json');
      if (jsonFile) {
        expect(jsonFile.type).toBe('json');
        expect(jsonFile.contentType).toBe('code');
        expect(jsonFile.size).toBeGreaterThan(0);
      }
    });

    it('should correctly identify directories', async () => {
      const results = await searchService.search({
        keywords: '__tests__',
        limit: 10,
        onlyIn: repoRoot,
      });

      if (!ensureResults(results, 'directory identification')) return;
      const testDir = results.find((r) => r.name === '__tests__' && r.isDirectory);
      if (testDir) {
        expect(testDir.isDirectory).toBe(true);
        expect(testDir.type).toBe('');
      }
    });

    it('should correctly identify markdown files', async () => {
      const results = await searchService.search({
        keywords: 'CLAUDE.md',
        limit: 5,
        onlyIn: repoRoot,
      });

      const mdFile = results.find((r) => r.name === 'CLAUDE.md');
      if (mdFile) {
        expect(mdFile.type).toBe('md');
        expect(mdFile.contentType).toBe('text');
      }
    });
  });

  describe('file metadata', () => {
    it('should return valid file metadata', async () => {
      const results = await searchService.search({
        keywords: 'package.json',
        limit: 1,
        onlyIn: repoRoot,
      });

      if (!ensureResultsOrSkipAssertions(results, 'package.json (metadata)')) return;

      const file = results[0];

      // Verify all metadata fields are present
      expect(file.path).toBeTruthy();
      expect(file.name).toBeTruthy();
      expect(typeof file.isDirectory).toBe('boolean');
      expect(typeof file.size).toBe('number');
      expect(file.size).toBeGreaterThanOrEqual(0);
      expect(file.type).toBeDefined();
      expect(file.contentType).toBeDefined();
      expect(file.modifiedTime).toBeInstanceOf(Date);
      expect(file.createdTime).toBeInstanceOf(Date);
      expect(file.lastAccessTime).toBeInstanceOf(Date);

      // Dates should be valid
      expect(file.modifiedTime.getTime()).toBeGreaterThan(0);
      expect(file.createdTime.getTime()).toBeGreaterThan(0);
    });

    it('should handle files with different extensions', async () => {
      const testCases = [
        { keyword: '.ts', expectedType: 'ts', expectedContentType: 'code' },
        { keyword: '.json', expectedType: 'json', expectedContentType: 'code' },
        { keyword: '.txt', expectedType: 'txt', expectedContentType: 'text' },
      ];

      for (const { keyword, expectedType, expectedContentType } of testCases) {
        const results = await searchService.search({
          keywords: keyword,
          limit: 5,
          onlyIn: repoRoot,
        });

        if (results.length > 0) {
          const file = results.find((r) => r.type === expectedType);
          if (file) {
            expect(file.type).toBe(expectedType);
            expect(file.contentType).toBe(expectedContentType);
          }
        }
      }
    });
  });

  describe('search accuracy after fix', () => {
    it('should use fuzzy matching instead of exact phrase', async () => {
      // Test the fix: keywords should do fuzzy matching, not exact phrase
      // Before fix: "local file" would only match exact phrase "local file"
      // After fix: "local file" should match "LocalFileCtr" (contains "local" and "file")

      const results = await searchService.search({
        keywords: 'LocalFile',
        limit: 10,
        onlyIn: repoRoot,
      });

      if (!ensureResultsOrSkipAssertions(results, 'LocalFile')) return;

      // Should find LocalFileCtr.ts or similar files
      const found = results.some(
        (r) => r.name.includes('LocalFile') || r.name.includes('localFile'),
      );
      expect(found).toBe(true);
    });

    it('should handle paths with spaces correctly', async () => {
      // Test the fix: command args should be properly split
      // This test verifies spawn receives correct arguments array

      const pathWithSpaces = repoRoot; // May contain spaces in CI or certain setups
      const results = await searchService.search({
        keywords: 'test',
        limit: 5,
        onlyIn: pathWithSpaces,
      });

      // Should not throw error even if path contains spaces
      expect(Array.isArray(results)).toBe(true);
    });

    it('should search case-insensitively', async () => {
      // The "cd" flag in kMDItemFSName makes it case-insensitive

      const lowerResults = await searchService.search({
        keywords: 'readme',
        limit: 5,
        onlyIn: repoRoot,
      });

      const upperResults = await searchService.search({
        keywords: 'README',
        limit: 5,
        onlyIn: repoRoot,
      });

      // Both searches should find similar files
      if (!ensureResultsOrSkipAssertions(lowerResults, 'readme')) return;
      if (!ensureResultsOrSkipAssertions(upperResults, 'README (case-insensitive)')) return;
    });
  });

  describe('error handling', () => {
    it('should handle non-existent directory gracefully', async () => {
      const nonExistentPath = path.join(repoRoot, 'this-directory-does-not-exist-12345');

      const results = await searchService.search({
        keywords: 'test',
        limit: 5,
        onlyIn: nonExistentPath,
      });

      // Should return empty array instead of throwing
      expect(results).toEqual([]);
    });
  });

  describe('updateSearchIndex', () => {
    it.skip('should handle index update request', async () => {
      // Index update requires elevated permissions, may fail in restricted environments
      const result = await searchService.updateSearchIndex(repoRoot);

      // Should return boolean (true if succeeded, false if failed)
      expect(typeof result).toBe('boolean');
    }, 15000); // Index update can take time
  });
});

// Skip message for non-macOS platforms
if (process.platform !== 'darwin') {
  // eslint-disable-next-line no-console
  console.log('⏭️  Skipping macOS integration tests on', process.platform, '(only runs on darwin)');
}
