import { describe, expect, it } from 'vitest';

import { mergeShareConfig } from './shareConfigPatch';

describe('mergeShareConfig', () => {
  const base = {
    allowReadMemory: false,
    enabledToolIds: ['a'],
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

  it('removes a key patched with null, mirroring the server jsonb merge', () => {
    const merged = mergeShareConfig(base, { monthlySpendLimit: null });

    expect('monthlySpendLimit' in merged).toBe(false);
    expect(merged.maxTopicsPerVisitor).toBe(5);
  });

  it('does not mutate the base', () => {
    mergeShareConfig(base, { enabledToolIds: ['a', 'b'] });

    expect(base.enabledToolIds).toEqual(['a']);
  });
});
