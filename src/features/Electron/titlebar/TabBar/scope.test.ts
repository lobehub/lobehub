import { describe, expect, it } from 'vitest';

import { isSameTabTarget, normalizeTabScope, resolveTabScope, tabTargetId } from './scope';

describe('desktop tab scope', () => {
  it('marks known top-level desktop routes as personal scope', () => {
    expect(resolveTabScope('/agent/personal-agent')).toEqual({ type: 'personal' });
    expect(resolveTabScope('/fleet')).toEqual({ type: 'personal' });
    expect(resolveTabScope('/settings/profile')).toEqual({ type: 'personal' });
    expect(resolveTabScope('/verify/run_1')).toEqual({ type: 'personal' });
    expect(resolveTabScope('/invite/abc')).toEqual({ type: 'personal' });
  });

  it('uses the first segment as workspace scope for workspace-prefixed URLs', () => {
    expect(resolveTabScope('/acme/agent/workspace-agent')).toEqual({
      slug: 'acme',
      type: 'workspace',
    });
    expect(resolveTabScope('/acme')).toEqual({ slug: 'acme', type: 'workspace' });
  });

  it('normalizes missing persisted scope from the item URL', () => {
    expect(normalizeTabScope(undefined, '/beta/group/g1')).toEqual({
      slug: 'beta',
      type: 'workspace',
    });
  });

  it('matches tab targets by normalized URL inside the active scope bucket', () => {
    expect(isSameTabTarget({ url: '/agent/a?b=2&a=1' }, '/agent/a?a=1&b=2')).toBe(true);

    expect(isSameTabTarget({ url: '/acme/agent/a' }, '/beta/agent/a')).toBe(false);
  });

  it('keeps the historical recent/pinned id as the normalized URL', () => {
    expect(tabTargetId('/acme/agent/a?b=2&a=1')).toBe('/acme/agent/a?a=1&b=2');
  });
});
