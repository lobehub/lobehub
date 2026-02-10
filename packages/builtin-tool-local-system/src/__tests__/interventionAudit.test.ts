import { describe, expect, it } from 'vitest';

import { pathScopeAudit } from '../interventionAudit';

describe('pathScopeAudit', () => {
  const metadata = { workingDirectory: '/Users/me/project' };

  describe('no intervention needed', () => {
    it('should return false when no working directory in metadata', () => {
      expect(pathScopeAudit({ path: '/anywhere' })).toBe(false);
      expect(pathScopeAudit({ path: '/anywhere' }, {})).toBe(false);
    });

    it('should return false when path is within working directory', () => {
      expect(pathScopeAudit({ path: '/Users/me/project/src/index.ts' }, metadata)).toBe(false);
    });

    it('should return false when relative path resolves within working directory', () => {
      expect(pathScopeAudit({ path: 'src/index.ts' }, metadata)).toBe(false);
    });

    it('should return false when relative directory resolves within working directory', () => {
      expect(pathScopeAudit({ directory: 'src' }, metadata)).toBe(false);
    });

    it('should resolve relative paths against tool scope when provided', () => {
      expect(
        pathScopeAudit(
          { scope: 'packages', path: 'a.ts' },
          { workingDirectory: '/Users/me/project' },
        ),
      ).toBe(false);
    });

    it('should return false when path equals working directory', () => {
      expect(pathScopeAudit({ path: '/Users/me/project' }, metadata)).toBe(false);
    });

    it('should return false for empty tool args', () => {
      expect(pathScopeAudit({}, metadata)).toBe(false);
    });
  });

  describe('intervention required', () => {
    it('should return true when path is outside working directory', () => {
      expect(pathScopeAudit({ path: '/Users/me/other-project/file.ts' }, metadata)).toBe(true);
    });

    it('should return true when relative path traversal escapes working directory', () => {
      expect(pathScopeAudit({ path: '../other-project/file.ts' }, metadata)).toBe(true);
    });

    it('should return true when file_path is outside working directory', () => {
      expect(pathScopeAudit({ file_path: '/tmp/secret.txt' }, metadata)).toBe(true);
    });

    it('should return true when directory is outside working directory', () => {
      expect(pathScopeAudit({ directory: '/etc' }, metadata)).toBe(true);
    });

    it('should return true when scope is outside working directory', () => {
      expect(pathScopeAudit({ scope: '/Users/me/other-project' }, metadata)).toBe(true);
    });

    it('should return true when pattern is an absolute glob outside working directory', () => {
      expect(pathScopeAudit({ pattern: '/Users/me/other/**/*.ts' }, metadata)).toBe(true);
    });

    it('should return false when pattern is within working directory', () => {
      expect(pathScopeAudit({ pattern: '/Users/me/project/src/**/*.ts' }, metadata)).toBe(false);
    });

    it('should ignore relative glob patterns (not a path)', () => {
      expect(pathScopeAudit({ pattern: '**/*.ts' }, metadata)).toBe(false);
      expect(pathScopeAudit({ pattern: 'src/**/*.tsx' }, metadata)).toBe(false);
    });

    it('should ignore regex patterns from grepContent', () => {
      expect(pathScopeAudit({ pattern: 'TODO|FIXME' }, metadata)).toBe(false);
      expect(pathScopeAudit({ pattern: 'function\\s+\\w+' }, metadata)).toBe(false);
      expect(pathScopeAudit({ pattern: '^import .* from' }, metadata)).toBe(false);
    });

    it('should return true when any path in items is outside working directory', () => {
      expect(
        pathScopeAudit(
          {
            items: [{ oldPath: '/Users/me/project/a.ts', newPath: '/Users/me/other/b.ts' }],
          },
          metadata,
        ),
      ).toBe(true);
    });
  });

  describe('items array handling', () => {
    it('should return false when all items paths are within working directory', () => {
      expect(
        pathScopeAudit(
          {
            items: [
              { oldPath: '/Users/me/project/a.ts', newPath: '/Users/me/project/b.ts' },
              { oldPath: '/Users/me/project/c.ts', newPath: '/Users/me/project/d.ts' },
            ],
          },
          metadata,
        ),
      ).toBe(false);
    });

    it('should handle items with only oldPath', () => {
      expect(pathScopeAudit({ items: [{ oldPath: '/outside/path.ts' }] }, metadata)).toBe(true);
    });

    it('should handle items with only newPath', () => {
      expect(pathScopeAudit({ items: [{ newPath: '/outside/path.ts' }] }, metadata)).toBe(true);
    });
  });

  describe('mixed parameters', () => {
    it('should return true if any parameter is outside, even if others are inside', () => {
      expect(
        pathScopeAudit({ path: '/Users/me/project/file.ts', scope: '/Users/me/other' }, metadata),
      ).toBe(true);
    });

    it('should return false when all parameters are within working directory', () => {
      expect(
        pathScopeAudit(
          { path: '/Users/me/project/src/file.ts', scope: '/Users/me/project' },
          metadata,
        ),
      ).toBe(false);
    });
  });

  describe('path traversal prevention', () => {
    it('should catch path traversal that escapes working directory', () => {
      expect(pathScopeAudit({ path: '/Users/me/project/../other/file.ts' }, metadata)).toBe(true);
    });

    it('should allow path traversal that stays within working directory', () => {
      expect(pathScopeAudit({ path: '/Users/me/project/src/../lib/file.ts' }, metadata)).toBe(
        false,
      );
    });
  });
});
