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

  it('accepts a null config so re-saving a model without config does not fail', () => {
    // The model-config modal submits the whole model card; models whose `config`
    // column is NULL read back as `null` and were rejected as an invalid object.
    expect(UpdateAiModelSchema.parse({ config: null })).toEqual({ config: null });
    expect(UpdateAiModelSchema.safeParse({ config: { deploymentName: 'deploy' } }).success).toBe(
      true,
    );
    expect(UpdateAiModelSchema.safeParse({ config: 'not-an-object' }).success).toBe(false);
  });
});

describe('Gemini reasoning config persistence', () => {
  it('preserves supported thinking levels and rejects invalid levels', () => {
    const config = {
      thinkingLevel: 'minimal',
      thinkingLevel2: 'low',
      thinkingLevel3: 'medium',
      thinkingLevel4: 'high',
    };
    expect(AiModelReasoningConfigSchema.parse(config)).toEqual(config);
    expect(AiModelReasoningConfigSchema.safeParse({ thinkingLevel3: 'minimal' }).success).toBe(
      false,
    );
    expect(AiModelReasoningConfigSchema.safeParse({ thinkingLevel4: 'medium' }).success).toBe(
      false,
    );
  });
});
