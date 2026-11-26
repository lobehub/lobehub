import { describe, expect, it } from 'vitest';

import type { EnabledProviderWithModels } from '@/types/aiProvider';

import { filterHiddenModels } from './filterHiddenModels';

describe('filterHiddenModels', () => {
  const list = [
    { children: [{ id: 'mini' }, { id: 'opus' }], id: 'lobehub' },
    { children: [{ id: 'opus' }], id: 'openai' },
    { children: [{ id: 'solo' }], id: 'other' },
  ] as unknown as EnabledProviderWithModels[];

  it('returns the same list without a predicate or when nothing is hidden', () => {
    expect(filterHiddenModels(list)).toBe(list);
    expect(filterHiddenModels(list, () => false)).toBe(list);
  });

  it('hides models per provider and drops providers left empty', () => {
    const result = filterHiddenModels(
      list,
      (modelId, providerId) => providerId === 'lobehub' && modelId === 'opus',
    );
    expect(result.map((p) => [p.id, p.children.map((m) => m.id)])).toEqual([
      ['lobehub', ['mini']],
      ['openai', ['opus']],
      ['other', ['solo']],
    ]);

    expect(filterHiddenModels(list, (modelId) => modelId === 'solo').map((p) => p.id)).toEqual([
      'lobehub',
      'openai',
    ]);
  });
});
