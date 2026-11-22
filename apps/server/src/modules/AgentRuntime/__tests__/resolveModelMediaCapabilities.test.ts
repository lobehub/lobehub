import type { AiFullModelCard, LobeDefaultAiModelListItem } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { resolveModelMediaCapabilities } from '../resolveModelMediaCapabilities';

const builtinModels: LobeDefaultAiModelListItem[] = [
  {
    abilities: { vision: true },
    enabled: true,
    id: 'gpt-4o',
    providerId: 'openai',
    source: 'builtin',
    type: 'chat',
  },
  {
    abilities: { audio: true, vision: true },
    enabled: true,
    id: 'gemini-2.5-pro',
    providerId: 'google',
    source: 'builtin',
    type: 'chat',
  },
];

describe('resolveModelMediaCapabilities', () => {
  it('prefers non-empty DB userAbilities over both serverModels and builtinModels', () => {
    const serverModels: AiFullModelCard[] = [
      { abilities: { video: true, vision: true }, id: 'gpt-4o', type: 'chat' },
    ];

    expect(
      resolveModelMediaCapabilities({
        builtinModels,
        model: 'gpt-4o',
        provider: 'openai',
        serverModels,
        userAbilities: { vision: false },
      }),
    ).toEqual({ audio: false, video: false, vision: false });
  });

  it('uses serverModels abilities for env-configured custom models absent from builtinModels', () => {
    const serverModels: AiFullModelCard[] = [
      {
        abilities: { functionCall: true, reasoning: true, vision: true },
        id: 'custom-vlm',
        type: 'chat',
      },
    ];

    expect(
      resolveModelMediaCapabilities({
        builtinModels,
        model: 'custom-vlm',
        provider: 'openai',
        serverModels,
      }),
    ).toEqual({ functionCall: true, reasoning: true, vision: true });
  });

  it('lets serverModels override bundled abilities when *_MODEL_LIST adds capabilities', () => {
    const serverModels: AiFullModelCard[] = [
      {
        abilities: { video: true, vision: true },
        id: 'gpt-4o',
        type: 'chat',
      },
    ];

    expect(
      resolveModelMediaCapabilities({
        builtinModels,
        model: 'gpt-4o',
        provider: 'openai',
        serverModels,
      }),
    ).toEqual({ video: true, vision: true });
  });

  it('matches serverModels by deploymentName when id does not match directly', () => {
    const serverModels: AiFullModelCard[] = [
      {
        abilities: { vision: true },
        config: { deploymentName: 'vlm-prod-deploy' },
        id: 'custom-vlm',
        type: 'chat',
      },
    ];

    expect(
      resolveModelMediaCapabilities({
        builtinModels: [],
        model: 'vlm-prod-deploy',
        provider: 'azure',
        serverModels,
      }),
    ).toEqual({ vision: true });
  });

  it('falls back to builtinModels (provider-scoped then canonical) when serverModels has no abilities', () => {
    const serverModels: AiFullModelCard[] = [{ abilities: {}, id: 'gpt-4o', type: 'chat' }];

    expect(
      resolveModelMediaCapabilities({
        builtinModels,
        model: 'gpt-4o',
        provider: 'openai',
        serverModels,
      }),
    ).toEqual({ vision: true });

    expect(
      resolveModelMediaCapabilities({
        builtinModels,
        model: 'gemini-2.5-pro',
        provider: 'openrouter',
      }),
    ).toEqual({ audio: true, vision: true });
  });
});
