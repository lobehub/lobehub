import { describe, expect, it } from 'vitest';

import { CreateAiModelSchema, UpdateAiModelSchema } from './aiModel';

describe('AI model mutation schemas', () => {
  it('strips deployment-owned compatibility metadata from user mutations', () => {
    const agentCompatibility = {
      serverDefaultHeterogeneousProfiles: ['kimi-code/anthropic-v1'],
    };

    expect(
      CreateAiModelSchema.parse({
        agentCompatibility,
        id: 'custom-model',
        providerId: 'custom-provider',
      }),
    ).toEqual({ id: 'custom-model', providerId: 'custom-provider' });

    expect(UpdateAiModelSchema.parse({ agentCompatibility })).toEqual({});
  });
});
