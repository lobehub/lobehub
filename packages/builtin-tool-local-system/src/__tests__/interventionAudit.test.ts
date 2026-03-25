import { describe, expect, it } from 'vitest';

import { createPathScopeAudit, pathScopeAudit } from '../interventionAudit';

describe('pathScopeAudit', () => {
  const metadata = { workingDirectory: '/Users/me/project' };

  describe('no intervention needed', () => {
    it('should return false when no working directory in metadata', async () => {
      await expect(pathScopeAudit({ path: '/anywhere' })).resolves.toBe(false);
      await expect(pathScopeAudit({ path: '/anywhere' }, {})).resolves.toBe(false);
    });

    it('should return false when path is within working directory', async () => {
      await expect(
        pathScopeAudit({ path: '/Users/me/project/src/index.ts' }, metadata),
      ).resolves.toBe(false);
    });

    it('should return false when relative path resolves within working directory', async () => {
      await expect(pathScopeAudit({ path: 'src/index.ts' }, metadata)).resolves.toBe(false);
    });

    it('should return false when relative directory resolves within working directory', async () => {
      await expect(pathScopeAudit({ directory: 'src' }, metadata)).resolves.toBe(false);
    });

    it('should resolve relative paths against tool scope when provided', async () => {
      await expect(
        pathScopeAudit(
          { scope: 'packages', path: 'a.ts' },
          { workingDirectory: '/Users/me/project' },
        ),
      ).resolves.toBe(false);
    });

    it('should return false when path equals working directory', async () => {
      await expect(pathScopeAudit({ path: '/Users/me/project' }, metadata)).resolves.toBe(false);
    });

    it('should return false for empty tool args', async () => {
      await expect(pathScopeAudit({}, metadata)).resolves.toBe(false);
    });
  });

  describe('intervention required', () => {
    it('should return true when path is outside working directory', async () => {
      await expect(
        pathScopeAudit({ path: '/Users/me/other-project/file.ts' }, metadata),
      ).resolves.toBe(true);
    });

    it('should return true when relative path traversal escapes working directory', async () => {
      await expect(pathScopeAudit({ path: '../other-project/file.ts' }, metadata)).resolves.toBe(
        true,
      );
    });

    it('should return true when file_path is outside working directory', async () => {
      await expect(pathScopeAudit({ file_path: '/home/other/secret.txt' }, metadata)).resolves.toBe(
        true,
      );
    });

    it('should return true when directory is outside working directory', async () => {
      await expect(pathScopeAudit({ directory: '/etc' }, metadata)).resolves.toBe(true);
    });

    it('should return true when scope is outside working directory', async () => {
      await expect(pathScopeAudit({ scope: '/Users/me/other-project' }, metadata)).resolves.toBe(
        true,
      );
    });

    it('should return true when pattern is an absolute glob outside working directory', async () => {
      await expect(pathScopeAudit({ pattern: '/Users/me/other/**/*.ts' }, metadata)).resolves.toBe(
        true,
      );
    });

    it('should return false when pattern is within working directory', async () => {
      await expect(
        pathScopeAudit({ pattern: '/Users/me/project/src/**/*.ts' }, metadata),
      ).resolves.toBe(false);
    });

    it('should ignore relative glob patterns (not a path)', async () => {
      await expect(pathScopeAudit({ pattern: '**/*.ts' }, metadata)).resolves.toBe(false);
      await expect(pathScopeAudit({ pattern: 'src/**/*.tsx' }, metadata)).resolves.toBe(false);
    });

    it('should ignore regex patterns from grepContent', async () => {
      await expect(pathScopeAudit({ pattern: 'TODO|FIXME' }, metadata)).resolves.toBe(false);
      await expect(pathScopeAudit({ pattern: 'function\\s+\\w+' }, metadata)).resolves.toBe(false);
      await expect(pathScopeAudit({ pattern: '^import .* from' }, metadata)).resolves.toBe(false);
    });

    it('should return true when any path in items is outside working directory', async () => {
      await expect(
        pathScopeAudit(
          {
            items: [{ oldPath: '/Users/me/project/a.ts', newPath: '/Users/me/other/b.ts' }],
          },
          metadata,
        ),
      ).resolves.toBe(true);
    });
  });

  describe('items array handling', () => {
    it('should return false when all items paths are within working directory', async () => {
      await expect(
        pathScopeAudit(
          {
            items: [
              { oldPath: '/Users/me/project/a.ts', newPath: '/Users/me/project/b.ts' },
              { oldPath: '/Users/me/project/c.ts', newPath: '/Users/me/project/d.ts' },
            ],
          },
          metadata,
        ),
      ).resolves.toBe(false);
    });

    it('should handle items with only oldPath', async () => {
      await expect(
        pathScopeAudit({ items: [{ oldPath: '/outside/path.ts' }] }, metadata),
      ).resolves.toBe(true);
    });

    it('should handle items with only newPath', async () => {
      await expect(
        pathScopeAudit({ items: [{ newPath: '/outside/path.ts' }] }, metadata),
      ).resolves.toBe(true);
    });
  });

  describe('mixed parameters', () => {
    it('should return true if any parameter is outside, even if others are inside', async () => {
      await expect(
        pathScopeAudit({ path: '/Users/me/project/file.ts', scope: '/Users/me/other' }, metadata),
      ).resolves.toBe(true);
    });

    it('should return false when all parameters are within working directory', async () => {
      await expect(
        pathScopeAudit(
          { path: '/Users/me/project/src/file.ts', scope: '/Users/me/project' },
          metadata,
        ),
      ).resolves.toBe(false);
    });
  });

  describe('safe path exclusions', () => {
    it('should require intervention for safe-path candidates when no resolver is configured', async () => {
      await expect(pathScopeAudit({ path: '/tmp/test-file.ts' }, metadata)).resolves.toBe(true);
      await expect(pathScopeAudit({ file_path: '/tmp/secret.txt' }, metadata)).resolves.toBe(true);
      await expect(pathScopeAudit({ directory: '/tmp' }, metadata)).resolves.toBe(true);
      await expect(pathScopeAudit({ path: '/tmp/subdir/file.ts' }, metadata)).resolves.toBe(true);
    });

    it('should skip intervention when an injected resolver confirms all safe paths', async () => {
      const safePathAudit = createPathScopeAudit({
        areAllPathsSafe: async () => true,
      });

      await expect(safePathAudit({ path: '/tmp/test-file.ts' }, metadata)).resolves.toBe(false);
      await expect(safePathAudit({ path: '/var/tmp/output.log' }, metadata)).resolves.toBe(false);
      await expect(
        safePathAudit(
          {
            items: [{ oldPath: '/tmp/a.ts', newPath: '/tmp/b.ts' }],
          },
          metadata,
        ),
      ).resolves.toBe(false);
    });

    it('should still require intervention when mixing safe and unsafe paths', async () => {
      const safePathAudit = createPathScopeAudit({
        areAllPathsSafe: async () => true,
      });

      await expect(
        safePathAudit(
          {
            items: [{ oldPath: '/tmp/a.ts', newPath: '/Users/me/other/b.ts' }],
          },
          metadata,
        ),
      ).resolves.toBe(true);
    });
  });

  describe('path traversal prevention', () => {
    it('should catch path traversal that escapes working directory', async () => {
      await expect(
        pathScopeAudit({ path: '/Users/me/project/../other/file.ts' }, metadata),
      ).resolves.toBe(true);
    });

    it('should allow path traversal that stays within working directory', async () => {
      await expect(
        pathScopeAudit({ path: '/Users/me/project/src/../lib/file.ts' }, metadata),
      ).resolves.toBe(false);
    });
  });
});
