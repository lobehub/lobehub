import { describe, expect, it } from 'vitest';

import { AiModelReasoningConfigSchema, CreateAiModelSchema, UpdateAiModelSchema } from './aiModel';

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

describe('AiModelReasoningConfigSchema', () => {
  it('keeps a known effort level and rejects an unknown one', () => {
    const config = { reasoningEffort: 'minimal', reasoningMode: 'pro' };
    expect(AiModelReasoningConfigSchema.parse(config)).toEqual(config);
    expect(AiModelReasoningConfigSchema.safeParse({ reasoningEffort: 'ultra' }).success).toBe(
      false,
    );
  });
});
