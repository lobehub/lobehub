import { describe, expect, it } from 'vitest';

import {
  filterAicoManagedProviders,
  isAicoManagedRuntimeProvider,
} from './isManagedRuntimeProvider';

describe('isAicoManagedRuntimeProvider', () => {
  it('accepts wallet-backed providers only', () => {
    expect(isAicoManagedRuntimeProvider('aico')).toBe(true);
    expect(isAicoManagedRuntimeProvider('openrouter')).toBe(true);
    expect(isAicoManagedRuntimeProvider('openai')).toBe(false);
    expect(isAicoManagedRuntimeProvider('google')).toBe(false);
    expect(isAicoManagedRuntimeProvider(undefined)).toBe(false);
  });

  it('filters provider groups to managed ids', () => {
    const list = [
      { children: [{ id: 'auto' }], id: 'openrouter' },
      { children: [{ id: 'gpt-4o' }], id: 'openai' },
      { children: [], id: 'aico' },
    ];
    expect(filterAicoManagedProviders(list).map((p) => p.id)).toEqual(['openrouter', 'aico']);
  });
});
