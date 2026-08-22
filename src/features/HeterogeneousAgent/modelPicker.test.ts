import type { LobeDefaultAiModelListItem } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { resolveServerDefaultModelMeta } from './modelPicker';

const catalogItem = (partial: {
  displayName?: string;
  id: string;
  providerId: string;
}): LobeDefaultAiModelListItem =>
  ({
    abilities: {},
    ...partial,
  }) as LobeDefaultAiModelListItem;

describe('resolveServerDefaultModelMeta', () => {
  it('prefers the LobeHub catalog entry over another provider with the same id', () => {
    const meta = resolveServerDefaultModelMeta('gpt-5.6', [
      catalogItem({ displayName: 'OpenAI GPT', id: 'gpt-5.6', providerId: 'openai' }),
      catalogItem({ displayName: 'GPT-5.6', id: 'gpt-5.6', providerId: 'lobehub' }),
    ]);

    expect(meta?.displayName).toBe('GPT-5.6');
  });

  it('falls back to any catalog match, then to undefined', () => {
    expect(
      resolveServerDefaultModelMeta('gpt-5.6', [
        catalogItem({ displayName: 'OpenAI GPT', id: 'gpt-5.6', providerId: 'openai' }),
      ])?.displayName,
    ).toBe('OpenAI GPT');
    expect(resolveServerDefaultModelMeta('gpt-5.6-sol', [])).toBeUndefined();
  });
});
