import { describe, expect, it } from 'vitest';

import { buildCacheScope } from './useCacheScope';

describe('buildCacheScope', () => {
  it('falls back to anon/personal', () => {
    expect(buildCacheScope(undefined, undefined)).toBe('anon:personal');
    expect(buildCacheScope(null, null)).toBe('anon:personal');
  });

  it('combines user and workspace', () => {
    expect(buildCacheScope('u1', 'w1')).toBe('u1:w1');
    expect(buildCacheScope('u1', null)).toBe('u1:personal');
  });

  it('isolates different users and workspaces', () => {
    expect(buildCacheScope('u1', 'w1')).not.toBe(buildCacheScope('u2', 'w1'));
    expect(buildCacheScope('u1', 'w1')).not.toBe(buildCacheScope('u1', 'w2'));
  });
});
