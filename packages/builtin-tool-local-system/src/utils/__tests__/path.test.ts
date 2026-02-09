import { describe, expect, it } from 'vitest';

import { normalizePathForScope, resolveArgsWithScope, resolvePathWithScope } from '../path';

describe('normalizePathForScope', () => {
  it('should normalize a simple absolute path', () => {
    expect(normalizePathForScope('/Users/me/project')).toBe('/Users/me/project');
  });

  it('should strip trailing slash', () => {
    expect(normalizePathForScope('/Users/me/project/')).toBe('/Users/me/project');
  });

  it('should keep root as /', () => {
    expect(normalizePathForScope('/')).toBe('/');
  });

  it('should normalize .. segments', () => {
    expect(normalizePathForScope('/Users/me/project/../other')).toBe('/Users/me/other');
  });

  it('should convert backslashes to forward slashes', () => {
    expect(normalizePathForScope('C:\\Users\\me\\project')).toBe('c:/Users/me/project');
  });

  it('should normalize drive letter to lowercase', () => {
    expect(normalizePathForScope('D:/workspace')).toBe('d:/workspace');
  });

  it('should treat empty string as root', () => {
    expect(normalizePathForScope('')).toBe('/');
  });

  it('should prepend slash to relative-looking path', () => {
    expect(normalizePathForScope('foo/bar')).toBe('/foo/bar');
  });
});

describe('resolvePathWithScope', () => {
  it('should return scope when no inputPath is provided', () => {
    expect(resolvePathWithScope(undefined, '/workspace')).toBe('/workspace');
  });

  it('should return inputPath as-is when no scope is provided', () => {
    expect(resolvePathWithScope('/some/path', undefined)).toBe('/some/path');
  });

  it('should return undefined when both are undefined', () => {
    expect(resolvePathWithScope(undefined, undefined)).toBeUndefined();
  });

  it('should return absolute inputPath as-is, ignoring scope', () => {
    expect(resolvePathWithScope('/absolute/path', '/workspace')).toBe('/absolute/path');
  });

  it('should join relative inputPath with scope', () => {
    expect(resolvePathWithScope('src/index.ts', '/workspace')).toBe('/workspace/src/index.ts');
  });

  it('should join relative path with dots', () => {
    expect(resolvePathWithScope('../other/file.ts', '/workspace/project')).toBe(
      '/workspace/other/file.ts',
    );
  });

  it('should handle scope with trailing slash', () => {
    expect(resolvePathWithScope('file.ts', '/workspace/')).toBe('/workspace/file.ts');
  });

  it('should return empty-string inputPath joined with scope', () => {
    expect(resolvePathWithScope('', '/workspace')).toBe('/workspace');
  });

  it('should join glob pattern with scope', () => {
    expect(resolvePathWithScope('**/*.ts', '/workspace')).toBe('/workspace/**/*.ts');
  });

  it('should join relative glob pattern with scope', () => {
    expect(resolvePathWithScope('src/**/*.tsx', '/workspace')).toBe('/workspace/src/**/*.tsx');
  });

  it('should return absolute glob pattern as-is', () => {
    expect(resolvePathWithScope('/absolute/**/*.ts', '/workspace')).toBe('/absolute/**/*.ts');
  });
});

describe('resolveArgsWithScope', () => {
  it('should resolve path field from scope when path is not provided', () => {
    const args = { scope: '/workspace' };
    const result = resolveArgsWithScope(args, 'path');
    expect((result as any).path).toBe('/workspace');
  });

  it('should resolve relative path field with scope', () => {
    const args = { path: 'src/file.ts', scope: '/workspace' };
    const result = resolveArgsWithScope(args, 'path');
    expect(result.path).toBe('/workspace/src/file.ts');
  });

  it('should leave absolute path unchanged', () => {
    const args = { path: '/absolute/file.ts', scope: '/workspace' };
    const result = resolveArgsWithScope(args, 'path');
    expect(result).toBe(args); // same reference, no copy
  });

  it('should use fallbackScope when args.scope is not provided', () => {
    const args = { path: 'src/file.ts' } as { scope?: string; path: string };
    const result = resolveArgsWithScope(args, 'path', '/fallback');
    expect(result.path).toBe('/fallback/src/file.ts');
  });

  it('should prefer args.scope over fallbackScope', () => {
    const args = { scope: '/explicit', path: 'file.ts' };
    const result = resolveArgsWithScope(args, 'path', '/fallback');
    expect(result.path).toBe('/explicit/file.ts');
  });

  it('should return same reference when nothing changes', () => {
    const args = { path: '/absolute/path' } as { scope?: string; path: string };
    const result = resolveArgsWithScope(args, 'path');
    expect(result).toBe(args);
  });

  it('should work with directory field', () => {
    const args = { directory: 'subdir', scope: '/workspace' };
    const result = resolveArgsWithScope(args, 'directory');
    expect((result as any).directory).toBe('/workspace/subdir');
  });

  it('should fill directory from scope when directory is undefined', () => {
    const args = { scope: '/workspace' };
    const result = resolveArgsWithScope(args, 'directory');
    expect((result as any).directory).toBe('/workspace');
  });

  it('should not mutate the original args', () => {
    const args = { path: 'relative', scope: '/workspace' };
    const originalPath = args.path;
    resolveArgsWithScope(args, 'path');
    expect(args.path).toBe(originalPath);
  });
});
