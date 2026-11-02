import { describe, expect, it } from 'vitest';

import { type EnabledProviderWithModels } from '@/types/aiProvider';

import { mergeProviderModelLists } from './mergeProviderModelLists';

const provider = (id: string, models: string[]) =>
  ({
    children: models.map((model) => ({ abilities: {}, displayName: model, id: model })),
    id,
    name: id,
    source: 'builtin',
  }) as unknown as EnabledProviderWithModels;

describe('mergeProviderModelLists', () => {
  it('appends extra models to the matching provider and adds new providers', () => {
    const merged = mergeProviderModelLists(
      [provider('openrouter', ['gpt-mini']), provider('openai', ['gpt-4o'])],
      [
        provider('openrouter', ['jev', 'gpt-mini']),
        provider('typesafe', ['one']),
        provider('x', []),
      ],
    );

    expect(merged.map(({ children, id }) => [id, children.map((model) => model.id)])).toEqual([
      ['openrouter', ['gpt-mini', 'jev']],
      ['openai', ['gpt-4o']],
      ['typesafe', ['one']],
    ]);
  });

  it('returns the base list unchanged when there is nothing to merge', () => {
    const base = [provider('openai', ['gpt-4o'])];
    expect(mergeProviderModelLists(base, [])).toBe(base);
  });

  it('does not mutate its inputs', () => {
    const base = [provider('openrouter', ['gpt-mini'])];
    mergeProviderModelLists(base, [provider('openrouter', ['jev'])]);
    expect(base[0].children).toHaveLength(1);
  });
});
