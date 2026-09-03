import { describe, expect, it } from 'vitest';

import { mergeShareConfig } from './shareConfigPatch';

describe('mergeShareConfig', () => {
  const base = {
    allowReadMemory: false,
    toolGrants: [{ identifier: 'a' }],
    maxTopicsPerVisitor: 5,
    maxTurnsPerTopic: 20,
    monthlySpendLimit: 10,
  };

  it('overwrites only the patched keys', () => {
    expect(mergeShareConfig(base, { maxTurnsPerTopic: 30 })).toEqual({
      ...base,
      maxTurnsPerTopic: 30,
    });
  });

  it('overwrites the spend cap with a zero cap, mirroring the server jsonb merge', () => {
    const merged = mergeShareConfig(base, { monthlySpendLimit: 0 });

    expect(merged.monthlySpendLimit).toBe(0);
    expect(merged.maxTopicsPerVisitor).toBe(5);
  });

  it('does not mutate the base', () => {
    mergeShareConfig(base, { toolGrants: [{ identifier: 'a' }, { identifier: 'b' }] });

    expect(base.toolGrants).toEqual([{ identifier: 'a' }]);
  });
});
