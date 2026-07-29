import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveAgainstCwd } from '../expandTilde';

describe('resolveAgainstCwd', () => {
  const cwd = '/Users/me/repo';

  it('anchors a relative path to cwd', () => {
    expect(resolveAgainstCwd('src/index.ts', cwd)).toBe(path.join(cwd, 'src/index.ts'));
    expect(resolveAgainstCwd('./pkg/a.ts', cwd)).toBe(path.join(cwd, 'pkg/a.ts'));
  });

  it('leaves an absolute path untouched', () => {
    expect(resolveAgainstCwd('/etc/hosts', cwd)).toBe('/etc/hosts');
  });

  it('expands ~ before considering cwd', () => {
    expect(resolveAgainstCwd('~/notes.md', cwd)).toBe(path.join(os.homedir(), 'notes.md'));
  });

  it('falls back to expandTilde behavior when cwd is absent (no regression)', () => {
    expect(resolveAgainstCwd('src/index.ts')).toBe('src/index.ts');
    expect(resolveAgainstCwd('src/index.ts', undefined)).toBe('src/index.ts');
  });

  it('passes through empty / undefined input', () => {
    expect(resolveAgainstCwd(undefined, cwd)).toBeUndefined();
    expect(resolveAgainstCwd('', cwd)).toBe('');
  });
});
