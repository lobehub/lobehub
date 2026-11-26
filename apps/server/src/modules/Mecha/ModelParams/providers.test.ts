// @vitest-environment node
import type { LobeDefaultAiModelListItem } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { createServerModelParamsProviders } from './providers';

vi.mock('@/database/models/aiModel', () => ({ AiModelModel: class {} }));
vi.mock('@/database/models/topic', () => ({ TopicModel: class {} }));

describe('createServerModelParamsProviders', () => {
  it('keeps the output window on the cards so a run can freeze it', () => {
    const providers = createServerModelParamsProviders({
      builtinModels: [
        {
          abilities: {},
          enabled: true,
          id: 'claude-opus-5-5',
          maxOutput: 128_000,
          providerId: 'anthropic',
          source: 'builtin',
          type: 'chat',
        },
        {
          abilities: {},
          enabled: true,
          id: 'text-embedding-3-small',
          providerId: 'openai',
          source: 'builtin',
          type: 'embedding',
        },
      ] as unknown as LobeDefaultAiModelListItem[],
    });

    expect(providers.listModelCards()).toEqual([
      expect.objectContaining({ id: 'claude-opus-5-5', maxOutput: 128_000 }),
      expect.objectContaining({ id: 'text-embedding-3-small', maxOutput: undefined }),
    ]);
  });
});
